import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { OcorrenciasService } from './ocorrencias.service';
import { slaHorasParaSeveridade } from './ocorrencias.dto';

const makePrismaMock = () => {
  const tx = {
    ocorrencia: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
    ocorrenciaComentario: { create: vi.fn() },
    cliente: { findFirst: vi.fn() },
    pedido: { findFirst: vi.fn() },
    usuario: { findFirst: vi.fn() },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
};

const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return [];
    return null;
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u-sac',
  email: 'sac@betinna.ai',
  nome: 'SAC Teste',
  role: 'SAC' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('OcorrenciasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: OcorrenciasService;
  let sequenceMock: {
    next: ReturnType<typeof vi.fn>;
    peek: ReturnType<typeof vi.fn>;
    seedFromDb: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = makePrismaMock();
    sequenceMock = {
      next: vi.fn(async () => 1),
      peek: vi.fn(async () => 0),
      seedFromDb: vi.fn(async () => undefined),
    };
    svc = new OcorrenciasService(
      prisma as never,
      makeRepScope() as never,
      { disparar: vi.fn() } as never,
      sequenceMock as never,
    );
  });

  describe('SLA por severidade', () => {
    it.each([
      ['baixa', 72],
      ['media', 48],
      ['alta', 24],
      ['critica', 4],
    ])('severidade %s → SLA %i horas', (sev, expected) => {
      expect(slaHorasParaSeveridade(sev)).toBe(expected);
    });

    it('valor desconhecido cai no default 48h', () => {
      expect(slaHorasParaSeveridade('xpto')).toBe(48);
    });
  });

  describe('create', () => {
    it('rejeita criação se cliente não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null);
      await expect(
        svc.create(fakeUser(), {
          clienteId: 'inexistente',
          tipo: 'ENTREGA',
          severidade: 'alta',
          titulo: 'Pedido errado',
          descricao: 'Veio óleo em vez de vinagre',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('REP só cria ocorrência pra clientes da própria carteira', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'c1', representanteId: 'outro-rep' });
      await expect(
        svc.create(fakeUser({ role: 'REP', id: 'rep-1' }), {
          clienteId: 'c1',
          tipo: 'ENTREGA',
          severidade: 'media',
          titulo: 'X',
          descricao: 'Y',
        }),
      ).rejects.toThrow();
    });

    it('calcula slaVenceEm baseado na severidade quando slaHoras não informado', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'c1', representanteId: null });
      prisma.ocorrencia.count.mockResolvedValue(0);
      prisma.ocorrencia.create.mockResolvedValue({ id: 'o1', slaVenceEm: new Date() });
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        clienteId: 'c1',
        cliente: { id: 'c1', nome: 'Cliente X', cnpj: null, representanteId: null },
      });

      await svc.create(fakeUser(), {
        clienteId: 'c1',
        tipo: 'QUALIDADE',
        severidade: 'critica',
        titulo: 'Cliente em pânico',
        descricao: 'Lote contaminado',
      });

      const data = prisma.ocorrencia.create.mock.calls[0][0].data;
      expect(data.slaHoras).toBe(4);
      const diffMs = data.slaVenceEm.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(3.5 * 60 * 60 * 1000);
      expect(diffMs).toBeLessThan(4.5 * 60 * 60 * 1000);
    });

    it('gera número sequencial OCO-XXXX via SequenceService atomic', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'c1', representanteId: null });
      // SequenceService retorna o próximo (auditoria 2026-05-15 P0-4)
      sequenceMock.next.mockResolvedValueOnce(43);
      prisma.ocorrencia.create.mockResolvedValue({ id: 'o1' });
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        clienteId: 'c1',
        cliente: { id: 'c1', nome: 'Cliente X', cnpj: null, representanteId: null },
      });
      await svc.create(fakeUser(), {
        clienteId: 'c1',
        tipo: 'PRAZO',
        severidade: 'media',
        titulo: 'X',
        descricao: 'Y',
      });
      const data = prisma.ocorrencia.create.mock.calls[0][0].data;
      expect(data.numero).toBe('OCO-0043');
      expect(sequenceMock.next).toHaveBeenCalledWith('emp-1', 'ocorrencia');
    });

    it('cria comentário sistêmico inicial', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'c1', representanteId: null });
      prisma.ocorrencia.count.mockResolvedValue(0);
      prisma.ocorrencia.create.mockResolvedValue({ id: 'o1' });
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        clienteId: 'c1',
        cliente: { id: 'c1', nome: 'Cliente X', cnpj: null, representanteId: null },
      });
      await svc.create(fakeUser(), {
        clienteId: 'c1',
        tipo: 'PRAZO',
        severidade: 'media',
        titulo: 'X',
        descricao: 'Y',
      });
      expect(prisma.ocorrenciaComentario.create).toHaveBeenCalled();
      const c = prisma.ocorrenciaComentario.create.mock.calls[0][0].data;
      expect(c.isSistema).toBe(true);
    });
  });

  describe('resolver', () => {
    it('rejeita resolver ocorrência já resolvida', async () => {
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        status: 'RESOLVIDA',
      });
      await expect(svc.resolver(fakeUser(), 'o1', { resolucao: 'X' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('rejeita resolver ocorrência cancelada', async () => {
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        status: 'CANCELADA',
      });
      await expect(svc.resolver(fakeUser(), 'o1', { resolucao: 'X' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('marca como RESOLVIDA, registra resolução e cria comentário sistêmico', async () => {
      // findById chama findFirst antes do updateMany e depois (pra retornar com timeline)
      prisma.ocorrencia.findFirst
        .mockResolvedValueOnce({ id: 'o1', empresaId: 'emp-1', status: 'ABERTA' })
        .mockResolvedValueOnce({ id: 'o1', empresaId: 'emp-1', status: 'RESOLVIDA' });
      prisma.ocorrencia.updateMany.mockResolvedValue({ count: 1 });

      const r = await svc.resolver(fakeUser(), 'o1', { resolucao: 'Trocado por outro lote' });
      expect(r.status).toBe('RESOLVIDA');
      const data = prisma.ocorrencia.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('RESOLVIDA');
      expect(data.resolvidoEm).toBeInstanceOf(Date);
      expect(prisma.ocorrenciaComentario.create).toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    it('rejeita mudar pra mesmo status', async () => {
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        status: 'ABERTA',
      });
      await expect(svc.changeStatus(fakeUser(), 'o1', { status: 'ABERTA' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('rejeita cancelar resolvida', async () => {
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        status: 'RESOLVIDA',
      });
      await expect(
        svc.changeStatus(fakeUser(), 'o1', { status: 'CANCELADA' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  describe('remove', () => {
    it('só permite excluir ocorrências ABERTAS', async () => {
      prisma.ocorrencia.findFirst.mockResolvedValue({
        id: 'o1',
        empresaId: 'emp-1',
        status: 'EM_ANDAMENTO',
      });
      await expect(svc.remove(fakeUser(), 'o1')).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });
});
