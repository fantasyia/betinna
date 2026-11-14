import { createHash } from 'node:crypto';
import type { MarketplaceIncidentStatus, MarketplaceIncidentTipo } from '@prisma/client';
import { dataShein } from './shein-pedidos';

/**
 * Pós-venda da Shein (Open API, /after-sales-order/details) → incidente do app
 * (Léo, 01/11). PURO. Status pela documentação oficial (conferida em 01/11):
 * 1 pendente do vendedor · 2 análise do atendimento · 3 escolha do comprador ·
 * 4 devolução pendente do comprador · 5 aguardando entrega · 6 entregue ·
 * 7 exceção em análise da plataforma · 8 trânsito no armazém da Shein ·
 * 9 reembolso aprovado · 10 disputa · 11/12 concluído · 13 cancelado ·
 * 14 reenvio pendente · 15 vendedor sobe a etiqueta · 16 feedback do cliente.
 * Horários em UTC+8 ("2026-09-01 09:41:51").
 */

export interface SheinPosVendaItem {
  goodsTitle?: string | null;
  skuSn?: string | null;
  goodsSn?: string | null;
  goodsAttributes?: Array<{ attrValueNames?: string; language?: string }> | null;
  aftersalesReasonList?: Array<{ reason?: string; language?: string }> | null;
  goodsSettlePrice?: number | null;
}

export interface SheinPosVenda {
  aftersalesOrderNo: string;
  orderNo?: string | null;
  returnOrderNo?: string | null;
  aftersalesOrderSubStatus?: number | null;
  aftersalesResolutionPlan?: number | null;
  refundRatio?: number | null;
  requestTime?: string | null;
  etaTime?: string | null;
  sellerHandleTime?: string | null;
  reissueEtaTime?: string | null;
  uploadExpressEtaTime?: string | null;
  applyInfo?: { buyerRemark?: string | null } | null;
  goodsList?: SheinPosVendaItem[] | null;
  costSummary?: { totalGoodsSettlePrice?: number | null } | null;
}

/** "2026-09-01 09:41:51" (UTC+8) → Date. */
export function horaPequim(s: string | null | undefined): Date | null {
  if (!s) return null;
  return dataShein(`${s.replace(' ', 'T')}+0800`);
}

/**
 * Status desconhecido ESTOURA: num incidente, um default silencioso vira uma
 * situação plausível que ninguém pediu (lição do operador "equals", 10/09).
 */
export function statusPosVenda(sub: number): MarketplaceIncidentStatus {
  switch (sub) {
    case 1: // pendente do vendedor
    case 14: // reenvio pendente
    case 15: // vendedor precisa subir a etiqueta
      return 'AGUARDANDO_VENDEDOR';
    case 6: // devolução entregue: conferir a peça que voltou
      return 'ABERTO';
    case 3:
    case 4:
    case 5:
    case 16:
      return 'AGUARDANDO_COMPRADOR';
    case 2:
    case 7:
    case 8:
    case 10:
      return 'EM_MEDIACAO';
    case 9:
    case 11:
    case 12:
      return 'RESOLVIDO';
    case 13:
      return 'CANCELADO';
    default:
      throw new Error(`status de pós-venda da Shein desconhecido: ${sub}`);
  }
}

/** Plano: 1 devolução e reembolso · 2 só reembolso · 3 recusado · 4 troca. */
export function tipoPosVenda(
  sub: number,
  plano: number | null | undefined,
): MarketplaceIncidentTipo {
  if (sub === 10) return 'DISPUTA';
  if (plano === 2 || plano === 4) return 'RECLAMACAO';
  return 'DEVOLUCAO';
}

const PLANO: Record<number, string> = {
  1: 'devolução e reembolso',
  2: 'só reembolso',
  3: 'pós-venda recusado',
  4: 'troca',
};

const SITUACAO: Record<number, string> = {
  1: 'esperando a loja',
  2: 'em análise pela Shein',
  3: 'comprador escolhendo a solução',
  4: 'comprador vai devolver',
  5: 'devolução a caminho',
  6: 'devolução entregue',
  7: 'exceção em análise pela Shein',
  8: 'no armazém da Shein',
  9: 'reembolso aprovado',
  10: 'em disputa',
  11: 'concluído',
  12: 'concluído',
  13: 'cancelado',
  14: 'reenvio pendente',
  15: 'loja precisa subir a etiqueta',
  16: 'esperando o cliente',
};

