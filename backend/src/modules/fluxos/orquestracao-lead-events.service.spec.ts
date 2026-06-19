import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrquestracaoLeadEventsService } from './orquestracao-lead-events.service';

const makePrisma = () => ({
  lead: { findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  // Match de lead por telefone agora é via $queryRaw (sufixo normalizado no SQL).
  $queryRaw: vi.fn().mockResolvedValue([]),
});
const makeBus = () => ({ disparar: vi.fn() });
const makeInbox = () => ({ registrarLeadEventHook: vi.fn() });
const makeConversarIa = () => ({
  aguardandoPorLead: vi.fn().mockResolvedValue(null),
  retomar: vi.fn(),
});

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
    svc = new OrquestracaoLeadEventsService(
      prisma as never,
      bus as never,
      inbox as never,
      makeConversarIa() as never,
    );
  });

  it('onModuleInit registra o hook na inbox', () => {
    svc.onModuleInit();
    expect(inbox.registrarLeadEventHook).toHaveBeenCalledTimes(1);
  });

  it('dispara LEAD_RESPONDEU quando casa lead por telefone (sufixo normalizado)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-9' }]);
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '+55 11 99999-0000', conteudo: 'oi' } as never,
      resultado(),
    );
    // O sufixo passado ao SQL é de 8 dígitos PUROS (3º arg do tagged template).
    expect(prisma.$queryRaw.mock.calls[0]?.[2]).toBe('99990000');
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ leadId: 'lead-9', conversationId: 'conv-1', texto: 'oi' }),
    );
  });

  // REGRESSÃO: o "Conversar com IA" parava de responder depois do opener porque o
  // resolverLead usava `contatoTelefone: { contains: sufixo }`, que QUEBRA quando o
  // lead tem telefone formatado (o hífen cai no meio dos 8 dígitos do sufixo). O lead
  // nunca casava → retomar nunca era chamado → execução presa em AGUARDANDO.
  it('casa lead com telefone FORMATADO (hífen no meio do sufixo) e dispara LEAD_RESPONDEU', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-anna' }]);
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '+55 (11) 97053-5832',
        conteudo: 'opa blz? sim vamos lá',
      } as never,
      resultado(),
    );
    // Sufixo só-dígitos — a normalização do ARMAZENADO acontece no SQL (RIGHT(REGEXP_REPLACE..)).
    expect(prisma.$queryRaw.mock.calls[0]?.[2]).toBe('70535832');
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_RESPONDEU',
      expect.objectContaining({ leadId: 'lead-anna' }),
    );
  });

  it('ignora mensagens duplicadas', async () => {
    await svc.aoReceberMensagem(
      { empresaId: 'emp-1', peerTelefone: '11999990000', conteudo: 'x' } as never,
      resultado({ duplicada: true }),
    );
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('dispara MENSAGEM_CANAL mas não LEAD_RESPONDEU quando nenhum lead casa', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await svc.aoReceberMensagem(
      {
        empresaId: 'emp-1',
        peerTelefone: '11999990000',
        conteudo: 'x',
        canal: 'WHATSAPP',
      } as never,
      resultado(),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'MENSAGEM_CANAL',
      expect.objectContaining({ leadId: null }),
    );
    expect(bus.disparar).not.toHaveBeenCalledWith('emp-1', 'LEAD_RESPONDEU', expect.anything());
  });
});
