/**
 * Em que pé está uma linha de comissão — a pergunta que o rep faz.
 *
 * A tela antiga mostrava só a folha fechada: quem vendeu no dia 3 não via nada,
 * e o número aparecia do nada no fechamento. Com a comissão virando conta a
 * pagar POR PEDIDO (05/09), passou a existir um caminho com fases — e é esse
 * caminho que o rep precisa enxergar, sem ter que perguntar pro financeiro.
 *
 * As fases são DERIVADAS do que já existe na linha; nada de campo `status`
 * paralelo, que é a receita para a tela e o ERP discordarem.
 */
export type FaseComissao =
  /** Linha existe, mas a venda ainda não foi expedida — não há conta no ERP. */
  | 'AGUARDANDO_ENVIO'
  /** Locação: o mês existe, mas a mensalidade ainda não foi recebida do cliente. */
  | 'AGUARDANDO_MENSALIDADE'
  /** Conta a pagar criada no ERP, vencendo dia 05 do mês seguinte. */
  | 'A_PAGAR'
  /** O financeiro baixou a conta no ERP. */
  | 'PAGA'
  /** Pedido/contrato cancelado — a linha foi zerada. */
  | 'CANCELADA';

export interface LinhaParaFase {
  valor: number;
  contaPagarErpId?: string | null;
  pagoEm?: Date | string | null;
  /** Só em locação: quando a mensalidade daquele mês entrou. */
  mensalidadeRecebidaEm?: Date | string | null;
  /** True quando o pedido/contrato de origem foi cancelado. */
  origemCancelada?: boolean;
}

/**
 * A ordem das perguntas é a regra:
 *
 * 1. **Paga** ganha de tudo. Uma conta baixada continua baixada mesmo que o
 *    pedido seja cancelado depois — o dinheiro saiu, e mostrar "cancelada" pra
 *    quem já recebeu é mentir sobre o extrato.
 * 2. **Cancelada** vem antes de "a pagar": cancelamento ZERA a linha mas mantém
 *    o `contaPagarErpId` (a API do Tiny não apaga conta — fica o marcador
 *    CANCELADA lá). Sem esta ordem, comissão cancelada apareceria como a receber.
 * 3. **A pagar** = tem conta no ERP.
 * 4. O resto é espera — e a espera da locação tem nome próprio, porque o que
 *    falta ali é o cliente pagar a mensalidade, não a expedição sair.
 */
export function faseDaComissao(l: LinhaParaFase): FaseComissao {
  if (l.pagoEm) return 'PAGA';
  if (l.origemCancelada || l.valor <= 0) return 'CANCELADA';
  if (l.contaPagarErpId) return 'A_PAGAR';
  if (l.mensalidadeRecebidaEm === null) return 'AGUARDANDO_MENSALIDADE';
  return 'AGUARDANDO_ENVIO';
}

/** Rótulo pro rep. `A_PAGAR` leva a data (dia 05 do mês seguinte à competência). */
export function rotuloDaFase(fase: FaseComissao, vencimento?: string | null): string {
  switch (fase) {
    case 'PAGA':
      return 'Paga';
    case 'CANCELADA':
      return 'Cancelada';
    case 'A_PAGAR':
      return vencimento ? `A pagar em ${formatarDiaMes(vencimento)}` : 'A pagar';
    case 'AGUARDANDO_MENSALIDADE':
      return 'Aguardando mensalidade';
    default:
      return 'Aguardando envio';
  }
}

/** `2026-10-05` → `05/10`. */
function formatarDiaMes(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return dia && mes ? `${dia}/${mes}` : iso;
}

/** Dia 05 do mês SEGUINTE — a mesma regra do provisionamento no ERP. */
export function vencimentoDia5(mes: number, ano: number): string {
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const anoDoVencimento = mes === 12 ? ano + 1 : ano;
  return `${anoDoVencimento}-${String(proximoMes).padStart(2, '0')}-05`;
}
