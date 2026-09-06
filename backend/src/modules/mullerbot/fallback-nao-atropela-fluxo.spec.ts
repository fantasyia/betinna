import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MullerWhatsappService } from './muller-whatsapp.service';

/**
 * Falha do bot GERAL não pode atropelar fluxo em andamento.
 *
 * 26/08, regressão do T1.2: no meio de um atendimento do C1 que corria bem,
 * caiu um balão genérico do SomaBOT geral logo depois de o consultivo ter feito
 * uma pergunta. E o estrago não parou na mensagem — o fallback também marca
 * `precisaHumano` e pausa o bot, então o atendimento ficou CONGELADO por uma
 * falha que nem era do fluxo que conduzia.
 *
 * O gate de entrada e o re-check antes de enviar já existiam. O caminho de
 * FALHA não passava por nenhum dos dois: a chamada de IA leva até 15s, e nesse
 * intervalo o fluxo assume. Aqui o teste é justamente essa janela.
 */
const makePrisma = () => ({
  empresa: { findUnique: vi.fn(async () => ({ botWhatsappAtivo: true })) },
  conversation: {
    findUnique: vi.fn<() => Promise<Record<string, unknown> | null>>(async () => ({
      botPausadoAte: null,
    })),
    update: vi.fn(async () => ({})),
  },
  message: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
  $queryRaw: vi.fn<() => Promise<Array<{ id: string }>>>(async () => []),
  lead: { findUnique: vi.fn(async () => null) },
  fluxoExecucao: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => null) },
});

/** IA que falha — é o gatilho do fallback. */
const makeMuller = () => ({
  responderComoEmpresa: vi.fn(async () => {
    throw new Error('OpenAI fora');
  }),
  transcreverAudio: vi.fn(async () => ''),
  temChaveOpenAI: vi.fn(async () => true),
});

function build(prisma: ReturnType<typeof makePrisma>, muller: ReturnType<typeof makeMuller>) {
  const inbox = {
    registrarBotHook: vi.fn(),
    responderComoBot: vi.fn(async () => undefined),
    marcarPrecisaHumano: vi.fn(async () => undefined),
  };
  const auditoria = { registrar: vi.fn().mockResolvedValue(undefined) };
  const notificacoes = { criarParaRole: vi.fn().mockResolvedValue(1) };
  const svc = new MullerWhatsappService(
    prisma as never,
    inbox as never,
    muller as never,
    { get: () => 24 } as never,
    auditoria as never,
    {
      verificarTeto: vi.fn().mockResolvedValue({ bloqueado: false }),
      registrarUso: vi.fn(),
    } as never,
    {
      botPessoalAtivo: vi.fn().mockResolvedValue(false),
      obterConfigBot: vi.fn().mockResolvedValue({
        historicoMensagens: 10,
        delayRespostaSegundos: 0,
        mostrarDigitando: false,
        quebrarMensagens: false,
        maxMensagens: 3,
        transcreverAudio: false,
        analisarImagem: false,
      }),
    } as never,
    { enviarPresenca: vi.fn(), baixarMidia: vi.fn().mockResolvedValue(null) } as never,
    {
      eval: vi.fn().mockResolvedValue(1),
      setNxEx: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(1),
    } as never,
    { aguardarSlot: vi.fn().mockResolvedValue(undefined) } as never,
    // Status de pedido no contexto do bot: fora do escopo destes testes.
    {
      ehPerguntaDePedido: vi.fn().mockReturnValue(false),
      contextoPorTelefone: vi.fn().mockResolvedValue(''),
    } as never,
    notificacoes as never,
  );
  return { svc, inbox, auditoria, notificacoes };
}

const params = {
  empresaId: 'emp-1',
  canal: 'WHATSAPP',
  peerId: '5519999990000',
  proprietarioId: null,
  direction: 'INBOUND',
  tipo: 'TEXT',
  conteudo: 'Oi, tudo bem?',
};
const resultado = { conversationId: 'conv-1', messageId: 'msg-1', duplicada: false };

const aoReceber = (svc: MullerWhatsappService) =>
  (svc as unknown as { aoReceber: (p: unknown, r: unknown) => Promise<void> }).aoReceber(
    params,
    resultado,
  );

