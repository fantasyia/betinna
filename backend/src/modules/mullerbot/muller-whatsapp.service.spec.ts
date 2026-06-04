import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MullerWhatsappService } from './muller-whatsapp.service';

/**
 * Cobre as regras de segurança do bot (as não-negociáveis da Fase 2):
 *  - NUNCA responde no WhatsApp pessoal do rep (proprietarioId preenchido)
 *  - NUNCA responde o próprio eco (OUTBOUND)
 *  - respeita liga/desliga global e pausa de handoff
 *  - caminho feliz envia a resposta; falha da IA cai no fallback
 */
const makePrisma = (over: Record<string, unknown> = {}) => ({
  empresa: { findUnique: vi.fn(async () => ({ botWhatsappAtivo: true })) },
  conversation: {
    findUnique: vi.fn(async () => ({ botPausadoAte: null })),
    update: vi.fn(async () => ({})),
  },
  message: { findMany: vi.fn(async () => []) },
  // Fase B — guard fluxoIaConduzindo (lead em fluxo de IA cala o bot geral).
  lead: { findFirst: vi.fn(async () => null) },
  fluxoExecucao: { findFirst: vi.fn(async () => null) },
  ...over,
});

const makeInbox = () => ({
  registrarBotHook: vi.fn(),
  responderComoBot: vi.fn(async () => undefined),
  marcarPrecisaHumano: vi.fn(async () => undefined),
});

const makeMuller = (resp: unknown = { texto: 'Olá! Como posso ajudar?' }) => ({
  responderComoEmpresa: vi.fn(async () => resp),
});

const env = { get: () => 24 };

function build(
  prisma: ReturnType<typeof makePrisma>,
  inbox: ReturnType<typeof makeInbox>,
  muller: ReturnType<typeof makeMuller>,
) {
  // Sprint 2.2 — mocks de auditoria + custo (não bloqueia por teto nos testes).
  const auditoria = { registrar: vi.fn().mockResolvedValue(undefined) };
  const custo = {
    verificarTeto: vi.fn().mockResolvedValue({ bloqueado: false }),
    registrarUso: vi.fn().mockResolvedValue(undefined),
  };
  const persona = {
    obterConfigBot: vi.fn().mockResolvedValue({
      historicoMensagens: 10,
      delayRespostaSegundos: 0,
      mostrarDigitando: false,
    }),
  };
  const whatsapp = { enviarPresenca: vi.fn().mockResolvedValue(undefined) };
  return new MullerWhatsappService(
    prisma as never,
    inbox as never,
    muller as never,
    env as never,
    auditoria as never,
    custo as never,
    persona as never,
    whatsapp as never,
  );
}

const baseParams = {
  empresaId: 'emp-1',
  canal: 'WHATSAPP',
  peerId: '5519999990000',
  proprietarioId: null,
  direction: 'INBOUND',
  tipo: 'TEXT',
  conteudo: 'Oi, vocês têm óleo de girassol?',
};
const resultado = { conversationId: 'conv-1', messageId: 'msg-1', duplicada: false };

// aoReceber é privado — chamamos via cast pra testar a decisão.
function aoReceber(svc: MullerWhatsappService, params: Record<string, unknown>, res = resultado) {
  return (svc as unknown as { aoReceber: (p: unknown, r: unknown) => Promise<void> }).aoReceber(
    params,
    res,
  );
}