/** Prazo da próxima ação: o que a situação pede; senão o prazo geral. */
function prazo(p: SheinPosVenda, sub: number): Date | null {
  const especifico = sub === 15 ? p.uploadExpressEtaTime : sub === 14 ? p.reissueEtaTime : null;
  return horaPequim(especifico) ?? horaPequim(p.etaTime) ?? horaPequim(p.sellerHandleTime);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "SKU variação" de cada peça do caso. */
function pecasDoCaso(p: SheinPosVenda): string[] {
  return (p.goodsList ?? []).map((i) => {
    const variacao =
      i.goodsAttributes?.find((a) => a.language === 'PT')?.attrValueNames ??
      i.goodsAttributes?.find((a) => a.language === 'US')?.attrValueNames;
    return [i.skuSn || i.goodsSn || i.goodsTitle, variacao].filter(Boolean).join(' ');
  });
}

export function incidenteShein(p: SheinPosVenda) {
  const sub = Number(p.aftersalesOrderSubStatus);
  const itens = p.goodsList ?? [];
  const motivos = [
    ...new Set(
      itens.flatMap((i) =>
        (i.aftersalesReasonList ?? []).map((m) => m.reason?.trim()).filter(Boolean),
      ),
    ),
  ] as string[];
  const pecas = pecasDoCaso(p);
  const valor =
    typeof p.costSummary?.totalGoodsSettlePrice === 'number'
      ? r2(p.costSummary.totalGoodsSettlePrice)
      : null;
  const ratio = typeof p.refundRatio === 'number' && p.refundRatio > 0 ? p.refundRatio : 100;
  const motivo = [motivos.join(' · '), p.applyInfo?.buyerRemark?.trim()]
    .filter(Boolean)
    .join(' — ');
  const resumo = [
    `Pós-venda ${p.aftersalesOrderNo}`,
    p.orderNo ? `pedido ${p.orderNo}` : null,
    PLANO[p.aftersalesResolutionPlan ?? 0] ?? null,
    SITUACAO[sub] ?? null,
    pecas.length ? `${pecas.length} peça(s): ${pecas.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    externalId: p.aftersalesOrderNo,
    tipo: tipoPosVenda(sub, p.aftersalesResolutionPlan),
    status: statusPosVenda(sub),
    motivo: motivo || undefined,
    motivoCodigo: String(sub),
    pedidoExternoId: p.orderNo ?? undefined,
    valor: valor ?? undefined,
    valorReembolso: valor !== null ? r2((valor * ratio) / 100) : undefined,
    prazoResposta: prazo(p, sub) ?? undefined,
    resumo: resumo.slice(0, 280),
  };
}

// ─── Pós-venda → conversa do Inbox (card SAC, 14/11) ───────────────────────

const brl = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

const fmtPrazo = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Situação do incidente → status da conversa. Só o que espera a LOJA fica
 * PENDENTE (o contador do SAC); encerrado sai da lista; o resto fica ABERTA
 * (à vista, mas sem cobrar resposta).
 */
export function statusConversaPosVenda(
  s: MarketplaceIncidentStatus,
): 'PENDENTE' | 'ABERTA' | 'RESOLVIDA' {
  if (s === 'AGUARDANDO_VENDEDOR' || s === 'ABERTO') return 'PENDENTE';
  if (s === 'RESOLVIDO' || s === 'CANCELADO' || s === 'EXPIRADO') return 'RESOLVIDA';
  return 'ABERTA';
}

/**
 * Caso de pós-venda → conversa do Inbox, no molde da "Reclamação ML #id". A
 * Shein não tem chat com o comprador: a conversa é só leitura, e cada mudança
 * do resumo vira uma mensagem nova (o `externalId` carrega um hash do texto —
 * reprocessar o mesmo estado não duplica, mudar a situação acrescenta).
 * PURO.
 */
export function conversaShein(p: SheinPosVenda) {
  const inc = incidenteShein(p);
  const sub = Number(p.aftersalesOrderSubStatus);
  const pecas = pecasDoCaso(p);
  const valores =
    inc.valor !== undefined
      ? [
          `Valor: ${brl(inc.valor)}`,
          inc.valorReembolso !== undefined && inc.valorReembolso !== inc.valor
            ? `reembolso ${brl(inc.valorReembolso)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
  const conteudo = [
    `Pós-venda Shein #${p.aftersalesOrderNo}`,
    p.orderNo ? `Pedido: ${p.orderNo}` : null,
    `Tipo: ${PLANO[p.aftersalesResolutionPlan ?? 0] ?? 'não informado'}`,
    `Situação: ${SITUACAO[sub] ?? `código ${sub}`}`,
    inc.motivo ? `Motivo: ${inc.motivo}` : null,
    pecas.length ? `Peças: ${pecas.join(', ')}` : null,
    valores,
    inc.prazoResposta ? `Prazo: ${fmtPrazo.format(inc.prazoResposta)}` : null,
    'Responda pelo painel da Shein — a API não tem chat com o comprador.',
  ]
    .filter(Boolean)
    .join('\n');
  const categoria =
    inc.tipo === 'DISPUTA' ? 'DISPUTA' : inc.tipo === 'RECLAMACAO' ? 'RECLAMACAO' : 'DEVOLUCAO';
  const hash = createHash('sha1').update(conteudo).digest('hex').slice(0, 12);
  return {
    incidente: inc,
    peerId: `posvenda:${p.aftersalesOrderNo}`,
    peerNome: `Pós-venda Shein #${p.aftersalesOrderNo}`,
    conteudo,
    externalId: `posvenda:${p.aftersalesOrderNo}:${hash}`,
    categoria,
    statusConversa: statusConversaPosVenda(inc.status),
  } as const;
}
