import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TinyOrcamentosService } from './tiny-orcamentos.service';

function build(opts: { produto?: { id: number } | null } = {}) {
  const client = {
    post: vi.fn().mockResolvedValue({ id: 900, numeroProposta: '12' }),
    get: vi.fn().mockResolvedValue({}),
  };
  const contatos = { garantir: vi.fn().mockResolvedValue(777) };
  const pedidos = {
    acharPorSku: vi.fn().mockResolvedValue(opts.produto === undefined ? { id: 33 } : opts.produto),
  };
  const svc = new TinyOrcamentosService(client as never, contatos as never, pedidos as never);
  return { svc, client, contatos, pedidos };
}

const BASE = {
  cliente: { nome: 'Indústria X', cpfCnpj: '16774052000155' },
  itens: [{ sku: 'MB-01', quantidade: 2, valorUnitario: 1500 }],
  vendedorId: 555,
};

describe('orçamento no Tiny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('monta o item com id do produto e unitário em STRING', async () => {
    // A API do orçamento pede o unitário como string — número volta 400 sem
    // dizer qual campo, e a caçada custa a tarde.
    const { svc, client } = build();

    await svc.criar('emp-1', BASE);

    const corpo = client.post.mock.calls[0][2] as Record<string, unknown>;
    expect(client.post.mock.calls[0][1]).toBe('/orcamentos');
    expect(corpo.itens).toEqual([{ produto: { id: 33 }, quantidade: 2, valorUnitario: '1500.00' }]);
    expect(corpo.contato).toEqual({ id: 777 });
    expect(corpo.vendedor).toEqual({ id: 555 });
  });

  it('SKU inexistente derruba o orçamento inteiro', async () => {
    // Proposta com item faltando vira pedido errado no dia em que o cliente
    // aprovar — e aí já é nota fiscal.
    const { svc, client } = build({ produto: null });

    await expect(svc.criar('emp-1', BASE)).rejects.toThrow(/não existe no Tiny/i);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('validade e prazo viajam em condicoesGerais', async () => {
    const { svc, client } = build();

    await svc.criar('emp-1', { ...BASE, validadeDias: 15, dataPrevistaEntrega: '2026-09-30' });

    const corpo = client.post.mock.calls[0][2] as Record<string, unknown>;
    expect(corpo.condicoesGerais).toEqual({ validade: 15, dataPrevistaEntrega: '2026-09-30' });
  });
});
