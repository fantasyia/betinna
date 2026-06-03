import { describe, expect, it, vi, beforeEach } from 'vitest';
import { proto } from '@whiskeysockets/baileys';
import { WhatsAppSessionService } from './whatsapp-session.service';

/**
 * Recibo de leitura → LIDO.
 *
 * `marcarRecibosLeitura` recebe os updates do evento Baileys `messages.update`
 * e marca como LIDO os CampanhaDestinatario cujo `waMessageId` casa com uma
 * mensagem NOSSA (fromMe) que o destinatário leu (status READ/PLAYED).
 */

const READ = proto.WebMessageInfo.Status.READ;
const PLAYED = proto.WebMessageInfo.Status.PLAYED;
const DELIVERY_ACK = proto.WebMessageInfo.Status.DELIVERY_ACK;

const makePrisma = () => ({
  campanhaDestinatario: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
});

function makeService(prisma: ReturnType<typeof makePrisma>): WhatsAppSessionService {
  // Só prisma + logger são usados por marcarRecibosLeitura; o resto é dummy.
  // onModuleInit não roda no `new` (só no ciclo do Nest), então é seguro.
  return new WhatsAppSessionService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

describe('WhatsAppSessionService.marcarRecibosLeitura', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: WhatsAppSessionService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = makeService(prisma);
  });

  it('marca LIDO os destinatários cujo waMessageId casa com recibos READ/PLAYED (fromMe)', async () => {
    await (svc as unknown as { marcarRecibosLeitura: (u: unknown[]) => Promise<void> }).marcarRecibosLeitura([
      { key: { fromMe: true, id: 'wa-1' }, update: { status: READ } },
      { key: { fromMe: true, id: 'wa-2' }, update: { status: PLAYED } },
    ]);

    expect(prisma.campanhaDestinatario.updateMany).toHaveBeenCalledWith({
      where: { waMessageId: { in: ['wa-1', 'wa-2'] }, status: 'ENVIADO' },
      data: { status: 'LIDO', lido: true, lidoEm: expect.any(Date) },
    });
  });

  it('ignora recibos não-fromMe, status < READ, ou sem id', async () => {
    await (svc as unknown as { marcarRecibosLeitura: (u: unknown[]) => Promise<void> }).marcarRecibosLeitura([
      { key: { fromMe: false, id: 'in-1' }, update: { status: READ } }, // inbound
      { key: { fromMe: true, id: 'wa-3' }, update: { status: DELIVERY_ACK } }, // só entregue
      { key: { fromMe: true }, update: { status: READ } }, // sem id
      { key: { fromMe: true, id: 'wa-4' }, update: {} }, // sem status
    ]);

    expect(prisma.campanhaDestinatario.updateMany).not.toHaveBeenCalled();
  });
});
