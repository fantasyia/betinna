import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MullerWhatsappService, dividirEmBaloes } from './muller-whatsapp.service';

describe('dividirEmBaloes — quebra da resposta em balões', () => {
  it('frase única (sem delimitador nem parágrafo) → 1 balão só', () => {
    expect(dividirEmBaloes('Oi, tudo bem?', 3)).toEqual(['Oi, tudo bem?']);
  });

  it('quebra nos "|||" e limpa espaços/vazios', () => {
    expect(dividirEmBaloes('Temos sim! ||| O 900ml é R$ 8,90 |||  ', 3)).toEqual([
      'Temos sim!',
      'O 900ml é R$ 8,90',
    ]);
  });

  it('quebra na LINHA EM BRANCO (parágrafo) — o que o modelo faz sozinho', () => {
    // Caso real: o modelo respondeu em 2 parágrafos, sem usar "|||".
    expect(
      dividirEmBaloes('Entendi, faz sentido acompanhar.\n\nSe mudar, a gente retoma.', 3),
    ).toEqual(['Entendi, faz sentido acompanhar.', 'Se mudar, a gente retoma.']);
  });

  it('quebra-linha simples (1 \\n) NÃO divide — só parágrafo (linha em branco)', () => {
    expect(dividirEmBaloes('linha 1\nlinha 2', 3)).toEqual(['linha 1\nlinha 2']);
  });

  it('respeita o teto juntando o excedente no último balão (não perde texto)', () => {
    const r = dividirEmBaloes('a ||| b ||| c ||| d', 3);
    expect(r).toEqual(['a', 'b', 'c\n\nd']);
    expect(r).toHaveLength(3);
  });

  it('texto só de delimitadores → vazio (caller usa salvaguarda)', () => {
    expect(dividirEmBaloes('|||  |||', 3)).toEqual([]);
  });
});

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
  message: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
  // Gate: lead do peer resolvido por buscarLeadDoPeer → $queryRaw (id por telefone,
  // indexado) + lead.findUnique (etapa/funil/tags). Default [] = nenhum lead.
  $queryRaw: vi.fn(async () => []),
  lead: { findUnique: vi.fn(async () => null) },
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
  transcreverAudio: vi.fn(async () => 'texto transcrito do áudio'),
});

const env = { get: () => 24 };

function build(
  prisma: ReturnType<typeof makePrisma>,
  inbox: ReturnType<typeof makeInbox>,
  muller: ReturnType<typeof makeMuller>,
  cfgOver: Record<string, unknown> = {},
  midiaBytes: Buffer | null = null,
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
      quebrarMensagens: false,
      maxMensagens: 3,
      transcreverAudio: false,
      analisarImagem: false,
      ...cfgOver,
    }),
  };
  const whatsapp = {
    enviarPresenca: vi.fn().mockResolvedValue(undefined),
    baixarMidia: vi.fn().mockResolvedValue(midiaBytes),
  };
  // Anti-spam no Redis: eval (INCR+EXPIRE) retorna contador baixo → nunca é spam nos testes.
  const redis = { eval: vi.fn().mockResolvedValue(1) };
  return new MullerWhatsappService(
    prisma as never,
    inbox as never,
    muller as never,
    env as never,
    auditoria as never,
    custo as never,
    persona as never,
    whatsapp as never,
    redis as never,
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

  it('NÃO responde se a conversa precisa de humano (espera o operador)', async () => {
    prisma.conversation.findUnique = vi.fn(async () => ({
      botPausadoAte: null,
      precisaHumano: true,
    }));
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
  });

  it('lead Perdido/Encerrado → bot silencia e marca precisa-humano (busca unificada)', async () => {
    prisma.$queryRaw = vi.fn(async () => [{ id: 'lead-1' }]); // achou o lead por telefone
    prisma.lead.findUnique = vi.fn(async () => ({
      id: 'lead-1',
      etapa: 'PERDIDO',
      funilEtapa: null,
      tags: [],
    }));
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ precisaHumano: true }) }),
    );
  });

  it('fluxo de IA conduzindo o lead → bot geral silencia (sem resposta dupla)', async () => {
    prisma.$queryRaw = vi.fn(async () => [{ id: 'lead-1' }]);
    prisma.lead.findUnique = vi.fn(async () => ({
      id: 'lead-1',
      etapa: 'NOVO',
      funilEtapa: null,
      tags: [],
    }));
    prisma.fluxoExecucao.findFirst = vi.fn(async () => ({ id: 'exec-1' })); // execução AGUARDANDO
    await aoReceber(build(prisma, inbox, muller), { ...baseParams });
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
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

  // ─── Multimodal (áudio + imagem) ──────────────────────────────────────────
  it('áudio + transcrição LIGADA → transcreve e responde com o texto da voz', async () => {
    const svc = build(prisma, inbox, muller, { transcreverAudio: true }, Buffer.from('audio'));
    await aoReceber(svc, {
      ...baseParams,
      tipo: 'AUDIO',
      conteudo: '[áudio]',
      mediaUrl: 'emp-1/peer/abc.ogg',
      mediaMime: 'audio/ogg',
    });
    expect(muller.transcreverAudio).toHaveBeenCalled();
    // A IA recebe a TRANSCRIÇÃO como mensagem, não o placeholder "[áudio]".
    expect(muller.responderComoEmpresa).toHaveBeenCalledWith(
      'emp-1',
      'texto transcrito do áudio',
      expect.any(Array),
      expect.anything(),
    );
    // Atualiza a mensagem na inbox com a transcrição (🎤).
    expect(prisma.message.update).toHaveBeenCalled();
    expect(inbox.responderComoBot).toHaveBeenCalled();
  });

  it('áudio com transcrição DESLIGADA → não responde (escala pra humano)', async () => {
    await aoReceber(build(prisma, inbox, muller), {
      ...baseParams,
      tipo: 'AUDIO',
      conteudo: '[áudio]',
      mediaUrl: 'emp-1/peer/abc.ogg',
      mediaMime: 'audio/ogg',
    });
    expect(muller.transcreverAudio).not.toHaveBeenCalled();
    expect(muller.responderComoEmpresa).not.toHaveBeenCalled();
    expect(inbox.marcarPrecisaHumano).toHaveBeenCalled();
  });

  it('imagem + visão LIGADA → manda a foto (imagemDataUrl) pra IA responder', async () => {
    const svc = build(
      prisma,
      inbox,
      muller,
      { analisarImagem: true },
      Buffer.from([0xff, 0xd8, 0xff]),
    );
    await aoReceber(svc, {
      ...baseParams,
      tipo: 'IMAGE',
      conteudo: '[imagem]',
      mediaUrl: 'emp-1/peer/img.jpg',
      mediaMime: 'image/jpeg',
    });
    const call = muller.responderComoEmpresa.mock.calls[0];
    expect(call).toBeTruthy();
    expect(call[3]).toEqual(
      expect.objectContaining({
        imagemDataUrl: expect.stringContaining('data:image/jpeg;base64,'),
      }),
    );
    expect(inbox.responderComoBot).toHaveBeenCalled();
  });
});
