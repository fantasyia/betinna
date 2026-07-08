import type { ClienteOmieStatus, Prisma } from '@prisma/client';
import type { OmieCliente, OmiePedidoItem, OmieProduto } from './omie.types';

/**
 * Conversores entre formato OMIE e modelos internos.
 *
 * Mantém a "estranheza" da OMIE (datas dd/mm/aaaa, S/N, etc) isolada aqui.
 */
export class OmieMapper {
  /**
   * Converte um OmieCliente em payload de upsert do Prisma.
   * Multi-tenant: empresaId precisa vir de fora.
   */
  static clienteToPrismaUpsert(
    empresaId: string,
    o: OmieCliente,
  ): {
    where: Prisma.ClienteWhereUniqueInput;
    create: Prisma.ClienteUncheckedCreateInput;
    update: Prisma.ClienteUncheckedUpdateInput;
  } | null {
    const codigoOmie = o.codigo_cliente_omie?.toString();
    if (!codigoOmie) return null;

    const omieStatus: ClienteOmieStatus = o.bloqueado === 'S' ? 'BLOQUEADO' : 'ATIVO';
    const telefone = this.formatTelefone(o.telefone1_ddd, o.telefone1_numero);
    const data = {
      empresaId,
      codigoOmie,
      nome: o.razao_social,
      cnpj: o.cnpj_cpf || null,
      email: o.email || null,
      telefone,
      cidade: o.cidade || null,
      uf: o.estado || null,
      omieStatus,
      // status interno baseado em sinais do OMIE
      status: o.inativo === 'S' ? ('INATIVO' as const) : ('ATIVO' as const),
    };
    return {
      where: { empresaId_codigoOmie: { empresaId, codigoOmie } },
      create: data,
      update: {
        nome: data.nome,
        cnpj: data.cnpj,
        email: data.email,
        telefone: data.telefone,
        cidade: data.cidade,
        uf: data.uf,
        omieStatus: data.omieStatus,
        status: data.status,
      },
    };
  }

  /**
   * Converte um OmieProduto em payload de upsert.
   * Usa codigo (SKU) + codigo_produto (codigoOmie) pra identificar.
   *
   * NÃO preenche o custo (precoFabrica): o OMIE só manda o preço de venda, não o
   * custo. Em produto NOVO o custo fica null; em produto EXISTENTE não é tocado
   * (preserva o que foi digitado à mão). Custo real entra quando a tabela de
   * preço do OMIE for integrada.
   */
  static produtoToPrismaUpsert(
    empresaId: string,
    o: OmieProduto,
  ): {
    where: Prisma.ProdutoWhereUniqueInput;
    create: Prisma.ProdutoUncheckedCreateInput;
    update: Prisma.ProdutoUncheckedUpdateInput;
  } | null {
    const codigoOmie = o.codigo_produto?.toString();
    if (!codigoOmie) return null;

    const precoTabela = o.valor_unitario ?? 0;

    const now = new Date();
    // OMIE nem sempre devolve `quantidade_estoque` em ListarProdutos. Campo AUSENTE
    // (≠ zero real) NÃO deve sobrescrever o estoque local nem virar 0 — senão um
    // produto com saldo é lido como "zerado" e dispara ESTOQUE_ZERADO falso. No
    // UPDATE só tocamos o estoque quando o campo veio de fato. (Migração pro
    // endpoint dedicado ListarPosEstoque fica pro plugue do OMIE real.)
    const temEstoque = typeof o.quantidade_estoque === 'number';
    const estoqueUpdate = temEstoque
      ? { estoque: o.quantidade_estoque as number, estoqueAtualizadoEm: now }
      : {};
    return {
      where: { empresaId_codigoOmie: { empresaId, codigoOmie } },
      create: {
        empresaId,
        codigoOmie,
        sku: o.codigo || null,
        nome: o.descricao,
        descricao: o.descricao_detalhada || null,
        marca: o.marca || null,
        unidade: o.unidade || null,
        precoTabela,
        precoFabrica: null, // custo não vem do OMIE — null até definir à mão / tabela real
        estoque: o.quantidade_estoque ?? 0,
        estoqueAtualizadoEm: now,
        ativo: o.inativo !== 'S',
      },
      update: {
        sku: o.codigo || null,
        nome: o.descricao,
        descricao: o.descricao_detalhada || null,
        marca: o.marca || null,
        unidade: o.unidade || null,
        precoTabela,
        // precoFabrica NÃO é tocado no sync — preserva o custo já definido à mão.
        // estoque só quando o OMIE mandou o campo (senão preserva o valor local).
        ...estoqueUpdate,
        ativo: o.inativo !== 'S',
      },
    };
  }

