import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrquestracaoLeadEventsService } from './orquestracao-lead-events.service';

const makePrisma = () => ({ lead: { findFirst: vi.fn() } });
const makeBus = () => ({ disparar: vi.fn() });
const makeInbox = () => ({ registrarLeadEventHook: vi.fn() });

const resultado = (over = {}) => ({
  conversationId: 'conv-1',
  messageId: 'm-1',
  duplicada: false,
  ...over,
});

describe('OrquestracaoLeadEventsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let bus: ReturnType<typeof makeBus>;
  let inbox: ReturnType<typeof makeInbox>;
  let svc: OrquestracaoLeadEventsService;

  beforeEach(() => {
    prisma = makePrisma();
    bus = makeBus();
    inbox = makeInbox();
    svc = new OrquestracaoLeadEventsService(prisma as never, bus as never, inbox as never);
  });

  it('onModuleInit registra o hook na inbox', () => {
    svc.onModuleInit();
    expect(inbox.registrarLeadEventHook).toHaveBeenCalledTimes(1);
  });

  it('dispara LEAD_RESPONDEU quando casa lead por telefone (sufixo)', async () => {
    prisma.lead.findFirst.mockResolvedValue({ id: 'lead-9' });
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '+55 11 99999-0000', conteudo: 'oi' } as never,
      resultado(),
    );
    expect(prisma.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contatoTelefone: { contains: '99990000' } }),
      }),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ leadId: 'lead-9', conversationId: 'conv-1', texto: 'oi' }),
    );
  });

  it('ignora mensagens duplicadas', async () => {
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '11999990000', conteudo: 'x' } as never,
      resultado({ duplicada: true }),
    );
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('não dispara quando nenhum lead casa', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '11999990000', conteudo: 'x' } as never,
      resultado(),
    );
    expect(bus.disparar).not.toHaveBeenCalled();
  });
});
