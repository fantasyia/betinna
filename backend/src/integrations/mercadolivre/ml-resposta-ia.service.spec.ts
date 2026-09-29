import { describe, expect, it, vi } from 'vitest';
import {
  MLRespostaIaService,
  PROMPT_RESPOSTA_PERGUNTA,
  contextoDoAnuncio,
} from './ml-resposta-ia.service';

/** Léo, 29/09: botão que sugere a resposta da pergunta lendo o próprio anúncio. */
function montar(opts: { peerId?: string; semDescricao?: boolean } = {}) {
  const prisma = {
    conversation: {
      findFirst: vi.fn(async () =>
        opts.peerId === undefined
          ? { peerId: 'q:13662157863' }
          : opts.peerId
            ? { peerId: opts.peerId }
            : null,
      ),
    },
  };
  const ml = {
    get: vi.fn(async (_e: string, path: string) => {
      if (path.startsWith('/questions/'))
        return { id: 13662157863, item_id: 'MLB4685939713', text: 'Preciso dela toda preta' };
      if (path.endsWith('/description')) {
        if (opts.semDescricao) throw new Error('ML GET 404');
        return { plain_text: 'Camiseta 100% algodão. Cores: branca, cinza e azul.' };
      }
      return {
        id: 'MLB4685939713',
        title: 'Camiseta Básica',
        price: 49.9,
        available_quantity: 3,
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
    }),
  };
  const bot = {
    gerarRespostaIa: vi.fn(async () => ({
      texto: '  Olá! Toda preta não temos.  ',
      modelo: 'gpt-x',
    })),
  };
  const svc = new MLRespostaIaService(prisma as never, ml as never, bot as never);
  return { svc, prisma, ml, bot };
}

describe('MLRespostaIaService', () => {
  it('manda pro modelo a pergunta + título, atributos, variações e descrição do anúncio', async () => {
    const m = montar();
    const r = await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(r).toEqual({
      texto: 'Olá! Toda preta não temos.',
      modelo: 'gpt-x',
      itemId: 'MLB4685939713',
    });
    const [empresa, prompt, msg] = m.bot.gerarRespostaIa.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(empresa).toBe('emp-1');
    expect(prompt).toBe(PROMPT_RESPOSTA_PERGUNTA);
    expect(msg).toContain('Preciso dela toda preta');
    expect(msg).toContain('Camiseta Básica');
    expect(msg).toContain('Material: Algodão');
    expect(msg).toContain('Cor: Branca (estoque: 1)');
    expect(msg).toContain('Cores: branca, cinza e azul');
    expect(msg).not.toContain('Vazio');
  });

  it('só procura conversa da empresa e do Mercado Livre', async () => {
    const m = montar();
    await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    expect(m.prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1', empresaId: 'emp-1', canal: 'MARKETPLACE_ML' },
      }),
    );
  });

  it('anúncio sem descrição: sugere mesmo assim, com título e atributos', async () => {
    const m = montar({ semDescricao: true });
    await m.svc.sugerirPorConversa('emp-1', 'conv-1');
    const msg = (m.bot.gerarRespostaIa.mock.calls[0] as unknown as string[])[2];
    expect(msg).toContain('Camiseta Básica');
    expect(msg).not.toContain('DESCRIÇÃO');
  });

  it('conversa que não é pergunta (pós-venda/reclamação) é recusada sem chamar a IA', async () => {
    const m = montar({ peerId: 'pack:123' });
    await expect(m.svc.sugerirPorConversa('emp-1', 'conv-1')).rejects.toThrow(
      'só existe pra pergunta',
    );
    expect(m.bot.gerarRespostaIa).not.toHaveBeenCalled();
  });

  it('conversa de outra empresa → não encontrada', async () => {
    const m = montar({ peerId: '' });
    await expect(m.svc.sugerirPorConversa('emp-2', 'conv-1')).rejects.toThrow();
    expect(m.ml.get).not.toHaveBeenCalled();
  });

  it('descrição gigante é cortada', () => {
    const ctx = contextoDoAnuncio({ id: 'MLB1', title: 't' }, 'x'.repeat(20000));
    expect(ctx.length).toBeLessThan(7000);
  });
});