describe('MullerWhatsappService — regras do bot', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let inbox: ReturnType<typeof makeInbox>;
  let muller: ReturnType<typeof makeMuller>;

  beforeEach(() => {
    prisma = makePrisma();
    inbox = makeInbox();
    muller = makeMuller();
  });

  it('NUNCA responde no WhatsApp pessoal do rep (proprietarioId preenchido)', async () => {
    await aoReceber(build(prisma, inbox, muller), { ...baseParams, proprietarioId: 'user-1' });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
  });

  it('NUNCA responde o próprio eco (mensagem OUTBOUND)', async () => {
    await aoReceber(build(prisma, inbox, muller), { ...baseParams, direction: 'OUTBOUND' });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('ignora canais que não são WhatsApp', async () => {
    await aoReceber(build(prisma, inbox, muller), { ...baseParams, canal: 'INSTAGRAM' });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('não responde se o bot está desligado globalmente', async () => {
    prisma.empresa.findUnique = vi.fn(async () => ({ botWhatsappAtivo: false }));
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('não responde se a conversa está pausada (handoff)', async () => {
    prisma.conversation.findUnique = vi.fn(async () => ({
      botPausadoAte: new Date(Date.now() + 3_600_000),
    }));
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('caminho feliz: envia a resposta da IA pelo bot', async () => {
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(muller.responderComoEmpresa).toHaveBeenCalledWith(
      'emp-1',
      baseParams.conteudo,
      expect.any(Array),
      expect.anything(),
    );
    expect(inbox.responderComoBot).toHaveBeenCalledWith('conv-1', 'Olá! Como posso ajudar?');
  });

  it('fallback: IA falha → manda mensagem padrão, marca precisa-humano e PAUSA o bot', async () => {
    muller.responderComoEmpresa = vi.fn(async () => {
      throw new Error('openai down');
    });
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(inbox.responderComoBot).toHaveBeenCalledTimes(1);
    // Em vez de só marcar precisa-humano, pausa o bot (botPausadoAte) pra não
    // re-spammar o mesmo fallback a cada nova mensagem enquanto a IA está fora.
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: expect.objectContaining({ precisaHumano: true, botPausadoAte: expect.any(Date) }),
      }),
    );
  });

  it('NÃO responde mensagem antiga (backlog/history sync após reconnect)', async () => {
    // Mensagem com timestamp de 10 min atrás (chegou no downtime e foi reentregue).
    const dezMinAtras = new Date(Date.now() - 10 * 60_000);
    await aoReceber(build(prisma, inbox, muller), { ...baseParams, data: dezMinAtras });
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('responde normalmente mensagem recente (timestamp de agora)', async () => {
    await aoReceber(build(prisma, inbox, muller), { ...baseParams, data: new Date() });
    expect(muller.responderComoEmpresa).toHaveBeenCalled();
    expect(inbox.responderComoBot).toHaveBeenCalled();
  });

  it('ignora mensagem duplicada', async () => {
    await aoReceber(
      build(prisma, inbox, muller),
      { ...baseParams },
      { ...resultado, duplicada: true },
    );
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('mídia sem legenda (áudio) → não responde, marca precisa humano', async () => {
    await aoReceber(build(prisma, inbox, muller), {
      ...baseParams,
      tipo: 'AUDIO',
      conteudo: '[áudio]',
    });
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    expect(inbox.marcarPrecisaHumano).toHaveBeenCalledWith('conv-1');
  });

  it('imagem sem legenda → não responde, marca precisa humano', async () => {
    await aoReceber(build(prisma, inbox, muller), {
      ...baseParams,
      tipo: 'IMAGE',
      conteudo: '[imagem]',
    });
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
    expect(inbox.marcarPrecisaHumano).toHaveBeenCalledWith('conv-1');
  });

  it('imagem COM legenda → responde usando o texto', async () => {
    await aoReceber(build(prisma, inbox, muller), {
      ...baseParams,
      tipo: 'IMAGE',
      conteudo: 'Esse produto da foto vocês têm?',
    });
    expect(muller.responderComoEmpresa).toHaveBeenCalledWith(
      'emp-1',
      'Esse produto da foto vocês têm?',
      expect.any(Array),
      expect.anything(),
    );
    expect(inbox.responderComoBot).toHaveBeenCalled();
  });

  it('emoji isolado é texto → responde normalmente', async () => {
    await aoReceber(build(prisma, inbox, muller), { ...baseParams, tipo: 'TEXT', conteudo: '👍' });
    expect(muller.responderComoEmpresa).toHaveBeenCalled();
    expect(inbox.responderComoBot).toHaveBeenCalled();
  });
});
