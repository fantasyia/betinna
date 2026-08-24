import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SINAIS_ROTEAMENTO } from './fluxo-executor.types';
import { filtrarVariaveisGravaveis } from './conversar-ia.service';
import {
  semMic,
  ConversarIaService,
  extrairMarcadoresDoc,
  parseTurnoIa,
  pedidoRemocaoNoTexto,
  personalizarNome,
  respostaEhDespedida,
} from './conversar-ia.service';

const makePrisma = () => ({
  // #4: cancelamento cross-fluxo das AGUARDANDO usa raw (o filtro JSON do
  // Prisma trata chave ausente como NULL — ver fluxo-event-bus).
  $executeRaw: vi.fn().mockResolvedValue(0),
  lead: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  fluxoExecucao: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    // Claim atômico do turno (CAS) — default: claim sempre vence.
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({ id: 'filha-1' }),
  },
  fluxoNo: { findUnique: vi.fn() },
  // #23: prompt do nó tem que existir/estar ativo — default: existe.
  botPrompt: {
    findFirst: vi.fn().mockResolvedValue({ id: 'p1' }),
    findUnique: vi.fn().mockResolvedValue(null),
  },
  fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
  message: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
  // Gate do bot no retomar (default: bot LIGADO, sem escalação pra humano).
  empresa: { findUnique: vi.fn().mockResolvedValue({ botWhatsappAtivo: true }) },
  conversation: {
    findUnique: vi.fn().mockResolvedValue({ botLigado: true, precisaHumano: false }),
  },
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
const makeMuller = () => ({
  gerarRespostaIa: vi.fn(),
  transcreverAudio: vi.fn().mockResolvedValue('texto transcrito'),
});
const makeCusto = () => ({
  verificarTeto: vi.fn().mockResolvedValue({ bloqueado: false }),
  registrarUso: vi.fn().mockResolvedValue(undefined),
});
const makeWhatsapp = () => ({
  // Gate anterior ao envio: instância fora do ar não pode fechar o passo
  // como CONCLUIDO. Default conectado — os testes que exercitam a queda
  // sobrescrevem.
  estaDisponivel: vi.fn().mockResolvedValue(true),
  enviarTexto: vi.fn().mockResolvedValue({ externalId: 'x' }),
  enviarPresenca: vi.fn().mockResolvedValue(undefined),
  baixarMidia: vi.fn().mockResolvedValue(Buffer.from('midia')),
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

  it('NÃO vaza variável interna pro cliente no fallback de texto puro', () => {
    // Caso real de prod: a IA respondeu a saudação E colou a variável embaixo.
    // Como o conjunto não era JSON, o texto CRU ia pro WhatsApp do cliente.
    const r = parseTurnoIa(
      'Oi! Tudo bem? Posso te ajudar a proteger qual equipamento?\nclassificacao_final="Indefinido"',
    );
    expect(r.resposta).toBe('Oi! Tudo bem? Posso te ajudar a proteger qual equipamento?');
    expect(r.resposta).not.toContain('classificacao_final');
  });

  it('preserva frase legítima com dois-pontos (não corta demais)', () => {
    const r = parseTurnoIa('Perfeito: vou encaminhar seu pedido pro time comercial agora mesmo.');
    expect(r.resposta).toBe('Perfeito: vou encaminhar seu pedido pro time comercial agora mesmo.');
  });

  it('NÃO vaza variável quando o JSON é VÁLIDO mas a resposta traz a variável dentro', () => {
    // 2º caso real de prod: o JSON parseou certo, mas o vazamento estava DENTRO
    // de `resposta` — o fix anterior (só no fallback) não pegava.
    const r = parseTurnoIa(
      JSON.stringify({
        resposta:
          'Me conta: você quer proteger algum equipamento ou ambiente específico? \nclassificacao_final = "Indefinido"',
        classificou: false,
      }),
    );
    expect(r.resposta).toBe(
      'Me conta: você quer proteger algum equipamento ou ambiente específico?',
    );
    expect(r.resposta).not.toContain('classificacao_final');
  });
});

describe('pedidoRemocaoNoTexto', () => {
  it('detecta pedidos de remoção comuns (pt-BR)', () => {
    for (const t of [
      'tira meu numero da sua lista de contatos',
      'me remove dessa lista',
      'não quero mais receber mensagens',
      'para de me mandar mensagem',
      'me descadastra por favor',
      'não me chame mais',
      'sair da lista',
    ]) {
      expect(pedidoRemocaoNoTexto(t)).toBe(true);
    }
  });
  it('NÃO dispara em conversa normal', () => {
    for (const t of ['oi tudo bem?', 'trabalho com metalurgia', 'me manda mais detalhes', '']) {
      expect(pedidoRemocaoNoTexto(t)).toBe(false);
    }
  });
  it('REGRESSÃO: "me tira/remove" sem destino de cadastro é lead ENGAJADO, não LGPD', () => {
    for (const t of [
      'me tira uma dúvida, funciona em 380V?',
      'pode me tirar uma foto do produto?',
      'esse preço me tira do sério haha',
      'remove o meu desconto então',
    ]) {
      expect(pedidoRemocaoNoTexto(t)).toBe(false);
    }
  });
  it('e segue detectando remoção COM destino de cadastro', () => {
    for (const t of [
      'me tira da lista por favor',
      'me tira daqui',
      'me remove do grupo',
      'me exclui dessa base',
      'me tira do seu mailing',
      'remove meu contato aí',
      'unsubscribe',
    ]) {
      expect(pedidoRemocaoNoTexto(t)).toBe(true);
    }
  });
});

describe('respostaEhDespedida', () => {
  it('detecta despedidas reais (padrão forte, ou 2+ cortesias)', () => {
    for (const t of [
      'Acho que peguei você num momento corrido. Vou te deixar em paz por aqui. Sucesso aí!',
      'Entendi — não é bem o perfil que buscamos agora. Valeu pela conversa!',
      'Sem problemas, vou te deixar em paz.',
      'Se um dia quiser retomar, é só me chamar. Sucesso!',
      'Qualquer coisa é só chamar. Sucesso aí!', // 2 cortesias juntas = despedida
    ]) {
      expect(respostaEhDespedida(t)).toBe(true);
    }
  });
  it('REGRESSÃO: cortesia de MEIO de conversa NÃO encerra entrevista viva', () => {
    for (const t of [
      'Fico à disposição pra qualquer dúvida. Prefere o kit trifásico ou o monofásico?',
      'Sucesso no evento de amanhã! Depois me conta como foi.',
      'É só me chamar quando tiver a medição em mãos.',
      'Perfeito! Fico à disposição. Qual o melhor horário pra gente conversar?',
      'Ótima pergunta! Qualquer coisa tô por aqui. Você atende a região de Campinas?',
    ]) {
      expect(respostaEhDespedida(t)).toBe(false);
    }
  });
  it('turno que TERMINA perguntando nunca é despedida (mesmo com padrão forte)', () => {
    expect(
      respostaEhDespedida('Não é bem o perfil que buscamos… mas me conta, você revende o quê?'),
    ).toBe(false);
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

describe('extrairMarcadoresDoc', () => {
  it('sem marcação: devolve o texto intacto e ids vazios', () => {
    const r = extrairMarcadoresDoc('Olá, tudo bem?');
    expect(r.limpo).toBe('Olá, tudo bem?');
    expect(r.ids).toEqual([]);
  });

  it('extrai o id e remove a marcação do texto', () => {
    const r = extrairMarcadoresDoc('Claro! Vou te enviar.\n[[ENVIAR_DOC:ckabc123]]');
    expect(r.ids).toEqual(['ckabc123']);
    expect(r.limpo).toBe('Claro! Vou te enviar.');
  });

  it('tolera espaços e case na marcação', () => {
    const r = extrairMarcadoresDoc('segue [[ enviar_doc : cku-9 ]] pronto');
    expect(r.ids).toEqual(['cku-9']);
    expect(r.limpo).toBe('segue  pronto');
  });

  it('dedup de ids repetidos + múltiplos arquivos', () => {
    const r = extrairMarcadoresDoc('[[ENVIAR_DOC:a]] x [[ENVIAR_DOC:b]] y [[ENVIAR_DOC:a]]');
    expect(r.ids).toEqual(['a', 'b']);
  });
});

describe('ConversarIaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let persona: ReturnType<typeof makePersona>;
  let muller: ReturnType<typeof makeMuller>;
  let custo: ReturnType<typeof makeCusto>;
  let whatsapp: ReturnType<typeof makeWhatsapp>;
  let bus: ReturnType<typeof makeBus>;
  let queue: ReturnType<typeof makeQueue>;
  let svc: ConversarIaService;

  beforeEach(() => {
    prisma = makePrisma();
    persona = makePersona();
    muller = makeMuller();
    custo = makeCusto();
    whatsapp = makeWhatsapp();
    bus = makeBus();
    queue = makeQueue();
    svc = new ConversarIaService(
      prisma as never,
      persona as never,
      muller as never,
      { buscar: vi.fn(async () => []) } as never, // produtoSearch (RAG)
      { buscar: vi.fn(async () => []) } as never, // conhecimentoSearch (RAG)
      custo as never,
      whatsapp as never,
      bus as never,
      { aguardarSlot: vi.fn() } as never,
      { suprimido: vi.fn(async () => false) } as never, // supressao
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
        { idempotencyKey: expect.stringMatching(/^fx:exec\-1:no\-ia:opener:b0:[0-9a-f]{12}$/) },
      );
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          data: expect.objectContaining({ status: 'AGUARDANDO', aguardandoNoId: 'no-ia' }),
        }),
      );
    });

    // ── T1.1: reativo tem que RESPONDER, não abrir conversa ──────────
    // O caso que reprovou a bateria: o cliente escreveu "queimou o CLP..." e a
    // Betinna respondeu "me conta, o que você precisa?". O modelo recebia
    // '(inicie)' + histórico [] e a instrução de ABORDAR — a fala dele estava
    // no contexto e não era repassada.

    it('REATIVO: manda a FALA DO LEAD como turno do usuário, não "(inicie)"', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Sobre o CLP…', modelo: 'gpt' });

      await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1', texto: 'queimou o CLP da linha de produção', conversationId: 'conv-1' },
        'emp-1',
        true, // reativo
      );

      const [, systemPrompt, mensagem] = muller.gerarRespostaIa.mock.calls[0];
      expect(mensagem).toBe('queimou o CLP da linha de produção');
      // E a instrução é de RESPONDER, não de abrir conversa.
      expect(systemPrompt).toContain('ACABOU DE ESCREVER');
      expect(systemPrompt).not.toContain('PRIMEIRA mensagem de abordagem');
    });

    it('REATIVO + usarNomeDoLead=false: o motor NÃO injeta exemplo de saudação', async () => {
      // O `"Oi! Tudo bem?"` estava escrito NO CÓDIGO — era literalmente o que o
      // cliente recebia depois de descrever o problema.
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'ok', modelo: 'gpt' });

      await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1', usarNomeDoLead: false }) as never,
        { leadId: 'lead-1', texto: 'oi, tenho um problema' },
        'emp-1',
        true,
      );

      const [, systemPrompt] = muller.gerarRespostaIa.mock.calls[0];
      expect(systemPrompt).toContain('NÃO use o nome do contato');
      expect(systemPrompt).not.toContain('Oi! Tudo bem?');
    });

    it('REATIVO: semeia o histórico da conversa (é o que sustenta o "não se reapresente")', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'ok', modelo: 'gpt' });
      // A query do montarHistorico é `orderBy: criadoEm desc` — o mock precisa
      // vir na MESMA ordem (mais recente primeiro), senão o teste valida um
      // cenário que o banco nunca produz.
      prisma.message.findMany.mockResolvedValue([
        { direction: 'INBOUND', conteudo: 'queimou o CLP', criadoEm: new Date() },
        {
          direction: 'OUTBOUND',
          conteudo: 'Oi, aqui é da Somatec',
          criadoEm: new Date(Date.now() - 60_000),
        },
      ]);

      await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1', texto: 'queimou o CLP', conversationId: 'conv-1' },
        'emp-1',
        true,
      );

      const [, , , historico] = muller.gerarRespostaIa.mock.calls[0];
      expect(Array.isArray(historico)).toBe(true);
      // O que o bot já disse chega ao modelo...
      expect(JSON.stringify(historico)).toContain('Somatec');
      // ...e a mensagem ATUAL não vai duplicada (ela é o turno, não o histórico).
      expect(
        (historico as Array<{ content: string }>).filter((h) => h.content === 'queimou o CLP'),
      ).toHaveLength(0);
    });

    it('REATIVO: grava os DOIS turnos no _iaHistorico (user + assistant)', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Sobre o CLP…', modelo: 'gpt' });

      await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1', texto: 'queimou o CLP' },
        'emp-1',
        true,
      );

      const upd = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      const hist = upd?.data?.contexto?._iaHistorico as Array<{ role: string; content: string }>;
      expect(hist.map((h) => h.role)).toEqual(['user', 'assistant']);
      expect(hist[0].content).toBe('queimou o CLP');
    });

    it('PROATIVO segue abrindo conversa — sem regressão no R1', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Olá! Tudo bem?', modelo: 'gpt' });

      await svc.iniciar('exec-1', no({ promptId: 'p1' }) as never, { leadId: 'lead-1' }, 'emp-1');

      const [, systemPrompt, mensagem, historico] = muller.gerarRespostaIa.mock.calls[0];
      expect(mensagem).toBe('(inicie)');
      expect(historico).toEqual([]);
      expect(systemPrompt).toContain('PRIMEIRA mensagem de abordagem');
    });

    it('teto de custo do bot atingido → roteia "erro" e NÃO chama a IA', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      custo.verificarTeto.mockResolvedValue({ bloqueado: true, motivo: 'Teto atingido' });

      const r = await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(r.roteado).toBe(true);
      expect(r.tipoErro).toBe('ia_custo_excedido');
      expect(muller.gerarRespostaIa).not.toHaveBeenCalled();
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    });

    it('#23: prompt do nó apagado/desativado → NÃO abre conversa com a persona errada', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      // Prompt não resolve (apagado, desativado ou de outro tenant).
      prisma.botPrompt.findFirst.mockResolvedValue(null);

      const r = await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(r.pulado).toBe(true);
      expect(r.motivo).toMatch(/desativado/i);
      expect(muller.gerarRespostaIa).not.toHaveBeenCalled();
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    });

    it('registra o uso de tokens no orçamento de custo do bot', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      muller.gerarRespostaIa.mockResolvedValue({
        texto: 'Olá!',
        modelo: 'gpt',
        tokensIn: 120,
        tokensOut: 40,
      });

      await svc.iniciar('exec-1', no({ promptId: 'p1' }) as never, { leadId: 'lead-1' }, 'emp-1');

      expect(custo.registrarUso).toHaveBeenCalledWith('emp-1', 120, 40);
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
        { idempotencyKey: expect.stringMatching(/^fx:exec\-1:no\-ia:opener:b0:[0-9a-f]{12}$/) },
      );
      expect(whatsapp.enviarTexto).toHaveBeenNthCalledWith(
        2,
        'emp-1',
        '11999990000@s.whatsapp.net',
        'tudo bem?',
        { idempotencyKey: expect.stringMatching(/^fx:exec\-1:no\-ia:opener:b1:[0-9a-f]{12}$/) },
      );
    });

    it('guarda a abertura na memória da IA (pra não se reapresentar)', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        contatoTelefone: '11999990000',
        contatoNome: 'Ana',
      });
      muller.gerarRespostaIa.mockResolvedValue({
        texto: 'Olá Ana, aqui é a Betinna…',
        modelo: 'gpt',
      });

      await svc.iniciar('exec-1', no({ promptId: 'p1' }) as never, { leadId: 'lead-1' }, 'emp-1');

      const upd = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(upd?.data?.status).toBe('AGUARDANDO');
      expect(upd?.data?.contexto?._iaHistorico).toEqual([
        expect.objectContaining({ role: 'assistant', content: 'Olá Ana, aqui é a Betinna…' }),
      ]);
    });

    it('erro de IA → roteia pela saída "erro" (tipo_erro=ia_sem_chave no contexto)', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-erro', label: 'erro' }]);
      muller.gerarRespostaIa.mockRejectedValue(
        new Error('OpenAI não configurada — defina a chave da empresa em Integrações'),
      );

      const r = await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(r.roteado).toBe(true);
      expect(r.tipoErro).toBe('ia_sem_chave');
      // Gravou os campos no contexto + saiu de AGUARDANDO
      const upd = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(upd?.data?.aguardandoNoId).toBeNull();
      expect(upd?.data?.contexto?.tipo_erro).toBe('ia_sem_chave');
      expect(upd?.data?.contexto?.mensagem_erro).toContain('OpenAI não configurada');
      // Roteou pela aresta "erro"
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-erro' },
        expect.any(Object),
      );
    });

    it('erro de WhatsApp → roteia "erro" com tipo_erro=whatsapp_falha', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-erro', label: 'erro' }]);
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Olá!', modelo: 'gpt' });
      whatsapp.enviarTexto.mockRejectedValue(new Error('WhatsApp da empresa não está conectado.'));

      const r = await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(r.roteado).toBe(true);
      expect(r.tipoErro).toBe('whatsapp_falha');
      const upd = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(upd?.data?.contexto?.tipo_erro).toBe('whatsapp_falha');
    });

    it('sem aresta "erro" ligada → encerra CONCLUÍDO (não fica preso) em vez de falhar', async () => {
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000' });
      prisma.fluxoEdge.findMany.mockResolvedValue([]); // nenhuma aresta de saída
      muller.gerarRespostaIa.mockRejectedValue(new Error('429 rate limit'));

      const r = await svc.iniciar(
        'exec-1',
        no({ promptId: 'p1' }) as never,
        { leadId: 'lead-1' },
        'emp-1',
      );

      expect(r.roteado).toBe(true);
      expect(r.tipoErro).toBe('ia_indisponivel');
      expect(queue.add).not.toHaveBeenCalled();
      // enfileirarSucessores sem alvos encerra como CONCLUÍDO
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONCLUIDO' }) }),
      );
    });
  });

  describe('prepararEntrada (multimodal — MESMA regra do bot geral)', () => {
    const cfg = (over = {}) => ({
      historicoMensagens: 10,
      delayRespostaSegundos: 0,
      mostrarDigitando: false,
      quebrarMensagens: false,
      maxMensagens: 3,
      transcreverAudio: false,
      analisarImagem: false,
      ...over,
    });

    it('transcreve áudio quando "transcreverAudio" está ligado (+ grava 🎤 na inbox)', async () => {
      persona.obterConfigBot.mockResolvedValue(cfg({ transcreverAudio: true }));
      muller.transcreverAudio.mockResolvedValue('quero sim, me explica melhor');

      const r = await svc.prepararEntrada(
        {
          empresaId: 'emp-1',
          tipo: 'AUDIO',
          conteudo: '[áudio]',
          mediaUrl: 'u',
          mediaMime: 'audio/ogg',
        } as never,
        'msg-1',
      );

      expect(r.mensagemIA).toBe('quero sim, me explica melhor');
      expect(prisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: { conteudo: '🎤 quero sim, me explica melhor' },
        }),
      );
    });

    it('prepara imagem (data-url) quando "analisarImagem" está ligado', async () => {
      persona.obterConfigBot.mockResolvedValue(cfg({ analisarImagem: true }));
      whatsapp.baixarMidia.mockResolvedValue(Buffer.from('img'));

      const r = await svc.prepararEntrada(
        {
          empresaId: 'emp-1',
          tipo: 'IMAGE',
          conteudo: '[imagem]',
          mediaUrl: 'u',
          mediaMime: 'image/jpeg',
        } as never,
        'msg-1',
      );

      expect(r.imagemDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(r.mensagemIA).toBe(''); // placeholder "[imagem]" sem legenda → vazio
    });

    it('toggle desligado → conteúdo cru, não transcreve (mídia escala pra humano)', async () => {
      persona.obterConfigBot.mockResolvedValue(cfg({ transcreverAudio: false }));

      const r = await svc.prepararEntrada(
        { empresaId: 'emp-1', tipo: 'AUDIO', conteudo: '[áudio]', mediaUrl: 'u' } as never,
        'msg-1',
      );

      expect(r.mensagemIA).toBe('[áudio]');
      expect(muller.transcreverAudio).not.toHaveBeenCalled();
    });

    it('#21: teto de custo batido → NÃO paga Whisper (a transcrição vinha antes do teto)', async () => {
      persona.obterConfigBot.mockResolvedValue(cfg({ transcreverAudio: true }));
      custo.verificarTeto.mockResolvedValue({ bloqueado: true, motivo: 'Teto atingido' });

      const r = await svc.prepararEntrada(
        {
          empresaId: 'emp-1',
          tipo: 'AUDIO',
          conteudo: '[áudio]',
          mediaUrl: 'u',
          mediaMime: 'audio/ogg',
        } as never,
        'msg-1',
      );

      expect(muller.transcreverAudio).not.toHaveBeenCalled();
      expect(r.mensagemIA).toBe('[áudio]');
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

    it('claim perdido (count=0) → NÃO roda a IA nem envia (anti-turno-duplo)', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      // Outro turno concorrente já pegou o lock → este claim falha.
      prisma.fluxoExecucao.updateMany.mockResolvedValueOnce({ count: 0 });

      await svc.retomar('exec-1', 'conv-1', 'oi');

      expect(muller.gerarRespostaIa).not.toHaveBeenCalled();
      expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
      expect(prisma.fluxoNo.findUnique).not.toHaveBeenCalled();
    });

    it('classificacao_final SOZINHA no meio da conversa NÃO encerra a entrevista', async () => {
      // O modelo às vezes preenche a variável no 1º turno (ex.: "Indefinido") só
      // por estar no schema. Antes isso valia como sinal terminal: a entrevista
      // morria na largada e o lead saía classificado errado.
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
      muller.gerarRespostaIa.mockResolvedValue({
        texto:
          '{"resposta":"Legal! Me conta qual equipamento você quer proteger?","classificou":false,"variaveis":{"classificacao_final":"Indefinido"}}',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'oi');

      // Segue conversando: NÃO disparou classificação nem avançou o fluxo.
      expect(bus.disparar).not.toHaveBeenCalledWith('emp-1', 'IA_CLASSIFICOU', expect.anything());
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('classificacao_final COM classificou=true encerra normalmente', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
      muller.gerarRespostaIa.mockResolvedValue({
        texto:
          '{"resposta":"Obrigado! Já passo pro time.","classificou":true,"variaveis":{"classificacao_final":"Forte Sinergia"}}',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'tenho interesse');

      expect(bus.disparar).toHaveBeenCalledWith(
        'emp-1',
        'IA_CLASSIFICOU',
        expect.objectContaining({ classificacao: 'Forte Sinergia' }),
      );
    });

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
        { idempotencyKey: expect.stringMatching(/^fx:exec\-1:no\-ia:t0:b0:[0-9a-f]{12}$/) },
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

    // BUG do card: encerramento comum (Sem Sinergia) sinaliza o fim nas VARIÁVEIS
    // (trilho=encerrar + classificacao_final) SEM setar o flag top-level classificou.
    // O motor tem que reconhecer isso e ROTEAR — antes ficava AGUARDANDO até 24h.
    it('encerramento via variáveis (trilho=encerrar) sem flag → avança e roteia', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
      muller.gerarRespostaIa.mockResolvedValue({
        texto:
          '{"resposta":"Tranquilo, então não é o perfil por aqui. Sucesso!","classificou":false,' +
          '"variaveis":{"trilho":"encerrar","classificacao_final":"Sem Sinergia"}}',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'neca de pitibiribas');

      // Gravou a classificacao_final DESTE turno (não valor velho) + dispara o gatilho
      const upd = prisma.lead.update.mock.calls.at(-1)?.[0];
      expect(upd.data.variaveis).toMatchObject({
        classificacao_final: 'Sem Sinergia',
        classificacao: 'Sem Sinergia',
      });
      expect(bus.disparar).toHaveBeenCalledWith(
        'emp-1',
        'IA_CLASSIFICOU',
        expect.objectContaining({ leadId: 'lead-1', classificacao: 'Sem Sinergia' }),
      );
      // Avançou pelo ramo "classificou" e saiu de AGUARDANDO
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-2' },
        expect.any(Object),
      );
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EM_EXECUCAO' }) }),
      );
    });

    // O CASO QUE TRAVAVA (repro do card): lead pede remoção, a IA responde a
    // despedida SÓ EM TEXTO (sem JSON/variável) → antes o nó ficava AGUARDANDO.
    // A rede de segurança determinística força pedido_remocao=sim e finaliza.
    it('pedido de remoção no texto do lead → finaliza mesmo com a IA em texto puro', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
      muller.gerarRespostaIa.mockResolvedValue({
        texto: 'Entendi, peço desculpas. Vou te tirar da nossa lista e não te procuro mais.',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'tira meu numero da sua lista de contatos');

      const upd = prisma.lead.update.mock.calls.at(-1)?.[0];
      expect(upd.data.variaveis).toMatchObject({ pedido_remocao: 'sim' });
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-2' },
        expect.any(Object),
      );
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EM_EXECUCAO' }) }),
      );
    });

    // O CASO SEM SINERGIA QUE TRAVAVA: a IA se despede (trava anti-loop) mas NÃO
    // grava classificacao_final → antes ficava AGUARDANDO. Agora o motor força a
    // classificação com uma chamada dedicada (fallback) e finaliza.
    it('IA se despede sem classificar → fallback classifica e finaliza', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
      // 1ª chamada = turno normal (despedida, sem classificar); 2ª = fallback classificador.
      muller.gerarRespostaIa
        .mockResolvedValueOnce({
          texto: 'Acho que te peguei num momento de zoeira. Vou te deixar em paz por aqui.',
          modelo: 'gpt',
        })
        .mockResolvedValueOnce({ texto: '{"classificacao_final":"Sem Sinergia"}', modelo: 'gpt' });

      await svc.retomar('exec-1', 'conv-1', 'beibe beibe du biruleibe');

      const upd = prisma.lead.update.mock.calls.at(-1)?.[0];
      expect(upd.data.variaveis).toMatchObject({ classificacao_final: 'Sem Sinergia' });
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
        { idempotencyKey: expect.stringMatching(/^fx:exec\-1:no\-ia:t0:b0:[0-9a-f]{12}$/) },
      );
      expect(bus.disparar).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      // Renovou timeout, mas não saiu de AGUARDANDO
      const upd = prisma.fluxoExecucao.update.mock.calls[0][0];
      expect(upd.data.timeoutEm).toBeInstanceOf(Date);
      expect(upd.data.status).toBeUndefined();
    });

    // DEFESA EM PROFUNDIDADE: mesmo numa execução "amnésica" (sem _iaHistorico — ex:
    // 2ª execução que escapou do anti-duplicata), a IA monta o histórico pela CONVERSA
    // real e enxerga o pitch já dado → NÃO se reapresenta.
    it('monta histórico pela CONVERSA quando _iaHistorico está vazio (não re-apresenta)', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando); // contexto SEM _iaHistorico
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: {} });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      // Conversa real (DESC, como o orderBy retorna): pitch já enviado + resposta atual.
      prisma.message.findMany.mockResolvedValue([
        {
          direction: 'INBOUND',
          conteudo: 'sim combinado',
          criadoEm: new Date('2026-06-19T20:04:00Z'),
        },
        {
          direction: 'OUTBOUND',
          conteudo: 'A MSM é uma indústria de alimentos, trabalha com caldos e molhos.',
          criadoEm: new Date('2026-06-19T20:03:00Z'),
        },
      ]);
      muller.gerarRespostaIa.mockResolvedValue({
        texto: 'Perfeito! Me conta de qual canal são teus clientes?',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'sim combinado');

      const [, , msgAtual, historico] = muller.gerarRespostaIa.mock.calls[0] as [
        string,
        string,
        string,
        Array<{ role: string; content: string }>,
      ];
      expect(msgAtual).toBe('sim combinado');
      // A IA recebeu o pitch já dito (não vai re-apresentar a empresa).
      expect(
        historico.some((h) => h.role === 'assistant' && h.content.includes('MSM é uma indústria')),
      ).toBe(true);
      // A mensagem atual do lead NÃO aparece duplicada no histórico (vai como msgAtual).
      expect(historico.filter((h) => h.content === 'sim combinado')).toHaveLength(0);
    });

    it('lê o histórico no tamanho CONFIGURADO (historicoMensagens) da empresa', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: {} });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      persona.obterConfigBot.mockResolvedValue({
        historicoMensagens: 5, // empresa configurou 5
        delayRespostaSegundos: 0,
        mostrarDigitando: false,
        quebrarMensagens: false,
        maxMensagens: 3,
        transcreverAudio: false,
        analisarImagem: false,
      });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'ok', modelo: 'gpt' });

      await svc.retomar('exec-1', 'conv-1', 'oi');

      // montarHistorico usa take = historicoMensagens (não um valor fixo hardcoded).
      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    });

    // Fecho com captura de e-mail: o lead manda o e-mail (pra receber o convite da
    // reunião) → grava em Lead.contatoEmail (dado estruturado reusável em funis).
    it('captura o e-mail que o lead manda e grava em Lead.contatoEmail', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: {} });
      prisma.lead.findFirst.mockResolvedValue({
        contatoTelefone: '11999990000',
        contatoEmail: null,
        variaveis: {},
      });
      muller.gerarRespostaIa.mockResolvedValue({ texto: 'Perfeito, anotado! 🙌', modelo: 'gpt' });

      await svc.retomar('exec-1', 'conv-1', 'claro, meu email é Joao.Rep@Empresa.com.br');

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: { contatoEmail: 'joao.rep@empresa.com.br' },
        }),
      );
    });

    // Encerramento educado (config `encerramentoEspera` no nó): ao classificar, roda o
    // ramo numa execução-FILHA e MANTÉM o nó de IA respondendo o rep (não encerra seco).
    it('COM janela de encerramento: classifica, roda o ramo numa execução-FILHA e segue AGUARDANDO', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue({ ...execAguardando, fluxoId: 'fluxo-1' });
      prisma.fluxoNo.findUnique.mockResolvedValue({
        id: 'no-ia',
        config: { encerramentoEspera: { valor: 30, unidade: 'minutos' } },
      });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-tag', label: 'classificou' }]);
      prisma.fluxoExecucao.create.mockResolvedValue({ id: 'filha-1' });
      muller.gerarRespostaIa.mockResolvedValue({
        texto:
          '{"resposta":"Perfeito, te chamo!","classificou":true,"classificacao":"Forte Sinergia"}',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'sim, combinado');

      // Rodou o ramo "classificou" numa execução-filha (não na própria) + enfileirou.
      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'filha-1', noId: 'no-tag' },
        expect.any(Object),
      );
      // O nó de IA SEGUE AGUARDANDO (não vira EM_EXECUCAO) e marca _iaClassificou.
      const upd = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(upd?.data?.status).toBeUndefined();
      expect(upd?.data?.contexto?._iaClassificou).toBe(true);
    });

    it('encerramento: já classificou → continua respondendo o rep SEM re-disparar tag/aviso', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue({
        ...execAguardando,
        contexto: { leadId: 'lead-1', _iaClassificou: true },
      });
      prisma.fluxoNo.findUnique.mockResolvedValue({
        id: 'no-ia',
        config: { encerramentoEspera: { valor: 30, unidade: 'minutos' } },
      });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      muller.gerarRespostaIa.mockResolvedValue({
        texto:
          '{"resposta":"Combinado, um abraço!","classificou":true,"classificacao":"Forte Sinergia"}',
        modelo: 'gpt',
      });

      await svc.retomar('exec-1', 'conv-1', 'valeu!');

      expect(whatsapp.enviarTexto).toHaveBeenCalled(); // respondeu o rep
      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled(); // não re-roda o ramo
      expect(bus.disparar).not.toHaveBeenCalled(); // não re-dispara IA_CLASSIFICOU
    });

    it('ignora execução que não está mais AGUARDANDO', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue({ ...execAguardando, status: 'CONCLUIDO' });
      await svc.retomar('exec-1', 'conv-1', 'oi');
      expect(muller.gerarRespostaIa).not.toHaveBeenCalled();
    });

    it('erro de IA no retomar → roteia "erro" e SAI de AGUARDANDO (não fica preso)', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
      prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config: { promptId: 'p1' } });
      prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
      prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-erro', label: 'erro' }]);
      muller.gerarRespostaIa.mockRejectedValue(new Error('429 rate limit'));

      await svc.retomar('exec-1', 'conv-1', 'oi');

      const upd = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(upd?.data?.status).toBe('EM_EXECUCAO');
      expect(upd?.data?.aguardandoNoId).toBeNull();
      expect(upd?.data?.contexto?.tipo_erro).toBe('ia_indisponivel');
      expect(upd?.data?.contexto?.mensagem_erro).toContain('rate limit');
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-erro' },
        expect.any(Object),
      );
    });
  });

  describe('processarTimeouts', () => {
    it('dispara LEAD_SEM_RESPOSTA e encerra execuções vencidas', async () => {
      prisma.fluxoExecucao.findMany.mockResolvedValue([
        { id: 'exec-1', empresaId: 'emp-1', contexto: { leadId: 'lead-1' } },
      ]);
      const n = await svc.processarTimeouts();
      expect(n).toBe(1);
      // `_hops` no payload: re-disparo interno propaga o corta-loop do bus
      // (auditoria 20/08) — sem ele a cadeia timeout→fluxo→IA→timeout não era cortada.
      expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'LEAD_SEM_RESPOSTA', {
        leadId: 'lead-1',
        _hops: 1,
      });
      // CAS: agora via updateMany (claim antes de disparar) em vez de update cego.
      expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONCLUIDO' }) }),
      );
    });
  });
});

