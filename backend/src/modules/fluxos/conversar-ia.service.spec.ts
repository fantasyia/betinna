import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversarIaService, parseTurnoIa, personalizarNome } from './conversar-ia.service';

const makePrisma = () => ({
  lead: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  fluxoExecucao: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  },
  fluxoNo: { findUnique: vi.fn() },
  fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
  message: { findMany: vi.fn().mockResolvedValue([]) },
});
const makePersona = () => ({
  compilarSystemPromptConversa: vi.fn().mockResolvedValue('PROMPT BASE'),
  obterConfigBot: vi.fn().mockResolvedValue({
    historicoMensagens: 10,
    delayRespostaSegundos: 0,
    mostrarDigitando: false,
    quebrarMensagens: false,
    maxMensagens: 3,
    transcreverAudio: false,
    analisarImagem: false,
  }),
});
const makeMuller = () => ({ gerarRespostaIa: vi.fn() });
const makeWhatsapp = () => ({
  enviarTexto: vi.fn().mockResolvedValue({ externalId: 'x' }),
  enviarPresenca: vi.fn().mockResolvedValue(undefined),
});
const makeBus = () => ({ disparar: vi.fn() });
const makeQueue = () => ({ add: vi.fn().mockResolvedValue({ id: 'job-1' }) });

describe('parseTurnoIa', () => {
  it('parseia JSON puro', () => {
    const r = parseTurnoIa('{"resposta":"oi","classificou":true,"classificacao":"X"}');
    expect(r).toEqual({
      resposta: 'oi',
      classificou: true,
      classificacao: 'X',
      variaveis: undefined,
    });
  });
  it('tolera cercas ```json', () => {
    const r = parseTurnoIa('```json\n{"resposta":"oi","classificou":false}\n```');
    expect(r.resposta).toBe('oi');
    expect(r.classificou).toBe(false);
  });
  it('cai pra texto puro quando não é JSON', () => {
    const r = parseTurnoIa('continua a conversa normal');
    expect(r).toEqual({ resposta: 'continua a conversa normal', classificou: false });
  });
});

describe('personalizarNome', () => {
  it('troca [primeiro_nome] pelo primeiro nome do lead', () => {
    expect(personalizarNome('[primeiro_nome], boa tarde!', 'João Silva')).toBe('João, boa tarde!');
  });
  it('cobre {{nome}} e {nome}', () => {
    expect(personalizarNome('Oi {{nome}} / {nome}', 'Maria Souza')).toBe('Oi Maria / Maria');
  });
  it('sem nome: remove o placeholder e limpa vírgula órfã', () => {
    expect(personalizarNome('[primeiro_nome], boa tarde!', null)).toBe('boa tarde!');
  });
});

