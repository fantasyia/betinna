import { describe, expect, it, vi } from 'vitest';
import { carregarBoard } from './kanban-board-carga';
import type { KBoardCompleto } from './kanban-types';

/**
 * BETINNA-FRONT-A: a tela baixava o quadro inteiro (1,2 MB no DEV) a cada 15s.
 * O que este teste trava: com uma assinatura em mãos, "nada mudou" devolve o
 * MESMO objeto (a tela não re-sincroniza nem pisca), e "mudou" devolve o novo.
 */

function board(id: string, assinatura: string, extra: Partial<KBoardCompleto> = {}) {
  return { id, assinatura, imagemFundoUrl: 'url-1', listas: [], etiquetas: [], campos: [], ...extra } as unknown as KBoardCompleto;
}

function buscarQueResponde(respostas: Record<string, unknown>) {
  return vi.fn(async (path: string) => {
    if (!(path in respostas)) throw new Error(`rota inesperada: ${path}`);
    return respostas[path];
  }) as unknown as (<T>(path: string) => Promise<T>) & ReturnType<typeof vi.fn>;
}

describe('carregarBoard', () => {
  it('primeira carga: busca o quadro sem `desde`', async () => {
    const novo = board('b1', 'h1');
    const buscar = buscarQueResponde({ '/kanban/boards/b1': novo });

    expect(await carregarBoard('b1', null, buscar)).toBe(novo);
  });

  it('nada mudou: manda a assinatura e devolve O MESMO objeto de antes', async () => {
    const anterior = board('b1', 'h1');
    const buscar = buscarQueResponde({
      '/kanban/boards/b1?desde=h1': { inalterado: true, assinatura: 'h1', imagemFundoUrl: 'url-1' },
    });

    const r = await carregarBoard('b1', anterior, buscar);

    expect(r).toBe(anterior);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('nada mudou mas a URL do fundo foi renovada: troca só a URL, mantém as listas', async () => {
    const anterior = board('b1', 'h1');
    const buscar = buscarQueResponde({
      '/kanban/boards/b1?desde=h1': { inalterado: true, assinatura: 'h1', imagemFundoUrl: 'url-2' },
    });

    const r = await carregarBoard('b1', anterior, buscar);

    expect(r.imagemFundoUrl).toBe('url-2');
    expect(r.listas).toBe(anterior.listas);
  });

  it('mudou: devolve o quadro novo', async () => {
    const novo = board('b1', 'h2');
    const buscar = buscarQueResponde({ '/kanban/boards/b1?desde=h1': novo });

    expect(await carregarBoard('b1', board('b1', 'h1'), buscar)).toBe(novo);
  });

  it('trocou de quadro na tela: não usa a assinatura do quadro anterior', async () => {
    const novo = board('b2', 'x');
    const buscar = buscarQueResponde({ '/kanban/boards/b2': novo });

    expect(await carregarBoard('b2', board('b1', 'h1'), buscar)).toBe(novo);
  });
});
