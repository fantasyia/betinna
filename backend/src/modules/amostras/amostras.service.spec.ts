import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AmostrasService } from './amostras.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  amostra: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  } satisfies MockModel,
  cliente: {
    findFirst: vi.fn(),
  } satisfies MockModel,
});

/** Replica a regra real de RepScopeService. */
const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a', 'rep-b']; // gerente vê esses reps
    return null; // ADMIN/DIRECTOR/SAC: sem restrição
  }),
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

const fakeAmostra = (overrides: Record<string, unknown> = {}) => ({
  id: 'am-1',
  empresaId: 'emp-1',
  clienteId: 'cli-1',
  produtoNome: 'Óleo 5L',
  valor: 100,
  notaFiscal: null,
  enviadoEm: new Date('2026-04-01'),
  followUpEm: new Date('2026-04-08'),
  status: 'ENVIADA',
  representanteNome: null,
  criadoEm: new Date('2026-04-01'),
  atualizadoEm: new Date('2026-04-01'),
  cliente: { id: 'cli-1', nome: 'Restaurante X', cnpj: null },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AmostrasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScope>;
  let service: AmostrasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScope();
    service = new AmostrasService(prisma as never, repScope as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = { page: 1, limit: 20, sortBy: 'criadoEm', sortOrder: 'desc' as const };

    it('lança ForbiddenException quando empresaIdAtiva está ausente', async () => {
      const user = fakeUser({ empresaIdAtiva: null });
      await expect(service.list(user, baseParams)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por empresaId do usuário autenticado', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ empresaIdAtiva: 'emp-99' }), baseParams);

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-99');
    });

    it('REP tem scope restrito ao próprio representanteId', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'REP', id: 'rep-77' }), baseParams);

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      expect(where.cliente.representanteId).toEqual({ in: ['rep-77'] });
    });

    it('GERENTE vê amostras dos REPs sob sua gerência', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'GERENTE', id: 'ger-1' }), baseParams);

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      expect(where.cliente.representanteId).toEqual({ in: ['rep-a', 'rep-b'] });
    });

    it('ADMIN não tem filtro de cliente/rep (scope=null)', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), baseParams);

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      expect(where.cliente).toBeUndefined();
    });

    it('filtra por status quando passado', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, status: 'CONVERTIDA' });

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ status: 'CONVERTIDA' }]));
    });

    it('filtra por clienteId quando passado', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, clienteId: 'cli-42' });

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ clienteId: 'cli-42' }]));
    });

    it('filtra amostras vencidas (followUpEm <= now + status ativo)', async () => {
      prisma.amostra.count.mockResolvedValue(0);
      prisma.amostra.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, vencidas: true });

      const where = prisma.amostra.findMany.mock.calls[0][0].where;
      const vencidasCond = (where.AND as Array<Record<string, unknown>>)?.find(
        (c) => 'followUpEm' in c,
      );
      expect(vencidasCond).toBeDefined();
      expect((vencidasCond as { status: unknown }).status).toEqual({
        in: ['ENVIADA', 'AGUARDANDO_FOLLOWUP'],
      });
    });

    it('retorna paginação correta', async () => {
      prisma.amostra.count.mockResolvedValue(55);
      prisma.amostra.findMany.mockResolvedValue([]);

      const result = await service.list(fakeUser(), { ...baseParams, page: 3, limit: 10 });

      expect(result.pagination.total).toBe(55);
      expect(result.pagination.page).toBe(3);
      const args = prisma.amostra.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna amostra quando encontrada', async () => {
      const am = fakeAmostra();
      prisma.amostra.findFirst.mockResolvedValue(am);

      const result = await service.findById(fakeUser(), 'am-1');

      expect(result).toEqual(am);
    });

    it('lança NotFoundException quando amostra não existe', async () => {
      prisma.amostra.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('inclui empresaId no where (tenant isolation)', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra());

      await service.findById(fakeUser({ empresaIdAtiva: 'emp-2' }), 'am-1');

      const args = prisma.amostra.findFirst.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-2');
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    const baseDto = {
      clienteId: 'cli-1',
      produtoNome: 'Óleo 5L',
      valor: 100,
      diasFollowUp: 7,
    };

    it('cria amostra com status ENVIADA', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: null });
      prisma.amostra.create.mockResolvedValue(fakeAmostra());

      await service.create(fakeUser(), baseDto);

      const data = prisma.amostra.create.mock.calls[0][0].data;
      expect(data.status).toBe('ENVIADA');
    });

    it('calcula followUpEm = enviadoEm + diasFollowUp * 24h', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: null });
      prisma.amostra.create.mockResolvedValue(fakeAmostra());

      const enviadoEm = new Date('2026-04-01T00:00:00.000Z');
      await service.create(fakeUser(), { ...baseDto, diasFollowUp: 7, enviadoEm });

      const data = prisma.amostra.create.mock.calls[0][0].data;
      const expectedFollowUp = new Date('2026-04-08T00:00:00.000Z');
      expect(data.followUpEm.getTime()).toBe(expectedFollowUp.getTime());
    });

    it('usa data atual quando enviadoEm não é informado', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: null });
      prisma.amostra.create.mockResolvedValue(fakeAmostra());

      const before = Date.now();
      await service.create(fakeUser(), baseDto);
      const after = Date.now();

      const data = prisma.amostra.create.mock.calls[0][0].data;
      const sentAt = data.enviadoEm.getTime();
      expect(sentAt).toBeGreaterThanOrEqual(before);
      expect(sentAt).toBeLessThanOrEqual(after);
    });

    it('REP recebe nome automaticamente em representanteNome', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: 'rep-77' });
      prisma.amostra.create.mockResolvedValue(fakeAmostra());

      await service.create(fakeUser({ role: 'REP', id: 'rep-77', nome: 'João Rep' }), baseDto);

      const data = prisma.amostra.create.mock.calls[0][0].data;
      expect(data.representanteNome).toBe('João Rep');
    });

    it('lança NotFoundException quando cliente não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null);

      await expect(service.create(fakeUser(), baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.amostra.create).not.toHaveBeenCalled();
    });

    it('REP lança ForbiddenException para cliente fora da carteira', async () => {
      // Cliente pertence a outro rep
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: 'rep-outro' });

      await expect(
        service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.amostra.create).not.toHaveBeenCalled();
    });

    it('REP lança ForbiddenException para cliente sem representante', async () => {
      // representanteId=null significa que o cliente não está atribuído a nenhum rep
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: null });

      await expect(
        service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN pode criar amostra para qualquer cliente (scope=null)', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: 'rep-qualquer' });
      prisma.amostra.create.mockResolvedValue(fakeAmostra());

      await expect(service.create(fakeUser({ role: 'ADMIN' }), baseDto)).resolves.toBeDefined();
    });

    it('lança ForbiddenException quando empresaIdAtiva está ausente', async () => {
      await expect(
        service.create(fakeUser({ empresaIdAtiva: null }), baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza amostra e retorna versão nova', async () => {
      const am = fakeAmostra();
      const updated = fakeAmostra({ produtoNome: 'Óleo Premium' });
      prisma.amostra.findFirst.mockResolvedValue(am);
      prisma.amostra.updateMany.mockResolvedValue({ count: 1 });
      prisma.amostra.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.update(fakeUser(), 'am-1', { produtoNome: 'Óleo Premium' });

      expect(result.produtoNome).toBe('Óleo Premium');
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const am = fakeAmostra({ empresaId: 'emp-1' });
      prisma.amostra.findFirst.mockResolvedValue(am);
      prisma.amostra.updateMany.mockResolvedValue({ count: 1 });
      prisma.amostra.findUniqueOrThrow.mockResolvedValue(am);

      await service.update(fakeUser(), 'am-1', { valor: 200 });

      const updateArgs = prisma.amostra.updateMany.mock.calls[0][0];
      expect(updateArgs.where.id).toBe('am-1');
      expect(updateArgs.where.empresaId).toBe('emp-1');
    });

    it('lança NotFoundException quando amostra não existe', async () => {
      prisma.amostra.findFirst.mockResolvedValue(null);

      await expect(service.update(fakeUser(), 'nao-existe', { valor: 200 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.amostra.updateMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // changeStatus
  // -------------------------------------------------------------------------

  describe('changeStatus', () => {
    it('muda status da amostra (ENVIADA → CONVERTIDA)', async () => {
      const am = fakeAmostra({ status: 'ENVIADA' });
      const converted = fakeAmostra({ status: 'CONVERTIDA' });
      prisma.amostra.findFirst.mockResolvedValue(am);
      prisma.amostra.updateMany.mockResolvedValue({ count: 1 });
      prisma.amostra.findUniqueOrThrow.mockResolvedValue(converted);

      const result = await service.changeStatus(fakeUser(), 'am-1', {
        status: 'CONVERTIDA',
      });

      expect(result.status).toBe('CONVERTIDA');
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const am = fakeAmostra({ empresaId: 'emp-1' });
      prisma.amostra.findFirst.mockResolvedValue(am);
      prisma.amostra.updateMany.mockResolvedValue({ count: 1 });
      prisma.amostra.findUniqueOrThrow.mockResolvedValue(am);

      await service.changeStatus(fakeUser(), 'am-1', { status: 'NAO_CONVERTEU' });

      const args = prisma.amostra.updateMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-1');
      expect(args.data.status).toBe('NAO_CONVERTEU');
    });

    it('lança NotFoundException quando amostra não existe', async () => {
      prisma.amostra.findFirst.mockResolvedValue(null);

      await expect(
        service.changeStatus(fakeUser(), 'nao-existe', { status: 'CONVERTIDA' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('REP não consegue mudar status de amostra de outro rep', async () => {
      // findFirst retorna null (não encontrou no scope do REP)
      prisma.amostra.findFirst.mockResolvedValue(null);

      await expect(
        service.changeStatus(fakeUser({ role: 'REP', id: 'rep-77' }), 'am-de-outro', {
          status: 'CONVERTIDA',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('remove amostra quando existe na empresa', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra({ empresaId: 'emp-1' }));
      prisma.amostra.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.remove(fakeUser(), 'am-1')).resolves.toBeUndefined();
    });

    it('usa deleteMany com id E empresaId (proteção TOCTOU)', async () => {
      prisma.amostra.findFirst.mockResolvedValue(fakeAmostra({ empresaId: 'emp-1' }));
      prisma.amostra.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(fakeUser(), 'am-1');

      const args = prisma.amostra.deleteMany.mock.calls[0][0];
      expect(args.where.id).toBe('am-1');
      expect(args.where.empresaId).toBe('emp-1');
    });

    it('lança NotFoundException quando amostra não existe', async () => {
      prisma.amostra.findFirst.mockResolvedValue(null);

      await expect(service.remove(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.amostra.deleteMany).not.toHaveBeenCalled();
    });
  });
});
