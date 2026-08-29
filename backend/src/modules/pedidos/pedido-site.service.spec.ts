import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PedidoSiteService } from './pedido-site.service';

/**
 * O checkout do site entrando no app.
 *
 * O que estes testes protegem é o que custa dinheiro de verdade: pedido
 * duplicado (cobrança e nota em dobro), item que não existe no catálogo virando
 * nota errada, e cliente do site nascendo como cadastro novo quando já existe —
 * o que parte o histórico e tira o cliente da carteira do rep.
 */
function build(
  opts: {
    pedidoExistente?: Record<string, unknown> | null;
    produtos?: Array<{ id: string; sku: string; nome: string }>;
    clientePorDoc?: Array<{ id: string }>;
    pushFalha?: boolean;
  } = {},
) {
  const prisma = {
    pedido: {
      findFirst: vi.fn().mockResolvedValue(opts.pedidoExistente ?? null),
      create: vi.fn().mockResolvedValue({ id: 'ped-1', numero: 'PED-0009' }),
    },
    produto: {
      findMany: vi
        .fn()
        .mockResolvedValue(opts.produtos ?? [{ id: 'prod-1', sku: 'MB-01', nome: 'Master Block' }]),
    },
    cliente: { create: vi.fn().mockResolvedValue({ id: 'cli-novo' }) },
    $queryRaw: vi.fn().mockResolvedValue(opts.clientePorDoc ?? []),
  };
  const captura = { autenticarChave: vi.fn().mockResolvedValue('emp-1') };
  const sequence = { next: vi.fn().mockResolvedValue(9) };
  const erpPush = {
    enviarPedido: opts.pushFalha
      ? vi.fn().mockRejectedValue(new Error('Tiny 500'))
      : vi.fn().mockResolvedValue({ numeroErp: '77' }),
  };
  const svc = new PedidoSiteService(
    prisma as never,
    captura as never,
    sequence as never,
    erpPush as never,
  );
  return { svc, prisma, captura, erpPush };
}

const PEDIDO = {
  numeroSite: 'SB1234',
  cliente: { nome: 'Indústria X', cpfCnpj: '16774052000155' },
  itens: [{ sku: 'MB-01', quantidade: 2, valorUnitario: 1500 }],
  valorFrete: 50,
};

describe('pedido do site', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cria o pedido como venda de CANAL e sobe pro ERP', async () => {
    const { svc, prisma, erpPush } = build();

    const r = await svc.receber('blc_chave', PEDIDO);

    const dados = prisma.pedido.create.mock.calls[0][0].data;
    expect(dados.origem).toBe('SITE');
    // Sem representante de propósito: atribuir alguém criaria comissão de rep
    // sobre venda que ninguém atendeu.
    expect(dados.representanteId).toBeNull();
    expect(Number(dados.total)).toBe(3050); // 2 × 1500 + 50 de frete
    expect(erpPush.enviarPedido).toHaveBeenCalledWith('ped-1', 'emp-1');
    expect(r.numeroErp).toBe('77');
  });

  it('reenvio do MESMO número não cria segundo pedido', async () => {
    // Clique duplo no checkout, retry do gateway ou reenvio manual — qualquer
    // um deles viraria cobrança dupla e duas notas.
    const { svc, prisma } = build({
      pedidoExistente: { id: 'ped-ja', numero: 'PED-0005', numeroErp: '5' },
    });

    const r = await svc.receber('blc_chave', PEDIDO);

    expect(r.duplicado).toBe(true);
    expect(r.numero).toBe('PED-0005');
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('SKU fora do catálogo RECUSA o pedido inteiro', async () => {
    const { svc, prisma } = build({ produtos: [] });

    await expect(svc.receber('blc_chave', PEDIDO)).rejects.toThrow(/SKU não cadastrado/i);
    expect(prisma.pedido.create).not.toHaveBeenCalled();
  });

  it('cliente que já existe pelo documento NÃO vira cadastro novo', async () => {
    const { svc, prisma } = build({ clientePorDoc: [{ id: 'cli-antigo' }] });

    await svc.receber('blc_chave', PEDIDO);

    expect(prisma.cliente.create).not.toHaveBeenCalled();
    expect(prisma.pedido.create.mock.calls[0][0].data.clienteId).toBe('cli-antigo');
  });

  it('ERP fora do ar não perde o pedido — ele existe e sobe depois', async () => {
    // O cliente já pagou: derrubar a resposta faria o checkout mostrar erro
    // pra uma compra que aconteceu.
    const { svc } = build({ pushFalha: true });

    const r = await svc.receber('blc_chave', PEDIDO);

    expect(r.numero).toBe('PED-0009');
    expect(r.numeroErp).toBeNull();
  });

  it('chave inválida não passa', async () => {
    const { svc, captura } = build();
    captura.autenticarChave.mockRejectedValue(new Error('Chave de API inválida'));

    await expect(svc.receber('errada', PEDIDO)).rejects.toThrow(/inválida/i);
  });
});