describe('fallback do bot geral × fluxo em andamento', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let muller: ReturnType<typeof makeMuller>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    muller = makeMuller();
  });

  it('fluxo assume DURANTE a geração: não manda o fallback nem encosta no estado', async () => {
    // 1ª chamada = gate de entrada (nada rodando ainda, o bot segue).
    // 2ª = re-check no caminho de falha, já com o fluxo conduzindo.
    prisma.fluxoExecucao.findFirst = vi
      .fn<() => Promise<{ id: string } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'exec-c1' });

    const { svc, inbox } = build(prisma, muller);
    await aoReceber(svc);

    // A IA foi chamada (o gate de entrada passou) e falhou...
    expect(muller.responderComoEmpresa).toHaveBeenCalled();
    // ...mas o cliente não vê a segunda voz.
    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    // E o principal: o atendimento do fluxo não é congelado.
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('a falha fica registrada na auditoria, não some', async () => {
    prisma.fluxoExecucao.findFirst = vi
      .fn<() => Promise<{ id: string } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'exec-c1' });

    const { svc, auditoria } = build(prisma, muller);
    await aoReceber(svc);

    // Suprimir a mensagem não é o mesmo que apagar o rastro: a falha da IA
    // continua auditada, só sem resposta e sem mexer na conversa.
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', resposta: null, status: 'SEM_RESPOSTA' }),
    );
  });

  it('sem fluxo conduzindo, o fallback continua saindo (não matei a rede de segurança)', async () => {
    const { svc, inbox } = build(prisma, muller); // findFirst sempre null

    await aoReceber(svc);

    expect(inbox.responderComoBot).toHaveBeenCalledWith('conv-1', expect.any(String));
    // Marca precisa-humano + pausa curta: é o comportamento correto quando não
    // há ninguém mais conduzindo a conversa.
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ precisaHumano: true }),
      }),
    );
  });

  it('o texto do fallback não tem emoji (regra de estilo dos prompts)', async () => {
    const { svc, inbox } = build(prisma, muller);
    await aoReceber(svc);

    const texto = (inbox.responderComoBot.mock.calls[0] as unknown as string[])[1];
    expect(texto).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('bot geral × lead DENTRO de um funil', () => {
  /** IA que RESPONDE — aqui o ponto é o bot se calar antes de chegar nela. */
  const mullerOk = () => ({
    responderComoEmpresa: vi.fn(async () => ({ texto: 'resposta do bot geral' })),
    transcreverAudio: vi.fn(async () => ''),
    temChaveOpenAI: vi.fn(async () => true),
  });

  it('lead com funil e SEM execução viva: o bot não responde e a diretoria é avisada', async () => {
    // Caso real de 05/09: cliente do Canal Reps escreveu "queimou outro CLP, dá
    // pra apressar aquele orçamento?" — o sinal de compra mais quente que chega
    // aqui — e o bot geral respondeu pedindo modelo do CLP, número do pedido e
    // nota fiscal. Ele nunca tinha comprado nada. O RT tinha acabado e o C2
    // nunca acendeu: sem execução viva, o guard antigo deixava passar.
    const prisma = makePrisma();
    // O lead precisa ser encontrado pelo telefone — é assim que o guard o vê.
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-1' }]);
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      etapa: 'NOVO',
      funilEtapa: null,
      tags: [],
      funilId: 'funil-canal-reps',
      nome: 'Fulano',
      contatoTelefone: '5519999990000',
      funil: { nome: 'Clientes - Canal Reps' },
    });
    const { svc, inbox, notificacoes } = build(prisma, mullerOk() as never);

    await svc['aoReceber'](params as never, resultado as never);

    expect(inbox.responderComoBot).not.toHaveBeenCalled();
    expect(notificacoes.criarParaRole).toHaveBeenCalledWith(
      expect.objectContaining({ prioridade: 'URGENTE' }),
    );
  });

  it('lead SEM funil segue pelo caminho normal — os 30 mil de prospecção fria não travam', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-1' }]);
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      etapa: 'NOVO',
      funilEtapa: null,
      tags: [],
      funilId: null,
    });
    const { svc, notificacoes } = build(prisma, mullerOk() as never);

    await svc['aoReceber'](params as never, resultado as never);

    expect(notificacoes.criarParaRole).not.toHaveBeenCalled();
  });

  it('execução VIVA não gera aviso — quem está falando é o fluxo, não é silêncio', async () => {
    const prisma = makePrisma();
    prisma.fluxoExecucao.findFirst.mockResolvedValue({ id: 'exec-1' });
    prisma.$queryRaw.mockResolvedValue([{ id: 'lead-1' }]);
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      etapa: 'NOVO',
      funilEtapa: null,
      tags: [],
      funilId: 'funil-1',
    });
    const { svc, notificacoes } = build(prisma, mullerOk() as never);

    await svc['aoReceber'](params as never, resultado as never);

    expect(notificacoes.criarParaRole).not.toHaveBeenCalled();
  });
});
