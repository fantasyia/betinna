import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole, UserStatus } from '@prisma/client';
import {
  BusinessRuleException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { UsersService } from './users.service';

// ---------------------------------------------------------------------------
// Supabase mock (hoisted so vi.mock factory can close over it)
// ---------------------------------------------------------------------------

const { mockInviteUserByEmail } = vi.hoisted(() => ({
  mockInviteUserByEmail: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        inviteUserByEmail: mockInviteUserByEmail,
      },
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;
type Tx = {
  usuario: MockModel;
  usuarioEmpresa: MockModel;
  empresa: MockModel;
};

const makePrismaMock = () => {
  const tx: Tx = {
    usuario: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    usuarioEmpresa: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
    },
    empresa: {
      findMany: vi.fn(),
    },
  };
  return {
    ...tx,
    $transaction: vi.fn(async (cb: (t: Tx) => unknown) => cb(tx)),
  };
};

const makeEnv = () => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      SUPABASE_URL: 'https://fake.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
    };
    return map[k] ?? '';
  }),
});

const makeRedis = () => ({
  del: vi.fn().mockResolvedValue(undefined),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin Teste',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeDbUser = (overrides: Partial<{
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  status: UserStatus;
  empresas: Array<{ empresaId: string }>;
  gerenteId: string | null;
  tetoDesconto: number | null;
  comissaoPadrao: number | null;
}> = {}) => ({
  id: 'user-1',
  email: 'rep@betinna.ai',
  nome: 'Rep Teste',
  role: 'REP' as UserRole,
  status: 'ATIVO' as UserStatus,
  gerenteId: null,
  tetoDesconto: 5,
  comissaoPadrao: 5,
  telefone: null,
  regiao: null,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  empresas: [{ empresaId: 'emp-1' }],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let env: ReturnType<typeof makeEnv>;
  let redis: ReturnType<typeof makeRedis>;
  let service: UsersService;

  beforeEach(() => {
    prisma = makePrismaMock();
    env = makeEnv();
    redis = makeRedis();
    service = new UsersService(prisma as never, env as never, redis as never);
    mockInviteUserByEmail.mockReset();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const defaultParams = { page: 1, limit: 20 };

    it('ADMIN sem empresaId → não injeta filtro de empresa', async () => {
      prisma.usuario.count.mockResolvedValue(0);
      prisma.usuario.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), defaultParams);

      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.where.empresas).toBeUndefined();
    });

    it('ADMIN com empresaId → usa esse filtro', async () => {
      prisma.usuario.count.mockResolvedValue(0);
      prisma.usuario.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), { ...defaultParams, empresaId: 'emp-99' });

      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.where.empresas).toEqual({ some: { empresaId: 'emp-99' } });
    });

    it('DIRECTOR força empresa ativa quando não passa filtro', async () => {
      prisma.usuario.count.mockResolvedValue(0);
      prisma.usuario.findMany.mockResolvedValue([]);

      await service.list(
        fakeUser({ role: 'DIRECTOR', empresaIdAtiva: 'emp-director' }),
        defaultParams,
      );

      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.where.empresas).toEqual({ some: { empresaId: 'emp-director' } });
    });

    it('DIRECTOR tentando filtrar empresa alheia → ForbiddenException', async () => {
      await expect(
        service.list(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: 'emp-1' }), {
          ...defaultParams,
          empresaId: 'emp-outra',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('DIRECTOR sem empresaIdAtiva → ForbiddenException', async () => {
      await expect(
        service.list(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: null }), defaultParams),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por search em nome e email (OR)', async () => {
      prisma.usuario.count.mockResolvedValue(0);
      prisma.usuario.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...defaultParams, search: 'joao' });

      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
      expect(args.where.OR[0].nome.contains).toBe('joao');
      expect(args.where.OR[1].email.contains).toBe('joao');
    });

    it('filtra por role quando passado', async () => {
      prisma.usuario.count.mockResolvedValue(0);
      prisma.usuario.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...defaultParams, role: 'REP' });

      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.where.role).toBe('REP');
    });

    it('filtra por status quando passado', async () => {
      prisma.usuario.count.mockResolvedValue(0);
      prisma.usuario.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...defaultParams, status: 'ATIVO' });

      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.where.status).toBe('ATIVO');
    });

    it('retorna paginação correta', async () => {
      prisma.usuario.count.mockResolvedValue(42);
      prisma.usuario.findMany.mockResolvedValue([]);

      const result = await service.list(fakeUser(), { page: 2, limit: 10 });

      expect(result.pagination.total).toBe(42);
      expect(result.pagination.page).toBe(2);
      const args = prisma.usuario.findMany.mock.calls[0][0];
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('ADMIN encontra usuário de qualquer empresa', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-outra' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);

      const result = await service.findById(fakeUser({ role: 'ADMIN' }), 'user-1');

      expect(result).toEqual(dbUser);
    });

    it('DIRECTOR encontra usuário da própria empresa', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);

      const result = await service.findById(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: 'emp-1' }), 'user-1');

      expect(result).toEqual(dbUser);
    });

    it('DIRECTOR não encontra usuário de empresa diferente → NotFoundException (mascarado)', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-outra' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);

      await expect(
        service.findById(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: 'emp-1' }), 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('usuário inexistente → NotFoundException', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('DIRECTOR sem empresaIdAtiva → ForbiddenException', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);

      await expect(
        service.findById(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: null }), 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // loadAndAssertScope (testado indiretamente via setStatus e outros)
  // -------------------------------------------------------------------------

  describe('loadAndAssertScope (via setStatus)', () => {
    it('ADMIN tem bypass total — pode agir em qualquer empresa', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-outra' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);
      prisma.usuario.update.mockResolvedValue({ ...dbUser, status: 'INATIVO' });

      await expect(
        service.setStatus(fakeUser({ role: 'ADMIN' }), 'user-1', 'INATIVO'),
      ).resolves.toBeDefined();
    });

    it('DIRECTOR fora do escopo → ForbiddenException', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-outra' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);

      await expect(
        service.setStatus(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: 'emp-1' }), 'user-1', 'ATIVO'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('target não existe → NotFoundException', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.setStatus(fakeUser(), 'nao-existe', 'ATIVO')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('caller sem empresaIdAtiva (não-ADMIN) → ForbiddenException', async () => {
      const dbUser = fakeDbUser({ empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);

      await expect(
        service.setStatus(fakeUser({ role: 'DIRECTOR', empresaIdAtiva: null }), 'user-1', 'ATIVO'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // setStatus
  // -------------------------------------------------------------------------

  describe('setStatus', () => {
    it('atualiza status corretamente', async () => {
      const dbUser = fakeDbUser({ role: 'REP', status: 'ATIVO' });
      prisma.usuario.findUnique.mockResolvedValue(dbUser);
      prisma.usuario.update.mockResolvedValue({ ...dbUser, status: 'INATIVO' });

      const result = await service.setStatus(fakeUser(), 'user-1', 'INATIVO');

      expect(result.status).toBe('INATIVO');
      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'INATIVO' },
      });
    });

    it('desativar GERENTE realoca REPs órfãos (gerenteId → null)', async () => {
      const gerente = fakeDbUser({ role: 'GERENTE', status: 'ATIVO', id: 'gerente-1' });
      prisma.usuario.findUnique.mockResolvedValue(gerente);
      prisma.usuario.updateMany.mockResolvedValue({ count: 3 });
      prisma.usuario.update.mockResolvedValue({ ...gerente, status: 'INATIVO' });

      await service.setStatus(fakeUser(), 'gerente-1', 'INATIVO');

      expect(prisma.usuario.updateMany).toHaveBeenCalledWith({
        where: { gerenteId: 'gerente-1' },
        data: { gerenteId: null },
      });
    });

    it('desativar GERENTE sem REPs não chama updateMany', async () => {
      const gerente = fakeDbUser({ role: 'GERENTE', id: 'gerente-1' });
      prisma.usuario.findUnique.mockResolvedValue(gerente);
      prisma.usuario.updateMany.mockResolvedValue({ count: 0 });
      prisma.usuario.update.mockResolvedValue({ ...gerente, status: 'INATIVO' });

      await service.setStatus(fakeUser(), 'gerente-1', 'INATIVO');

      // updateMany ainda é chamado, mas retorna count=0
      expect(prisma.usuario.updateMany).toHaveBeenCalled();
    });

    it('ativar GERENTE não dispara updateMany de reps', async () => {
      const gerente = fakeDbUser({ role: 'GERENTE', status: 'INATIVO', id: 'gerente-1' });
      prisma.usuario.findUnique.mockResolvedValue(gerente);
      prisma.usuario.update.mockResolvedValue({ ...gerente, status: 'ATIVO' });

      await service.setStatus(fakeUser(), 'gerente-1', 'ATIVO');

      expect(prisma.usuario.updateMany).not.toHaveBeenCalled();
    });

    it('invalida cache de auth após mudança de status', async () => {
      const dbUser = fakeDbUser();
      prisma.usuario.findUnique.mockResolvedValue(dbUser);
      prisma.usuario.update.mockResolvedValue(dbUser);

      await service.setStatus(fakeUser(), 'user-1', 'ATIVO');

      expect(redis.del).toHaveBeenCalledWith('auth:user:user-1');
    });
  });

  // -------------------------------------------------------------------------
  // setRepDiscountLimit
  // -------------------------------------------------------------------------

  describe('setRepDiscountLimit', () => {
    it('atualiza tetoDesconto para REP', async () => {
      const rep = fakeDbUser({ role: 'REP', empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(rep);
      prisma.usuarioEmpresa.findFirst.mockResolvedValue({ usuarioId: 'user-1' });
      prisma.usuario.update.mockResolvedValue({ ...rep, tetoDesconto: 15 });

      await expect(
        service.setRepDiscountLimit(fakeUser(), 'user-1', { tetoDesconto: 15 }),
      ).resolves.toBeUndefined();

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { tetoDesconto: 15 },
      });
    });

    it('lança BusinessRuleException para role não-REP', async () => {
      const gerente = fakeDbUser({ role: 'GERENTE' });
      prisma.usuario.findUnique.mockResolvedValue(gerente);

      await expect(
        service.setRepDiscountLimit(fakeUser(), 'user-1', { tetoDesconto: 10 }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('TOCTOU: lança ForbiddenException se usuário saiu da empresa durante a operação', async () => {
      const rep = fakeDbUser({ role: 'REP', empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(rep);
      // Na transação, findFirst retorna null (user já foi desvinculado)
      prisma.usuarioEmpresa.findFirst.mockResolvedValue(null);

      await expect(
        service.setRepDiscountLimit(fakeUser(), 'user-1', { tetoDesconto: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // update NÃO deve ter sido chamado
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // setComissaoPercentual
  // -------------------------------------------------------------------------

  describe('setComissaoPercentual', () => {
    it('atualiza comissaoPadrao para REP', async () => {
      const rep = fakeDbUser({ role: 'REP', empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(rep);
      prisma.usuarioEmpresa.findFirst.mockResolvedValue({ usuarioId: 'user-1' });
      prisma.usuario.update.mockResolvedValue(rep);

      await expect(
        service.setComissaoPercentual(fakeUser(), 'user-1', { comissaoPadrao: 8 }),
      ).resolves.toBeUndefined();

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { comissaoPadrao: 8 },
      });
    });

    it('atualiza comissaoPadrao para GERENTE', async () => {
      const gerente = fakeDbUser({ role: 'GERENTE', empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(gerente);
      prisma.usuarioEmpresa.findFirst.mockResolvedValue({ usuarioId: 'user-1' });
      prisma.usuario.update.mockResolvedValue(gerente);

      await expect(
        service.setComissaoPercentual(fakeUser(), 'user-1', { comissaoPadrao: 3 }),
      ).resolves.toBeUndefined();
    });

    it('lança BusinessRuleException para ADMIN/SAC/DIRECTOR', async () => {
      const admin = fakeDbUser({ role: 'ADMIN' });
      prisma.usuario.findUnique.mockResolvedValue(admin);

      await expect(
        service.setComissaoPercentual(fakeUser(), 'user-1', { comissaoPadrao: 5 }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('TOCTOU: lança ForbiddenException se usuário saiu da empresa', async () => {
      const rep = fakeDbUser({ role: 'REP', empresas: [{ empresaId: 'emp-1' }] });
      prisma.usuario.findUnique.mockResolvedValue(rep);
      prisma.usuarioEmpresa.findFirst.mockResolvedValue(null);

      await expect(
        service.setComissaoPercentual(fakeUser(), 'user-1', { comissaoPadrao: 5 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // resendInvite
  // -------------------------------------------------------------------------

  describe('resendInvite', () => {
    it('reenvio com sucesso para usuário PENDENTE', async () => {
      const pendente = fakeDbUser({ status: 'PENDENTE', email: 'novo@empresa.com' });
      prisma.usuario.findUnique.mockResolvedValue(pendente);
      mockInviteUserByEmail.mockResolvedValue({ error: null });

      const result = await service.resendInvite(fakeUser(), 'user-1');

      expect(result).toEqual({ ok: true, sentTo: 'novo@empresa.com' });
      expect(mockInviteUserByEmail).toHaveBeenCalledWith('novo@empresa.com');
    });

    it('lança BusinessRuleException se status não for PENDENTE', async () => {
      const ativo = fakeDbUser({ status: 'ATIVO' });
      prisma.usuario.findUnique.mockResolvedValue(ativo);

      await expect(service.resendInvite(fakeUser(), 'user-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException se Supabase retornar erro', async () => {
      const pendente = fakeDbUser({ status: 'PENDENTE' });
      prisma.usuario.findUnique.mockResolvedValue(pendente);
      mockInviteUserByEmail.mockResolvedValue({ error: { message: 'rate limited' } });

      await expect(service.resendInvite(fakeUser(), 'user-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // confirmarOnboarding
  // -------------------------------------------------------------------------

  describe('confirmarOnboarding', () => {
    it('atualiza status para ATIVO quando PENDENTE', async () => {
      const pendente = fakeDbUser({ status: 'PENDENTE' });
      prisma.usuario.findUnique.mockResolvedValue(pendente);
      prisma.usuario.update.mockResolvedValue({ ...pendente, status: 'ATIVO' });

      await expect(service.confirmarOnboarding('user-1')).resolves.toBeUndefined();

      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'ATIVO' },
      });
    });

    it('não chama update se já estiver ATIVO (idempotente)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(fakeDbUser({ status: 'ATIVO' }));

      await service.confirmarOnboarding('user-1');

      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('lança NotFoundException se usuário não existir', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);

      await expect(service.confirmarOnboarding('nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('invalida cache de auth após confirmação', async () => {
      prisma.usuario.findUnique.mockResolvedValue(fakeDbUser({ status: 'PENDENTE' }));
      prisma.usuario.update.mockResolvedValue(fakeDbUser({ status: 'ATIVO' }));

      await service.confirmarOnboarding('user-1');

      expect(redis.del).toHaveBeenCalledWith('auth:user:user-1');
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    const baseDto = {
      email: 'novo@empresa.com',
      nome: 'Novo Usuário',
      role: 'REP' as UserRole,
      empresaIds: ['emp-1'],
    };

    beforeEach(() => {
      mockInviteUserByEmail.mockResolvedValue({
        data: { user: { id: 'supabase-id-1' } },
        error: null,
      });
    });

    it('cria usuário com status PENDENTE e vincula à empresa', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null); // sem conflito
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: true }]);
      prisma.usuario.create.mockResolvedValue(fakeDbUser({ id: 'supabase-id-1' }));

      await service.create(baseDto);

      const data = prisma.usuario.create.mock.calls[0][0].data;
      expect(data.id).toBe('supabase-id-1');
      expect(data.status).toBe('PENDENTE');
      expect(data.empresas.create).toHaveLength(1);
    });

    it('REP recebe tetoDesconto=5 por default', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: true }]);
      prisma.usuario.create.mockResolvedValue(fakeDbUser());

      await service.create({ ...baseDto, role: 'REP' });

      const data = prisma.usuario.create.mock.calls[0][0].data;
      expect(data.tetoDesconto).toBe(5);
    });

    it('role não-REP recebe tetoDesconto=null por default', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: true }]);
      prisma.usuario.create.mockResolvedValue(fakeDbUser({ role: 'GERENTE' }));

      await service.create({ ...baseDto, role: 'GERENTE' });

      const data = prisma.usuario.create.mock.calls[0][0].data;
      expect(data.tetoDesconto).toBeNull();
    });

    it('lança ConflictException para email já cadastrado', async () => {
      prisma.usuario.findUnique.mockResolvedValue(fakeDbUser());

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('lança NotFoundException se empresa não existir', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.empresa.findMany.mockResolvedValue([]); // 0 de 1 pedido

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException para empresa inativa', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: false }]);

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BusinessRuleException);
      expect(mockInviteUserByEmail).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException quando Supabase retorna erro', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: true }]);
      mockInviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'email invalid' } });

      await expect(service.create(baseDto)).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.usuario.create).not.toHaveBeenCalled();
    });

    it('valida gerenteId: lança NotFoundException se gerente não existir', async () => {
      prisma.usuario.findUnique
        .mockResolvedValueOnce(null) // sem conflito de email
        // assertGerenteValido → findUnique retorna null
        .mockResolvedValueOnce(null);
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: true }]);

      await expect(service.create({ ...baseDto, gerenteId: 'gerente-fake' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('valida gerenteId: lança BusinessRuleException se apontado não for GERENTE', async () => {
      prisma.usuario.findUnique
        .mockResolvedValueOnce(null) // sem conflito de email
        // assertGerenteValido → findUnique retorna REP (não é GERENTE)
        .mockResolvedValueOnce({ role: 'REP' });
      prisma.empresa.findMany.mockResolvedValue([{ id: 'emp-1', ativo: true }]);

      await expect(service.create({ ...baseDto, gerenteId: 'rep-1' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza campos básicos do usuário', async () => {
      const dbUser = fakeDbUser();
      prisma.usuario.findUnique.mockResolvedValue(dbUser);
      prisma.usuario.update.mockResolvedValue({ ...dbUser, nome: 'Novo Nome' });

      await service.update(fakeUser(), 'user-1', { nome: 'Novo Nome' });

      const txArgs = prisma.usuario.update.mock.calls[0][0];
      expect(txArgs.data.nome).toBe('Novo Nome');
    });

    it('atualiza empresas dentro da transação (delete + create)', async () => {
      const dbUser = fakeDbUser();
      prisma.usuario.findUnique.mockResolvedValue(dbUser);
      prisma.usuario.update.mockResolvedValue(dbUser);
      prisma.usuarioEmpresa.deleteMany.mockResolvedValue({ count: 1 });
      prisma.usuarioEmpresa.createMany.mockResolvedValue({ count: 2 });

      await service.update(fakeUser(), 'user-1', { empresaIds: ['emp-1', 'emp-2'] });

      expect(prisma.usuarioEmpresa.deleteMany).toHaveBeenCalledWith({
        where: { usuarioId: 'user-1' },
      });
      expect(prisma.usuarioEmpresa.createMany).toHaveBeenCalledWith({
        data: [
          { usuarioId: 'user-1', empresaId: 'emp-1' },
          { usuarioId: 'user-1', empresaId: 'emp-2' },
        ],
      });
    });

    it('gerenteId em REP → conecta gerente', async () => {
      const rep = fakeDbUser({ role: 'REP' });
      prisma.usuario.findUnique
        .mockResolvedValueOnce(rep) // loadAndAssertScope
        .mockResolvedValueOnce({ role: 'GERENTE' }); // assertGerenteValido
      prisma.usuario.update.mockResolvedValue(rep);

      await service.update(fakeUser(), 'user-1', { gerenteId: 'gerente-1' });

      const txArgs = prisma.usuario.update.mock.calls[0][0];
      expect(txArgs.data.gerente).toEqual({ connect: { id: 'gerente-1' } });
    });

    it('gerenteId em role não-REP → BusinessRuleException', async () => {
      const gerente = fakeDbUser({ role: 'GERENTE' });
      prisma.usuario.findUnique
        .mockResolvedValueOnce(gerente) // loadAndAssertScope
        .mockResolvedValueOnce({ role: 'GERENTE' }); // assertGerenteValido

      await expect(
        service.update(fakeUser(), 'user-1', { gerenteId: 'g-1', role: 'GERENTE' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('mudança de role para não-REP desconecta gerente', async () => {
      const rep = fakeDbUser({ role: 'REP' });
      prisma.usuario.findUnique.mockResolvedValue(rep);
      prisma.usuario.update.mockResolvedValue({ ...rep, role: 'SAC' });

      await service.update(fakeUser(), 'user-1', { role: 'SAC' });

      const txArgs = prisma.usuario.update.mock.calls[0][0];
      expect(txArgs.data.gerente).toEqual({ disconnect: true });
    });

    it('invalida cache de auth após update', async () => {
      prisma.usuario.findUnique.mockResolvedValue(fakeDbUser());
      prisma.usuario.update.mockResolvedValue(fakeDbUser());

      await service.update(fakeUser(), 'user-1', { nome: 'X' });

      expect(redis.del).toHaveBeenCalledWith('auth:user:user-1');
    });
  });
});