describe('ConversarIaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let persona: ReturnType<typeof makePersona>;
  let muller: ReturnType<typeof makeMuller>;
  let whatsapp: ReturnType<typeof makeWhatsapp>;
  let bus: ReturnType<typeof makeBus>;
  let queue: ReturnType<typeof makeQueue>;
  let svc: ConversarIaService;

  beforeEach(() => {
    prisma = makePrisma();
    persona = makePersona();
    muller = makeMuller();
    whatsapp = makeWhatsapp();
    bus = makeBus();
    queue = makeQueue();
    svc = new ConversarIaService(
      prisma as never,
      persona as never,
      muller as never,
      whatsapp as never,
      bus as never,
      queue as never,
    );
  });

  const no = (config = {}) => ({ id: 'no-ia', config, acaoTipo: 'CONVERSAR_IA' });

  describe('iniciar', () => {
    it('envia 1ª msg e pausa (AGUARDANDO) quando aguardarResposta', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Olá! Tudo bem?', modelo: 'gpt' });

      const r = await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(r.aguardando).toBe(true);
      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '11999990000@s.whatsapp.net',
        'Olá! Tudo bem?',
        {},
      );
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          data: expect.objectContaining({ status: 'AGUARDANDO', aguardandoNoId: 'no-ia' }),
        }),
      );
    });

    it('não pausa quando aguardarResposta=false', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Oi', modelo: 'gpt' });

      const r = await svc.iniciar(
        'exec-1',
        no({ aguardarResposta: false }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );
      expect(r.aguardando).toBe(false);
      expect(prisma.fluxoExecucao.update).not.toHaveBeenCalled();
    });

    it('pula (sem falhar) quando lead sem telefone', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: null });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'x', modelo: 'gpt' });

      const r = await svc.iniciar('exec-1', no() as never, { leadId: 'lead-1' }, 'emp-1');

      // Não lança: retorna pulado + motivo, não envia nada e não pausa a execução.
      expect(r.aguardando).toBe(false);
      expect(r.pulado).toBe(true);
      expect(r.motivo).toMatch(/telefone/i);
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
      expect(prisma.fluxoExecucao.update).not.toHaveBeenCalled();
    });

    it('quebra em balões e troca [primeiro_nome] pelo nome real', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        contatoTelefone: '11999990000',
        contatoNome: 'João Silva',
      });
      muller.gerarRespostaIa.mockResolvedValue({
        texto: '[primeiro_nome], oi|||tudo bem?',
        modelo: 'gpt',
      });
      persona.obterConfigBot.mockResolvedValue({
        historicoMensagens: 10,
        delayRespostaSegundos: 0,
        mostrarDigitando: false,
        quebrarMensagens: true,
        maxMensagens: 3,
        transcreverAudio: false,
        analisarImagem: false,
      });

      await svc.iniciar(
        'exec-1',
        no({ aguardarResposta: false }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(2);
      expect(whatsapp.enviarTexto).toHaveBeenNthCalledWith(
        1,
        'emp-1',
        '11999990000@s.whatsapp.net',
        'João, oi',
        {},
      );
      expect(whatsapp.enviarTexto).toHaveBeenNthCalledWith(
        2,
        'emp-1',
        '11999990000@s.whatsapp.net',
        'tudo bem?',
        {},
      );
    });
  });

  describe('retomar', () => {
    const execAguardando = {
      id: 'exec-1',
      status: 'AGUARDANDO',
      aguardandoNoId: 'no-ia',
      empresaId: 'emp-1',
      contexto: { leadId: 'lead-1' },
    };

    it('IA classificou → grava variáveis, dispara IA_CLASSIFICOU e avança', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
      muller.gerarRespostaIa.mockResolvedValue({
        texto:
          '{"resposta":"Show! Vou te conectar com a diretoria.","classificou":true,"classificacao":"Forte Sinergia","variaveis":{"canal":"distribuidor"}}',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'Trabalho com distribuição há 10 anos');

      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '11999990000@s.whatsapp.net',
        'Show! Vou te conectar com a diretoria.',
        {},
      );
      const upd = prisma.lead.update.mock.calls[0][0];
      expect(upd.data.variaveis).toMatchObject({
        classificacao: 'Forte Sinergia',
        canal: 'distribuidor',
      });
      expect(bus.disparar).toHaveBeenCalledWith(
        'emp-1',
        'IA_CLASSIFICOU',
        expect.objectContaining({ leadId: 'lead-1', classificacao: 'Forte Sinergia' }),
      );
      // Avançou: enfileirou o sucessor + tirou de AGUARDANDO
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-2' },
        expect.any(Object),
      );
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EM_EXECUCAO' }) }),
      );
    });

    it('IA não classificou → responde e continua AGUARDANDO (renova timeout)', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: {} });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      muller.gerarRespostaIa.mockResolvedValue({
        texto: 'Legal! E há quanto tempo atua?',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'Sou representante');

      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '11999990000@s.whatsapp.net',
        'Legal! E há quanto tempo atua?',
        {},
      );
      expect(bus.disparar).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      // Renovou timeout, mas não saiu de AGUARDANDO
      const upd = prisma.fluxoExecucao.update.mock.calls[0][0];
      expect(upd.data.timeoutEm).toBeInstanceOf(Date);
      expect(upd.data.status).toBeUndefined();
    });

    it('ignora execução que não está mais AGUARDANDO', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue({ ...execAguardando, status: 'CONCLUIDO' });
      await svc.retomar('exec-1', 'conv-1', 'oi');
      expect(muller.gerarRespostaIa).not.toHaveBeenCalled();
    });
  });

  describe('processarTimeouts', () => {
    it('dispara LEAD_SEM_RESPOSTA e encerra execuções vencidas', async () => {
      prisma.fluxoExecucao.findMany.mockResolvedValue([
        { id: 'exec-1', empresaId: 'emp-1', contexto: { leadId: 'lead-1' } },
      ]);
      const n = await svc.processarTimeouts();
      expect(n).toBe(1);
      expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'LEAD_SEM_RESPOSTA', { leadId: 'lead-1' });
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONCLUIDO' }) }),
      );
    });
  });
});
