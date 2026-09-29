import { describe, expect, it, vi } from 'vitest';
import {
  MLRespostaIaService,
  PROMPT_RESPOSTA_PERGUNTA,
  TAG_HUMANO,
  dadosDoAnuncio,
  lerResposta,
} from './ml-resposta-ia.service';

/**
 * Léo, 29/09: "Sugerir com IA" na pergunta. Primeiro a base (pergunta, anúncio
 * e respostas anteriores do nosso banco); a descrição só se precisar; sem a
 * informação, NÃO responde e marca pra humano.
 */
const ia = (sabe: boolean, resposta = '') => ({
  texto: JSON.stringify({ sabe, resposta }),
  modelo: 'gpt-x',
});

function montar(
  opts: {
    peerId?: string | null;
    respostasIa?: Array<ReturnType<typeof ia>>;
    semDescricao?: boolean;
    tags?: string[];
    anteriores?: Array<{
      conteudo: string;
      conversation: { mensagens: Array<{ conteudo: string }> };
    }>;
  } = {},
) {
  const prisma = {
    conversation: {
      findFirst: vi.fn(async () =>
        opts.peerId === null
          ? null
          : { id: 'conv-1', peerId: opts.peerId ?? 'q:13662157863', tagsInternas: opts.tags ?? [] },
      ),
      update: vi.fn(async () => ({})),
    },
    message: {
      // pergunta importada (tem ml_item_id no meta)
      findMany: vi.fn(async (args: { where: { conversationId?: string } }) =>
        args.where.conversationId
          ? [{ conteudo: 'Preciso dela toda preta', meta: { ml_item_id: 'MLB4685939713' } }]
          : (opts.anteriores ?? []),
      ),
    },
  };
  const ml = {
    get: vi.fn(async (_e: string, path: string) => {
      if (path.endsWith('/description')) {
        if (opts.semDescricao) throw new Error('ML GET 404');
        return { plain_text: 'Camiseta 100% algodão. Cores: branca, cinza e azul.' };
      }
      if (path.startsWith('/items/'))
        return {
          id: 'MLB4685939713',
          title: 'Camiseta Básica',
          price: 49.9,
          attributes: [
            { name: 'Material', value_name: 'Algodão' },
            { name: 'Vazio', value_name: null },
          ],
          variations: [
            {
              available_quantity: 1,
              attribute_combinations: [{ name: 'Cor', value_name: 'Branca' }],
            },
          ],
        };
      throw new Error('inesperado ' + path);
    }),
  };
  const respostas = [...(opts.respostasIa ?? [ia(true, 'Toda preta não temos.')])];
  const bot = { gerarRespostaIa: vi.fn(async () => respostas.shift() ?? ia(false)) };
  const cache = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn(async (k: string) => cache.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        cache.set(k, v);
        return 'OK';
      }),
    },
  };
  const svc = new MLRespostaIaService(prisma as never, ml as never, bot as never, redis as never);
  const mensagemIa = (i: number) => (bot.gerarRespostaIa.mock.calls[i] as unknown as string[])[2]!;
  const pediuDescricao = () =>
    ml.get.mock.calls.some((c) => String((c as unknown[])[1]).endsWith('/description'));
  return { svc, prisma, ml, bot, mensagemIa, pediuDescricao };
}

