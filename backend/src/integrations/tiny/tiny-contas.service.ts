import { Injectable, Logger } from '@nestjs/common';
import { TinyClientService } from './tiny-client.service';

export interface LancamentoFinanceiro {
  /** Contato no ERP que RECEBE (a pagar) ou PAGA (a receber). */
  idContato: number;
  valor: number;
  /** Quando vence — 'YYYY-MM-DD'. */
  dataVencimento: string;
  /** Mês a que o lançamento PERTENCE — 'YYYY-MM'. É o que fecha o DRE. */
  dataCompetencia?: string;
  numeroDocumento?: string;
  historico?: string;
  idCategoria?: number;
  /**
   * U = única (DEFAULT — e é sempre enviado). Recorrente (M = mensal…) é SÓ a
   * mensalidade de locação do representante; comissão e venda do site são
   * lançamento único. Omitir o campo deixava o Tiny decidir — e ele criou
   * comissão como conta recorrente.
   */
  ocorrencia?: 'U' | 'W' | 'Q' | 'M' | 'T' | 'S' | 'A' | 'P';
  /** Enum do Tiny (15 = Pix, 5 = Boleto, 21 = transferência…). Sem ele a conta nasce "não definida". */
  formaPagamento?: number;
  /** Dia do vencimento (1–31) — campo DA RECORRÊNCIA; só vai quando a ocorrência não é única. */
  diaVencimento?: number;
}

/**
 * Contas a pagar e a receber no ERP.
 *
 * É onde a comissão vira dinheiro de verdade: o Tiny tem **um** vendedor por
 * pedido e não expõe comissão na API (é campo de painel), então a comissão é
 * modelada como CONTA A PAGAR — que, contabilmente, é o que ela é.
 *
 * Dois campos carregam a regra que o Léo definiu e que não pode escorregar:
 *
 *  - `dataCompetencia` ('YYYY-MM') é o mês do FATURAMENTO. É ele que decide em
 *    que mês o custo aparece no resultado. Errar aqui infla um mês e esvazia o
 *    outro, e o erro só aparece no fechamento contábil.
 *  - `dataVencimento` é dia 05 do mês SEGUINTE. Nota de 05/01 e de 29/01 vencem
 *    as duas em 05/02 — vencimento é caixa, competência é resultado, e misturar
 *    os dois é o erro clássico.
 */
@Injectable()
export class TinyContasService {
  private readonly logger = new Logger(TinyContasService.name);

  constructor(private readonly client: TinyClientService) {}

  /** Reescreve uma conta a pagar já criada (valor/histórico) — reprocessamento da folha. */
  async atualizarContaPagar(empresaId: string, id: number, l: LancamentoFinanceiro): Promise<void> {
    // O PUT aceita SÓ estes campos (spec) — contato e histórico ficam como estão.
    await this.client.put(empresaId, `/contas-pagar/${id}`, {
      valor: Math.round(l.valor * 100) / 100,
      dataVencimento: l.dataVencimento,
      ...(l.dataCompetencia ? { dataCompetencia: l.dataCompetencia } : {}),
      ...(l.idCategoria ? { categoria: { id: l.idCategoria } } : {}),
    });
  }

  /**
   * Marca uma conta a pagar como CANCELADA. É o máximo que a API deixa: não
   * existe DELETE, e o PUT recusa valor 0 ("deve ser maior que 0"). O marcador
   * é visível na lista do painel e é o sinal pra quem apaga à mão.
   */
  /**
   * Estado de uma conta a pagar no ERP. É como o app descobre que o financeiro
   * BAIXOU a comissão — o pagamento acontece lá, não aqui.
   *
   * `situacao` ∈ aberto | cancelada | pago | parcial | prevista | atrasadas | emissao.
   */
  async obterContaPagar(
    empresaId: string,
    id: number,
  ): Promise<{
    id: number;
    situacao?: string;
    dataLiquidacao?: string;
    valorPago?: number;
  } | null> {
    return this.client
      .get<{
        id: number;
        situacao?: string;
        dataLiquidacao?: string;
        valorPago?: number;
      }>(empresaId, `/contas-pagar/${id}`)
      .catch(() => null);
  }

  async marcarContaPagarCancelada(empresaId: string, id: number): Promise<void> {
    const atuais = await this.client
      .get<Array<{ descricao?: string }>>(empresaId, `/contas-pagar/${id}/marcadores`)
      .catch(() => [] as Array<{ descricao?: string }>);
    if ((atuais ?? []).some((m) => (m.descricao ?? '').toUpperCase() === 'CANCELADA')) return;
    await this.client.post(empresaId, `/contas-pagar/${id}/marcadores`, [
      { descricao: 'CANCELADA' },
    ]);
  }

  async criarContaPagar(empresaId: string, l: LancamentoFinanceiro): Promise<number> {
    const r = await this.client.post<{ id: number }>(empresaId, '/contas-pagar', this.corpo(l));
    this.logger.log(
      `[tiny] conta a pagar criada id=${r?.id} valor=${l.valor} venc=${l.dataVencimento}`,
    );
    return r.id;
  }

