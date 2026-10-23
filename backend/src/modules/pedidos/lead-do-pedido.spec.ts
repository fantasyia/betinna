import { describe, expect, it, vi } from 'vitest';
import { ligarLeadDoPedido } from './lead-do-pedido';

/** Pedido ↔ lead do funil (card cmv8qmn…, Léo/#01 14/10). */

const CFG = {
  funilPedidos: {
    criadoEtapaId: 'et-montado',
    pagoEtapaId: 'et-pago',
    pagoSemLeadEtapaId: 'et-1a-compra',
  },
};
const ETAPAS: Record<string, { id: string; funilId: string; tipo: string }> = {
  'et-montado': { id: 'et-montado', funilId: 'f-vendas', tipo: 'ATIVA' },
  'et-pago': { id: 'et-pago', funilId: 'f-vendas', tipo: 'ATIVA' },
  'et-1a-compra': { id: 'et-1a-compra', funilId: 'f-recompra', tipo: 'ATIVA' },
  'et-hora-recomprar': { id: 'et-hora-recomprar', funilId: 'f-recompra', tipo: 'ATIVA' },
};

function montar(o: { config?: unknown; leadDoCliente?: unknown; leadDoTelefone?: unknown } = {}) {
  const prisma = {
    pedido: {
      findUnique: vi.fn().mockResolvedValue({
        empresaId: 'emp-1',
        numero: 'PED-0010',
        clienteId: 'cli-1',
        contatoNome: 'Maria Souza',
        contatoTelefone: '5511999990000',
        cliente: { nome: 'Maria Souza', telefone: null },
        empresa: { config: o.config === undefined ? CFG : o.config },
      }),
    },
    lead: {
      findFirst: vi.fn().mockResolvedValue(o.leadDoCliente ?? null),
      findUnique: vi.fn().mockResolvedValue(o.leadDoTelefone ?? null),
      create: vi.fn().mockResolvedValue({ id: 'lead-novo' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValue(o.leadDoTelefone ? [{ id: (o.leadDoTelefone as { id: string }).id }] : []),
    funilEtapa: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ETAPAS[where.id] ?? null),
    },
    leadEtapaHistorico: { create: vi.fn().mockResolvedValue({}) },
  };
  const bus = { disparar: vi.fn().mockResolvedValue(undefined) };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { prisma, bus, d: { prisma: prisma as never, bus: bus as never, logger } };
}

describe('ligarLeadDoPedido', () => {
  it('empresa SEM config.funilPedidos: nada muda (as outras empresas ficam como estão)', async () => {
    const { d, prisma, bus } = montar({ config: {} });
    expect(await ligarLeadDoPedido(d, 'ped-1', 'CRIADO')).toBeNull();
    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('CRIADO com lead achado pelo TELEFONE: liga ao cliente e move pra "Pedido montado"', async () => {
    const { d, prisma, bus } = montar({
      leadDoTelefone: {
        id: 'lead-wa',
        funilId: 'f-vendas',
        funilEtapaId: 'et-conversa',
        clienteId: null,
      },
    });
    expect(await ligarLeadDoPedido(d, 'ped-1', 'CRIADO')).toBe('lead-wa');
    // D18: últimos 8 dígitos
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain('99990000');
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-wa', clienteId: null },
      data: { clienteId: 'cli-1' },
    });
    expect(prisma.lead.updateMany.mock.calls[1][0].data).toMatchObject({
      funilEtapaId: 'et-montado',
    });
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_ETAPA_MUDOU',
      expect.objectContaining({
        leadId: 'lead-wa',
        paraFunilEtapaId: 'et-montado',
        deFunilEtapaId: 'et-conversa',
      }),
    );
  });

  it('CRIADO sem lead: cria em "Pedido montado", origem vitrine, ligado ao cliente — SEM LEAD_CRIADO', async () => {
    const { d, prisma, bus } = montar();
    expect(await ligarLeadDoPedido(d, 'ped-1', 'CRIADO')).toBe('lead-novo');
    expect(prisma.lead.create.mock.calls[0][0].data).toMatchObject({
      funilEtapaId: 'et-montado',
      funilId: 'f-vendas',
      origemCadastro: 'vitrine',
      clienteId: 'cli-1',
      nome: 'Maria Souza',
    });
    expect(bus.disparar).not.toHaveBeenCalled();
  });

  it('PAGO: lead no funil de Vendas vai pra "Pedido pago"; em OUTRO funil, fica', async () => {
    const a = montar({
      leadDoCliente: {
        id: 'l1',
        funilId: 'f-vendas',
        funilEtapaId: 'et-montado',
        clienteId: 'cli-1',
      },
    });
    await ligarLeadDoPedido(a.d, 'ped-1', 'PAGO');
    expect(a.prisma.lead.updateMany.mock.calls[0][0].data).toMatchObject({
      funilEtapaId: 'et-pago',
    });

    const b = montar({
      leadDoCliente: { id: 'l2', funilId: 'f-recompra', funilEtapaId: 'et-x', clienteId: 'cli-1' },
    });
    expect(await ligarLeadDoPedido(b.d, 'ped-1', 'PAGO')).toBe('l2');
    expect(b.prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('PAGO sem lead nenhum (borda): cria em "Clientes · Recompra → 1ª compra"', async () => {
    const { d, prisma } = montar();
    await ligarLeadDoPedido(d, 'ped-1', 'PAGO');
    expect(prisma.lead.create.mock.calls[0][0].data).toMatchObject({
      funilEtapaId: 'et-1a-compra',
      funilId: 'f-recompra',
    });
  });

  it('23/10 PAGO de quem já está na Recompra: volta pra "1ª compra" e reacende', async () => {
    const config = { funilPedidos: { ...CFG.funilPedidos, pagoRecompraEtapaId: 'et-1a-compra' } };
    const { d, prisma, bus } = montar({
      config,
      leadDoCliente: {
        id: 'lead-1',
        funilId: 'f-recompra',
        funilEtapaId: 'et-hora-recomprar',
        clienteId: 'cli-1',
      },
    });
    expect(await ligarLeadDoPedido(d, 'ped-1', 'PAGO')).toBe('lead-1');
    expect(prisma.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ funilEtapaId: 'et-1a-compra' }) }),
    );
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_ETAPA_MUDOU',
      expect.objectContaining({ leadId: 'lead-1', paraFunilEtapaId: 'et-1a-compra' }),
    );
  });

  it('23/10 recompra de quem JÁ está na "1ª compra": não move, mas o evento sai (reacende)', async () => {
    const config = { funilPedidos: { ...CFG.funilPedidos, pagoRecompraEtapaId: 'et-1a-compra' } };
    const { d, prisma, bus } = montar({
      config,
      leadDoCliente: {
        id: 'lead-1',
        funilId: 'f-recompra',
        funilEtapaId: 'et-1a-compra',
        clienteId: 'cli-1',
      },
    });
    await ligarLeadDoPedido(d, 'ped-1', 'PAGO');
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    expect(bus.disparar).toHaveBeenCalledTimes(1);
  });

  it('23/10 lead no funil de VENDAS segue indo pra "Pedido pago" (a recompra não pega)', async () => {
    const config = { funilPedidos: { ...CFG.funilPedidos, pagoRecompraEtapaId: 'et-1a-compra' } };
    const { d, bus } = montar({
      config,
      leadDoCliente: {
        id: 'lead-1',
        funilId: 'f-vendas',
        funilEtapaId: 'et-montado',
        clienteId: 'cli-1',
      },
    });
    await ligarLeadDoPedido(d, 'ped-1', 'PAGO');
    expect(bus.disparar).toHaveBeenCalledWith(
      'emp-1',
      'LEAD_ETAPA_MUDOU',
      expect.objectContaining({ paraFunilEtapaId: 'et-pago' }),
    );
  });

  it('erro no meio não derruba o pedido: vira log e devolve null', async () => {
    const { d, prisma } = montar();
    prisma.pedido.findUnique.mockRejectedValue(new Error('banco caiu'));
    expect(await ligarLeadDoPedido(d, 'ped-1', 'CRIADO')).toBeNull();
  });
});
