import { describe, expect, it } from 'vitest';
import {
  type LinhaReserva,
  LIMITE_QUEDA_PADRAO,
  MOTIVO_CANCELADO,
  MOTIVO_ITEM_SAIU,
  MOTIVO_NF_DESLIGADA,
  lerConfigReservaMagis5,
  planejarPedido,
  saldoParaEnvio,
} from './reserva-marketplace';

const pecas = (o: Record<string, number>) => new Map(Object.entries(o));
const linha = (
  produtoId: string,
  quantidade: number,
  status: LinhaReserva['status'] = 'CONFIRMADA',
): LinhaReserva => ({ id: `r-${produtoId}`, produtoId, quantidade, status });
const base = { existentes: [] as LinhaReserva[], ligada: true, depoisDoDesde: true };

describe('lerConfigReservaMagis5 — chave por empresa, padrão desligada', () => {
  it('sem config = desligada', () => {
    expect(lerConfigReservaMagis5(null)).toMatchObject({ ligada: false, erro: null });
    expect(lerConfigReservaMagis5({ erpInterno: { ativo: true } }).ligada).toBe(false);
  });

  it('ligada exige o ERP ligado E um "desde" válido', () => {
    const ok = lerConfigReservaMagis5({
      erpInterno: { ativo: true, reservaMagis5: { ativo: true, desde: '2026-11-15T00:00:00Z' } },
    });
    expect(ok.ligada).toBe(true);
    expect(ok.limiteQueda).toBe(LIMITE_QUEDA_PADRAO);
    const semErp = lerConfigReservaMagis5({
      erpInterno: { ativo: false, reservaMagis5: { ativo: true, desde: '2026-11-15T00:00:00Z' } },
    });
    expect(semErp.ligada).toBe(false);
    const semDesde = lerConfigReservaMagis5({
      erpInterno: { ativo: true, reservaMagis5: { ativo: true, desde: 'ontem' } },
    });
    expect(semDesde).toMatchObject({ ligada: false, erro: expect.stringContaining('desde') });
  });

  it('"ativo" precisa ser true de verdade (string "true" não liga)', () => {
    const c = lerConfigReservaMagis5({
      erpInterno: { ativo: true, reservaMagis5: { ativo: 'true', desde: '2026-11-15T00:00:00Z' } },
    });
    expect(c.ligada).toBe(false);
  });

  it('lê depósito, lista de SKUs e limite de queda', () => {
    const c = lerConfigReservaMagis5({
      erpInterno: {
        ativo: true,
        reservaMagis5: {
          ativo: true,
          desde: '2026-11-15T00:00:00Z',
          deposito: { id: 1, title: 'Estoque Único' },
          skusEnvio: ['A', '', 3],
          limiteQueda: 5,
        },
      },
    });
    expect(c.deposito).toEqual({ id: '1', title: 'Estoque Único' });
    expect(c.skusEnvio).toEqual(['A']);
    expect(c.limiteQueda).toBe(5);
  });
});

