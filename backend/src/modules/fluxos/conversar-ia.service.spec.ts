import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversarIaService,
  extrairMarcadoresDoc,
  parseTurnoIa,
  pedidoRemocaoNoTexto,
  personalizarNome,
} from './conversar-ia.service';

const makePrisma = () => ({
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
  fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
  message: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
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
      expect(bus.disparar).toHaveBeenCalledWith('emp-1', 'LEAD_SEM_RESPOSTA', { leadId: 'lead-1' });
      // CAS: agora via updateMany (claim antes de disparar) em vez de update cego.
      expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONCLUIDO' }) }),
      );
    });
  });
});
