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
import type { BulkUpsertCatalogoDto, ShareCatalogDto, UpsertCatalogoItemDto } from './catalogo.dto';

export interface CatalogoItem {
  id: string;
  produtoId: string;
  produto: {
    id: string;
    nome: string;
    sku: string | null;
    marca: string | null;
    linha: string | null;
    unidade: string | null;
    imagem: string | null;
    precoTabela: number;
    /** Custo. `null` quando não informado (não inventamos mais o chute de 70%). */
    precoFabrica: number | null;
    popularidade: number;
    ativo: boolean;
    estoque: number;
    estoqueAtualizadoEm: Date | null;
  };
}

export interface PreviewItem extends CatalogoItem {
  precoFinal: number;
  precoNegociado: boolean;
}

/**
 * Projeção PÚBLICA de um item de catálogo (endpoint @Public de share/:token, visto pelo cliente
 * final). Só campos não-sensíveis — SEM precoFabrica (custo), estoque, popularidade ou flags. #6.
 */
export interface PublicShareProduto {
  id: string;
  nome: string;
  sku: string | null;
  marca: string | null;
  linha: string | null;
  unidade: string | null;
  imagem: string | null;
  precoTabela: number;
}
export interface PublicShareItem {
  produtoId: string;
  produto: PublicShareProduto;
  precoFinal: number;
  precoNegociado: boolean;
}

/**
 * Catálogo personalizado do representante.
 *
 * Cada rep monta o seu próprio subset de produtos da empresa. O preço é o
 * definido pela empresa (MSM) — o rep NÃO aplica markup sobre nada. Quando
 * envia pra um cliente, o preço final é:
 *   1. Preço negociado do cliente (se houver, via PricingService), senão
 *   2. Preço de tabela da empresa.
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
            estoque: true,
            estoqueAtualizadoEm: true,
          },
        },
      },
      orderBy: { produto: { nome: 'asc' } },
    });
    // Converte dinheiro Decimal→number na fronteira (interface CatalogoItem usa number).
    return items.map((it) => ({
      id: it.id,
      produtoId: it.produtoId,
      produto: {
        ...it.produto,
        precoTabela: Number(it.produto.precoTabela),
        precoFabrica: it.produto.precoFabrica == null ? null : Number(it.produto.precoFabrica),
      },
    }));
  }

  async upsertItem(user: AuthenticatedUser, dto: UpsertCatalogoItemDto): Promise<CatalogoItem> {
    const empresaId = this.requireEmpresa(user);
    await this.assertProdutoDaEmpresa(empresaId, dto.produtoId);

    const item = await this.prisma.repCatalogoItem.upsert({
      where: { usuarioId_produtoId: { usuarioId: user.id, produtoId: dto.produtoId } },
      // Sem markup: adicionar produto é só vinculá-lo ao catálogo (preço = MSM).
      // Re-adicionar é idempotente (update vazio). markup default 0 no schema.
      update: {},
      create: { usuarioId: user.id, produtoId: dto.produtoId },
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
            estoque: true,
            estoqueAtualizadoEm: true,
          },
        },
      },
    });
    // Converte dinheiro Decimal→number na fronteira (interface CatalogoItem usa number).
    return {
      id: item.id,
      produtoId: item.produtoId,
      produto: {
        ...item.produto,
        precoTabela: Number(item.produto.precoTabela),
        precoFabrica: item.produto.precoFabrica == null ? null : Number(item.produto.precoFabrica),
      },
    };
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
          update: {},
          create: { usuarioId: user.id, produtoId: item.produtoId },
        }),
      ),
    );
    return { ok: true, processados: dto.itens.length };
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
   * Preview "livre" do catálogo do rep — SEM cliente vinculado.
   * Preço = tabela da empresa (MSM). Sem markup. Não considera preços
   * negociados (não há cliente alvo).
   *
   * Usado quando o rep compartilha catálogo "pra qualquer pessoa"
   * (envio livre via link público sem cadastro de cliente).
   */
  async previewSemCliente(user: AuthenticatedUser): Promise<PreviewItem[]> {
    this.requireEmpresa(user);
    const catalog = await this.listMyCatalog(user);
    if (catalog.length === 0) return [];
    return catalog.map((c) => ({
      ...c,
      precoFinal: Number(c.produto.precoTabela),
      precoNegociado: false,
    }));
  }

  /**
   * Preview do catálogo do rep aplicado a um cliente específico.
   * Mostra qual preço o cliente vai ver: preço negociado do cliente quando
   * houver, senão a tabela da empresa (MSM). Sem markup do rep.
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
      const precoFinal = resolved?.precoFinal ?? Number(c.produto.precoTabela);
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
    clienteId: string | null;
    itens: number;
    token: string;
    previewUrl: string;
  }> {
    if (!user.empresaIdAtiva) {
      throw new BusinessRuleException('Empresa não definida');
    }
    // Vínculo com cliente é OPCIONAL — share livre quando dto.clienteId vazio.
    let clienteId: string | undefined;
    let items: PreviewItem[];
    if (dto.clienteId) {
      const cliente = await this.clientes.findById(user, dto.clienteId);
      items = await this.previewParaCliente(user, dto.clienteId);
      clienteId = cliente.id;
    } else {
      items = await this.previewSemCliente(user);
    }
    if (items.length === 0) {
      throw new BusinessRuleException(
        'Seu catálogo está vazio. Adicione produtos antes de compartilhar.',
      );
    }
    const token = await this.share.gerar({
      repId: user.id,
      clienteId,
      empresaId: user.empresaIdAtiva,
    });
    return {
      ok: true,
      canal: dto.canal,
      clienteId: clienteId ?? null,
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
  ): Promise<{ rep: { id: string; nome: string }; produtos: PublicShareItem[] }> {
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
    // Token sem clienteId = share livre (sem vínculo). Preview "genérico".
    const produtos = payload.clienteId
      ? await this.previewParaCliente(fakeAuth, payload.clienteId)
      : await this.previewSemCliente(fakeAuth);
    return {
      rep: { id: rep.id, nome: rep.nome },
      // CAÇADA-BUG #6: este endpoint é @Public() — o CLIENTE final vê o JSON. Projetar só campos
      // públicos: NUNCA vazar precoFabrica (custo = margem da empresa), estoque, popularidade nem
      // flags internas. Só nome/preço/identificação do produto + preço final da negociação.
      produtos: produtos.map((p) => this.toPublicShareItem(p)),
    };
  }

  /** Projeção pública do preview (endpoint @Public de share): remove custo/estoque/flags internas. */
  private toPublicShareItem(p: PreviewItem): PublicShareItem {
    return {
      produtoId: p.produtoId,
      produto: {
        id: p.produto.id,
        nome: p.produto.nome,
        sku: p.produto.sku,
        marca: p.produto.marca,
        linha: p.produto.linha,
        unidade: p.produto.unidade,
        imagem: p.produto.imagem,
        precoTabela: Number(p.produto.precoTabela),
      },
      precoFinal: p.precoFinal,
      precoNegociado: p.precoNegociado,
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
