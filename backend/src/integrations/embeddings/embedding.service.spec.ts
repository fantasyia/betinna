import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingService } from './embedding.service';

type EnvMap = Record<string, unknown>;
const makeEnv = (over: EnvMap = {}) => ({
  get: (k: string) =>
    ({
      MULLERBOT_MOCK: false,
      OPENAI_API_KEY: 'sk-env',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      ...over,
    })[k],
});

// Integração sempre sem chave própria → cai pro env (ou null se env vazio).
const integracoesSemChave = {
  obterCredenciaisInternas: vi.fn(async () => {
    throw new Error('sem openai');
  }),
};

const make = (env: EnvMap = {}, integ = integracoesSemChave) =>
  new EmbeddingService(makeEnv(env) as never, integ as never);

afterEach(() => vi.unstubAllGlobals());

describe('EmbeddingService', () => {
  it('retorna null em MULLERBOT_MOCK sem chamar a API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const svc = make({ MULLERBOT_MOCK: true });
    expect(await svc.gerar('emp-1', 'óleo')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retorna null quando não há chave (env vazio)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const svc = make({ OPENAI_API_KEY: '' });
    expect(await svc.gerar('emp-1', 'óleo')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('embeda e mapeia o vetor no sucesso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
      })),
    );
    const svc = make();
    expect(await svc.gerar('emp-1', 'óleo de girassol')).toEqual([0.1, 0.2, 0.3]);
  });

  it('preserva a ordem e devolve null pra input vazio (não vai pra API)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        // a API recebe só os não-vazios; index 0 = "a", index 1 = "b"
        json: async () => ({
          data: [
            { index: 1, embedding: [9] },
            { index: 0, embedding: [8] },
          ],
        }),
      })),
    );
    const svc = make();
    const out = await svc.gerarLote('emp-1', ['a', '   ', 'b']);
    expect(out).toEqual([[8], null, [9]]);
  });

  it('retorna null em erro HTTP da API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limit' })),
    );
    const svc = make();
    expect(await svc.gerar('emp-1', 'óleo')).toBeNull();
  });
});
