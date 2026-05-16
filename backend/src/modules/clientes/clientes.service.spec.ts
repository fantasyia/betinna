import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Cliente, ClienteOmieStatus, ClienteStatus, UserRole } from '@prisma/client';
import { ClientesService } from './clientes.service';
import { ListasDinamicasService } from './listas-dinamicas.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import {
  ForbiddenException,
  BusinessRuleException,
  NotFoundException,
} from '@shared/errors/app-exception';

/**
 * Mock leve do PrismaService.
 * Cada teste pode sobrescrever os métodos que usa.
 */
type MockModel = Record<string, ReturnType<typeof vi.fn>>;
type Tx = { cliente: MockModel; clienteTag: MockModel; usuario: MockModel; tag: MockModel };
const makePrismaMock = () => {
  const tx: Tx = {
    cliente: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    clienteTag: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    usuario: { findFirst: vi.fn() },
    tag: { count: vi.fn() },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (cb: (t: Tx) => unknown) => cb(tx)),
  };
};

/** Mock do RepScopeService: replica a regra real (REP → [id], outros → null). */
const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return [];
    return null;
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-admin',
  email: 'admin@betinna.ai',
  nome: 'Admin Teste',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeCliente = (overrides: Partial<Cliente> = {}): Cliente => ({
  id: 'cli-1',
  empresaId: 'emp-1',
  codigoOmie: null,
  nome: 'Restaurante Teste',
  cnpj: null,
  email: null,
  telefone: null,
  segmento: 'Restaurante',
  cidade: 'São Paulo',
  uf: 'SP',
  regiao: 'Grande SP',
  status: 'ATIVO' as ClienteStatus,
  omieStatus: 'ATIVO' as ClienteOmieStatus,
  score: 80,
  prazoPagamento: 30,
  limiteCredito: null,
  ultimoPedidoEm: null,
  representanteId: null,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  ...overrides,
});

