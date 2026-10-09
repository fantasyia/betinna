import type { PrismaService } from '@database/prisma.service';
import type { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';

/** Como o pedido foi pago — vai no contexto do fluxo (`pagamento.*`). */
export interface PagamentoDoEvento {
  /** PIX / CARTAO (online, Asaas), MANUAL (botão "Pagamento recebido"), ERP (avançou o status). */
  forma: 'PIX' | 'CARTAO' | 'MANUAL' | 'ERP';
  parcelas: number;
  /** true = pago pela vitrine (Asaas), sem ninguém da equipe no meio. */
  online: boolean;
}

/** Quem mais quer saber que o pedido virou PAGO (ex.: compra pro Meta, CAPI). */
export type OuvintePedidoPago = (pedidoId: string, pagamento: PagamentoDoEvento) => Promise<void>;

const ouvintes = new Set<OuvintePedidoPago>();

/**
 * Registra um ouvinte do pedido pago. Devolve o "desregistrar".
 *
 * Por que registro e não injeção: PEDIDO_PAGO nasce em TRÊS módulos (checkout
 * online, Pix confirmado no estoque, "pagamento recebido" no pedido) e todos
 * chamam esta função. Um serviço que precisa do evento se registra no boot
 * (onModuleInit) — sem costurar dependência nova nos três.
 */
export function ouvirPedidoPago(fn: OuvintePedidoPago): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/**
 * Dispara o gatilho PEDIDO_PAGO (Léo, 07/10). Chamado DEPOIS de a transação
 * gravar o pedido como PAGO, por quem venceu a virada (CAS) — então dispara uma
 * vez só. Melhor esforço: falha aqui nunca desfaz o pagamento.
 *
 * Contexto no mesmo formato do PEDIDO_CRIADO/ENTREGUE (pedidoId, pedido{…},
 * clienteId, cliente{…}, telefone) — os nós de WhatsApp acham o cliente pelo
 * telefone do pedido.
 */
export async function dispararPedidoPago(
  prisma: PrismaService,
  bus: FluxoEventBusService | undefined,
  pedidoId: string,
  pagamento: PagamentoDoEvento,
): Promise<void> {
  // Ouvintes ANTES do `bus`: a compra pro Meta não depende do motor de fluxo.
  // Melhor esforço e sem esperar — cada ouvinte cuida (e loga) a própria falha.
  for (const fn of ouvintes) void fn(pedidoId, pagamento).catch(() => undefined);
  if (!bus) return;
  try {
    const p = await prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        empresaId: true,
        numero: true,
        total: true,
        origem: true,
        clienteId: true,
        contatoNome: true,
        contatoTelefone: true,
        representanteId: true,
        cliente: { select: { id: true, nome: true } },
      },
    });
    if (!p) return;
    await bus.disparar(p.empresaId, 'PEDIDO_PAGO', {
      pedidoId: p.id,
      pedido: { id: p.id, numero: p.numero, total: Number(p.total) },
      origem: p.origem,
      clienteId: p.clienteId,
      cliente: { id: p.cliente.id, nome: p.contatoNome ?? p.cliente.nome },
      telefone: p.contatoTelefone ?? null,
      representanteId: p.representanteId,
      pagamento,
    });
  } catch {
    /* o bus já loga; o pagamento está gravado */
  }
}