describe('planejarPedido — ledger idempotente', () => {
  it('vendido sem nota: reserva cada peça', () => {
    expect(
      planejarPedido({ ...base, situacao: 'RESERVAR', desejado: pecas({ p1: 2, p2: 1 }) }),
    ).toEqual([
      { tipo: 'criar', produtoId: 'p1', quantidade: 2 },
      { tipo: 'criar', produtoId: 'p2', quantidade: 1 },
    ]);
  });

  it('rodar de novo com o ledger em dia não faz nada', () => {
    expect(
      planejarPedido({
        ...base,
        situacao: 'RESERVAR',
        desejado: pecas({ p1: 2 }),
        existentes: [linha('p1', 2)],
      }),
    ).toEqual([]);
    expect(
      planejarPedido({
        ...base,
        situacao: 'NF_EMITIDA',
        desejado: pecas({ p1: 2 }),
        existentes: [linha('p1', 2, 'BAIXADA')],
      }),
    ).toEqual([]);
    expect(
      planejarPedido({
        ...base,
        situacao: 'CANCELADO',
        desejado: pecas({ p1: 2 }),
        existentes: [linha('p1', 2, 'LIBERADA')],
      }),
    ).toEqual([]);
  });

  it('quantidade mudou: ajusta; peça saiu do pedido: libera', () => {
    expect(
      planejarPedido({
        ...base,
        situacao: 'RESERVAR',
        desejado: pecas({ p1: 3 }),
        existentes: [linha('p1', 2), linha('p9', 1)],
      }),
    ).toEqual([
      { tipo: 'ajustar', id: 'r-p1', quantidade: 3 },
      { tipo: 'liberar', id: 'r-p9', motivo: MOTIVO_ITEM_SAIU },
    ]);
  });

  it('nota emitida com a chave LIGADA: a reserva vira saída', () => {
    expect(
      planejarPedido({
        ...base,
        situacao: 'NF_EMITIDA',
        desejado: pecas({ p1: 2 }),
        existentes: [linha('p1', 2)],
      }),
    ).toEqual([{ tipo: 'baixar', id: 'r-p1', produtoId: 'p1', quantidade: 2 }]);
  });

  it('nota antes de a rodada ver o pedido: baixa direto, só se o pedido é depois do "desde"', () => {
    const args = { ...base, situacao: 'NF_EMITIDA' as const, desejado: pecas({ p1: 1 }) };
    expect(planejarPedido(args)).toEqual([
      { tipo: 'baixarDireto', produtoId: 'p1', quantidade: 1 },
    ]);
    expect(planejarPedido({ ...args, depoisDoDesde: false })).toEqual([]);
  });

  it('chave DESLIGADA: nota não gera saída, a reserva só deixa de segurar', () => {
    expect(
      planejarPedido({
        ...base,
        ligada: false,
        situacao: 'NF_EMITIDA',
        desejado: pecas({ p1: 2, p2: 1 }),
        existentes: [linha('p1', 2)],
      }),
    ).toEqual([{ tipo: 'liberar', id: 'r-p1', motivo: MOTIVO_NF_DESLIGADA }]);
  });

  it('cancelado antes da nota: libera; depois da nota (BAIXADA) não volta sozinho', () => {
    expect(
      planejarPedido({
        ...base,
        situacao: 'CANCELADO',
        desejado: pecas({ p1: 2, p2: 1 }),
        existentes: [linha('p1', 2), linha('p2', 1, 'BAIXADA')],
      }),
    ).toEqual([{ tipo: 'liberar', id: 'r-p1', motivo: MOTIVO_CANCELADO }]);
  });

  it('status desconhecido, sem pagamento ou ignorado: não mexe', () => {
    for (const situacao of ['DESCONHECIDO', 'AGUARDANDO_PAGAMENTO', 'IGNORAR'] as const) {
      expect(
        planejarPedido({
          ...base,
          situacao,
          desejado: pecas({ p1: 2 }),
          existentes: [linha('p1', 1)],
        }),
      ).toEqual([]);
    }
  });

  it('item que voltou ao pedido reabre a linha liberada', () => {
    expect(
      planejarPedido({
        ...base,
        situacao: 'RESERVAR',
        desejado: pecas({ p1: 1 }),
        existentes: [linha('p1', 1, 'LIBERADA')],
      }),
    ).toEqual([{ tipo: 'reabrir', id: 'r-p1', quantidade: 1 }]);
  });
});

describe('saldoParaEnvio', () => {
  it('nunca negativo nem fração', () => {
    expect(saldoParaEnvio(-3)).toBe(0);
    expect(saldoParaEnvio(0)).toBe(0);
    expect(saldoParaEnvio(7)).toBe(7);
    expect(saldoParaEnvio(Number.NaN)).toBe(0);
  });
});
