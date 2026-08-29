import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { ClientesService } from '@modules/clientes/clientes.service';
import { PricingService } from '@modules/produtos/pricing.service';
import { CatalogShareService } from './catalog-share.service';
import { CatalogoPdfService, type LinhaCatalogoPdf } from './catalogo-pdf.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ocultaCusto, precosParaRep } from '@shared/utils/custo-oculto.util';
import type { BulkUpsertCatalogoDto, ShareCatalogDto, UpsertCatalogoItemDto } from './catalogo.dto';

/**
 * Qual tabela de preços o material mostra.
 *
 * O REP fica preso em `locacao` (ele loca, não vende — regra do Léo). Gestão
 * escolhe: venda, locação ou as duas juntas.
 */
export type TabelaDePrecos = 'venda' | 'locacao' | 'ambos';

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
    /** Preço de VENDA. `null` quando quem lê é REP — ele loca, não vende. */
    precoTabela: number | null;
    /** Custo. `null` quando não informado (não inventamos mais o chute de 70%). */
    precoFabrica: number | null;
    /** Mensalidade de locação. É o ÚNICO preço que o REP enxerga. */
    precoLocacaoMensal: number | null;
    popularidade: number;
    ativo: boolean;
    estoque: number;
    estoqueAtualizadoEm: Date | null;
  };
}