describe('ClientesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let listas: ListasDinamicasService;
  let service: ClientesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    listas = new ListasDinamicasService();
    service = new ClientesService(prisma as never, listas, makeRepScope() as never);
  });

  describe('tenant isolation', () => {
    it('lança Forbidden se usuário sem empresa ativa', async () => {
      const user = fakeUser({ empresaIdAtiva: null });
      await expect(
        service.list(user, { page: 1, limit: 20, sortBy: 'criadoEm', sortOrder: 'desc' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por empresaIdAtiva ao listar', async () => {
      const user = fakeUser({ empresaIdAtiva: 'emp-99' });
      prisma.cliente.count.mockResolvedValue(0);
      prisma.cliente.findMany.mockResolvedValue([]);
      await service.list(user, { page: 1, limit: 20, sortBy: 'criadoEm', sortOrder: 'desc' });
      const callArgs = prisma.cliente.findMany.mock.calls[0][0];
      expect(callArgs.where.empresaId).toBe('emp-99');
    });
  });

  describe('rep filtering', () => {
    it('quando role=REP, restringe a representanteId = user.id', async () => {
      const user = fakeUser({ role: 'REP', id: 'rep-77' });
      prisma.cliente.count.mockResolvedValue(0);
      prisma.cliente.findMany.mockResolvedValue([]);
      await service.list(user, { page: 1, limit: 20, sortBy: 'criadoEm', sortOrder: 'desc' });
      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-77'] });
    });

    it('quando rep cria cliente sem informar representanteId, atribui a si mesmo', async () => {
      const user = fakeUser({ role: 'REP', id: 'rep-77' });
      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-77' });
      prisma.cliente.create.mockResolvedValue(fakeCliente({ representanteId: 'rep-77' }));
      await service.create(user, {
        nome: 'Padaria X',
        status: 'NOVO',
        omieStatus: 'ATIVO',
        score: 50,
        prazoPagamento: 30,
        tagIds: [],
      });
      const data = prisma.cliente.create.mock.calls[0][0].data;
      expect(data.representanteId).toBe('rep-77');
    });

    it('rep não consegue ver cliente de outro rep (findFirst com filtro retorna null)', async () => {
      const user = fakeUser({ role: 'REP', id: 'rep-77' });
      prisma.cliente.findFirst.mockResolvedValue(null);
      await expect(service.findById(user, 'cli-de-outro-rep')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('validações de negócio', () => {
    it('rejeita CNPJ duplicado dentro da mesma empresa', async () => {
      const user = fakeUser();
      prisma.cliente.findFirst.mockResolvedValue({ id: 'outro-cliente' });
      await expect(
        service.create(user, {
          nome: 'Duplicado',
          cnpj: '00.000.000/0001-00',
          status: 'NOVO',
          omieStatus: 'ATIVO',
          score: 50,
          prazoPagamento: 30,
          tagIds: [],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejeita representanteId que não é REP ativo na empresa', async () => {
      const user = fakeUser();
      prisma.usuario.findFirst.mockResolvedValue(null); // não encontrou rep válido
      await expect(
        service.create(user, {
          nome: 'X',
          representanteId: 'rep-fake',
          status: 'NOVO',
          omieStatus: 'ATIVO',
          score: 50,
          prazoPagamento: 30,
          tagIds: [],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejeita tagIds que não existem', async () => {
      const user = fakeUser();
      prisma.tag.count.mockResolvedValue(1); // pediu 2 tags, achou 1
      await expect(
        service.create(user, {
          nome: 'X',
          status: 'NOVO',
          omieStatus: 'ATIVO',
          score: 50,
          prazoPagamento: 30,
          tagIds: ['tag-1', 'tag-2'],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  describe('listas dinâmicas', () => {
    it('lista "criticos" inclui where com score < 30 OU status CRITICO', async () => {
      const user = fakeUser();
      prisma.cliente.count.mockResolvedValue(0);
      prisma.cliente.findMany.mockResolvedValue([]);
      await service.list(user, {
        page: 1,
        limit: 20,
        sortBy: 'criadoEm',
        sortOrder: 'desc',
        lista: 'criticos',
      });
      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeDefined();
      const criticosCond = where.AND.find(
        (c: { OR?: unknown[] }) => Array.isArray(c.OR) && c.OR.length === 2,
      );
      expect(criticosCond).toBeDefined();
    });

    it('lista "top10" usa orderBy por score desc e take=10', async () => {
      const user = fakeUser();
      prisma.cliente.count.mockResolvedValue(0);
      prisma.cliente.findMany.mockResolvedValue([]);
      await service.list(user, {
        page: 1,
        limit: 50,
        sortBy: 'criadoEm',
        sortOrder: 'desc',
        lista: 'top10',
      });
      const args = prisma.cliente.findMany.mock.calls[0][0];
      expect(args.take).toBe(10);
      expect(args.skip).toBe(0);
    });
  });

  describe('bulkAssignRep', () => {
    it('atribui rep a vários clientes restritos à empresa ativa (ADMIN)', async () => {
      const user = fakeUser();
      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-1' });
      prisma.cliente.updateMany.mockResolvedValue({ count: 3 });
      const result = await service.bulkAssignRep(user, {
        clienteIds: ['c1', 'c2', 'c3'],
        representanteId: 'rep-1',
      });
      expect(result).toEqual({ ok: true, afetados: 3 });
      const args = prisma.cliente.updateMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-1');
      expect(args.where.id.in).toEqual(['c1', 'c2', 'c3']);
      // ADMIN não tem scope — não restringe representanteId atual
      expect(args.where.representanteId).toBeUndefined();
    });

    it('GERENTE só consegue reatribuir clientes cujo rep atual está sob sua gerência', async () => {
      const gerente = fakeUser({ role: 'GERENTE', id: 'gerente-1' });
      const repScopeMock = makeRepScope();
      repScopeMock.getRepIds.mockResolvedValue(['rep-a', 'rep-b']);
      service = new ClientesService(prisma as never, listas, repScopeMock as never);

      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-a' });
      prisma.cliente.updateMany.mockResolvedValue({ count: 2 });

      await service.bulkAssignRep(gerente, {
        clienteIds: ['c1', 'c2', 'c3'],
        representanteId: 'rep-a',
      });
      const args = prisma.cliente.updateMany.mock.calls[0][0];
      // Restringe pelos reps sob gerência
      expect(args.where.representanteId).toEqual({ in: ['rep-a', 'rep-b'] });
    });

    it('GERENTE não pode atribuir para rep FORA da sua gerência', async () => {
      const gerente = fakeUser({ role: 'GERENTE', id: 'gerente-1' });
      const repScopeMock = makeRepScope();
      repScopeMock.getRepIds.mockResolvedValue(['rep-a', 'rep-b']);
      service = new ClientesService(prisma as never, listas, repScopeMock as never);

      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-fora' });
      await expect(
        service.bulkAssignRep(gerente, {
          clienteIds: ['c1'],
          representanteId: 'rep-fora',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falha quando user não tem empresa ativa', async () => {
      const user = fakeUser({ empresaIdAtiva: null });
      await expect(
        service.bulkAssignRep(user, { clienteIds: ['c1'], representanteId: 'rep-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update — bloqueio de transferência por REP (auditoria P0-3)', () => {
    it('REP não pode alterar representanteId do cliente', async () => {
      const rep = fakeUser({ role: 'REP', id: 'rep-77' });
      // findById retorna cliente com rep atual = rep-77
      prisma.cliente.findFirst.mockResolvedValue(fakeCliente({ representanteId: 'rep-77' }));
      await expect(
        service.update(rep, 'cli-1', { representanteId: 'rep-99' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN pode alterar representanteId livremente', async () => {
      const admin = fakeUser({ role: 'ADMIN' });
      prisma.cliente.findFirst.mockResolvedValue(fakeCliente({ representanteId: 'rep-velho' }));
      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-novo' });
      prisma.cliente.update.mockResolvedValue(fakeCliente({ representanteId: 'rep-novo' }));
      // $transaction não é chamado neste path porque não passou tagIds
      await service.update(admin, 'cli-1', { representanteId: 'rep-novo' });
      // assertRepValido roda
      expect(prisma.usuario.findFirst).toHaveBeenCalled();
    });
  });
});