describe('MLRespostaIaService', () => {
  it('etapa 1 resolve: usa a base (pergunta do banco + anúncio) e NÃO busca a descrição', async () => {
    const m = montar();
    const r = await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(r).toEqual({
      texto: 'Toda preta não temos.',
      precisaHumano: false,
      fonte: 'base',
      modelo: 'gpt-x',
    });
    expect(m.bot.gerarRespostaIa).toHaveBeenCalledTimes(1);
    expect(m.pediuDescricao()).toBe(false);
    // a pergunta veio do banco — nada de /questions no ML
    expect(
      m.ml.get.mock.calls.some((c) => String((c as unknown[])[1]).startsWith('/questions')),
    ).toBe(false);
    const msg = m.mensagemIa(0);
    expect(msg).toContain('Preciso dela toda preta');
    expect(msg).toContain('Material: Algodão');
    expect(msg).toContain('Cor: Branca (estoque: 1)');
    expect(msg).not.toContain('DESCRIÇÃO');
    const [, prompt, , , , extras] = m.bot.gerarRespostaIa.mock.calls[0] as unknown as [
      string,
      string,
      string,
      unknown,
      unknown,
      { responseFormat: { name: string } },
    ];
    expect(prompt).toBe(PROMPT_RESPOSTA_PERGUNTA);
    expect(extras.responseFormat.name).toBe('resposta_pergunta_ml');
  });

  it('respostas já dadas no mesmo anúncio entram na base', async () => {
    const m = montar({
      anteriores: [
        { conteudo: 'Tem tamanho G?', conversation: { mensagens: [{ conteudo: 'Temos P e M.' }] } },
        { conteudo: 'Sem resposta ainda', conversation: { mensagens: [] } },
      ],
    });
    await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    const msg = m.mensagemIa(0);
    expect(msg).toContain('P: Tem tamanho G?\nR: Temos P e M.');
    expect(msg).not.toContain('Sem resposta ainda');
  });

  it('etapa 1 não sabe → busca a descrição e resolve na etapa 2', async () => {
    const m = montar({ respostasIa: [ia(false), ia(true, 'Temos branca, cinza e azul.')] });
    const r = await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(r).toMatchObject({ texto: 'Temos branca, cinza e azul.', fonte: 'descricao' });
    expect(m.pediuDescricao()).toBe(true);
    expect(m.mensagemIa(1)).toContain('Cores: branca, cinza e azul');
    expect(m.prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('nem com a descrição: NÃO responde e marca a conversa pra humano', async () => {
    const m = montar({ respostasIa: [ia(false), ia(false)], tags: ['vip'] });
    const r = await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(r).toEqual({ texto: null, precisaHumano: true, fonte: null, modelo: 'gpt-x' });
    expect(m.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { tagsInternas: ['vip', TAG_HUMANO] },
    });
  });

  it('anúncio sem descrição: etapa 1 não sabe → vai direto pra humano (sem 2ª chamada à IA)', async () => {
    const m = montar({ respostasIa: [ia(false)], semDescricao: true });
    const r = await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(r.precisaHumano).toBe(true);
    expect(m.bot.gerarRespostaIa).toHaveBeenCalledTimes(1);
  });

  it('já marcada pra humano não duplica a etiqueta', async () => {
    const m = montar({ respostasIa: [ia(false), ia(false)], tags: ['Humano'] });
    await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(m.prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('segunda sugestão do mesmo anúncio usa o cache (não chama o ML de novo)', async () => {
    const m = montar({ respostasIa: [ia(false), ia(false), ia(false), ia(false)] });
    await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    const chamadas = m.ml.get.mock.calls.length;
    await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(m.ml.get.mock.calls.length).toBe(chamadas);
  });

  it('só procura conversa da empresa e do ML; pergunta de outro tipo é recusada', async () => {
    const m = montar({ peerId: 'pack:123' });
    await expect(m.svc.sugerirPorConversa('emp-1', 'conv-1')).rejects.toThrow(
      'só existe pra pergunta',
    );
    expect(m.prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1', empresaId: 'emp-1', canal: 'MARKETPLACE_ML' },
      }),
    );
    expect(m.bot.gerarRespostaIa).not.toHaveBeenCalled();
  });

  it('conversa de outra empresa → não encontrada, sem chamar ML', async () => {
    const m = montar({ peerId: null });
    await expect(m.svc.sugerirPorConversa('emp-2', 'conv-1')).rejects.toThrow();
    expect(m.ml.get).not.toHaveBeenCalled();
  });
});

describe('lerResposta / dadosDoAnuncio', () => {
  it('"sabe" sem texto, JSON quebrado ou texto solto contam como NÃO sabe', () => {
    expect(lerResposta('{"sabe":true,"resposta":"  "}').sabe).toBe(false);
    expect(lerResposta('Toda preta não temos').sabe).toBe(false);
    expect(lerResposta('{"sabe":"true","resposta":"x"}').sabe).toBe(false);
    expect(lerResposta('{"sabe":true,"resposta":" ok "}')).toEqual({ sabe: true, resposta: 'ok' });
  });

  it('atributo sem valor fica de fora', () => {
    const t = dadosDoAnuncio({ id: 'MLB1', attributes: [{ name: 'Vazio', value_name: null }] });
    expect(t).not.toContain('Vazio');
  });
});
