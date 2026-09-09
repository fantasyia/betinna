import { describe, expect, it, vi } from 'vitest';
import { TinyPedidoPushService } from './tiny-pedido-push.service';

/**
 * O pedido do site chegava ao ERP sem saber COMO foi pago.
 *
 * Medido em 09/09 no pedido nº 49: `forma_pagamento: "multiplas"` e
 * `meio_pagamento` vazio. Isso atrapalha exatamente a conciliação da conta a
 * receber com a cobrança do gateway — o ERP tem o valor, mas não o meio.
 *
 * A causa NÃO era esquecimento: mandar o meio derrubava o pedido inteiro com
 * 400 ("Meio de pagamento não encontrado") enquanto o Financeiro → Gateway do
 * Tiny não estivesse configurado. Trocar um rótulo faltando por nenhum pedido
 * subindo seria pior.
 *
 * Daí as duas metades: o marcador vai SEMPRE (texto livre não derruba pedido) e
 * o campo próprio só quando o tenant disser que o gateway está ligado.
 */
const build = (over: { forma?: string; cfg?: Record<string, unknown> } = {}) => {
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
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: { erp: over.cfg ?? {} } }) },
  };
  const pedidos = {
    criar: vi.fn().mockResolvedValue({ id: 339043452, numeroPedido: 49 }),
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

describe('forma de pagamento no pedido que sobe pro ERP', () => {
  it('o meio vai como MARCADOR, sempre — é o que permite conciliar', async () => {
    const { corpo } = build({ forma: 'CARTAO_CREDITO' });

    expect((await corpo()).marcadores).toEqual(['Cartão de crédito']);
  });

  it('Pix idem', async () => {
    const { corpo } = build({ forma: 'PIX' });

    expect((await corpo()).marcadores).toEqual(['Pix']);
  });

  it('SEM a chave do tenant, o campo próprio NÃO vai', async () => {
    // É a trava: com o gateway não configurado no Tiny, mandar o meio faz o
    // pedido inteiro voltar 400. Nenhum pedido subindo é pior que um rótulo
    // faltando.
    const { corpo } = build();

    const pag = (await corpo()).pagamento as Record<string, unknown>;
    expect(pag.meioPagamento).toBeUndefined();
    expect(pag.parcelas).toBeDefined();
  });

  it('COM a chave ligada, vai o enum do Tiny (3 = cartão)', async () => {
    const { corpo } = build({ forma: 'CARTAO_CREDITO', cfg: { meioPagamentoNoPedido: true } });

    expect(((await corpo()).pagamento as Record<string, unknown>).meioPagamento).toBe(3);
  });

  it('COM a chave ligada e Pix, vai 15', async () => {
    const { corpo } = build({ forma: 'PIX', cfg: { meioPagamentoNoPedido: true } });

    expect(((await corpo()).pagamento as Record<string, unknown>).meioPagamento).toBe(15);
  });

  it('as PARCELAS continuam indo em qualquer caso', async () => {
    // São elas que fazem o Tiny gerar (e estornar) a conta a receber junto com
    // a nota. Nada aqui pode custar isso.
    const { corpo } = build({ cfg: { meioPagamentoNoPedido: true } });

    expect(((await corpo()).pagamento as Record<string, unknown>).parcelas).toBeDefined();
  });
});
