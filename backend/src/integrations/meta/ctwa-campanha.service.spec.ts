import { describe, expect, it, vi } from 'vitest';
import { CtwaCampanhaService } from './ctwa-campanha.service';

/** Item 9 (29/09): campanha do CTWA = NOME da campanha no Meta, pelo sourceId. */
function montar(opts: { semConexao?: boolean; graphFalha?: boolean } = {}) {
  const mem = new Map<string, string>();
  const redis = {
    get: vi.fn(async (k: string) => (mem.has(k) ? mem.get(k)! : null)),
    setEx: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
  };
  const integracoes = {
    obterCredenciaisInternas: opts.semConexao
      ? vi.fn().mockRejectedValue(new Error('Integração facebook não configurada'))
      : vi.fn().mockResolvedValue({ credenciais: { pageAccessToken: 'tok-page' } }),
  };
  const graph = {
    obterAnuncio: opts.graphFalha
      ? vi.fn().mockRejectedValue(new Error('(#200) ads_read'))
      : vi.fn().mockResolvedValue({ id: '1', campaign: { name: 'MB-Industria-Agosto' } }),
  };
  const svc = new CtwaCampanhaService(graph as never, integracoes as never, redis as never);
  return { svc, graph, redis };
}

describe('CtwaCampanhaService', () => {
  it('resolve o nome da campanha pelo sourceId com o token da Página da empresa', async () => {
    const m = montar();
    expect(await m.svc.nomeDaCampanha('emp-1', '120210000000001')).toBe('MB-Industria-Agosto');
    expect(m.graph.obterAnuncio).toHaveBeenCalledWith('120210000000001', 'tok-page');
  });

  it('cacheia: 2ª mensagem do mesmo anúncio não vai à Graph', async () => {
    const m = montar();
    await m.svc.nomeDaCampanha('emp-1', '120210000000001');
    await m.svc.nomeDaCampanha('emp-1', '120210000000001');
    expect(m.graph.obterAnuncio).toHaveBeenCalledTimes(1);
  });

  it('sem conexão Meta ou sem ads_read: null (quem chama usa a manchete marcada), sem estourar', async () => {
    expect(await montar({ semConexao: true }).svc.nomeDaCampanha('emp-1', '1202100000')).toBeNull();
    const m = montar({ graphFalha: true });
    expect(await m.svc.nomeDaCampanha('emp-1', '1202100000')).toBeNull();
    // negativo também cacheia (não martela a Graph a cada mensagem)
    await m.svc.nomeDaCampanha('emp-1', '1202100000');
    expect(m.graph.obterAnuncio).toHaveBeenCalledTimes(1);
  });

  it('sourceId ausente ou que não é id numérico: nem tenta', async () => {
    const m = montar();
    expect(await m.svc.nomeDaCampanha('emp-1', undefined)).toBeNull();
    expect(await m.svc.nomeDaCampanha('emp-1', 'Master Block')).toBeNull();
    expect(m.graph.obterAnuncio).not.toHaveBeenCalled();
  });
});