export interface PreviewItem extends CatalogoItem {
  /** `null` quando o rep não tem mensalidade definida pra o item (tela mostra "—"). */
  precoFinal: number | null;
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
  /** `null` quando o catálogo veio de um REP: ele loca, e preço de venda não é
   *  oferta dele. A tela do cliente mostra o `precoFinal`. */
  precoTabela: number | null;
}
export interface PublicShareItem {
  produtoId: string;
  produto: PublicShareProduto;
  precoFinal: number | null;
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
    private readonly pdf: CatalogoPdfService,
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
    return (await this.listMyCatalogInterno(user)).map((it) => ({
      ...it,
      // Catálogo do REP: locação sim, venda e custo não.
      produto: precosParaRep(user, it.produto),
    }));
  }

  /**
   * Mesma listagem, SEM a máscara de preços do rep.
   *
   * Existe porque o preview PRA O CLIENTE precisa calcular preço, e calcular em
   * cima do valor mascarado dava zero na tela do cliente — a máscara é de
   * exibição pro rep, não de dado. (Quebrou o teste do preview na primeira
   * tentativa; o teste estava certo.)
   */
  private async listMyCatalogInterno(user: AuthenticatedUser): Promise<CatalogoItem[]> {
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
            precoLocacaoMensal: true,
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
        precoLocacaoMensal:
          it.produto.precoLocacaoMensal == null ? null : Number(it.produto.precoLocacaoMensal),
      },
    }));
  }

  async upsertItem(user: AuthenticatedUser, dto: UpsertCatalogoItemDto): Promise<CatalogoItem> {
    const empresaId = this.requireEmpresa(user);
    await this.assertProdutoDaEmpresa(empresaId, dto.produtoId);

    const item = await this.prisma.repCatalogoItem.upsert({
      where: { usuarioId_produtoId: { usuarioId: user.id, produtoId: dto.produtoId } },
      // Sem markup (D5): adicionar produto é só vinculá-lo ao catálogo — o preço
      // é o da empresa. Re-adicionar é idempotente (update vazio). A coluna
      // `markup` foi DROPADA do schema em 2026-06-17; o comentário antigo ainda
      // falava do "default 0" e mandava gente procurar campo que não existe.
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
            precoLocacaoMensal: true,
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
      // Mesmo gate do listMyCatalog: adicionar item ao catálogo devolve o
      // produto, e essa resposta chegava com preço de venda e custo pro rep.
      produto: precosParaRep(user, {
        ...item.produto,
        precoTabela: Number(item.produto.precoTabela),
        precoFabrica: item.produto.precoFabrica == null ? null : Number(item.produto.precoFabrica),
        precoLocacaoMensal:
          item.produto.precoLocacaoMensal == null ? null : Number(item.produto.precoLocacaoMensal),
      }),
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
  /**
   * PDF do catálogo — o material que o rep manda pro cliente.
   *
   * O preço é resolvido AQUI, com a mesma regra da tela: o representante loca,
   * então o que sai no papel é a mensalidade; para os outros papéis sai o preço
   * final do cliente (negociado quando houver). O gerador de PDF não decide
   * preço — decidir preço em dois lugares é como o número errado chega ao
   * cliente.
   */
  async exportarPdf(
    user: AuthenticatedUser,
    clienteId?: string,
    precos: TabelaDePrecos = 'venda',
  ): Promise<{ filename: string; base64: string }> {
    const empresaId = this.requireEmpresa(user);
    const itens = clienteId
      ? await this.previewParaCliente(user, clienteId)
      : await this.previewSemCliente(user);
    if (itens.length === 0) {
      throw new BusinessRuleException(
        'Seu catálogo está vazio. Adicione produtos antes de gerar o PDF.',
      );
    }

    const [empresa, rep, cliente] = await Promise.all([
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nome: true, cnpj: true, config: true },
      }),
      this.prisma.usuario.findUnique({
        where: { id: user.id },
        select: { nome: true, email: true, telefone: true },
      }),
      clienteId
        ? this.prisma.cliente.findFirst({
            where: { id: clienteId, empresaId },
            select: { nome: true, cnpj: true },
          })
        : Promise.resolve(null),
    ]);

    const cfg = (empresa?.config as Record<string, unknown> | null) ?? {};
    const estoqueCfg = (cfg.estoque as { modo?: string; diasMontagem?: number } | null) ?? null;
    const sobEncomenda = estoqueCfg?.modo === 'sob_encomenda';
    const dias = typeof estoqueCfg?.diasMontagem === 'number' ? estoqueCfg.diasMontagem : null;
    const repLoca = ocultaCusto(user);

    // O REP não escolhe: ele loca, então o papel dele manda — mesmo que a
    // requisição peça outra coisa. Quem escolhe é gestão (admin/diretor/gerente).
    const tabela: TabelaDePrecos = repLoca ? 'locacao' : precos;

    const linhas: LinhaCatalogoPdf[] = itens.map((i) => ({
      nome: i.produto.nome,
      detalhe: [i.produto.sku, i.produto.marca, i.produto.linha].filter(Boolean).join(' · '),
      imagem: i.produto.imagem,
      precos: this.colunasDePreco(tabela, i),
      disponibilidade: this.textoDisponibilidade(i.produto.estoque, sobEncomenda, dias),
      negociado: i.precoNegociado,
    }));

    const pdf = await this.pdf.gerar({
      empresa: { nome: empresa?.nome ?? 'Catálogo', cnpj: empresa?.cnpj ?? null },
      representante: {
        nome: rep?.nome ?? '',
        email: rep?.email ?? null,
        telefone: rep?.telefone ?? null,
      },
      cliente: cliente ? { nome: cliente.nome, cnpj: cliente.cnpj } : null,
      geradoEm: new Date(),
      itens: linhas,
    });

    const nomeArquivo = cliente
      ? `catalogo-${cliente.nome
          .replace(/[^\w]+/g, '-')
          .toLowerCase()
          .slice(0, 40)}.pdf`
      : 'catalogo.pdf';
    return { filename: nomeArquivo, base64: pdf.toString('base64') };
  }

  /**
   * As colunas de preço do material, na ordem em que aparecem.
   *
   * `venda` usa o preço FINAL do cliente (negociado quando existe) — é o número
   * que vale na proposta. `locacao` usa a mensalidade do produto. `ambos` mostra
   * os dois lado a lado, que é o caso de quem apresenta as duas modalidades na
   * mesma reunião.
   */
  private colunasDePreco(
    tabela: TabelaDePrecos,
    item: PreviewItem,
  ): Array<{ rotulo: string; valor: number | null }> {
    const venda = { rotulo: 'Venda', valor: item.precoFinal };
    const locacao = { rotulo: 'Locação / mês', valor: item.produto.precoLocacaoMensal };
    if (tabela === 'locacao') return [locacao];
    if (tabela === 'ambos') return [venda, locacao];
    return [venda];
  }

  /**
   * O que o cliente lê como disponibilidade.
   *
   * Sob encomenda, saldo não diz nada (o produto é montado depois do pedido) —
   * o que vale é o PRAZO. Mandar "0 em estoque" num catálogo de venda é tiro no
   * pé: parece falta de produto quando é o modelo de operação.
   */
  private textoDisponibilidade(
    estoque: number,
    sobEncomenda: boolean,
    diasMontagem: number | null,
  ): string {
    if (sobEncomenda) {
      if (diasMontagem == null) return 'Sob encomenda';
      if (diasMontagem === 0) return 'Sob encomenda · montagem no mesmo dia';
      return `Sob encomenda · ${diasMontagem} dia${diasMontagem === 1 ? '' : 's'} útil${
        diasMontagem === 1 ? '' : 'eis'
      }`;
    }
    if (estoque <= 0) return 'Sob consulta';
    return `${estoque} em estoque`;
  }

  async previewSemCliente(user: AuthenticatedUser): Promise<PreviewItem[]> {
    this.requireEmpresa(user);
    const catalog = await this.listMyCatalogInterno(user);
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
      // REP LOCA: o preço que ele mostra ao cliente é a mensalidade, não o
      // preço de venda. Sem mensalidade definida vai null — a tela mostra "—"
      // em vez de exibir um valor de venda que ninguém deveria estar oferecendo.
      const precoFinal = ocultaCusto(user)
        ? (c.produto.precoLocacaoMensal ?? null)
        : (resolved?.precoFinal ?? Number(c.produto.precoTabela));
      return {
        ...c,
        produto: precosParaRep(user, c.produto),
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
    /** Quando o link deixa de funcionar (respeita o "válido até" escolhido). */
    expiraEm: string;
  }> {
    if (!user.empresaIdAtiva) {
      throw new BusinessRuleException('Empresa não definida');
    }
    // HISTÓRICO, pra não voltar atrás sem entender: por um tempo isto recusava
    // quem não fosse REP. O motivo era real — o `resolverShareToken` exigia
    // `role: 'REP'` no dono, então link de diretor nascia morto e o cliente
    // batia em "Representante não encontrado". A correção certa, feita em
    // 29/08, foi tirar a exigência de papel do RESOLVER: o catálogo é de quem o
    // montou, e diretor/gerente também apresentam catálogo a cliente. O gate
    // que sobra é o que importa — usuário ATIVO e vinculado à empresa do token.
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
    // A tela deixa o rep escolher "válido até" e o backend ACEITAVA e IGNORAVA:
    // o link vivia sempre os 7 dias globais, com o preço negociado dentro. Agora
    // a data escolhida encurta o TTL de verdade (nunca estica além do global).
    let ttlSegundos: number | undefined;
    if (dto.validoAte) {
      const restanteMs = dto.validoAte.getTime() - Date.now();
      if (restanteMs <= 0) {
        throw new BusinessRuleException('A validade escolhida já passou. Escolha uma data futura.');
      }
      ttlSegundos = Math.floor(restanteMs / 1000);
    }
    const token = await this.share.gerar(
      {
        repId: user.id,
        clienteId,
        empresaId: user.empresaIdAtiva,
      },
      ttlSegundos,
    );
    const tetoTtl = this.share.ttlMaximoSegundos;
    const validadeEfetivaMs = Math.min(ttlSegundos ?? tetoTtl, tetoTtl) * 1000;
    return {
      ok: true,
      canal: dto.canal,
      clienteId: clienteId ?? null,
      itens: items.length,
      token,
      previewUrl: `/catalogo/share/${token}`,
      // Validade REAL do link (o rep pode ter pedido menos que o teto global).
      expiraEm: new Date(Date.now() + validadeEfetivaMs).toISOString(),
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
    // Reconstruir AuthenticatedUser mínimo pra reuso de previewParaCliente.
    // O vínculo com a empresa DO TOKEN entra no filtro: o fluxo normal de editar
    // usuário troca os vínculos SEM desativar, então um rep movido de tenant
    // (ou removido da empresa) seguia com o link vivo, servindo o catálogo e os
    // preços negociados da empresa que ele deixou.
    const dono = await this.prisma.usuario.findFirst({
      where: {
        id: payload.repId,
        status: 'ATIVO',
        empresas: { some: { empresaId: payload.empresaId } },
      },
      select: { id: true, nome: true, role: true },
    });
    if (!dono) {
      throw new BusinessRuleException('Este link não está mais disponível.');
    }
    // Tenant desativado (churn/inadimplência) não serve mais catálogo público.
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: payload.empresaId, ativo: true },
      select: { id: true },
    });
    if (!empresa) {
      throw new BusinessRuleException('Este link não está mais disponível.');
    }
    // O papel REAL do dono entra aqui de propósito: é ele que decide o preço que
    // o link mostra. Catálogo de REP sai com a mensalidade de locação (ele não
    // vende); catálogo de diretor/gerente sai com o preço de venda. Fixar 'REP'
    // faria o link do diretor exibir locação — o número errado pro cliente dele.
    const fakeAuth: AuthenticatedUser = {
      id: dono.id,
      email: '',
      nome: dono.nome,
      role: dono.role,
      empresaIds: [payload.empresaId],
      empresaIdAtiva: payload.empresaId,
    };
    // Token sem clienteId = share livre (sem vínculo). Preview "genérico".
    const produtos = payload.clienteId
      ? await this.previewParaCliente(fakeAuth, payload.clienteId)
      : await this.previewSemCliente(fakeAuth);
    return {
      rep: { id: dono.id, nome: dono.nome },
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
        precoTabela: p.produto.precoTabela == null ? null : Number(p.produto.precoTabela),
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
