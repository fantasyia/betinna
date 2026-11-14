/**
 * Reserva até a NF dos pedidos de marketplace (Léo, 25/10; reconfirmado 14/11).
 * PURO: decide o que fazer com UM pedido, sem banco.
 *
 * - vendido e sem nota → as peças ficam RESERVADAS (kit = peças da composição);
 * - nota emitida → a reserva vira SAÍDA física (um movimento por pedido × peça);
 * - cancelado antes da nota → a reserva volta ao disponível.
 *
 * 🔒 Chave por empresa em `config.erpInterno.reservaMagis5` (padrão DESLIGADA).
 * Desligada, o ledger anda (é a prévia), mas não conta no disponível, não gera
 * saída e nada vai pro Magis5.
 */

/** Situação do pedido já traduzida do canal de origem. */
export type SituacaoPedido =
  /** Vendido, sem nota: reserva. */
  | 'RESERVAR'
  /** Nota emitida (ou já despachado): sai do estoque. */
  | 'NF_EMITIDA'
  | 'CANCELADO'
  /**
   * Sem pagamento (boleto/Pix gerado): segura como PENDENTE (status ATIVA),
   * contado com teto — ver `pendenteContado` (Léo, 14/11).
   */
  | 'AGUARDANDO_PAGAMENTO'
  /** Fora do saldo do app (Full) ou já reservado por outro caminho (vitrine). */
  | 'IGNORAR'
  /** Status que o código não conhece: não decide nada e avisa. */
  | 'DESCONHECIDO';

export interface ConfigReservaMagis5 {
  /** Efetivo: chave ligada E `desde` válido. */
  ligada: boolean;
  /** Pedido feito antes disto, já com nota e sem reserva no ledger, não baixa. */
  desde: Date | null;
  /** Depósito do Magis5 que recebe o saldo; sem ele, nada é enviado. */
  deposito: { id: string; title: string } | null;
  /** Se definido, só estes SKUs vão pro Magis5 (teste com 3 produtos). */
  skusEnvio: string[] | null;
  /** Mais SKUs que isto caindo de >0 pra 0 numa rodada: o envio para e avisa. */
  limiteQueda: number;
  /** % do livre (depois dos pagos) que pedido sem pagamento pode segurar. */
  limitePendentePct: number;
  /** Por que a chave está ligada mas não vale (config incompleta). */
  erro: string | null;
}

export const LIMITE_QUEDA_PADRAO = 30;
export const LIMITE_PENDENTE_PCT_PADRAO = 50;

/** Lê `Empresa.config.erpInterno.reservaMagis5`. Qualquer dúvida = desligada. */
export function lerConfigReservaMagis5(config: unknown): ConfigReservaMagis5 {
  const erp = (config as { erpInterno?: { ativo?: unknown; reservaMagis5?: unknown } } | null)
    ?.erpInterno;
  const c = (erp?.reservaMagis5 ?? {}) as Record<string, unknown>;
  const desde = typeof c.desde === 'string' ? new Date(c.desde) : null;
  const desdeOk = desde !== null && !Number.isNaN(desde.getTime());
  const dep = c.deposito as { id?: unknown; title?: unknown } | undefined;
  const deposito =
    dep &&
    (typeof dep.id === 'string' || typeof dep.id === 'number') &&
    typeof dep.title === 'string'
      ? { id: String(dep.id), title: dep.title }
      : null;
  const skus = Array.isArray(c.skusEnvio)
    ? c.skusEnvio.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : null;
  const limite =
    typeof c.limiteQueda === 'number' && Number.isInteger(c.limiteQueda) && c.limiteQueda >= 0
      ? c.limiteQueda
      : LIMITE_QUEDA_PADRAO;
  const pct =
    typeof c.limitePendentePct === 'number' &&
    c.limitePendentePct >= 0 &&
    c.limitePendentePct <= 100
      ? c.limitePendentePct
      : LIMITE_PENDENTE_PCT_PADRAO;
  const pediu = c.ativo === true && erp?.ativo === true;
  const erro = !pediu
    ? null
    : !desdeOk
      ? 'reservaMagis5.ativo sem "desde" válido (data ISO de quando a baixa passa a valer)'
      : null;
  return {
    ligada: pediu && erro === null,
    desde: desdeOk ? desde : null,
    deposito,
    skusEnvio: skus,
    limiteQueda: limite,
    limitePendentePct: pct,
    erro,
  };
}

/** Linha do ledger já gravada para este pedido. */
export interface LinhaReserva {
  id: string;
  produtoId: string;
  quantidade: number;
  status: 'ATIVA' | 'CONFIRMADA' | 'BAIXADA' | 'LIBERADA';
}

export type Acao =
  /** `pendente`: pedido sem pagamento → linha ATIVA (conta com teto). */
  | { tipo: 'criar'; produtoId: string; quantidade: number; pendente?: boolean }
  /** Pagamento aprovado: ATIVA → CONFIRMADA (passa a contar inteira). */
  | { tipo: 'confirmar'; id: string; quantidade: number }
  | { tipo: 'ajustar'; id: string; quantidade: number }
  /** LIBERADA volta a segurar (item voltou ao pedido). */
  | { tipo: 'reabrir'; id: string; quantidade: number; pendente?: boolean }
  | { tipo: 'liberar'; id: string; motivo: string }
  /** CONFIRMADA → BAIXADA + movimento de saída. */
  | { tipo: 'baixar'; id: string; produtoId: string; quantidade: number }
  /** Nota chegou antes de a rodada ver o pedido: cria já BAIXADA + saída. */
  | { tipo: 'baixarDireto'; produtoId: string; quantidade: number };

