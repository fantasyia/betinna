import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyProdutosService } from './tiny-produtos.service';

/**
 * Subir catálogo pro ERP é escrita em sistema fiscal — os cuidados aqui não são
 * teóricos: catálogo duplicado contamina pedido, estoque e nota; NCM ou custo
 * inventado vira problema fiscal e margem mentirosa.
 */
function build(existentes: Array<{ id: number; sku: string }> = []) {
  const client = {
    get: vi.fn().mockResolvedValue({ itens: existentes }),
    post: vi.fn().mockResolvedValue({ id: 999 }),
    put: vi.fn().mockResolvedValue({}),
  };
  return { svc: new TinyProdutosService(client as never), client };
}

const MB04 = {
  sku: 'MB-04',
  descricao: 'Master Block MB-04',
  preco: 7040,
  comprimentoCm: 20,
  larguraCm: 10,
  alturaCm: 7,
  pesoKg: 2,
  fichaTecnica: 'Corrente de carga: 400 – 500 A',
};

describe('importar produtos pro Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SKU novo é CRIADO como Simples — o Tiny recusa Fabricado sem estrutura', async () => {
    // Tentativa real de 26/08: tipo F devolveu 400 "deve conter informações de
    // produção". A estrutura (lista de componentes) teria que vir junto, e
    // inventá-la seria inventar como a fábrica monta o produto.
    const { svc, client } = build([]);

    const r = await svc.importar('emp-1', [MB04]);

    expect(client.post).toHaveBeenCalledTimes(1);
    const corpo = client.post.mock.calls[0][2] as Record<string, unknown>;
    expect(corpo.tipo).toBe('S');
    expect(corpo.sku).toBe('MB-04');
    expect(r.criados).toBe(1);
  });

  it('quem quiser Fabricado pede explicitamente (com a estrutura pronta lá)', async () => {
    const { svc, client } = build([]);
    await svc.importar('emp-1', [{ ...MB04, tipo: 'F' as const }]);
    expect((client.post.mock.calls[0][2] as Record<string, unknown>).tipo).toBe('F');
  });

  it('429 na escrita não vira item faltando: espera e tenta de novo', async () => {
    // O teto de ESCRITA do Tiny é apertado — 12 POSTs seguidos tomaram 429 na
    // primeira importação real. Limite de taxa é "agora não", não "não".
    const { svc, client } = build([]);
    client.post.mockRejectedValueOnce(new Error('Tiny POST /produtos HTTP 429: '));

    const r = await svc.importar('emp-1', [MB04]);

    expect(client.post).toHaveBeenCalledTimes(2);
    expect(r.criados).toBe(1);
  });

  it('SKU que já existe é ATUALIZADO — rodar duas vezes não duplica catálogo', async () => {
    const { svc, client } = build([{ id: 42, sku: 'MB-04' }]);

    const r = await svc.importar('emp-1', [MB04]);

    expect(client.post).not.toHaveBeenCalled();
    expect(client.put).toHaveBeenCalledWith('emp-1', '/produtos/42', expect.anything());
    expect(r.atualizados).toBe(1);
  });

  it('a busca por código é BUSCA, não igualdade — confere o SKU exato', async () => {
    // O filtro `codigo` do Tiny casaria MB-01 dentro de MB-010. Sem a
    // conferência exata, atualizaríamos o produto ERRADO.
    const { svc, client } = build([{ id: 10, sku: 'MB-040' }]);

    await svc.importar('emp-1', [MB04]);

    expect(client.put).not.toHaveBeenCalled();
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('sem custo real, o campo NÃO é enviado (custo chutado = margem mentirosa)', async () => {
    const { svc, client } = build([]);

    await svc.importar('emp-1', [MB04]);

    const corpo = client.post.mock.calls[0][2] as { precos: Record<string, number> };
    expect(corpo.precos).toEqual({ preco: 7040 });
    expect(corpo.precos.precoCusto).toBeUndefined();
  });

  it('peso e dimensões vão preenchidos — é o que o Melhor Envio usa pra cotar', async () => {
    const { svc, client } = build([]);

    await svc.importar('emp-1', [MB04]);

    const corpo = client.post.mock.calls[0][2] as { dimensoes: Record<string, number> };
    expect(corpo.dimensoes).toEqual({
      comprimento: 20,
      largura: 10,
      altura: 7,
      pesoLiquido: 2,
      pesoBruto: 2,
    });
  });

  it('sob encomenda por padrão: saldo zero não pode barrar venda de fabricado', async () => {
    const { svc, client } = build([]);
    await svc.importar('emp-1', [MB04]);
    const corpo = client.post.mock.calls[0][2] as { estoque: Record<string, boolean> };
    expect(corpo.estoque).toEqual({ controlar: true, sobEncomenda: true });
  });

  it('um SKU que falha não interrompe os outros, e o relatório diz qual', async () => {
    const { svc, client } = build([]);
    client.post.mockRejectedValueOnce(new Error('HTTP 400: ncm inválido'));

    const r = await svc.importar('emp-1', [
      MB04,
      { sku: 'MB-05', descricao: 'Master Block MB-05' },
    ]);

    expect(r.erros).toBe(1);
    expect(r.criados).toBe(1);
    expect(r.itens[0]).toMatchObject({ sku: 'MB-04', acao: 'erro' });
  });
});
