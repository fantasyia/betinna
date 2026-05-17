import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FidelidadeService } from './fidelidade.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => {
  const tx = {
    saldoFidelidade: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    } satisfies MockModel,
    movimentoFidelidade: {
      create: vi.fn().mockResolvedValue({ id: 'mov-1', pontos: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
    } satisfies MockModel,
    recompensaFidelidade: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } satisfies MockModel,
  };
  return {
    _tx: tx,
    programaFidelidade: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'prog-1',
        empresaId: 'emp-1',
        ativo: true,
        pontosPorReal: 1,
        ttlMeses: 12,
        valorMinimoPedido: 0,
      }),
      update: vi.fn().mockResolvedValue({}),
    } satisfies MockModel,
    recompensaFidelidade: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'rec-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } satisfies MockModel,
    saldoFidelidade: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    } satisfies MockModel,
    movimentoFidelidade: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    } satisfies MockModel,
    cliente: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cli-1' }),
    } satisfies MockModel,
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
};

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FidelidadeService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: FidelidadeService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new FidelidadeService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // ForbiddenException sem empresaIdAtiva
  // -------------------------------------------------------------------------

  describe('ForbiddenException sem empresaIdAtiva', () => {
    const noEmp = fakeUser({ empresaIdAtiva: null });

    it.each([
      ['getPrograma', (svc: FidelidadeService) => svc.getPrograma(noEmp)],
      ['updatePrograma', (svc: FidelidadeService) => svc.updatePrograma(noEmp, {})],
      ['listRecompensas', (svc: FidelidadeService) => svc.listRecompensas(noEmp)],
      ['getSaldo', (svc: FidelidadeService) => svc.getSaldo(noEmp, 'cli-1')],
    ] as const)('%s lança ForbiddenException', async (_, fn) => {
      await expect(fn(service)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // Programa
  // -------------------------------------------------------------------------

  describe('getPrograma / updatePrograma', () => {
    it('cria programa singleton se não existir', async () => {
      prisma.programaFidelidade.findUnique.mockResolvedValue(null);

      const result = await service.getPrograma(fakeUser());

      expect(prisma.programaFidelidade.create).toHaveBeenCalledWith({
        data: { empresaId: 'emp-1' },
      });
      expect(result.id).toBe('prog-1');
    });

    it('retorna programa existente sem criar', async () => {
      prisma.programaFidelidade.findUnique.mockResolvedValue({ id: 'existente' });

      const result = await service.getPrograma(fakeUser());

      expect(prisma.programaFidelidade.create).not.toHaveBeenCalled();
      expect(result.id).toBe('existente');
    });

    it('updatePrograma garante row antes de update', async () => {
      prisma.programaFidelidade.findUnique.mockResolvedValue({ id: 'p' });
      prisma.programaFidelidade.update.mockResolvedValue({ id: 'p', ativo: false });

      await service.updatePrograma(fakeUser(), { ativo: false });

      expect(prisma.programaFidelidade.update).toHaveBeenCalledWith({
        where: { empresaId: 'emp-1' },
        data: { ativo: false },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Recompensas
  // -------------------------------------------------------------------------

  describe('createRecompensa', () => {
    it('persiste com empresaId do user', async () => {
      await service.createRecompensa(fakeUser(), {
        nome: 'Caneca',
        custoPontos: 100,
        tipo: 'BRINDE',
      });

      const data = prisma.recompensaFidelidade.create.mock.calls[0][0].data;
      expect(data.empresaId).toBe('emp-1');
      expect(data.tipo).toBe('BRINDE');
    });
  });

  describe('updateRecompensa', () => {
    it('lança NotFoundException quando recompensa não pertence à empresa', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRecompensa(fakeUser(), 'rec-x', { nome: 'Novo' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('atualiza quando recompensa existe', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue({ id: 'rec-1' });
      prisma.recompensaFidelidade.update.mockResolvedValue({});

      await service.updateRecompensa(fakeUser(), 'rec-1', { nome: 'Novo' });

      expect(prisma.recompensaFidelidade.update).toHaveBeenCalledWith({
        where: { id: 'rec-1' },
        data: { nome: 'Novo' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Saldo
  // -------------------------------------------------------------------------

  describe('getSaldo', () => {
    it('lança NotFoundException quando cliente não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null);

      await expect(service.getSaldo(fakeUser(), 'cli-fake')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('retorna 0 quando cliente nunca teve saldo', async () => {
      prisma.saldoFidelidade.findUnique.mockResolvedValue(null);

      const result = await service.getSaldo(fakeUser(), 'cli-1');

      expect(result.pontos).toBe(0);
      expect(result.saldo).toBeNull();
    });

    it('retorna pontos quando saldo existe', async () => {
      prisma.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 250 });

      const result = await service.getSaldo(fakeUser(), 'cli-1');

      expect(result.pontos).toBe(250);
    });
  });

  // -------------------------------------------------------------------------
  // Resgate
  // -------------------------------------------------------------------------

  describe('resgatar', () => {
    it('lança NotFoundException quando recompensa não está ativa', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue(null);

      await expect(
        service.resgatar(fakeUser(), { clienteId: 'cli-1', recompensaId: 'rec-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lança BusinessRuleException quando estoque é 0', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue({
        id: 'rec-1',
        custoPontos: 100,
        estoque: 0,
        nome: 'Esgotada',
      });

      await expect(
        service.resgatar(fakeUser(), { clienteId: 'cli-1', recompensaId: 'rec-1' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando saldo é insuficiente', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue({
        id: 'rec-1',
        custoPontos: 500,
        estoque: null,
      });
      prisma._tx.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 100 });

      await expect(
        service.resgatar(fakeUser(), { clienteId: 'cli-1', recompensaId: 'rec-1' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('debita saldo + cria movimento RESGATE quando OK', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue({
        id: 'rec-1',
        custoPontos: 100,
        estoque: null,
      });
      prisma._tx.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 500 });
      prisma._tx.movimentoFidelidade.create.mockResolvedValue({ id: 'mov-1', pontos: -100 });

      const result = await service.resgatar(fakeUser(), {
        clienteId: 'cli-1',
        recompensaId: 'rec-1',
      });

      expect(result.saldoAposPontos).toBe(400);
      const createArgs = prisma._tx.movimentoFidelidade.create.mock.calls[0][0];
      expect(createArgs.data.tipo).toBe('RESGATE');
      expect(createArgs.data.pontos).toBe(-100);
      // Upsert atualiza pra 400
      expect(prisma._tx.saldoFidelidade.upsert).toHaveBeenCalled();
    });

    it('decrementa estoque atômico quando recompensa tem controle', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue({
        id: 'rec-1',
        custoPontos: 100,
        estoque: 5,
      });
      prisma._tx.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 500 });
      prisma._tx.recompensaFidelidade.updateMany.mockResolvedValue({ count: 1 });

      await service.resgatar(fakeUser(), { clienteId: 'cli-1', recompensaId: 'rec-1' });

      expect(prisma._tx.recompensaFidelidade.updateMany).toHaveBeenCalledWith({
        where: { id: 'rec-1', estoque: { gt: 0 } },
        data: { estoque: { decrement: 1 } },
      });
    });

    it('rejeita se estoque esgotou durante o resgate (race)', async () => {
      prisma.recompensaFidelidade.findFirst.mockResolvedValue({
        id: 'rec-1',
        custoPontos: 100,
        estoque: 1,
      });
      prisma._tx.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 500 });
      // Race: outra request consumiu — count=0
      prisma._tx.recompensaFidelidade.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resgatar(fakeUser(), { clienteId: 'cli-1', recompensaId: 'rec-1' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // Ajuste manual
  // -------------------------------------------------------------------------

  describe('ajustar', () => {
    it('lança quando ajuste deixaria saldo negativo', async () => {
      prisma._tx.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 50 });

      await expect(
        service.ajustar(fakeUser(), {
          clienteId: 'cli-1',
          pontos: -100,
          motivo: 'Erro contábil',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('cria movimento AJUSTE_MANUAL com motivo', async () => {
      prisma._tx.saldoFidelidade.findUnique.mockResolvedValue({ pontos: 100 });
      prisma._tx.movimentoFidelidade.create.mockResolvedValue({ id: 'm', pontos: 50 });

      await service.ajustar(fakeUser(), {
        clienteId: 'cli-1',
        pontos: 50,
        motivo: 'Bonificação de aniversário',
      });

      const args = prisma._tx.movimentoFidelidade.create.mock.calls[0][0];
      expect(args.data.tipo).toBe('AJUSTE_MANUAL');
      expect(args.data.motivo).toBe('Bonificação de aniversário');
      expect(args.data.criadoPorId).toBe('admin-1');
    });
  });

  // -------------------------------------------------------------------------
  // Trigger creditarPedidoAprovado
  // -------------------------------------------------------------------------

  describe('creditarPedidoAprovado', () => {
    beforeEach(() => {
      prisma.programaFidelidade.findUnique.mockResolvedValue({
        id: 'p',
        empresaId: 'emp-1',
        ativo: true,
        pontosPorReal: 1,
        ttlMeses: 12,
        valorMinimoPedido: 0,
      });
    });

    it('credita pontos = floor(valorPedido × pontosPorReal)', async () => {
      prisma._tx.movimentoFidelidade.findUnique.mockResolvedValue(null);
      prisma._tx.movimentoFidelidade.create.mockResolvedValue({ id: 'm', pontos: 1500 });

      const result = await service.creditarPedidoAprovado({
        empresaId: 'emp-1',
        clienteId: 'cli-1',
        pedidoId: 'ped-1',
        valorPedido: 1500.75,
      });

      expect(result).toBeDefined();
      const args = prisma._tx.movimentoFidelidade.create.mock.calls[0][0];
      expect(args.data.pontos).toBe(1500); // floor(1500.75 * 1)
      expect(args.data.tipo).toBe('GANHO_PEDIDO');
    });

    it('é idempotente — não duplica se já há GANHO_PEDIDO para o pedido', async () => {
      prisma._tx.movimentoFidelidade.findUnique.mockResolvedValue({
        id: 'm-existente',
        pontos: 500,
      });

      const result = await service.creditarPedidoAprovado({
        empresaId: 'emp-1',
        clienteId: 'cli-1',
        pedidoId: 'ped-1',
        valorPedido: 1500,
      });

      expect(result?.id).toBe('m-existente');
      expect(prisma._tx.movimentoFidelidade.create).not.toHaveBeenCalled();
    });

    it('pula quando programa inativo', async () => {
      prisma.programaFidelidade.findUnique.mockResolvedValue({
        ativo: false,
        pontosPorReal: 1,
        valorMinimoPedido: 0,
      });

      const result = await service.creditarPedidoAprovado({
        empresaId: 'emp-1',
        clienteId: 'cli-1',
        pedidoId: 'ped-1',
        valorPedido: 1000,
      });

      expect(result).toBeNull();
    });

    it('pula quando valor < valorMinimoPedido', async () => {
      prisma.programaFidelidade.findUnique.mockResolvedValue({
        ativo: true,
        pontosPorReal: 1,
        valorMinimoPedido: 500,
      });

      const result = await service.creditarPedidoAprovado({
        empresaId: 'emp-1',
        clienteId: 'cli-1',
        pedidoId: 'ped-1',
        valorPedido: 100,
      });

      expect(result).toBeNull();
    });

    it('best-effort: retorna null em vez de lançar quando DB falha', async () => {
      prisma.programaFidelidade.findUnique.mockRejectedValue(new Error('DB down'));

      const result = await service.creditarPedidoAprovado({
        empresaId: 'emp-1',
        clienteId: 'cli-1',
        pedidoId: 'ped-1',
        valorPedido: 1000,
      });

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Trigger estornarPedidoCancelado
  // -------------------------------------------------------------------------

  describe('estornarPedidoCancelado', () => {
    it('cria ESTORNO_PEDIDO espelhando o GANHO_PEDIDO', async () => {
      // findUnique chamado 2x: 1) GANHO_PEDIDO (existe), 2) ESTORNO_PEDIDO (não existe)
      prisma._tx.movimentoFidelidade.findUnique
        .mockResolvedValueOnce({
          id: 'ganho-1',
          empresaId: 'emp-1',
          clienteId: 'cli-1',
          pontos: 500,
        })
        .mockResolvedValueOnce(null);
      prisma._tx.movimentoFidelidade.create.mockResolvedValue({ id: 'estorno-1', pontos: -500 });

      const result = await service.estornarPedidoCancelado('ped-1');

      expect(result).toBeDefined();
      const args = prisma._tx.movimentoFidelidade.create.mock.calls[0][0];
      expect(args.data.tipo).toBe('ESTORNO_PEDIDO');
      expect(args.data.pontos).toBe(-500);
    });

    it('retorna null quando não há GANHO_PEDIDO prévio (pedido nunca gerou pontos)', async () => {
      prisma._tx.movimentoFidelidade.findUnique.mockResolvedValueOnce(null);

      const result = await service.estornarPedidoCancelado('ped-1');

      expect(result).toBeNull();
      expect(prisma._tx.movimentoFidelidade.create).not.toHaveBeenCalled();
    });

    it('é idempotente — se já estornou, retorna o estorno existente', async () => {
      prisma._tx.movimentoFidelidade.findUnique
        .mockResolvedValueOnce({ id: 'ganho', empresaId: 'emp-1', clienteId: 'cli-1', pontos: 500 })
        .mockResolvedValueOnce({ id: 'estorno-existente', pontos: -500 });

      const result = await service.estornarPedidoCancelado('ped-1');

      expect(result?.id).toBe('estorno-existente');
      expect(prisma._tx.movimentoFidelidade.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Ranking
  // -------------------------------------------------------------------------

  describe('ranking', () => {
    it('retorna top N clientes por saldo', async () => {
      prisma.saldoFidelidade.findMany.mockResolvedValue([
        { clienteId: 'cli-1', pontos: 1000, cliente: { id: 'cli-1', nome: 'João' } },
        { clienteId: 'cli-2', pontos: 500, cliente: { id: 'cli-2', nome: 'Maria' } },
      ]);

      const result = await service.ranking(fakeUser(), 10);

      expect(result).toHaveLength(2);
      expect(result[0].pontos).toBe(1000);
      expect(result[0].clienteNome).toBe('João');
    });

    it('limita a 50 mesmo com limit > 50', async () => {
      prisma.saldoFidelidade.findMany.mockResolvedValue([]);

      await service.ranking(fakeUser(), 999);

      const args = prisma.saldoFidelidade.findMany.mock.calls[0][0];
      expect(args.take).toBe(50);
    });
  });
});
