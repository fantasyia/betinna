import { ESPERA_PADRAO } from './pendencias-ia';
import { describe, expect, it, vi } from 'vitest';
import { PendenciasIaService } from './pendencias-ia.service';

type Pend = {
  id: string;
  canal: string;
  tipo: string;
  chave: string;
  titulo: string;
  pedido: string | null;
};

function montar(o: {
  ativo?: boolean;
  desligados?: string[];
  pendencias: Pend[];
  conversa?: { id: string } | null;
  mensagens?: Array<{
    direction: 'INBOUND' | 'OUTBOUND';
    conteudo: string;
    tipo?: string;
    criadoEm?: Date;
  }>;
  base?: Array<{ titulo: string; conteudo: string; categoria: string | null }>;
  iaTexto?: string;
  envioFalha?: boolean;
  shopee?: unknown;
  figurinha?: { stickerPackageId: string; stickerId: string };
}) {
  const estados: Record<string, string> = {};
  const registros: Array<Record<string, unknown>> = [];
  const enviados: string[] = [];
  const prisma = {
    empresa: {
      findUnique: vi.fn(async () => ({
        config: {
          pendenciasIa: { ativo: o.ativo ?? true, desligados: o.desligados ?? [] },
          ...(o.figurinha ? { shopeeFigurinhaAgradecimento: o.figurinha } : {}),
        },
      })),
    },
    pendenciaMarketplace: {
      findMany: vi.fn(async () => o.pendencias),
      update: vi.fn(async ({ where, data }) => {
        estados[where.id] = data.estado;
        return {};
      }),
    },
    conversation: {
      findFirst: vi.fn(async () => (o.conversa === undefined ? { id: 'c1' } : o.conversa)),
      findUnique: vi.fn(async () => ({ metadata: { shopee_from_id: 848307855 } })),
    },
    // findMany vem em ordem DESC (o serviço inverte)
    message: {
      findMany: vi.fn(async () =>
        [...(o.mensagens ?? [])]
          // Padrão: o cliente falou há 10 min (já terminou de escrever).
          .map((m) => ({ tipo: 'TEXT', criadoEm: new Date(Date.now() - 10 * 60_000), ...m }))
          .reverse(),
      ),
    },
    marketplaceOrder: { findFirst: vi.fn(async () => null) },
    knowledgeChunk: { findMany: vi.fn(async () => o.base ?? []) },
    pendenciaRespostaIa: {
      create: vi.fn(async ({ data }) => {
        registros.push(data);
        return data;
      }),
    },
    usuario: { findMany: vi.fn(async () => [{ id: 'u1' }]) },
  };
  const inbox = {
    responderComoBot: vi.fn(async (_c: string, texto: string) => {
      if (o.envioFalha) throw new Error('Shopee fora');
      enviados.push(texto);
    }),
  };
  const bot = {
    gerarRespostaIa: vi.fn(async () => ({
      texto:
        o.iaTexto ??
        '{"acao":"responder","resposta":"Nós que agradecemos!","motivo":"agradecimento"}',
      modelo: 'gpt-x',
    })),
  };
  const push = { enviar: vi.fn(async () => 1) };
  const svc = new PendenciasIaService(
    prisma as never,
    inbox as never,
    bot as never,
    push as never,
    undefined,
    undefined,
    o.shopee as never,
  );
  return { svc, estados, registros, enviados, bot, push, inbox };
}

const SHOPEE: Pend = {
  id: 'p1',
  canal: 'MARKETPLACE_SHOPEE',
  tipo: 'MENSAGEM',
  chave: 'conv:9',
  titulo: 'Mensagem de x',
  pedido: null,
};

