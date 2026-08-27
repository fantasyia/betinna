import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyContaService } from './tiny-conta.service';

/**
 * O raio-X existe pro setup não depender de alguém transcrever id à mão: o
 * `POST /pedidos` do Tiny exige `deposito.id` e `vendedor.id`, e id errado faz
 * o pedido nascer no depósito errado — erro caro e silencioso.
 */
function build(resp: Record<string, unknown>) {
  const client = {
    get: vi.fn((_e: string, caminho: string) => {
      const chave = Object.keys(resp).find((k) => caminho.startsWith(k));
      const v = chave ? resp[chave] : undefined;
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? { itens: [] });
    }),
  };
  return { svc: new TinyContaService(client as never), client };
}

describe('raio-X da conta do Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve os ids que o POST /pedidos exige', async () => {
    const { svc } = build({
      // Nomes vêm em `descricao` (depósito) e `contato.nome` (vendedor) — mapear
      // por `nome` devolvia vazio, e por um tempo pareceu cadastro em branco.
      '/depositos': { itens: [{ id: 7, descricao: 'Geral', padrao: true }] },
      '/vendedores': {
        itens: [{ id: 3, contato: { id: 99, nome: 'REP TESTE' }, situacao: 'A' }],
      },
    });

    const r = await svc.raioX('emp-1');

    expect(r.depositos).toEqual([{ id: 7, nome: 'Geral', padrao: true }]);
    expect(r.vendedores).toEqual([{ id: 3, nome: 'REP TESTE', situacao: 'A' }]);
  });

  it('produtos: total vem da PAGINAÇÃO, não do tamanho da amostra', async () => {
    // Pedimos 10 itens só pra conferir SKU e custo; quem conta é o Tiny. Sem
    // isso, um catálogo de 300 produtos apareceria como "10".
    const { svc } = build({
      '/produtos': {
        itens: [
          {
            id: 1,
            sku: 'MB-04',
            descricao: 'Master Block 04',
            precos: { preco: 1290, precoCusto: 700 },
          },
        ],
        paginacao: { limit: 10, offset: 0, total: 312 },
      },
    });

    const r = await svc.raioX('emp-1');

    expect(r.produtos.total).toBe(312);
    expect(r.produtos.amostra[0]).toEqual({
      id: 1,
      sku: 'MB-04',
      nome: 'Master Block 04',
      preco: 1290,
      // O custo real é o que mata o chute de 70% herdado do OMIE.
      custo: 700,
    });
  });

  it('uma leitura falhar não derruba as outras — diagnóstico parcial vale', async () => {
    // "vendedores falhou" já é informação: normalmente significa permissão que
    // faltou marcar no aplicativo do Tiny.
    const { svc } = build({
      '/depositos': { itens: [{ id: 7, descricao: 'Geral' }] },
      '/vendedores': new Error('HTTP 403'),
    });

    const r = await svc.raioX('emp-1');

    expect(r.depositos).toHaveLength(1);
    expect(r.vendedores).toEqual([]);
  });

  it('só pede produtos ATIVOS, e poucos — é diagnóstico, não sync', async () => {
    const { svc, client } = build({});
    await svc.raioX('emp-1');
    const chamada = client.get.mock.calls.find((c) => String(c[1]).startsWith('/produtos'));
    expect(chamada?.[2]).toEqual({ situacao: 'A', limit: 10 });
  });
});