  /**
   * Converte item de pedido interno → formato OMIE.
   */
  static pedidoItemToOmie(item: {
    produtoCodigoOmie: string | null;
    produtoSku: string | null;
    quantidade: number;
    precoUnitario: number;
    desconto: number;
  }): OmiePedidoItem {
    const produto: OmiePedidoItem['produto'] = {
      quantidade: item.quantidade,
      valor_unitario: item.precoUnitario,
      percentual_desconto: item.desconto > 0 ? item.desconto : undefined,
    };
    if (item.produtoCodigoOmie) {
      produto.codigo_produto = Number(item.produtoCodigoOmie);
    } else if (item.produtoSku) {
      produto.codigo_produto_integracao = item.produtoSku;
    }
    return { ide: {}, produto };
  }

  /**
   * Converte uma amostra → item OMIE de remessa de amostra grátis.
   *
   * Diferenças pro item de pedido normal:
   *  - CFOP de remessa (5911 mesma UF / 6911 interestadual) é forçado;
   *  - valor_unitario é o valor de REFERÊNCIA (a amostra é grátis, mas o OMIE
   *    exige um valor pra base de cálculo/estatística);
   *  - sem desconto (não faz sentido em remessa grátis).
   */
  static amostraItemToOmie(item: {
    produtoCodigoOmie: string | null;
    produtoSku: string | null;
    quantidade: number;
    valorReferencia: number;
    cfop: string;
  }): OmiePedidoItem {
    const produto: OmiePedidoItem['produto'] = {
      quantidade: item.quantidade,
      valor_unitario: item.valorReferencia,
      cfop: item.cfop,
    };
    if (item.produtoCodigoOmie) {
      produto.codigo_produto = Number(item.produtoCodigoOmie);
    } else if (item.produtoSku) {
      produto.codigo_produto_integracao = item.produtoSku;
    }
    return { ide: {}, produto };
  }

  /** Date → "dd/mm/aaaa" (formato OMIE). */
  static dateToOmie(date: Date): string {
    const d = date.getUTCDate().toString().padStart(2, '0');
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }

  /** "dd/mm/aaaa" → Date (UTC midnight). */
  static omieToDate(s: string | undefined | null): Date | null {
    if (!s) return null;
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }

  /**
   * "dd/MM/yyyy" + "HH:mm:ss" (opcional) → Date (instante UTC real).
   * Aceita também a string completa "dd/MM/yyyy HH:mm:ss" no primeiro parâmetro.
   * Retorna null se formato inválido.
   *
   * OMIE devolve horário de parede em BRT (UTC-3, fixo — Brasil sem DST desde 2019) e não declara
   * timezone. CAÇADA-BUG #10: antes montávamos o Date com `Date.UTC(...)` direto dos números, o que
   * tratava o BRT como se fosse UTC → o instante saía 3h ANTES do real. Como o sync incremental
   * compara `alterado <= ultimoSync` (ultimoSync = nosso `new Date()`, UTC real), um registro
   * alterado no OMIE até 3h APÓS o sync era pulado PARA SEMPRE (ex.: alterado 02:00 BRT = 05:00 UTC,
   * mas parseado como 02:00 UTC ≤ 04:00 UTC do sync → nunca reimportado). Somamos +3h pra obter o
   * instante UTC correto (Date.UTC normaliza o overflow de hora/dia).
   */
  static omieDateTimeToDate(
    dateStr: string | undefined | null,
    timeStr?: string | undefined | null,
  ): Date | null {
    if (!dateStr) return null;
    // Aceita "dd/MM/yyyy" ou "dd/MM/yyyy HH:mm:ss"
    const combinado = timeStr ? `${dateStr} ${timeStr}` : dateStr;
    const m = combinado.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    const BRT_OFFSET_HORAS = 3; // BRT = UTC-3 → soma 3h pra chegar no instante UTC
    return new Date(
      Date.UTC(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        (m[4] ? Number(m[4]) : 0) + BRT_OFFSET_HORAS,
        m[5] ? Number(m[5]) : 0,
        m[6] ? Number(m[6]) : 0,
      ),
    );
  }

  private static formatTelefone(ddd?: string, numero?: string): string | null {
    if (!ddd && !numero) return null;
    return `(${ddd ?? ''}) ${numero ?? ''}`.trim();
  }
}