describe('PendenciasIaService (fase 2, 25/10)', () => {
  it('resposta na hora: cada fala do cliente zera o relógio; a IA entra 30 s depois da ÚLTIMA', () => {
    vi.useFakeTimers();
    try {
      const t = montar({ pendencias: [] });
      const responder = vi.spyOn(t.svc, 'responderChat').mockResolvedValue();
      t.svc.agendarChat('e1', 'MARKETPLACE_SHOPEE', 'conv:9', 'c1');
      vi.advanceTimersByTime(20_000);
      t.svc.agendarChat('e1', 'MARKETPLACE_SHOPEE', 'conv:9', 'c1'); // escreveu de novo
      vi.advanceTimersByTime(20_000);
      expect(responder).not.toHaveBeenCalled(); // 40 s da 1ª, mas só 20 s da última
      vi.advanceTimersByTime(12_000);
      expect(responder).toHaveBeenCalledTimes(1);
      expect(responder).toHaveBeenCalledWith('e1', 'MARKETPLACE_SHOPEE', 'conv:9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pergunta de anúncio do ML (q:) não entra no relógio — fica com o robô do ML', () => {
    vi.useFakeTimers();
    try {
      const t = montar({ pendencias: [] });
      const responder = vi.spyOn(t.svc, 'responderChat').mockResolvedValue();
      t.svc.agendarChat('e1', 'MARKETPLACE_ML', 'q:123', 'c2');
      vi.advanceTimersByTime(60_000);
      expect(responder).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('comentário de FB/IG (cmt:) entra no relógio como chat (13/11)', () => {
    vi.useFakeTimers();
    try {
      const t = montar({ pendencias: [] });
      const responder = vi.spyOn(t.svc, 'responderChat').mockResolvedValue();
      t.svc.agendarChat('e1', 'INSTAGRAM_COMENTARIO', 'cmt:m1:u1', 'c3');
      vi.advanceTimersByTime(32_000);
      expect(responder).toHaveBeenCalledWith('e1', 'INSTAGRAM_COMENTARIO', 'cmt:m1:u1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cliente ainda escrevendo (card agora há pouco): espera, não responde no meio', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        {
          direction: 'INBOUND',
          conteudo: '[produto: 123]',
          criadoEm: new Date(Date.now() - 10_000),
        },
      ],
    });
    await t.svc.processar('e1');
    expect(t.bot.gerarRespostaIa).not.toHaveBeenCalled();
    expect(t.enviados).toEqual([]);
  });

  it('a IA recebe a base de conhecimento INTEIRA, não 4 trechos (Léo, 26/10)', async () => {
    const base = Array.from({ length: 16 }, (_, i) => ({
      titulo: `Produto ${i}`,
      conteudo: `Medidas do produto ${i}`,
      categoria: 'produtos',
    }));
    const t = montar({
      pendencias: [SHOPEE],
      base,
      mensagens: [{ direction: 'INBOUND', conteudo: 'Tamanho G vestir qual numeração' }],
    });
    await t.svc.processar('e1');
    const contexto = (t.bot.gerarRespostaIa.mock.calls[0] as unknown[])[2] as string;
    for (let i = 0; i < 16; i++) expect(contexto).toContain(`## Produto ${i}`);
  });

  it('empresa sem a IA ligada: não toca em nada', async () => {
    const t = montar({
      ativo: false,
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'obg' }],
    });
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 0, humano: 0 });
    expect(t.bot.gerarRespostaIa).not.toHaveBeenCalled();
  });

  it('cliente só agradeceu ("obg"): "Estamos à disposição!" sem chamar a IA (Léo, 12/11)', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'OUTBOUND', conteudo: 'Seu pedido saiu hoje.' },
        { direction: 'INBOUND', conteudo: 'Obg' },
      ],
    });
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 1, humano: 0 });
    expect(t.enviados).toEqual(['Estamos à disposição!']);
    expect(t.bot.gerarRespostaIa).not.toHaveBeenCalled();
    expect(t.estados.p1).toBe('RESPONDIDA_IA');
  });

  it('"ok" de novo depois do "Estamos à disposição!": não manda nada (anti-loop)', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'OUTBOUND', conteudo: 'Estamos à disposição!' },
        { direction: 'INBOUND', conteudo: 'Okay' },
      ],
    });
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 1, humano: 0 });
    expect(t.enviados).toEqual([]);
    expect(t.estados.p1).toBe('RESPONDIDA_IA');
    expect(t.registros[0]).toMatchObject({ acao: 'silencio', enviada: false });
  });

  it('cliente falou por último (pergunta): a IA responde, envia, registra e marca RESPONDIDA_IA', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'OUTBOUND', conteudo: 'Seu pedido saiu hoje.' },
        { direction: 'INBOUND', conteudo: 'Qual o rastreio?' },
      ],
    });
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 1, humano: 0 });
    expect(t.enviados).toEqual(['Nós que agradecemos!']);
    expect(t.estados.p1).toBe('RESPONDIDA_IA');
    expect(t.registros[0]).toMatchObject({
      acao: 'responder',
      enviada: true,
      conversationId: 'c1',
    });
  });

  it('kit na Shopee: a IA indica o unitário e o card dele vai logo depois do texto (Léo, 29/10)', async () => {
    const postShop = vi.fn(async () => ({}));
    const shopee = {
      getShop: vi.fn(async () => ({
        response: {
          item_list: [
            {
              item_id: 10801442351,
              item_name: 'Kit 3 Camisetas UV',
              description:
                'Pra escolher as cores, acesse este link https://shopee.com.br/product/327263189/11501442309/',
            },
          ],
        },
      })),
      postShop,
    };
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'INBOUND', conteudo: '[produto: 10801442351]' },
        { direction: 'INBOUND', conteudo: 'Posso escolher as cores?' },
      ],
      iaTexto:
        '{"acao":"responder","resposta":"Te mando aqui o anúncio da peça unitária.","motivo":"cor do kit","card_unitario":true}',
      shopee,
    });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual(['Te mando aqui o anúncio da peça unitária.']);
    expect(postShop).toHaveBeenCalledWith('e1', '/api/v2/sellerchat/send_message', {
      to_id: 848307855,
      message_type: 'item',
      content: { item_id: 11501442309 },
    });
    // a IA soube que o card existe
    const contexto = (t.bot.gerarRespostaIa.mock.calls[0] as unknown[])[2] as string;
    expect(contexto).toContain('Anúncio da peça unitária deste kit');
  });

  it('sem card_unitario, ou sem unitário na descrição, não manda card', async () => {
    const postShop = vi.fn(async () => ({}));
    const shopee = {
      getShop: vi.fn(async () => ({
        response: { item_list: [{ item_id: 1, item_name: 'Bermuda', description: 'sem link' }] },
      })),
      postShop,
    };
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: '[produto: 1]' }],
      iaTexto: '{"acao":"responder","resposta":"Oi!","motivo":"x","card_unitario":true}',
      shopee,
    });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual(['Oi!']);
    expect(postShop).not.toHaveBeenCalled();
  });

  it('a loja já falou por último: não manda nada', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'INBOUND', conteudo: 'obg' },
        { direction: 'OUTBOUND', conteudo: 'nós que agradecemos' },
      ],
    });
    await t.svc.processar('e1');
    expect(t.bot.gerarRespostaIa).not.toHaveBeenCalled();
    expect(t.enviados).toEqual([]);
  });

  it('figurinha da loja não é resposta: a IA responde mesmo assim (mesmo critério da rotina)', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'INBOUND', conteudo: 'Tem a cor bege no G?' },
        { direction: 'OUTBOUND', conteudo: '[sticker]', tipo: 'STICKER' },
      ],
    });
    await t.svc.processar('e1');
    expect(t.bot.gerarRespostaIa).toHaveBeenCalledTimes(1);
  });

  it('reembolso: manda a espera (última palavra), marca humano e avisa por push', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'Aí eu já pedi o reembolso' }],
      iaTexto:
        '{"acao":"humano","resposta":"Olá! Recebemos e já estamos verificando.","motivo":"reembolso"}',
    });
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 0, humano: 1 });
    expect(t.enviados).toEqual(['Olá! Recebemos e já estamos verificando.']);
    expect(t.estados.p1).toBe('AGUARDANDO_HUMANO');
    expect(t.push.enviar).toHaveBeenCalledTimes(1);
  });

  it('palavra proibida: gera de novo avisando o porquê e envia a versão limpa (31/10)', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'Veio o tamanho errado' }],
    });
    t.bot.gerarRespostaIa
      .mockResolvedValueOnce({
        texto:
          '{"acao":"responder","resposta":"Pode pedir a devolução no app.","motivo":"x","card_unitario":false}',
        modelo: 'm',
      } as never)
      .mockResolvedValueOnce({
        texto:
          '{"acao":"responder","resposta":"Sentimos muito pelo engano. Você resolve pela aba de compras.","motivo":"x","card_unitario":false}',
        modelo: 'm',
      } as never);
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 1, humano: 0 });
    expect(t.bot.gerarRespostaIa).toHaveBeenCalledTimes(2);
    expect(String((t.bot.gerarRespostaIa.mock.calls as unknown[][])[1][2])).toMatch(
      /barrada.*devolução/,
    );
    expect(t.enviados).toEqual(['Sentimos muito pelo engano. Você resolve pela aba de compras.']);
  });

  it('palavra proibida duas vezes: o texto barrado NUNCA vai — espera padrão e humano', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'Quero cancelar' }],
      iaTexto:
        '{"acao":"responder","resposta":"Pode cancelar no app.","motivo":"x","card_unitario":false}',
    });
    expect(await t.svc.processar('e1')).toEqual({ respondidas: 0, humano: 1 });
    expect(t.enviados).toEqual([ESPERA_PADRAO]);
    expect(t.estados.p1).toBe('AGUARDANDO_HUMANO');
    expect(t.registros[0]).toMatchObject({
      acao: 'humano',
      motivo: expect.stringMatching(/proibida/),
    });
  });

  it('envio falhou: registra o erro e passa pro humano (nunca fica "respondida" sem ter ido)', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'oi' }],
      envioFalha: true,
    });
    await t.svc.processar('e1');
    expect(t.estados.p1).toBe('AGUARDANDO_HUMANO');
    expect(t.registros[0]).toMatchObject({ enviada: false, erro: 'Shopee fora' });
  });

  it('devolução da Shopee (sem chat por texto): humano direto, sem chamar a IA', async () => {
    const t = montar({
      pendencias: [{ ...SHOPEE, id: 'p2', tipo: 'DEVOLUCAO', chave: 'inc:RET123' }],
    });
    await t.svc.processar('e1');
    expect(t.bot.gerarRespostaIa).not.toHaveBeenCalled();
    expect(t.estados.p2).toBe('AGUARDANDO_HUMANO');
  });

  it('tipo desligado fica de fora', async () => {
    const t = montar({
      desligados: ['MENSAGEM'],
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'oi' }],
    });
    await t.svc.processar('e1');
    expect(t.bot.gerarRespostaIa).not.toHaveBeenCalled();
  });
});

