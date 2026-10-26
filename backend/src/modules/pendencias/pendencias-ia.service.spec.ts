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
  mensagens?: Array<{ direction: 'INBOUND' | 'OUTBOUND'; conteudo: string; tipo?: string }>;
  iaTexto?: string;
  envioFalha?: boolean;
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
    },
    // findMany vem em ordem DESC (o serviço inverte)
    message: {
      findMany: vi.fn(async () =>
        [...(o.mensagens ?? [])].map((m) => ({ tipo: 'TEXT', ...m })).reverse(),
      ),
    },
    marketplaceOrder: { findFirst: vi.fn(async () => null) },
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
  const svc = new PendenciasIaService(prisma as never, inbox as never, bot as never, push as never);
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
