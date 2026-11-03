import { describe, expect, it } from 'vitest';
import { inicioDaLeitura, lerPedido, listaDaResposta } from './magis5-pedidos';

describe('Magis5: leitura de pedidos (03/11)', () => {
  it('acha a lista na resposta, solta ou dentro de um campo', () => {
    expect(listaDaResposta([{ id: '1' }])).toHaveLength(1);
    expect(listaDaResposta({ next: null, orders: [{ id: '1' }] })).toHaveLength(1);
    expect(listaDaResposta({ orders: [] })).toEqual([]);
  });

  it('resposta sem lista ESTOURA: não vira "sem pedido"', () => {
    expect(() => listaDaResposta({ message: 'erro' })).toThrow('sem lista');
    expect(() => listaDaResposta(null)).toThrow('sem lista');
  });

  it('usa o número completo e cai no id', () => {
    expect(lerPedido({ completeOrderNumber: 'A-1', id: '9' }).numero).toBe('A-1');
    expect(lerPedido({ id: 9 }).numero).toBe('9');
    expect(lerPedido({}).numero).toBeNull();
  });

  it('data inválida não vira data', () => {
    expect(lerPedido({ dateCreated: 'x' }).pedidoEm).toBeNull();
    expect(lerPedido({ dateCreated: '2026-11-03T10:00:00Z' }).pedidoEm?.toISOString()).toBe(
      '2026-11-03T10:00:00.000Z',
    );
  });

  it('recomeça com 15 min de sobra; sem cursor pega 30 dias', () => {
    const agora = new Date('2026-11-03T12:00:00Z');
    expect(inicioDaLeitura(agora, agora).toISOString()).toBe('2026-11-03T11:45:00.000Z');
    expect(inicioDaLeitura(null, agora).toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });
});
