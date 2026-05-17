import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ClientesService } from '@modules/clientes/clientes.service';
import { PricingService } from '@modules/produtos/pricing.service';
import { CatalogShareService } from './catalog-share.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  BulkUpsertCatalogoDto,
  SetMarkupGlobalDto,
  ShareCatalogDto,
  UpsertCatalogoItemDto,
} from './catalogo.dto';

export interface CatalogoItem {
  id: string;
  produtoId: string;
  markup: number;
  produto: {
    id: string;
    nome: string;
    sku: string | null;
    marca: string | null;
    linha: string | null;
    unidade: string | null;
    imagem: string | null;
    precoTabela: number;
    precoFabrica: number;
    popularidade: number;
    ativo: boolean;
  };
}

export interface PreviewItem extends CatalogoItem {
  precoFinal: number;
  precoNegociado: boolean;
}

/**
 * Catálogo personalizado do representante.
 *
 * Cada rep monta o seu próprio subset de produtos da empresa,
 * com markup % aplicado sobre o preço de tabela. Quando envia
 * pra um cliente, o preço final considera:
 *   1. Preço negociado do cliente (se houver, via PricingService)
 *   2. Markup do rep aplicado sobre o preço resultante
 */
@Injectable()
export class CatalogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientes: ClientesService,
    private readonly pricing: PricingService,
    private readonly share: CatalogShareService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  async listMyCatalog(user: AuthenticatedUser): Promise<CatalogoItem[]> {
    const empresaId = this.requireEmpresa(user);
    const items = await this.prisma.repCatalogoItem.findMany({
      where: {
        usuarioId: user.id,
        produto: { empresaId, ativo: true },
      },
      include: {
        produto: {
          select: {
            id: true,
            nome: true,
            sku: true,
            marca: true,
            linha: true,
            unidade: true,
            imagem: true,
            precoTabela: true,
            precoFabrica: true,
            popularidade: true,
            ativo: true,
          },
        },
      },
      orderBy: { produto: { nome: 'asc' } },
    });
    return items as CatalogoItem[];
  }

  async upsertItem(user: AuthenticatedUser, dto: UpsertCatalogoItemDto): Promise<CatalogoItem> {
    const empresaId = this.requireEmpresa(user);
    await this.assertProdutoDaEmpresa(empresaId, dto.produtoId);

    const item = await this.prisma.repCatalogoItem.upsert({
      where: { usuarioId_produtoId: { usuarioId: user.id, produtoId: dto.produtoId } },
      update: { markup: dto.markup },
      create: { usuarioId: user.id, produtoId: dto.produtoId, markup: dto.markup },
      include: {
        produto: {
          select: {
            id: true,
            nome: true,
            sku: true,
            marca: true,
            linha: true,
            unidade: true,
            imagem: true,
            precoTabela: true,
            precoFabrica: true,
            popularidade: true,
            ativo: true,
          },
        },
      },
    });
    return item as CatalogoItem;
  }

  async bulkUpsert(
    user: AuthenticatedUser,
    dto: BulkUpsertCatalogoDto,
  ): Promise<{ ok: true; processados: number }> {
    const empresaId = this.requireEmpresa(user);
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const count = await this.prisma.produto.count({
      where: { id: { in: ids }, empresaId },
    });
    if (count !== ids.length) {
      throw new BusinessRuleException('Um ou mais produtos não pertencem à sua empresa');
    }
    await this.prisma.$transaction(
      dto.itens.map((item) =>
        this.prisma.repCatalogoItem.upsert({
          where: {
            usuarioId_produtoId: { usuarioId: user.id, produtoId: item.produtoId },
          },
          update: { markup: item.markup },
          create: { usuarioId: user.id, produtoId: item.produtoId, markup: item.markup },
        }),
      ),
    );
    return { ok: true, processados: dto.itens.length };
  }

  async setMarkupGlobal(
    user: AuthenticatedUser,
    dto: SetMarkupGlobalDto,
  ): Promise<{ ok: true; atualizados: number }> {
    this.requireEmpresa(user);
    const { count } = await this.prisma.repCatalogoItem.updateMany({
      where: { usuarioId: user.id },
      data: { markup: dto.markup },
    });
    return { ok: true, atualizados: count };
  }

  async removeItem(user: AuthenticatedUser, produtoId: string): Promise<void> {
    const existing = await this.prisma.repCatalogoItem.findUnique({
      where: { usuarioId_produtoId: { usuarioId: user.id, produtoId } },
    });
    if (!existing) throw new NotFoundException('Item do catálogo');
    await this.prisma.repCatalogoItem.delete({
      where: { usuarioId_produtoId: { usuarioId: user.id, produtoId } },
    });
  }

  async clear(user: AuthenticatedUser): Promise<{ ok: true; removidos: number }> {
    this.requireEmpresa(user);
    const { count } = await this.prisma.repCatalogoItem.deleteMany({
      where: { usuarioId: user.id },
    });
    return { ok: true, removidos: count };
  }

  /**
   * Preview do catálogo do rep aplicado a um cliente específico.
   * Mostra qual preço o cliente vai ver — usando preço negociado
   * quando houver e aplicando o markup do rep sobre o resultado.
   */
  async previewParaCliente(user: AuthenticatedUser, clienteId: string): Promise<PreviewItem[]> {
    // Valida acesso ao cliente (também garante mesma empresa que o rep)
    const empresaId = this.requireEmpresa(user);
    await this.clientes.findById(user, clienteId);

    const catalog = await this.listMyCatalog(user);
    if (catalog.length === 0) return [];

    // AUDITORIA 2026-05-15 P0: PricingService agora exige empresaId
    const priceMap = await this.pricing.priceForClientBatch(
      empresaId,
      clienteId,
      catalog.map((c) => c.produtoId),
    );

    return catalog.map((c) => {
      const resolved = priceMap.get(c.produtoId);
      const baseTrade = resolved?.precoFinal ?? c.produto.precoTabela;
      const precoFinal = Math.round(baseTrade * (1 + c.markup / 100) * 100) / 100;
      return {
        ...c,
        precoFinal,
        precoNegociado: Boolean(resolved?.negociado && resolved.vigente),
      };
    });
  }

  /**
   * Compartilhar catálogo com cliente (WhatsApp / PDF / Link público).
   *
   * Sprint 2026-05-17 (audit fix): gera JWT signed com TTL (default 7d).
   * URL final: `/catalogo/share/<token>` — endpoint público `:token` decodifica
   * e retorna preview SE token válido e não expirado.
   *
   * Segurança:
   *  - Token assinado HS256 com secret derivada da ENCRYPTION_KEY
   *  - Expira em 7 dias (config via CATALOG_SHARE_TTL_SECONDS)
   *  - Cliente clica no link → backend valida → mostra preview
   *  - Sem token válido = 401 Unauthorized
   */
  async shareWithClient(
    user: AuthenticatedUser,
    dto: ShareCatalogDto,
  ): Promise<{
    ok: true;
    canal: string;
    clienteId: string;
    itens: number;
    token: string;
    previewUrl: string;
  }> {
    if (!user.empresaIdAtiva) {
      throw new BusinessRuleException('Empresa não definida');
    }
    const cliente = await this.clientes.findById(user, dto.clienteId);
    const items = await this.previewParaCliente(user, dto.clienteId);
    if (items.length === 0) {
      throw new BusinessRuleException(
        'Seu catálogo está vazio. Adicione produtos antes de compartilhar.',
      );
    }
    const token = await this.share.gerar({
      repId: user.id,
      clienteId: cliente.id,
      empresaId: user.empresaIdAtiva,
    });
    return {
      ok: true,
      canal: dto.canal,
      clienteId: cliente.id,
      itens: items.length,
      token,
      previewUrl: `/catalogo/share/${token}`,
    };
  }

  /**
   * Acessa preview do catálogo via token público (sem auth).
   * Usado pelo endpoint `GET /catalogo/share/:token`.
   */
  async resolverShareToken(
    token: string,
  ): Promise<{ rep: { id: string; nome: string }; produtos: unknown[] }> {
    const payload = await this.share.validar(token);
    // Reconstruir AuthenticatedUser mínimo pra reuso de previewParaCliente
    const rep = await this.prisma.usuario.findUnique({
      where: { id: payload.repId },
      select: { id: true, nome: true, status: true, role: true },
    });
    if (!rep || rep.status !== 'ATIVO' || rep.role !== 'REP') {
      throw new BusinessRuleException('Representante não encontrado ou inativo. Link inválido.');
    }
    const fakeAuth: AuthenticatedUser = {
      id: rep.id,
      email: '',
      nome: rep.nome,
      role: rep.role,
      empresaIds: [payload.empresaId],
      empresaIdAtiva: payload.empresaId,
    };
    const produtos = await this.previewParaCliente(fakeAuth, payload.clienteId);
    return {
      rep: { id: rep.id, nome: rep.nome },
      produtos,
    };
  }

  private async assertProdutoDaEmpresa(empresaId: string, produtoId: string): Promise<void> {
    const produto = await this.prisma.produto.findFirst({
      where: { id: produtoId, empresaId, ativo: true },
      select: { id: true },
    });
    if (!produto) {
      throw new BusinessRuleException('Produto inexistente, inativo ou de outra empresa');
    }
  }
}
