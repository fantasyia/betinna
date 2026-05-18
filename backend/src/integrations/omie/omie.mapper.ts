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
   * Ratio default pra estimar precoFabrica a partir de precoTabela.
   * Configurável via env `OMIE_PRECO_FABRICA_RATIO`. Único call-site
   * (OmieProdutosService) injeta o ratio do env; tests usam o default.
   *
   * TODO: integrar OMIE `tabela_de_preco` (ListarTabelasPreco + por produto)
   * pra ler precoFabrica REAL. Heurística fica como fallback pra produtos
   * que não estão em nenhuma tabela auxiliar.
   */
  static readonly DEFAULT_PRECO_FABRICA_RATIO = 0.7;

  /**
   * Converte um OmieProduto em payload de upsert.
   * Usa codigo (SKU) + codigo_produto (codigoOmie) pra identificar.
   *
   * @param ratio fração aplicada em precoTabela para estimar precoFabrica.
   *   Default 0.7 (70%). Aceita 0–1.
   */
  static produtoToPrismaUpsert(
    empresaId: string,
    o: OmieProduto,
    ratio: number = OmieMapper.DEFAULT_PRECO_FABRICA_RATIO,
  ): {
    where: Prisma.ProdutoWhereUniqueInput;
    create: Prisma.ProdutoUncheckedCreateInput;
    update: Prisma.ProdutoUncheckedUpdateInput;
  } | null {
    const codigoOmie = o.codigo_produto?.toString();
    if (!codigoOmie) return null;

    const precoTabela = o.valor_unitario ?? 0;
    // Heurística: precoFabrica = precoTabela * ratio (default 70%).
    // TODO: substituir por consulta a OMIE `tabela_de_preco` quando o cliente
    // configurar tabelas auxiliares. Ratio configurável via env por empresa.
    const safeRatio = ratio >= 0 && ratio <= 1 ? ratio : OmieMapper.DEFAULT_PRECO_FABRICA_RATIO;
    const precoFabrica = Number((precoTabela * safeRatio).toFixed(2));

    const now = new Date();
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
        precoFabrica,
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
        precoFabrica,
        estoque: o.quantidade_estoque ?? 0,
        estoqueAtualizadoEm: now,
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
   * "dd/MM/yyyy" + "HH:mm:ss" (opcional) → Date.
   * Aceita também a string completa "dd/MM/yyyy HH:mm:ss" no primeiro parâmetro.
   * Retorna null se formato inválido.
   *
   * OMIE não declara timezone — assumimos horário do servidor OMIE (BRT/UTC-3).
   * Pra MVP isso é OK porque comparamos com `ultimoSync` que é nosso `new Date()`
   * em UTC e a margem de 3h só faria sync re-importar produtos já recentes — não
   * causa loss, no máximo trabalho duplicado em janela curta.
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
    return new Date(
      Date.UTC(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        m[4] ? Number(m[4]) : 0,
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