describe('figurinha de agradecimento na Shopee (14/11)', () => {
  const FIG = { stickerPackageId: 'br_shoppito', stickerId: '0002' };
  const shopeeMock = () => ({
    getShop: vi.fn(async () => ({})),
    postShop: vi.fn(async (..._a: unknown[]) => ({})),
  });
  const OBG = [
    { direction: 'OUTBOUND' as const, conteudo: 'Seu pedido saiu hoje.' },
    { direction: 'INBOUND' as const, conteudo: 'Obrigada!' },
  ];

  it('cliente só agradeceu: texto e, DEPOIS dele, a figurinha configurada', async () => {
    const shopee = shopeeMock();
    const t = montar({ pendencias: [SHOPEE], mensagens: OBG, shopee, figurinha: FIG });
    let textoAntes: string[] = [];
    shopee.postShop.mockImplementation(async () => {
      textoAntes = [...t.enviados];
      return {};
    });
    await t.svc.processar('e1');
    expect(textoAntes).toEqual(['Estamos à disposição!']); // o texto foi primeiro
    expect(shopee.postShop).toHaveBeenCalledTimes(1);
    expect(shopee.postShop).toHaveBeenCalledWith('e1', '/api/v2/sellerchat/send_message', {
      to_id: 848307855,
      message_type: 'sticker',
      content: { sticker_id: '0002', sticker_package_id: 'br_shoppito' },
    });
    expect(t.estados.p1).toBe('RESPONDIDA_IA');
  });

  it('empresa sem figurinha configurada: só o texto, nada de figurinha', async () => {
    const shopee = shopeeMock();
    const t = montar({ pendencias: [SHOPEE], mensagens: OBG, shopee });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual(['Estamos à disposição!']);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('anti-loop: "ok" depois do "Estamos à disposição!" + figurinha não manda nada', async () => {
    const shopee = shopeeMock();
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'OUTBOUND', conteudo: 'Estamos à disposição!' },
        { direction: 'OUTBOUND', conteudo: '[sticker]', tipo: 'STICKER' },
        { direction: 'INBOUND', conteudo: 'ok' },
      ],
      shopee,
      figurinha: FIG,
    });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual([]);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('a última da loja já foi figurinha: o texto vai, a figurinha não repete', async () => {
    const shopee = shopeeMock();
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'OUTBOUND', conteudo: 'Seu pedido saiu hoje.' },
        { direction: 'OUTBOUND', conteudo: '[sticker]', tipo: 'STICKER' },
        { direction: 'INBOUND', conteudo: 'valeu' },
      ],
      shopee,
      figurinha: FIG,
    });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual(['Estamos à disposição!']);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('pergunta de verdade: a IA responde e a figurinha não vai', async () => {
    const shopee = shopeeMock();
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [{ direction: 'INBOUND', conteudo: 'Qual o rastreio?' }],
      shopee,
      figurinha: FIG,
    });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual(['Nós que agradecemos!']);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('Mercado Livre: só o texto (figurinha é só na Shopee)', async () => {
    const shopee = shopeeMock();
    const t = montar({
      pendencias: [{ ...SHOPEE, canal: 'MARKETPLACE_ML', chave: 'pack:1' }],
      mensagens: OBG,
      shopee,
      figurinha: FIG,
    });
    await t.svc.processar('e1');
    expect(t.enviados).toEqual(['Estamos à disposição!']);
    expect(shopee.postShop).not.toHaveBeenCalled();
  });

  it('envio do texto falhou: a figurinha não vai sozinha', async () => {
    const shopee = shopeeMock();
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: OBG,
      shopee,
      figurinha: FIG,
      envioFalha: true,
    });
    await t.svc.processar('e1');
    expect(shopee.postShop).not.toHaveBeenCalled();
  });
});

