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
      // O custo real é o que mata o chute de 70% herdado do ERP.
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

  /**
   * A lista `/produtos` traz so o resumo. Campo fiscal (NCM/CEST/origem) so
   * existe no `GET /produtos/{id}` — e subir dado fiscal sem ver o nome real do
   * campo seria adivinhar, com o agravante de o Tiny IGNORAR EM SILENCIO o que
   * nao reconhece.
   */
  describe('cru.produto — o produto INTEIRO', () => {
    // `/produtos/` casa ANTES de `/produtos` no build(), entao a chave mais
    // especifica define o detalhe.
    const respostas = {
      '/produtos/': { id: 335240597, sku: 'MB-01', classificacaoFiscal: '85352900' },
      '/produtos': { itens: [{ id: 335240597, sku: 'MB-01' }] },
    };

    it('busca o detalhe do primeiro produto da lista', async () => {
      const { svc, client } = build(respostas);

      await svc.raioX('emp-1');

      expect(client.get).toHaveBeenCalledWith('emp-1', '/produtos/335240597');
    });

    it('devolve o produto inteiro em cru.produto', async () => {
      const { svc } = build(respostas);

      const r = await svc.raioX('emp-1');

      expect(r.cru?.produto).toMatchObject({ sku: 'MB-01' });
    });

    it('falha no detalhe nao derruba o raio-X — o resto do diagnostico continua util', async () => {
      const { svc } = build({
        '/produtos/': new Error('500 do Tiny'),
        '/produtos': { itens: [{ id: 335240597, sku: 'MB-01' }] },
      });

      const r = await svc.raioX('emp-1');

      expect(r.cru?.produto).toBeUndefined();
      expect(r.produtos.amostra).toHaveLength(1);
    });
  });
});
