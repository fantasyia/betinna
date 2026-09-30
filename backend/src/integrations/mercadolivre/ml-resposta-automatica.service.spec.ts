import { describe, expect, it, vi } from 'vitest';
import { MLRespostaAutomaticaService } from './ml-resposta-automatica.service';

/**
 * Léo, 30/09: a IA responde sozinha a pergunta do ML quando sabe — com chave
 * própria, separada do bot do WhatsApp; sem a informação, fica pro humano.
 */
function montar(
  opts: {
    config?: unknown;
    saidas?: number;
    tags?: string[];
    trava?: 'OK' | null;
    sugestao?: { texto: string | null };
    envioFalha?: boolean;
  } = {},
) {
  const prisma = {
    empresa: {
      findUnique: vi.fn(async () => ({
        config: opts.config ?? { mercadoLivre: { respostaAutomatica: true } },
      })),
    },
    conversation: {
      findFirst: vi.fn(async () => ({
        peerId: 'q:123',
        tagsInternas: opts.tags ?? [],
        mensagens: Array.from({ length: opts.saidas ?? 0 }, (_, i) => ({ id: `o${i}` })),
      })),
    },
  };
  const redis = {
    client: { set: vi.fn(async () => (opts.trava === undefined ? 'OK' : opts.trava)) },
  };
  const inbox = {
    responderComoBot: vi.fn(async () => {
      if (opts.envioFalha) throw new Error('Item must be active');
    }),
  };
  const respostaIa = {
    sugerirPorConversa: vi.fn(async () => opts.sugestao ?? { texto: 'Temos sim, na cor azul.' }),
    marcarParaHumano: vi.fn(async () => undefined),
  };
  const svc = new MLRespostaAutomaticaService(
    prisma as never,
    redis as never,
    inbox as never,
    respostaIa as never,
  );
  return { svc, prisma, inbox, respostaIa };
}

describe('MLRespostaAutomaticaService', () => {
  it('ligada e a IA sabe: envia como bot, uma vez, com chave de idempotência', async () => {
    const m = montar();
    expect(await m.svc.talvezResponder('emp-1', 'conv-1', 'UNANSWERED')).toBe('respondida');
    expect(m.inbox.responderComoBot).toHaveBeenCalledWith(
      'conv-1',
      'Temos sim, na cor azul.',
      'ml-auto:conv-1',
    );
  });

  it('DESLIGADA por padrão — e o bot do WhatsApp ligado não liga a do ML', async () => {
    for (const config of [
      {},
      { mercadoLivre: { respostaAutomatica: false } },
      { botAtivo: true, bot: { ligado: true } },
    ]) {
      const m = montar({ config });
      expect(await m.svc.talvezResponder('emp-1', 'conv-1', 'UNANSWERED')).toBe('pulada');
      expect(m.respostaIa.sugerirPorConversa).not.toHaveBeenCalled();
    }
  });

  it('IA sem a informação: não envia nada (a sugestão já marcou humano)', async () => {
    const m = montar({ sugestao: { texto: null } });
    expect(await m.svc.talvezResponder('emp-1', 'conv-1', 'UNANSWERED')).toBe('humano');
    expect(m.inbox.responderComoBot).not.toHaveBeenCalled();
  });

  it('envio falhou (anúncio pausado): marca humano e não fica tentando', async () => {
    const m = montar({ envioFalha: true });
    expect(await m.svc.talvezResponder('emp-1', 'conv-1', 'UNANSWERED')).toBe('humano');
    expect(m.respostaIa.marcarParaHumano).toHaveBeenCalledWith('conv-1');
  });

  it('pula: já respondida, já marcada humano, pergunta não pendente ou trava tomada', async () => {
    for (const o of [{ saidas: 1 }, { tags: ['Humano'] }, { trava: null as null }]) {
      const m = montar(o);
      expect(await m.svc.talvezResponder('emp-1', 'conv-1', 'UNANSWERED')).toBe('pulada');
      expect(m.respostaIa.sugerirPorConversa).not.toHaveBeenCalled();
    }
    const m = montar();
    expect(await m.svc.talvezResponder('emp-1', 'conv-1', 'ANSWERED')).toBe('pulada');
    expect(m.prisma.empresa.findUnique).not.toHaveBeenCalled();
  });

  it('erro na IA (sem chave, ML fora): não lança, a pergunta fica pro humano ver', async () => {
    const m = montar();
    m.respostaIa.sugerirPorConversa.mockRejectedValueOnce(new Error('OpenAI não configurada'));
    await expect(m.svc.talvezResponder('emp-1', 'conv-1', 'UNANSWERED')).resolves.toBe('pulada');
  });
});