describe('simularCasos (#04 SAC, 02/11): casos de teste no corpo', () => {
  it('passa pelo filtro, devolve ação/resposta/motivo e NÃO envia nem grava nada', async () => {
    const t = montar({ pendencias: [] });
    t.bot.gerarRespostaIa
      .mockResolvedValueOnce({
        texto:
          '{"acao":"responder","resposta":"Pode pedir a devolução no app.","motivo":"troca","card_unitario":false}',
        modelo: 'm',
      } as never)
      .mockResolvedValueOnce({
        texto:
          '{"acao":"responder","resposta":"Você resolve pela aba de compras.","motivo":"troca","card_unitario":false}',
        modelo: 'm',
      } as never);
    const r = await t.svc.simularCasos('e1', [
      {
        canal: 'MARKETPLACE_ML',
        mensagens: [{ de: 'cliente', texto: 'Quero trocar o tamanho' }],
      },
    ]);
    expect(r).toEqual([
      expect.objectContaining({
        caso: 1,
        acao: 'responder',
        resposta: 'Você resolve pela aba de compras.',
        barradaAntes: expect.stringMatching(/devolução/),
      }),
    ]);
    expect(t.inbox.responderComoBot).not.toHaveBeenCalled();
    expect(t.registros).toEqual([]);
  });
});
