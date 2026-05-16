import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SequenceService } from './sequence.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRedisMock = () => ({
  incr: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
});

const makePrismaMock = () => ({
  empresaSequence: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SequenceService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: SequenceService;

  beforeEach(() => {
    redis = makeRedisMock();
    prisma = makePrismaMock();
    service = new SequenceService(redis as never, prisma as never);
  });

  // -------------------------------------------------------------------------
  // next
  // -------------------------------------------------------------------------

  describe('next', () => {
    it('incrementa Redis e retorna o novo valor', async () => {
      redis.incr.mockResolvedValue(42);
      prisma.empresaSequence.upsert.mockResolvedValue({});

      const result = await service.next('emp-1', 'pedido');

      expect(result).toBe(42);
      expect(redis.incr).toHaveBeenCalledWith('seq:emp-1:pedido');
    });

    it('persiste no banco de forma best-effort (não bloqueia o retorno)', async () => {
      redis.incr.mockResolvedValue(5);
      prisma.empresaSequence.upsert.mockResolvedValue({});

      await service.next('emp-1', 'proposta');

      // Upsert pode ter sido chamado (best-effort, não aguardamos)
      // O teste apenas verifica que não lança e retorna o valor
      expect(redis.incr).toHaveBeenCalledOnce();
    });

    it('gera chave Redis com formato seq:{empresaId}:{tipo}', async () => {
      redis.incr.mockResolvedValue(1);
      prisma.empresaSequence.upsert.mockResolvedValue({});

      await service.next('emp-abc', 'ocorrencia');

      expect(redis.incr).toHaveBeenCalledWith('seq:emp-abc:ocorrencia');
    });

    it('não lança quando DB upsert falha (best-effort)', async () => {
      redis.incr.mockResolvedValue(10);
      prisma.empresaSequence.upsert.mockRejectedValue(new Error('DB timeout'));

      // Não deve lançar — best-effort
      await expect(service.next('emp-1', 'pedido')).resolves.toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // peek
  // -------------------------------------------------------------------------

  describe('peek', () => {
    it('retorna valor do Redis quando disponível', async () => {
      redis.get.mockResolvedValue('15');

      const result = await service.peek('emp-1', 'pedido');

      expect(result).toBe(15);
      expect(prisma.empresaSequence.findUnique).not.toHaveBeenCalled();
    });

    it('cai pro banco quando Redis não tem o valor', async () => {
      redis.get.mockResolvedValue(null);
      prisma.empresaSequence.findUnique.mockResolvedValue({ ultimo: 7 });

      const result = await service.peek('emp-1', 'pedido');

      expect(result).toBe(7);
    });

    it('retorna 0 quando nem Redis nem banco têm valor', async () => {
      redis.get.mockResolvedValue(null);
      prisma.empresaSequence.findUnique.mockResolvedValue(null);

      const result = await service.peek('emp-1', 'pedido');

      expect(result).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // seedFromDb
  // -------------------------------------------------------------------------

  describe('seedFromDb', () => {
    it('popula Redis com valores do banco', async () => {
      prisma.empresaSequence.findMany.mockResolvedValue([
        { empresaId: 'emp-1', tipo: 'pedido', ultimo: 50 },
        { empresaId: 'emp-1', tipo: 'proposta', ultimo: 10 },
      ]);
      redis.get.mockResolvedValue(null); // Redis vazio

      await service.seedFromDb();

      expect(redis.set).toHaveBeenCalledWith('seq:emp-1:pedido', 50);
      expect(redis.set).toHaveBeenCalledWith('seq:emp-1:proposta', 10);
    });

    it('não decrementea Redis se DB < Redis atual', async () => {
      prisma.empresaSequence.findMany.mockResolvedValue([
        { empresaId: 'emp-1', tipo: 'pedido', ultimo: 5 }, // DB tem 5
      ]);
      redis.get.mockResolvedValue('20'); // Redis já tem 20

      await service.seedFromDb();

      // NÃO deve atualizar Redis porque DB (5) < Redis (20)
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('atualiza Redis quando DB > Redis', async () => {
      prisma.empresaSequence.findMany.mockResolvedValue([
        { empresaId: 'emp-1', tipo: 'pedido', ultimo: 100 },
      ]);
      redis.get.mockResolvedValue('50'); // Redis tem 50, DB tem 100

      await service.seedFromDb();

      expect(redis.set).toHaveBeenCalledWith('seq:emp-1:pedido', 100);
    });

    it('não faz nada quando banco está vazio', async () => {
      prisma.empresaSequence.findMany.mockResolvedValue([]);

      await service.seedFromDb();

      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});
