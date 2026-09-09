import { describe, expect, it, vi } from 'vitest';
import { TinyPedidoPushService } from './tiny-pedido-push.service';

/**
 * O vínculo com o ERP é o ID, não o número.
 *
 * Incidente de 09/09, reconstruído a partir do banco: o Tiny devolveu os
 * números 44 e 45 pros dois pedidos que o app criou. Só que PED-0072 e PED-0073
 * — importados DO ERP em 05/09 — já ocupavam exatamente esses números. O
 * `@@unique([empresaId, numeroErp])` estourou no write-back, a exceção subiu, e
 * os pedidos ficaram RASCUNHO no app **com o pedido já criado no ERP**.
 *
 * É o pior estado possível: o app acha que falhou, o ERP tem o pedido, e um
 * reenvio manual criaria o segundo. O Tiny reaproveita numeração; id é
 * identidade, número é rótulo.
 */
const build = (over: { pedido?: Record<string, unknown>; updateFalha?: boolean } = {}) => {
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(
        over.pedido ?? {
          id: 'ped-1',
          numero: 'PED-0078',
          empresaId: 'emp-1',
          erpPedidoId: null,
          numeroErp: null,
          enviadoErpEm: null,
          observacoes: null,
          numeroSite: 'SB1',
          total: 4350,
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
          itens: [{ quantidade: 1, precoUnitario: 4350, produto: { sku: 'MB-01' } }],
          representante: null,
        },
      ),
      update: vi.fn(),
    },
    empresa: { findUnique: vi.fn().mockResolvedValue({ config: {} }) },
  };
  // 1ª chamada (vínculo) sempre passa; a 2ª (número) falha quando pedido.
  prisma.pedido.update
    .mockResolvedValueOnce({})
    .mockImplementation(async () =>
      over.updateFalha ? Promise.reject(new Error('Unique constraint failed')) : {},
    );

  const pedidos = {
    criar: vi.fn().mockResolvedValue({ id: 338952128, numeroPedido: 44 }),
    informarVolumes: vi.fn().mockResolvedValue({}),
  };
  const svc = new TinyPedidoPushService(
    prisma as never,
    pedidos as never,
    { acharVendedorPorContato: vi.fn() } as never,
    { registrarSaudeOk: vi.fn().mockResolvedValue(undefined) } as never,
    { acharFormaRecebimento: vi.fn().mockResolvedValue(335196092) } as never,
  );
  return { svc, prisma, pedidos };
};

describe('write-back do pedido no ERP', () => {
  it('grava o ID do ERP e o status ANTES de tentar o número', async () => {
    const { svc, prisma } = build();

    await svc.enviarPedido('ped-1', 'emp-1');

    const primeiro = prisma.pedido.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(primeiro.erpPedidoId).toBe('338952128');
    expect(primeiro.status).toBe('ENVIADO_ERP');
    // O rótulo vai numa segunda escrita, separada de propósito.
    expect(primeiro.numeroErp).toBeUndefined();
  });

  it('número colidindo NÃO perde o vínculo — perde só o rótulo', async () => {
    // Foi exatamente isto que aconteceu: número 44 já ocupado por um pedido
    // importado, e o pedido inteiro ficou como se nunca tivesse subido.
    const { svc, prisma } = build({ updateFalha: true });

    const r = await svc.enviarPedido('ped-1', 'emp-1');

    expect(r.idTiny).toBe(338952128);
    expect(prisma.pedido.update.mock.calls[0][0].data).toMatchObject({
      erpPedidoId: '338952128',
      status: 'ENVIADO_ERP',
    });
  });

  it('pedido que JÁ está no ERP é recusado — reenviar duplicaria lá', async () => {
    const { svc, pedidos } = build({
      pedido: {
        id: 'ped-1',
        numero: 'PED-0078',
        erpPedidoId: '338952128',
        numeroErp: '44',
        itens: [],
      },
    });

    await expect(svc.enviarPedido('ped-1', 'emp-1')).rejects.toThrow(/já está no ERP/i);
    // E o mais importante: não chega a chamar o Tiny.
    expect(pedidos.criar).not.toHaveBeenCalled();
  });
});
