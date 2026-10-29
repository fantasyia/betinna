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
}) {
  const estados: Record<string, string> = {};
  const registros: Array<Record<string, unknown>> = [];
  const enviados: string[] = [];
  const prisma = {
    empresa: {
      findUnique: vi.fn(async () => ({
        config: { pendenciasIa: { ativo: o.ativo ?? true, desligados: o.desligados ?? [] } },
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

  it('cliente falou por último ("obg"): a IA responde, envia, registra e marca RESPONDIDA_IA', async () => {
    const t = montar({
      pendencias: [SHOPEE],
      mensagens: [
        { direction: 'OUTBOUND', conteudo: 'Seu pedido saiu hoje.' },
        { direction: 'INBOUND', conteudo: 'Obg' },
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