describe('semMic — dedup de áudio transcrito (#B8)', () => {
  it('remove o prefixo 🎤 que a Message ganha ao transcrever', () => {
    expect(semMic('🎤 quero saber o preço')).toBe('quero saber o preço');
  });

  it('texto sem prefixo passa igual (só trim)', () => {
    expect(semMic('  quero saber o preço  ')).toBe('quero saber o preço');
  });

  it('as duas formas do MESMO áudio colapsam — era isso que escapava do dedup', () => {
    // O histórico traz "🎤 <texto>" (Message) e o turno traz "<texto>" cru; a
    // comparação literal nunca casava e o recado ia DUAS vezes pro modelo.
    expect(semMic('🎤 tenho interesse')).toBe(semMic('tenho interesse'));
  });

  it('🎤 no MEIO do texto não é tocado (só o prefixo é decoração)', () => {
    expect(semMic('falei 🎤 no microfone')).toBe('falei 🎤 no microfone');
  });
});

describe('allowlist de variaveisGravadas NÃO come os sinais de roteamento', () => {
  // Reproduz o filtro do turno (conversar-ia.service, "Filtra pro conjunto
  // permitido"). O bug: `new Set(gravaveis)` jogava fora pedido_remocao e
  // classificacao_final — que o MOTOR força, não a IA. O lead pedia pra sair,
  // o motor logava "forçando pedido_remocao=sim", e a chave morria aqui: a tag
  // de LGPD nunca era aplicada e ele seguia sendo abordado.
  // ⚠️ Antes este teste REIMPLEMENTAVA o filtro aqui dentro e testava a cópia —
  // reverter a linha de produção mantinha tudo verde. Agora aponta pra função
  // exportada que o service usa de verdade.
  const filtrar = filtrarVariaveisGravaveis;

  it('pedido_remocao sobrevive a uma allowlist que não o lista (LGPD)', () => {
    const out = filtrar(['tipo_atuacao', 'regiao'], {
      tipo_atuacao: 'industria',
      pedido_remocao: 'sim',
    });
    expect(out.pedido_remocao).toBe('sim');
  });

  it('classificacao_final sobrevive (fallback de despedida roteia o nó)', () => {
    const out = filtrar(['regiao'], { classificacao_final: 'Sem Sinergia', lixo: 'x' });
    expect(out.classificacao_final).toBe('Sem Sinergia');
    expect(out.lixo).toBeUndefined();
  });

  it('TODOS os sinais de roteamento passam', () => {
    const vars = Object.fromEntries(SINAIS_ROTEAMENTO.map((k) => [k, 'v']));
    expect(Object.keys(filtrar(['nada'], vars)).sort()).toEqual([...SINAIS_ROTEAMENTO].sort());
  });

  it('variável de negócio FORA da allowlist continua sendo descartada', () => {
    const out = filtrar(['regiao'], { regiao: 'SP', orcamento: '10k' });
    expect(out.regiao).toBe('SP');
    expect(out.orcamento).toBeUndefined();
  });

  it('sem allowlist, nada é filtrado', () => {
    const vars = { qualquer: '1', outra: '2' };
    expect(filtrar([], vars)).toEqual(vars);
  });
});