  /** Contas a receber que a NOTA gerou (o Tiny cria sozinho quando a nota tem parcelas). */
  async listarContasReceberDaNota(
    empresaId: string,
    idNota: number,
  ): Promise<Array<{ id: number; valor?: number; dataVencimento?: string }>> {
    const r = await this.client.get<{
      itens?: Array<{ id: number; valor?: number; dataVencimento?: string }>;
    }>(empresaId, '/contas-receber', { idNota, limit: 50 });
    return r.itens ?? [];
  }

  /**
   * Marca uma conta a RECEBER como CANCELADA. Mesma limitação da conta a pagar:
   * a API não apaga nem zera, e o estorno nem sempre remove o lançamento.
   */
  /** A conta a receber ainda existe? Cancelar a NF com "estornar contas" a APAGA. */
  async contaReceberExiste(empresaId: string, id: number): Promise<boolean> {
    return this.client
      .get(empresaId, `/contas-receber/${id}`)
      .then(() => true)
      .catch(() => false);
  }

  async marcarContaReceberCancelada(empresaId: string, id: number): Promise<void> {
    const atuais = await this.client
      .get<Array<{ descricao?: string }>>(empresaId, `/contas-receber/${id}/marcadores`)
      .catch(() => [] as Array<{ descricao?: string }>);
    if ((atuais ?? []).some((m) => (m.descricao ?? '').toUpperCase() === 'CANCELADA')) return;
    await this.client.post(empresaId, `/contas-receber/${id}/marcadores`, [
      { descricao: 'CANCELADA' },
    ]);
  }

  /** Só o que o PUT de conta a receber aceita: categoria (e datas). */
  async categorizarContaReceber(empresaId: string, id: number, idCategoria: number): Promise<void> {
    await this.client.put(empresaId, `/contas-receber/${id}`, { categoria: { id: idCategoria } });
  }

  async criarContaReceber(empresaId: string, l: LancamentoFinanceiro): Promise<number> {
    const r = await this.client.post<{ id: number }>(empresaId, '/contas-receber', this.corpo(l));
    this.logger.log(
      `[tiny] conta a receber criada id=${r?.id} valor=${l.valor} venc=${l.dataVencimento}`,
    );
    return r.id;
  }

  /**
   * Acha o id de uma categoria de receita/despesa pelo nome.
   *
   * Sem categoria o lançamento entra "sem classificação" e some do DRE por
   * categoria — funciona, mas não serve pro relatório que motivou tudo isso.
   * Falha aqui NÃO derruba o lançamento: melhor conta a pagar sem categoria do
   * que comissão não provisionada.
   */
  async acharCategoria(empresaId: string, nome: string): Promise<number | null> {
    try {
      const r = await this.client.get<{ itens?: Array<{ id: number; descricao?: string }> }>(
        empresaId,
        '/categorias-receita-despesa',
        // ⚠️ limit acima de 100 → HTTP 400. Com 200 a busca falhava calada e TODA
        // conta a pagar de comissão entrava sem categoria.
        { limit: 100 },
      );
      // Sem acento e sem caixa: "Comissões sobre vendas" tem que bater com
      // "comissoes sobre vendas" digitado no painel.
      const chave = (t: string) =>
        t
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();
      const alvo = (r.itens ?? []).find((c) => chave(c.descricao ?? '') === chave(nome));
      return alvo?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `[tiny] não consegui listar categorias: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private corpo(l: LancamentoFinanceiro): Record<string, unknown> {
    return {
      contato: { id: l.idContato },
      // Centavos arredondados aqui, uma vez: dinheiro com casa sobrando vira
      // divergência de um centavo entre o app e o ERP, e isso ninguém concilia.
      valor: Math.round(l.valor * 100) / 100,
      dataVencimento: l.dataVencimento,
      ...(l.dataCompetencia ? { dataCompetencia: l.dataCompetencia } : {}),
      ...(l.numeroDocumento ? { numeroDocumento: l.numeroDocumento } : {}),
      ...(l.historico ? { historico: l.historico } : {}),
      ...(l.idCategoria ? { categoria: { id: l.idCategoria } } : {}),
      // Sempre explícito: única salvo quem pediu recorrência (locação).
      ocorrencia: l.ocorrencia ?? 'U',
      // A pagar chama de `formaPagamento`; a receber, de `formaRecebimento` — o
      // mesmo enum. Vai nos dois nomes: cada endpoint ignora o que não é dele.
      ...(l.formaPagamento !== undefined
        ? { formaPagamento: l.formaPagamento, formaRecebimento: l.formaPagamento }
        : {}),
      // `diaVencimento` é da recorrência. Numa conta única ele não existe — e
      // mandar (ou deixar o Tiny inventar) é o que fazia a conta virar recorrente.
      ...(l.ocorrencia && l.ocorrencia !== 'U'
        ? { diaVencimento: l.diaVencimento ?? Number(l.dataVencimento.slice(-2)) }
        : {}),
    };
  }
}
