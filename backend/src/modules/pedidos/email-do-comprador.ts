import type { Logger } from '@nestjs/common';
import type { PrismaService } from '@database/prisma.service';

/**
 * E-mail do comprador (réguas de e-mail da Têxtil, 23/10): o que ele digita no
 * pedido ou no pagamento vai pro PEDIDO, pro CLIENTE e pro LEAD — é de onde o
 * nó ENVIAR_EMAIL resolve o destinatário. Antes ficava só no pedido.
 *
 * Só preenche campo VAZIO (não troca e-mail que alguém já cadastrou) e nunca
 * derruba o pedido: e-mail é rede pra régua, não condição da venda.
 */
export async function gravarEmailDoComprador(
  prisma: Pick<PrismaService, 'pedido' | 'cliente' | 'lead'>,
  logger: Pick<Logger, 'warn'>,
  a: {
    empresaId: string;
    email: string | null | undefined;
    pedidoId?: string | null;
    clienteId?: string | null;
    leadId?: string | null;
  },
): Promise<void> {
  const email = a.email?.trim().toLowerCase().slice(0, 160);
  if (!email || !email.includes('@')) return;
  const passo = async (nome: string, f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (err) {
      logger.warn(`[email-comprador] ${nome} não gravou: ${String(err)}`);
    }
  };
  if (a.pedidoId) {
    await passo('pedido', () =>
      prisma.pedido.updateMany({
        where: { id: a.pedidoId!, empresaId: a.empresaId, contatoEmail: null },
        data: { contatoEmail: email },
      }),
    );
  }
  if (a.clienteId) {
    await passo('cliente', () =>
      prisma.cliente.updateMany({
        where: { id: a.clienteId!, empresaId: a.empresaId, OR: [{ email: null }, { email: '' }] },
        data: { email },
      }),
    );
  }
  if (a.leadId) {
    await passo('lead', async () => {
      // 1 lead por e-mail por empresa (índice único em LOWER(contatoEmail)):
      // se outro lead já tem este e-mail, este fica sem — não briga com o índice.
      const outro = await prisma.lead.count({
        where: {
          empresaId: a.empresaId,
          id: { not: a.leadId! },
          contatoEmail: { equals: email, mode: 'insensitive' },
        },
      });
      if (outro > 0) return;
      await prisma.lead.updateMany({
        where: {
          id: a.leadId!,
          empresaId: a.empresaId,
          OR: [{ contatoEmail: null }, { contatoEmail: '' }],
        },
        data: { contatoEmail: email },
      });
    });
  }
}

/**
 * Lead de um pedido SEM mexer no funil: o ligado ao cliente, senão pelo
 * telefone (sufixo 8, D18). Pros eventos que não passam por `ligarLeadDoPedido`
 * (PEDIDO_NAO_PAGO) levarem `leadId`.
 */
export async function leadDoPedidoSemMover(
  prisma: Pick<PrismaService, 'lead' | '$queryRaw'>,
  empresaId: string,
  clienteId: string | null | undefined,
  telefone: string | null | undefined,
): Promise<string | null> {
  try {
    if (clienteId) {
      const l = await prisma.lead.findFirst({
        where: { empresaId, clienteId },
        orderBy: { atualizadoEm: 'desc' },
        select: { id: true },
      });
      if (l) return l.id;
    }
    const d = (telefone ?? '').replace(/\D/g, '');
    if (d.length < 8) return null;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Lead"
      WHERE "empresaId" = ${empresaId}
        AND "contatoTelefone" IS NOT NULL
        AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${d.slice(-8)}
      ORDER BY "atualizadoEm" DESC
      LIMIT 1`;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}
