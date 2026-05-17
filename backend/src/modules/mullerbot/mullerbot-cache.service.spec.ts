import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MullerBotCacheService } from './mullerbot-cache.service';

const makeRedis = () => {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    setEx: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    del: vi.fn(async (k: string) => {
      const had = store.delete(k);
      return had ? 1 : 0;
    }),
  };
};

describe('MullerBotCacheService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let svc: MullerBotCacheService;

  beforeEach(() => {
    redis = makeRedis();
    svc = new MullerBotCacheService(redis as never);
  });

  describe('buildAnswerKey', () => {
    it('é determinístico — mesma entrada gera mesma chave', () => {
      const params = {
        empresaId: 'emp-1',
        modelo: 'gpt-4o-mini',
        pergunta: 'qual o preço do óleo?',
        produtoIds: ['p1', 'p2'],
      };
      expect(svc.buildAnswerKey(params)).toBe(svc.buildAnswerKey(params));
    });

    it('normaliza espaços e case na pergunta', () => {
      const a = svc.buildAnswerKey({
        empresaId: 'e',
        modelo: 'm',
        pergunta: '  Qual O Preço?  ',
        produtoIds: ['p1'],
      });
      const b = svc.buildAnswerKey({
        empresaId: 'e',
        modelo: 'm',
        pergunta: 'qual o preço?',
        produtoIds: ['p1'],
      });
      expect(a).toBe(b);
    });

    it('ordem dos produtoIds não afeta a chave (sort interno)', () => {
      const a = svc.buildAnswerKey({
        empresaId: 'e',
        modelo: 'm',
        pergunta: 'x',
        produtoIds: ['p1', 'p2'],
      });
      const b = svc.buildAnswerKey({
        empresaId: 'e',
        modelo: 'm',
        pergunta: 'x',
        produtoIds: ['p2', 'p1'],
      });
      expect(a).toBe(b);
    });

    it('mudança em qualquer parâmetro muda a chave', () => {
      const base = {
        empresaId: 'e',
        modelo: 'm',
        pergunta: 'x',
        produtoIds: ['p1'],
      };
      const k0 = svc.buildAnswerKey(base);
      expect(svc.buildAnswerKey({ ...base, empresaId: 'e2' })).not.toBe(k0);
      expect(svc.buildAnswerKey({ ...base, modelo: 'm2' })).not.toBe(k0);
      expect(svc.buildAnswerKey({ ...base, pergunta: 'y' })).not.toBe(k0);
      expect(svc.buildAnswerKey({ ...base, produtoIds: ['p1', 'p2'] })).not.toBe(k0);
    });

    it('tem prefixo "mb:answer:" e tamanho fixo', () => {
      const k = svc.buildAnswerKey({
        empresaId: 'e',
        modelo: 'm',
        pergunta: 'x',
        produtoIds: [],
      });
      expect(k.startsWith('mb:answer:')).toBe(true);
      expect(k.length).toBe('mb:answer:'.length + 32);
    });
  });

  describe('answer cache', () => {
    it('miss retorna null', async () => {
      const r = await svc.getAnswer('mb:answer:none');
      expect(r).toBeNull();
    });

    it('roundtrip — setAnswer depois getAnswer marca cacheHit=true', async () => {
      const resposta = {
        resposta: 'Sim, o óleo custa R$48',
        produtosUsados: [],
        produtosTruncados: 0,
        modelo: 'gpt-4o-mini',
        tokensInEstimados: 100,
      };
      await svc.setAnswer('mb:answer:k1', resposta);
      const r = await svc.getAnswer('mb:answer:k1');
      expect(r?.resposta).toBe('Sim, o óleo custa R$48');
      expect(r?.cacheHit).toBe(true);
    });

    it('best-effort: falha de redis em get retorna null sem throw', async () => {
      redis.get.mockRejectedValueOnce(new Error('redis down'));
      const r = await svc.getAnswer('mb:answer:x');
      expect(r).toBeNull();
    });

    it('best-effort: falha de redis em set NÃO propaga', async () => {
      redis.setEx.mockRejectedValueOnce(new Error('redis down'));
      const resposta = {
        resposta: 'x',
        produtosUsados: [],
        produtosTruncados: 0,
        modelo: 'm',
        tokensInEstimados: 1,
      };
      await expect(svc.setAnswer('mb:answer:y', resposta)).resolves.toBeUndefined();
    });

    it('não persiste flag cacheHit dentro do cache', async () => {
      const resposta = {
        resposta: 'x',
        produtosUsados: [],
        produtosTruncados: 0,
        modelo: 'm',
        tokensInEstimados: 1,
        cacheHit: true, // veio de outro cache (impossível na prática)
      };
      await svc.setAnswer('mb:answer:z', resposta);
      const stored = redis._store.get('mb:answer:z');
      expect(stored).not.toContain('cacheHit');
    });
  });

  describe('histórico conversacional', () => {
    it('histórico vazio quando nunca foi salvo', async () => {
      const r = await svc.getHistorico('user-1', 'sess-1');
      expect(r).toEqual([]);
    });

    it('pushTurn salva user+assistant em ordem', async () => {
      await svc.pushTurn('user-1', 'sess-1', 'pergunta 1', 'resposta 1');
      const r = await svc.getHistorico('user-1', 'sess-1');
      expect(r).toHaveLength(2);
      expect(r[0]?.role).toBe('user');
      expect(r[0]?.content).toBe('pergunta 1');
      expect(r[1]?.role).toBe('assistant');
      expect(r[1]?.content).toBe('resposta 1');
    });

    it('múltiplos pushTurn mantêm ordem cronológica', async () => {
      await svc.pushTurn('u', 's', 'p1', 'r1');
      await svc.pushTurn('u', 's', 'p2', 'r2');
      const r = await svc.getHistorico('u', 's');
      expect(r.map((m) => m.content)).toEqual(['p1', 'r1', 'p2', 'r2']);
    });

    it('mantém apenas últimas N turns (default 4 = 8 mensagens)', async () => {
      for (let i = 0; i < 10; i++) {
        await svc.pushTurn('u', 's', `p${i}`, `r${i}`);
      }
      const r = await svc.getHistorico('u', 's');
      expect(r).toHaveLength(8); // 4 turns × 2 mensagens
      // primeiro deve ser p6 (mais recente p6/r6/.../p9/r9)
      expect(r[0]?.content).toBe('p6');
      expect(r[7]?.content).toBe('r9');
    });

    it('isolamento por usuário', async () => {
      await svc.pushTurn('user-A', 's1', 'p1', 'r1');
      await svc.pushTurn('user-B', 's1', 'pX', 'rX');
      const a = await svc.getHistorico('user-A', 's1');
      const b = await svc.getHistorico('user-B', 's1');
      expect(a[0]?.content).toBe('p1');
      expect(b[0]?.content).toBe('pX');
    });

    it('isolamento por sessionId', async () => {
      await svc.pushTurn('u', 'sess-A', 'p1', 'r1');
      await svc.pushTurn('u', 'sess-B', 'p2', 'r2');
      const a = await svc.getHistorico('u', 'sess-A');
      const b = await svc.getHistorico('u', 'sess-B');
      expect(a[0]?.content).toBe('p1');
      expect(b[0]?.content).toBe('p2');
    });

    it('sanitiza caracteres especiais no sessionId (chave Redis)', async () => {
      // Não deve dar erro mesmo com ../, espaços ou unicode
      await svc.pushTurn('u', '../etc/passwd!', 'p', 'r');
      const r = await svc.getHistorico('u', '../etc/passwd!');
      expect(r).toHaveLength(2);
    });

    it('limparHistorico apaga a chave', async () => {
      await svc.pushTurn('u', 's', 'p1', 'r1');
      const antes = await svc.getHistorico('u', 's');
      expect(antes).toHaveLength(2);

      await svc.limparHistorico('u', 's');
      const depois = await svc.getHistorico('u', 's');
      expect(depois).toEqual([]);
    });

    it('best-effort: falha de redis em getHistorico retorna []', async () => {
      redis.get.mockRejectedValueOnce(new Error('redis down'));
      const r = await svc.getHistorico('u', 's');
      expect(r).toEqual([]);
    });

    it('best-effort: falha de redis em pushTurn NÃO propaga', async () => {
      redis.setEx.mockRejectedValueOnce(new Error('redis down'));
      await expect(svc.pushTurn('u', 's', 'p', 'r')).resolves.toBeUndefined();
    });

    it('limparHistorico best-effort: sempre retorna {ok:true}', async () => {
      redis.del.mockRejectedValueOnce(new Error('redis down'));
      const r = await svc.limparHistorico('u', 's');
      expect(r).toEqual({ ok: true });
    });
  });
});