export const MOTIVO_CANCELADO = 'pedido cancelado antes da nota';
export const MOTIVO_ITEM_SAIU = 'peça saiu do pedido';
export const MOTIVO_NF_DESLIGADA = 'nota emitida com a baixa desligada (sem saída)';

/**
 * O que fazer com UM pedido. Idempotente por construção: rodar de novo com o
 * mesmo pedido e o ledger já atualizado devolve lista vazia.
 */
export function planejarPedido(input: {
  situacao: SituacaoPedido;
  /** Peças que o pedido consome (kit já desdobrado), por produtoId. */
  desejado: Map<string, number>;
  existentes: LinhaReserva[];
  ligada: boolean;
  /** O pedido foi feito depois do `desde` da chave? */
  depoisDoDesde: boolean;
}): Acao[] {
  const { situacao, desejado, existentes, ligada, depoisDoDesde } = input;
  const acoes: Acao[] = [];
  const porProduto = new Map(existentes.map((l) => [l.produtoId, l]));
  const segurando = existentes.filter((l) => l.status === 'CONFIRMADA' || l.status === 'ATIVA');

  if (situacao === 'CANCELADO') {
    // Cancelado DEPOIS da nota (BAIXADA) não volta sozinho: devolução é manual.
    for (const l of segurando) acoes.push({ tipo: 'liberar', id: l.id, motivo: MOTIVO_CANCELADO });
    return acoes;
  }

  if (situacao === 'RESERVAR' || situacao === 'AGUARDANDO_PAGAMENTO') {
    const pendente = situacao === 'AGUARDANDO_PAGAMENTO';
    for (const [produtoId, q] of desejado) {
      const l = porProduto.get(produtoId);
      const marca = pendente ? { pendente: true } : {};
      if (!l) acoes.push({ tipo: 'criar', produtoId, quantidade: q, ...marca });
      else if (l.status === 'LIBERADA')
        acoes.push({ tipo: 'reabrir', id: l.id, quantidade: q, ...marca });
      // Pagou: a reserva pendente vira inteira.
      else if (!pendente && l.status === 'ATIVA')
        acoes.push({ tipo: 'confirmar', id: l.id, quantidade: q });
      else if (l.status !== 'BAIXADA' && l.quantidade !== q)
        acoes.push({ tipo: 'ajustar', id: l.id, quantidade: q });
    }
    for (const l of segurando) {
      if (!desejado.has(l.produtoId))
        acoes.push({ tipo: 'liberar', id: l.id, motivo: MOTIVO_ITEM_SAIU });
    }
    return acoes;
  }

  if (situacao === 'NF_EMITIDA') {
    if (!ligada) {
      // Chave desligada: o físico não é tocado; a reserva só deixa de segurar.
      for (const l of segurando)
        acoes.push({ tipo: 'liberar', id: l.id, motivo: MOTIVO_NF_DESLIGADA });
      return acoes;
    }
    for (const [produtoId, q] of desejado) {
      const l = porProduto.get(produtoId);
      if (l && (l.status === 'CONFIRMADA' || l.status === 'ATIVA')) {
        acoes.push({ tipo: 'baixar', id: l.id, produtoId, quantidade: q });
      } else if (!l && depoisDoDesde) {
        acoes.push({ tipo: 'baixarDireto', produtoId, quantidade: q });
      }
      // BAIXADA: já saiu. LIBERADA: decidido antes (cancelou ou nota com a chave
      // desligada). Sem linha e anterior ao `desde`: o inventário já contou.
    }
    for (const l of segurando) {
      if (!desejado.has(l.produtoId))
        acoes.push({ tipo: 'liberar', id: l.id, motivo: MOTIVO_ITEM_SAIU });
    }
    return acoes;
  }

  // IGNORAR, DESCONHECIDO: não mexe.
  return acoes;
}

/** Saldo que vai pro canal: disponível, nunca negativo. */
export const saldoParaEnvio = (disponivel: number): number =>
  Number.isFinite(disponivel) ? Math.max(0, Math.trunc(disponivel)) : 0;

/**
 * Quanto do que pedido SEM pagamento segura entra no disponível (Léo, 14/11):
 * reserva, mas com folga — um boleto gerado com o estoque inteiro não pode
 * zerar o anúncio. Conta no máximo `pct`% do livre (depois dos pagos) e nunca
 * a última peça. `livre` = físico − reservado pago.
 */
export function pendenteContado(livre: number, pendente: number, pct: number): number {
  if (!(pendente > 0) || !(livre > 1)) return 0;
  const teto = Math.min(Math.floor((livre * pct) / 100), livre - 1);
  return Math.max(0, Math.min(Math.trunc(pendente), teto));
}
