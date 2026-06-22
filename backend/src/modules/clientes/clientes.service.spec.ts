import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Cliente, ClienteOmieStatus, ClienteStatus, UserRole } from '@prisma/client';
import { ClientesService } from './clientes.service';
import { ListasDinamicasService } from './listas-dinamicas.service';
import type { CreateClienteDto } from './clientes.dto';
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
      deleteMany: vi.fn(),
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
  cep: '01310-100',
  endereco: 'Av Paulista',
  numero: '1000',
  complemento: null,
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  regiao: 'Grande SP',
  status: 'ATIVO' as ClienteStatus,
  omieStatus: 'ATIVO' as ClienteOmieStatus,
  score: 80,
  prazoPagamento: 30,
  limiteCredito: null,
  ultimoPedidoEm: null,
  reativacaoDisparadaEm: null,
  representanteId: null,
  isDemo: false,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  ...overrides,
});

// DTO de criação com todos os campos obrigatórios (endereço, contato, fiscal). Cada teste
// sobrescreve só o que exercita (nome/cnpj/representanteId/tagIds).
const baseCriarCliente: CreateClienteDto = {
  nome: 'Cliente Teste',
  cnpj: '11.222.333/0001-44',
  email: 'cliente@teste.com',
  telefone: '+5511999990000',
  segmento: 'Restaurante',
  cep: '01310-100',
  endereco: 'Av Paulista',
  numero: '1000',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  status: 'NOVO',
  omieStatus: 'ATIVO',
  prazoPagamento: 30,
  tagIds: [],
};

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
      await service.create(user, { ...baseCriarCliente, nome: 'Padaria X' });
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
          ...baseCriarCliente,
          nome: 'Duplicado',
          cnpj: '00.000.000/0001-00',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejeita representanteId que não é REP ativo na empresa', async () => {
      const user = fakeUser();
      prisma.usuario.findFirst.mockResolvedValue(null); // não encontrou rep válido
      await expect(
        service.create(user, {
          ...baseCriarCliente,
          nome: 'X',
          representanteId: 'rep-fake',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejeita tagIds que não existem', async () => {
      const user = fakeUser();
      prisma.tag.count.mockResolvedValue(1); // pediu 2 tags, achou 1
      await expect(
        service.create(user, {
          ...baseCriarCliente,
          nome: 'X',
          tagIds: ['tag-1', 'tag-2'],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  describe('listas dinâmicas', () => {
    // CL2 (Lote 7): score removido. "criticos" agora filtra só pelo Status.
    it('lista "criticos" aplica where com status CRITICO', async () => {
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
      expect(where.AND).toContainEqual({ status: 'CRITICO' });
    });

    it('lista "risco" aplica where com status RISCO', async () => {
      const user = fakeUser();
      prisma.cliente.count.mockResolvedValue(0);
      prisma.cliente.findMany.mockResolvedValue([]);
      await service.list(user, {
        page: 1,
        limit: 20,
        sortBy: 'criadoEm',
        sortOrder: 'desc',
        lista: 'risco',
      });
      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ status: 'RISCO' });
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

  // ─── CL1 (Lote 7) — ações em massa ─────────────────────────────────────
  describe('bulkSetTags', () => {
    it('adicionar: cria ClienteTag pros clientes acessíveis (skipDuplicates)', async () => {
      prisma.tag.count.mockResolvedValue(2); // 2 tags válidas
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      prisma.clienteTag.createMany.mockResolvedValue({ count: 4 });

      const result = await service.bulkSetTags(fakeUser(), {
        clienteIds: ['c1', 'c2'],
        tagIds: ['t1', 't2'],
        modo: 'adicionar',
      });

      expect(result).toEqual({ ok: true, afetados: 2 });
      const args = prisma.clienteTag.createMany.mock.calls[0][0];
      expect(args.skipDuplicates).toBe(true);
      expect(args.data).toHaveLength(4); // 2 clientes × 2 tags
    });

    it('remover: deleta ClienteTag dos clientes acessíveis', async () => {
      prisma.tag.count.mockResolvedValue(1);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.clienteTag.deleteMany.mockResolvedValue({ count: 1 });

      await service.bulkSetTags(fakeUser(), {
        clienteIds: ['c1'],
        tagIds: ['t1'],
        modo: 'remover',
      });

      const args = prisma.clienteTag.deleteMany.mock.calls[0][0];
      expect(args.where.clienteId).toEqual({ in: ['c1'] });
      expect(args.where.tagId).toEqual({ in: ['t1'] });
    });

    it('lança quando uma tag não pertence à empresa', async () => {
      prisma.tag.count.mockResolvedValue(1); // só 1 das 2 existe
      await expect(
        service.bulkSetTags(fakeUser(), {
          clienteIds: ['c1'],
          tagIds: ['t1', 't2'],
          modo: 'adicionar',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('não faz nada quando nenhum cliente é acessível ao scope', async () => {
      prisma.tag.count.mockResolvedValue(1);
      prisma.cliente.findMany.mockResolvedValue([]); // scope não retorna nada
      const result = await service.bulkSetTags(fakeUser(), {
        clienteIds: ['c1'],
        tagIds: ['t1'],
        modo: 'adicionar',
      });
      expect(result.afetados).toBe(0);
      expect(prisma.clienteTag.createMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpdateStatus', () => {
    it('atualiza status restringindo por empresa + scope', async () => {
      prisma.cliente.updateMany.mockResolvedValue({ count: 3 });
      const result = await service.bulkUpdateStatus(fakeUser(), {
        clienteIds: ['c1', 'c2', 'c3'],
        status: 'INATIVO' as ClienteStatus,
      });
      expect(result).toEqual({ ok: true, afetados: 3 });
      const args = prisma.cliente.updateMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-1');
      expect(args.where.id).toEqual({ in: ['c1', 'c2', 'c3'] });
      expect(args.data).toEqual({ status: 'INATIVO' });
    });
  });

  describe('bulkRemove', () => {
    it('exclui em best-effort e reporta falhas por cliente', async () => {
      // c1 OK; c2 tem vínculo (P2003 → BusinessRuleException no remove)
      prisma.cliente.findFirst
        .mockResolvedValueOnce(fakeCliente({ id: 'c1' }))
        .mockResolvedValueOnce(fakeCliente({ id: 'c2' }));
      prisma.cliente.findUniqueOrThrow.mockResolvedValue(fakeCliente());
      prisma.cliente.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(
          new BusinessRuleException('Cliente possui pedidos, propostas ou outros vínculos.'),
        );

      const result = await service.bulkRemove(fakeUser(), { clienteIds: ['c1', 'c2'] });

      expect(result.excluidos).toBe(1);
      expect(result.falhas).toHaveLength(1);
      expect(result.falhas[0].id).toBe('c2');
    });

    it('cliente fora do escopo entra como falha (NotFound), não exclui', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null); // findById → NotFound
      const result = await service.bulkRemove(fakeUser(), { clienteIds: ['c-alheio'] });
      expect(result.excluidos).toBe(0);
      expect(result.falhas).toHaveLength(1);
      expect(prisma.cliente.deleteMany).not.toHaveBeenCalled();
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
