import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContaDoPedido, PagamentosDaFaccao, linkFinanceiro } from './Atalhos';

/**
 * Atalhos do financeiro (§7.4): o pedido mostra a conta a receber dele; a OP,
 * os pagamentos da facção. Fora da diretoria ou com o financeiro desligado,
 * não aparece NADA (nem pergunta pra API).
 */

let role = 'DIRECTOR';
let ligado = true;
const titulos: Record<string, unknown[]> = {};
const chamadas: string[] = [];

vi.mock('@/hooks/usePermission', () => ({ useRole: () => role }));
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: (path: string | null) => {
    if (path) chamadas.push(path);
    if (!path) return { data: undefined, loading: false, error: null, refetch: vi.fn() };
    if (path === '/financeiro/status') return { data: { ativo: ligado }, loading: false, error: null, refetch: vi.fn() };
    const chave = path.includes('pedidoId') ? 'pedido' : 'op';
    return {
      data: { titulos: titulos[chave] ?? [], totais: { emAberto: 0, vencido: 0, quitadoNoMes: 0 } },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

const titulo = (over: Record<string, unknown>) => ({
  id: 't-1',
  tipo: 'RECEBER',
  descricao: 'Pedido PED-0007 (vitrine)',
  valor: 1234.5,
  pago: 0,
  saldo: 1234.5,
  vencimento: '2026-10-07T12:00:00.000Z',
  status: 'ABERTO',
  situacao: 'ABERTO',
  categoria: null,
  contatoNome: 'Loja da Ana',
  observacoes: null,
  recorrente: false,
  automatico: true,
  ...over,
});

const montar = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);
// Moeda pt-BR usa espaço inseparável entre "R$" e o número.
const texto = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ');

afterEach(() => {
  cleanup();
  role = 'DIRECTOR';
  ligado = true;
  chamadas.length = 0;
  for (const k of Object.keys(titulos)) delete titulos[k];
});

describe('atalhos do financeiro', () => {
  it('pedido: valor, situação, quanto falta e o link pra lista filtrada pelo número', () => {
    titulos.pedido = [titulo({ pago: 234.5, saldo: 1000, status: 'PARCIAL', situacao: 'PARCIAL' })];
    const { getByTestId } = montar(<ContaDoPedido pedidoId="ped-1" numero="PED-0007" />);
    const card = getByTestId('fin-conta-pedido');
    expect(texto(card)).toContain('R$ 1.234,50');
    expect(texto(card)).toContain('Recebido em parte');
    expect(texto(card)).toContain('falta R$ 1.000,00');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/financeiro?aba=RECEBER&busca=PED-0007&situacao=TODOS');
    expect(chamadas).toContain('/financeiro/titulos?tipo=RECEBER&situacao=TODOS&pedidoId=ped-1');
  });

  it('pedido ainda sem conta (só "sob consulta"): avisa que nasce no pagamento', () => {
    const { getByTestId } = montar(<ContaDoPedido pedidoId="ped-1" numero="PED-0007" />);
    expect(texto(getByTestId('fin-conta-pedido'))).toContain('nasce no pagamento');
  });

  it('OP: lista entregas + saldo, total pago de total', () => {
    titulos.op = [
      titulo({ id: 'a', tipo: 'PAGAR', descricao: 'Facção Maria · OP-0003 · entrega de 50 peça(s)', valor: 225, pago: 225, saldo: 0, status: 'QUITADO', situacao: 'QUITADO' }),
      titulo({ id: 'b', tipo: 'PAGAR', descricao: 'Facção Maria · OP-0003 · saldo de 8 peça(s)', valor: 36, pago: 0, saldo: 36 }),
    ];
    const { getByTestId } = montar(<PagamentosDaFaccao opId="op-1" numero="OP-0003" />);
    const card = getByTestId('fin-pagamentos-op');
    expect(texto(card)).toContain('R$ 225,00 pago de R$ 261,00');
    expect(card.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(texto(card)).toContain('Pago');
  });

  it('REP (ou financeiro desligado): não aparece e nem consulta títulos', () => {
    role = 'REP';
    const a = montar(<ContaDoPedido pedidoId="ped-1" numero="PED-0007" />);
    expect(a.container.innerHTML).toBe('');
    expect(chamadas).toEqual([]);
    cleanup();
    role = 'DIRECTOR';
    ligado = false;
    const b = montar(<PagamentosDaFaccao opId="op-1" numero="OP-0003" />);
    expect(b.container.innerHTML).toBe('');
    expect(chamadas.some((c) => c.includes('/titulos'))).toBe(false);
  });

  it('link do financeiro monta aba + busca', () => {
    expect(linkFinanceiro('PAGAR', 'OP-0003')).toBe('/financeiro?aba=PAGAR&busca=OP-0003&situacao=TODOS');
  });
});
