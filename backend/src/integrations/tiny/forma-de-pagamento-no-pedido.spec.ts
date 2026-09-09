import { describe, expect, it, vi } from 'vitest';
import { TinyPedidoPushService } from './tiny-pedido-push.service';

/**
 * O bloco `pagamento` do pedido leva SÓ as parcelas — e isso é uma trava, não
 * uma limitação a corrigir.
 *
 * Três pedidos seguidos em produção (09/09) provaram o custo de mexer:
 *
 *   nº 49  só parcelas                     → parcelas OK, condicaoPagamento "30"
 *   nº 53  + formaRecebimento.id           → parcelas NULL, condicao ""
 *   nº 54  + meioPagamento (sem o id)      → parcelas NULL, condicao ""
 *
 * O Tiny não recusa: aceita, devolve 200 e DESCARTA O BLOCO INTEIRO. Parcela é
 * o que faz o ERP gerar a conta a receber, então o estrago é uma venda sem
 * conta a receber — e ninguém percebe até a conciliação do mês.
 *
 * Entre "o ERP não sabe a forma de pagamento" e "a venda não vira conta a
 * receber", o primeiro é incomparavelmente mais barato.
 */
const build = (over: { forma?: string } = {}) => {
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ped-1',
        numero: 'PED-0090',
        empresaId: 'emp-1',
        erpPedidoId: null,
        numeroErp: null,
        enviadoErpEm: null,
        observacoes: null,
        numeroSite: 'SB1',
        total: 10,
        formaPagamento: over.forma ?? 'CARTAO_CREDITO',
        condicaoPagamento: 'avista',
        cliente: {
          nome: 'X',
          cnpj: '1',
          cep: '1',
          endereco: 'r',
          numero: '1',
          cidade: 'SP',
          uf: 'SP',
        },
        itens: [{ quantidade: 1, precoUnitario: 10, produto: { sku: 'TESTE-NF' } }],
        representante: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: { erp: {} } }) },
  };
  const pedidos = {
    criar: vi.fn().mockResolvedValue({ id: 339063965, numeroPedido: 54 }),
    informarVolumes: vi.fn().mockResolvedValue({}),
  };
  const svc = new TinyPedidoPushService(
    prisma as never,
    pedidos as never,
    { acharVendedorPorContato: vi.fn() } as never,
    { registrarSaudeOk: vi.fn().mockResolvedValue(undefined) } as never,
  );
  const corpo = async () => {
    await svc.enviarPedido('ped-1', 'emp-1');
    return pedidos.criar.mock.calls[0][1] as Record<string, unknown>;
  };
  return { corpo };
};

describe('bloco de pagamento do pedido no ERP', () => {
  it('leva as PARCELAS — é o que gera a conta a receber', async () => {
    const { corpo } = build();

    expect(((await corpo()).pagamento as Record<string, unknown>).parcelas).toBeDefined();
  });

  it('e SÓ as parcelas: nada mais entra no bloco', async () => {
    // Cada campo extra testado até aqui zerou as parcelas em produção. Se
    // alguém precisar acrescentar um, tem que PROVAR num pedido de teste antes
    // — e este teste é o lembrete de que a conta desse erro é silenciosa.
    const { corpo } = build();

    expect(Object.keys((await corpo()).pagamento as Record<string, unknown>)).toEqual(['parcelas']);
  });

  it('não manda meioPagamento, formaRecebimento nem marcadores', async () => {
    const c = await build().corpo();
    const pag = c.pagamento as Record<string, unknown>;

    expect(pag.meioPagamento).toBeUndefined();
    expect(pag.formaRecebimentoId).toBeUndefined();
    expect(c.marcadores).toBeUndefined();
    expect(c.observacoesInternas).toBeUndefined();
  });
});
