import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { SegmentosService } from './segmentos.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { RegrasDto } from './segmentos.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  segmento: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  cliente: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'admin@betinna.ai',
  nome: 'Admin Teste',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeSegmento = (overrides: Record<string, unknown> = {}) => ({
  id: 'seg-1',
  empresaId: 'emp-1',
  nome: 'VIP',
  descricao: null,
  regrasJson: { logic: 'AND', conditions: [{ campo: 'status', op: 'eq', valor: 'ATIVO' }] },
  cor: '#facc15',
  ativo: true,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-02'),
  ...overrides,
});

const upsertDto = (overrides: Record<string, unknown> = {}) => ({
  nome: 'VIP',
  descricao: undefined,
  regras: {
    logic: 'AND' as const,
    conditions: [{ campo: 'status' as const, op: 'eq' as const, valor: 'ATIVO' }],
  },
  cor: undefined,
  ativo: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SegmentosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: SegmentosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new SegmentosService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // Multi-tenant — requireEmpresa
  // -------------------------------------------------------------------------

  describe('multi-tenant (requireEmpresa)', () => {
    it('lança ForbiddenException quando não há empresa ativa (list)', async () => {
      await expect(service.list(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('não toca o banco quando empresa não definida', async () => {
      await expect(service.list(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.segmento.findMany).not.toHaveBeenCalled();
    });

    it('bloqueia getById sem empresa ativa', async () => {
      await expect(
        service.getById(fakeUser({ empresaIdAtiva: null }), 'seg-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('bloqueia upsert sem empresa ativa', async () => {
      await expect(
        service.upsert(fakeUser({ empresaIdAtiva: null }), null, upsertDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('bloqueia delete sem empresa ativa', async () => {
      await expect(
        service.delete(fakeUser({ empresaIdAtiva: null }), 'seg-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('bloqueia preview sem empresa ativa', async () => {
      await expect(
        service.preview(fakeUser({ empresaIdAtiva: null }), upsertDto().regras as RegrasDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('bloqueia listarClientes sem empresa ativa', async () => {
      await expect(
        service.listarClientes(fakeUser({ empresaIdAtiva: null }), 'seg-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('escopa pela empresa ativa e ordena por atualizadoEm desc', async () => {
      prisma.segmento.findMany.mockResolvedValue([fakeSegmento()]);

      const result = await service.list(fakeUser({ empresaIdAtiva: 'emp-7' }));

      expect(result).toEqual([fakeSegmento()]);
      const args = prisma.segmento.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ empresaId: 'emp-7' });
      expect(args.orderBy).toEqual({ atualizadoEm: 'desc' });
    });
  });

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------

  describe('getById', () => {
    it('busca por id E empresaId (defesa em profundidade)', async () => {
      prisma.segmento.findFirst.mockResolvedValue(fakeSegmento());

      await service.getById(fakeUser({ empresaIdAtiva: 'emp-2' }), 'seg-1');

      const args = prisma.segmento.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'seg-1', empresaId: 'emp-2' });
    });

    it('lança NotFoundException quando segmento não pertence à empresa', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);

      await expect(service.getById(fakeUser(), 'seg-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // upsert — create
  // -------------------------------------------------------------------------

  describe('upsert (create)', () => {
    it('cria segmento com empresaId do JWT (não do DTO)', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null); // sem conflito de nome
      prisma.segmento.create.mockResolvedValue(fakeSegmento());

      await service.upsert(fakeUser({ empresaIdAtiva: 'emp-correto' }), null, upsertDto());

      const data = prisma.segmento.create.mock.calls[0][0].data;
      expect(data.empresaId).toBe('emp-correto');
      expect(data.nome).toBe('VIP');
    });

    it('persiste as regras em regrasJson', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.create.mockResolvedValue(fakeSegmento());

      const dto = upsertDto({
        regras: {
          logic: 'OR' as const,
          conditions: [{ campo: 'uf' as const, op: 'eq' as const, valor: 'SP' }],
        },
      });
      await service.upsert(fakeUser(), null, dto);

      const data = prisma.segmento.create.mock.calls[0][0].data;
      expect(data.regrasJson).toEqual(dto.regras);
    });

    it('aplica cor default #facc15 quando não informada', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.create.mockResolvedValue(fakeSegmento());

      await service.upsert(fakeUser(), null, upsertDto({ cor: undefined }));

      const data = prisma.segmento.create.mock.calls[0][0].data;
      expect(data.cor).toBe('#facc15');
    });

    it('respeita cor customizada quando informada', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.create.mockResolvedValue(fakeSegmento());

      await service.upsert(fakeUser(), null, upsertDto({ cor: '#201554' }));

      const data = prisma.segmento.create.mock.calls[0][0].data;
      expect(data.cor).toBe('#201554');
    });

    it('normaliza descricao undefined para null', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.create.mockResolvedValue(fakeSegmento());

      await service.upsert(fakeUser(), null, upsertDto({ descricao: undefined }));

      const data = prisma.segmento.create.mock.calls[0][0].data;
      expect(data.descricao).toBeNull();
    });

    it('lança BusinessRuleException quando nome já existe na empresa', async () => {
      prisma.segmento.findFirst.mockResolvedValue({ id: 'outro' }); // conflito

      await expect(
        service.upsert(fakeUser(), null, upsertDto({ nome: 'VIP' })),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.segmento.create).not.toHaveBeenCalled();
    });

    it('checa conflito de nome escopado pela empresa (sem NOT quando criando)', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.create.mockResolvedValue(fakeSegmento());

      await service.upsert(
        fakeUser({ empresaIdAtiva: 'emp-9' }),
        null,
        upsertDto({ nome: 'Novo' }),
      );

      const where = prisma.segmento.findFirst.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-9');
      expect(where.nome).toBe('Novo');
      expect(where.NOT).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // upsert — update
  // -------------------------------------------------------------------------

  describe('upsert (update)', () => {
    it('atualiza segmento existente quando id é passado', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.update.mockResolvedValue(fakeSegmento({ nome: 'Premium' }));

      const result = await service.upsert(fakeUser(), 'seg-1', upsertDto({ nome: 'Premium' }));

      expect(result).toEqual(fakeSegmento({ nome: 'Premium' }));
      expect(prisma.segmento.update.mock.calls[0][0].where).toEqual({ id: 'seg-1' });
      expect(prisma.segmento.create).not.toHaveBeenCalled();
    });

    it('exclui o próprio id do check de conflito (NOT) ao atualizar', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);
      prisma.segmento.update.mockResolvedValue(fakeSegmento());

      await service.upsert(fakeUser(), 'seg-1', upsertDto({ nome: 'VIP' }));

      const where = prisma.segmento.findFirst.mock.calls[0][0].where;
      expect(where.NOT).toEqual({ id: 'seg-1' });
    });

    it('bloqueia rename para nome de outro segmento da mesma empresa', async () => {
      prisma.segmento.findFirst.mockResolvedValue({ id: 'seg-2' }); // outro segmento com o nome

      await expect(
        service.upsert(fakeUser(), 'seg-1', upsertDto({ nome: 'Existente' })),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.segmento.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('remove quando segmento pertence à empresa', async () => {
      prisma.segmento.findFirst.mockResolvedValue({ id: 'seg-1' });
      prisma.segmento.delete.mockResolvedValue(fakeSegmento());

      const result = await service.delete(fakeUser(), 'seg-1');

      expect(result).toEqual({ deleted: true });
      expect(prisma.segmento.delete).toHaveBeenCalledWith({ where: { id: 'seg-1' } });
    });

    it('checa pertença por id E empresaId antes de deletar', async () => {
      prisma.segmento.findFirst.mockResolvedValue({ id: 'seg-1' });
      prisma.segmento.delete.mockResolvedValue(fakeSegmento());

      await service.delete(fakeUser({ empresaIdAtiva: 'emp-5' }), 'seg-1');

      const where = prisma.segmento.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({ id: 'seg-1', empresaId: 'emp-5' });
    });

    it('lança NotFoundException e não deleta quando não pertence à empresa', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);

      await expect(service.delete(fakeUser(), 'seg-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.segmento.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // executar — montagem do where + AND/OR (via preview)
  // -------------------------------------------------------------------------

  describe('execução de regras (preview)', () => {
    beforeEach(() => {
      prisma.cliente.findMany.mockResolvedValue([]);
      prisma.cliente.count.mockResolvedValue(0);
    });

    it('sempre escopa clientes pela empresa ativa', async () => {
      const regras: RegrasDto = {
        logic: 'AND',
        conditions: [{ campo: 'status', op: 'eq', valor: 'ATIVO' }],
      };

      await service.preview(fakeUser({ empresaIdAtiva: 'emp-3' }), regras);

      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-3');
    });

    it('usa AND quando logic = AND', async () => {
      const regras: RegrasDto = {
        logic: 'AND',
        conditions: [
          { campo: 'status', op: 'eq', valor: 'ATIVO' },
          { campo: 'uf', op: 'eq', valor: 'SP' },
        ],
      };

      await service.preview(fakeUser(), regras);

      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([{ status: 'ATIVO' }, { uf: 'SP' }]);
      expect(where.OR).toBeUndefined();
    });

    it('usa OR quando logic = OR', async () => {
      const regras: RegrasDto = {
        logic: 'OR',
        conditions: [
          { campo: 'uf', op: 'eq', valor: 'SP' },
          { campo: 'uf', op: 'eq', valor: 'RJ' },
        ],
      };

      await service.preview(fakeUser(), regras);

      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ uf: 'SP' }, { uf: 'RJ' }]);
      expect(where.AND).toBeUndefined();
    });

    it('aplica o mesmo where no findMany e no count (total consistente)', async () => {
      const regras: RegrasDto = {
        logic: 'AND',
        conditions: [{ campo: 'status', op: 'eq', valor: 'ATIVO' }],
      };

      await service.preview(fakeUser(), regras);

      const whereFind = prisma.cliente.findMany.mock.calls[0][0].where;
      const whereCount = prisma.cliente.count.mock.calls[0][0].where;
      expect(whereCount).toEqual(whereFind);
    });

    it('retorna { clientes, total }', async () => {
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.cliente.count.mockResolvedValue(42);

      const regras: RegrasDto = {
        logic: 'AND',
        conditions: [{ campo: 'status', op: 'eq', valor: 'ATIVO' }],
      };
      const result = await service.preview(fakeUser(), regras);

      expect(result).toEqual({ clientes: [{ id: 'c1' }], total: 42 });
    });

    it('respeita o limit no take', async () => {
      const regras: RegrasDto = {
        logic: 'AND',
        conditions: [{ campo: 'status', op: 'eq', valor: 'ATIVO' }],
      };

      await service.preview(fakeUser(), regras, 7);

      expect(prisma.cliente.findMany.mock.calls[0][0].take).toBe(7);
    });

    it('limit default do preview é 20', async () => {
      const regras: RegrasDto = {
        logic: 'AND',
        conditions: [{ campo: 'status', op: 'eq', valor: 'ATIVO' }],
      };

      await service.preview(fakeUser(), regras);

      expect(prisma.cliente.findMany.mock.calls[0][0].take).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // toPrismaCondition — tradução de operadores (via preview)
  // -------------------------------------------------------------------------

  describe('tradução de operadores (toPrismaCondition)', () => {
    beforeEach(() => {
      prisma.cliente.findMany.mockResolvedValue([]);
      prisma.cliente.count.mockResolvedValue(0);
    });

    const runConditions = async (conditions: RegrasDto['conditions']) => {
      await service.preview(fakeUser(), { logic: 'AND', conditions });
      return prisma.cliente.findMany.mock.calls[0][0].where.AND as Record<string, unknown>[];
    };

    it('eq → igualdade direta', async () => {
      const and = await runConditions([{ campo: 'status', op: 'eq', valor: 'ATIVO' }]);
      expect(and).toEqual([{ status: 'ATIVO' }]);
    });

    it('neq → NOT', async () => {
      const and = await runConditions([{ campo: 'status', op: 'neq', valor: 'BLOQUEADO' }]);
      expect(and).toEqual([{ NOT: { status: 'BLOQUEADO' } }]);
    });

    it('gt/gte/lt/lte → operadores de comparação', async () => {
      const and = await runConditions([
        { campo: 'prazoPagamento', op: 'gt', valor: 30 },
        { campo: 'prazoPagamento', op: 'gte', valor: 30 },
        { campo: 'limiteCredito', op: 'lt', valor: 1000 },
        { campo: 'limiteCredito', op: 'lte', valor: 1000 },
      ]);
      expect(and).toEqual([
        { prazoPagamento: { gt: 30 } },
        { prazoPagamento: { gte: 30 } },
        { limiteCredito: { lt: 1000 } },
        { limiteCredito: { lte: 1000 } },
      ]);
    });

    it('in com array → { in: [...] }', async () => {
      const and = await runConditions([{ campo: 'uf', op: 'in', valor: ['SP', 'RJ'] }]);
      expect(and).toEqual([{ uf: { in: ['SP', 'RJ'] } }]);
    });

    it('in com valor não-array é descartado (condição inválida vira null)', async () => {
      const and = await runConditions([
        { campo: 'uf', op: 'in', valor: 'SP' },
        { campo: 'status', op: 'eq', valor: 'ATIVO' },
      ]);
      // a condição "in" inválida some; só a válida permanece
      expect(and).toEqual([{ status: 'ATIVO' }]);
    });

    it('contains → busca case-insensitive', async () => {
      const and = await runConditions([{ campo: 'cidade', op: 'contains', valor: 'são' }]);
      expect(and).toEqual([{ cidade: { contains: 'são', mode: 'insensitive' } }]);
    });

    it('contains com valor não-string é descartado', async () => {
      const and = await runConditions([
        { campo: 'cidade', op: 'contains', valor: 123 },
        { campo: 'status', op: 'eq', valor: 'ATIVO' },
      ]);
      expect(and).toEqual([{ status: 'ATIVO' }]);
    });
  });

  // -------------------------------------------------------------------------
  // listarClientes — segmento salvo
  // -------------------------------------------------------------------------

  describe('listarClientes', () => {
    it('lança NotFoundException quando segmento não existe na empresa', async () => {
      prisma.segmento.findFirst.mockResolvedValue(null);

      await expect(service.listarClientes(fakeUser(), 'seg-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('executa as regras salvas (regrasJson) do segmento', async () => {
      prisma.segmento.findFirst.mockResolvedValue(
        fakeSegmento({
          regrasJson: {
            logic: 'OR',
            conditions: [{ campo: 'uf', op: 'eq', valor: 'SP' }],
          },
        }),
      );
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.cliente.count.mockResolvedValue(1);

      const result = await service.listarClientes(fakeUser({ empresaIdAtiva: 'emp-4' }), 'seg-1');

      const where = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-4');
      expect(where.OR).toEqual([{ uf: 'SP' }]);
      expect(result).toEqual({ clientes: [{ id: 'c1' }], total: 1 });
    });

    it('limit default do listarClientes é 50', async () => {
      prisma.segmento.findFirst.mockResolvedValue(fakeSegmento());
      prisma.cliente.findMany.mockResolvedValue([]);
      prisma.cliente.count.mockResolvedValue(0);

      await service.listarClientes(fakeUser(), 'seg-1');

      expect(prisma.cliente.findMany.mock.calls[0][0].take).toBe(50);
    });
  });
});