/**
 * O prompt do nó manda no modelo e na temperatura — e as variáveis declaradas
 * viram enum no structured output.
 *
 * ⚠️ Até 18/08 `BotPrompt.modelo` e `BotPrompt.temperatura` existiam no banco,
 * na tela e no MCP, e NÃO chegavam na chamada: o modelo vinha sempre da persona
 * da empresa e a temperatura não era enviada nunca. Quem calibrava um prompt
 * estava mexendo em campo decorativo, sem nenhum sinal de que não pegou.
 */
describe('ConversarIaService — overrides do prompt e enum das variáveis', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let muller: ReturnType<typeof makeMuller>;
  let svc: ConversarIaService;

  const execAguardando = {
    id: 'exec-1',
    status: 'AGUARDANDO',
    aguardandoNoId: 'no-ia',
    empresaId: 'emp-1',
    contexto: { leadId: 'lead-1' },
  };

  const preparar = (config: Record<string, unknown>) => {
    prisma.fluxoExecucao.findUnique.mockResolvedValue(execAguardando);
    prisma.fluxoNo.findUnique.mockResolvedValue({ id: 'no-ia', config });
    prisma.lead.findFirst.mockResolvedValue({ contatoTelefone: '11999990000', variaveis: {} });
    prisma.fluxoEdge.findMany.mockResolvedValue([{ targetNoId: 'no-2' }]);
    muller.gerarRespostaIa.mockResolvedValue({
      texto: '{"resposta":"oi","classificou":false}',
      modelo: 'gpt',
    });
  };

  beforeEach(() => {
    prisma = makePrisma();
    muller = makeMuller();
    svc = new ConversarIaService(
      prisma as never,
      makePersona() as never,
      muller as never,
      { buscar: vi.fn(async () => []) } as never, // produtoSearch (RAG)
      { buscar: vi.fn(async () => []) } as never, // conhecimentoSearch (RAG)
      makeCusto() as never,
      makeWhatsapp() as never,
      makeBus() as never,
      { aguardarSlot: vi.fn() } as never,
      { suprimido: vi.fn(async () => false) } as never, // supressao
      makeQueue() as never,
    );
  });

  it('manda o MODELO e a TEMPERATURA do prompt (antes ia só o da empresa)', async () => {
    preparar({ promptId: 'p1' });
    prisma.botPrompt.findFirst.mockResolvedValue({ modelo: 'gpt-5.6-terra', temperatura: 0.4 });

    await svc.retomar('exec-1', 'conv-1', 'oi');

    const opts = muller.gerarRespostaIa.mock.calls[0][5] as {
      modelo?: string;
      temperatura?: number;
    };
    expect(opts.modelo).toBe('gpt-5.6-terra');
    expect(opts.temperatura).toBe(0.4);
  });

  it('variáveis com valores declarados viram ENUM no structured output', async () => {
    preparar({
      promptId: 'p1',
      variaveisGravadas: ['perfil_energia: Industrial | Nao industrial', 'regiao'],
    });
    prisma.botPrompt.findFirst.mockResolvedValue({ modelo: null, temperatura: null });

    await svc.retomar('exec-1', 'conv-1', 'oi');

    const opts = muller.gerarRespostaIa.mock.calls[0][5] as {
      responseFormat?: {
        schema: { properties: { variaveis: { properties: Record<string, { enum?: unknown[] }> } } };
      };
    };
    expect(opts.responseFormat?.schema.properties.variaveis.properties.perfil_energia.enum).toEqual(
      ['Industrial', 'Nao industrial', null],
    );
  });

  it('sem valores declarados, NÃO liga structured output (não muda fluxo existente)', async () => {
    preparar({ promptId: 'p1', variaveisGravadas: ['regiao', 'canal'] });
    prisma.botPrompt.findFirst.mockResolvedValue({ modelo: null, temperatura: null });

    await svc.retomar('exec-1', 'conv-1', 'oi');

    const opts = muller.gerarRespostaIa.mock.calls[0][5] as { responseFormat?: unknown };
    expect(opts.responseFormat).toBeNull();
  });

  it('os valores aceitos entram TAMBÉM no texto do prompt (ajuda a escolha, não só o formato)', async () => {
    preparar({
      promptId: 'p1',
      variaveisGravadas: ['classificacao_final: Não é lead | Interesse comercial'],
    });
    prisma.botPrompt.findFirst.mockResolvedValue({ modelo: null, temperatura: null });

    await svc.retomar('exec-1', 'conv-1', 'oi');

    const systemPrompt = muller.gerarRespostaIa.mock.calls[0][1] as string;
    expect(systemPrompt).toContain('Não é lead | Interesse comercial');
  });

  it('prompt inacessível não derruba o turno (segue com o modelo da empresa)', async () => {
    preparar({ promptId: 'p1' });
    prisma.botPrompt.findFirst.mockRejectedValue(new Error('banco fora'));

    await svc.retomar('exec-1', 'conv-1', 'oi');

    expect(muller.gerarRespostaIa).toHaveBeenCalled();
  });
});
