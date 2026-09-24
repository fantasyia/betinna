import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  auditLog: {
    create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuditService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: AuditService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new AuditService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // log (fire-and-forget)
  // -------------------------------------------------------------------------

  describe('log', () => {
    it('chama prisma.auditLog.create com os dados corretos', async () => {
      service.log({
        usuarioId: 'user-1',
        empresaId: 'emp-1',
        acao: 'CREATE',
        recurso: 'pedido',
        recursoId: 'ped-1',
        ip: '127.0.0.1',
      });

      // log é fire-and-forget — precisamos de um tick para a Promise ser agendada
      await new Promise((r) => setTimeout(r, 0));

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usuarioId: 'user-1',
            empresaId: 'emp-1',
            acao: 'CREATE',
            recurso: 'pedido',
            recursoId: 'ped-1',
            ip: '127.0.0.1',
          }),
        }),
      );
    });

    it('usa null quando campos opcionais não são informados', async () => {
      service.log({ acao: 'LIST', recurso: 'clientes' });

      await new Promise((r) => setTimeout(r, 0));

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            usuarioId: null,
            empresaId: null,
            recursoId: null,
            ip: null,
          }),
        }),
      );
    });

    it('não lança quando prisma.create falha (fire-and-forget)', () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB error'));

      // log() é síncrono (void), não deve lançar
      expect(() => service.log({ acao: 'DELETE', recurso: 'usuario' })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // logSync (await)
  // -------------------------------------------------------------------------

  describe('logSync', () => {
    it('resolve sem lançar em caso de sucesso', async () => {
      await expect(
        service.logSync({ acao: 'UPDATE', recurso: 'cliente', recursoId: 'cli-1' }),
      ).resolves.toBeUndefined();

      expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    });

    it('não lança quando prisma.create falha (swallows error)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB timeout'));

      await expect(service.logSync({ acao: 'SYNC', recurso: 'erp' })).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // list — ADMIN viewer (audit fix 2026-05-17)
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('retorna paginação com defaults page=1 limit=50', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'a', acao: 'X' }]);
      prisma.auditLog.count.mockResolvedValue(1);

      const r = await service.list({});
      expect(r.data).toHaveLength(1);
      expect(r.pagination.page).toBe(1);
      expect(r.pagination.limit).toBe(50);
      expect(r.pagination.total).toBe(1);
      expect(r.pagination.totalPages).toBe(1);
    });

    it('aplica filtro empresaId quando informado', async () => {
      await service.list({ empresaId: 'emp-7' });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-7');
    });

    it('aplica filtro usuarioId', async () => {
      await service.list({ usuarioId: 'user-9' });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where.usuarioId).toBe('user-9');
    });

    it('aplica filtro acao com contains case-insensitive', async () => {
      await service.list({ acao: 'create' });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where.acao).toEqual({ contains: 'create', mode: 'insensitive' });
    });

    it('aplica filtro recurso + recursoId combinados', async () => {
      await service.list({ recurso: 'pedido', recursoId: 'ped-42' });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where.recurso).toBe('pedido');
      expect(args.where.recursoId).toBe('ped-42');
    });

    it('aplica intervalo de datas com gte/lte', async () => {
      const de = new Date('2026-01-01');
      const ate = new Date('2026-01-31');
      await service.list({ de, ate });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where.criadoEm.gte).toEqual(de);
      expect(args.where.criadoEm.lte).toEqual(ate);
    });

    it('paginação calcula skip corretamente', async () => {
      await service.list({ page: 3, limit: 20 });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.skip).toBe(40);
      expect(args.take).toBe(20);
    });

    it('limite max 100 mesmo se passar maior', async () => {
      await service.list({ limit: 500 });
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
    });

    it('ordena por criadoEm desc (mais recente primeiro)', async () => {
      await service.list({});
      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ criadoEm: 'desc' });
    });

    it('totalPages = ceil(total/limit) com pelo menos 1', async () => {
      prisma.auditLog.count.mockResolvedValue(0);
      const r = await service.list({});
      expect(r.pagination.totalPages).toBe(1);

      prisma.auditLog.count.mockResolvedValue(125);
      const r2 = await service.list({ limit: 50 });
      expect(r2.pagination.totalPages).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // findById + listRecursosUnicos
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('chama prisma.findUnique com id', async () => {
      await service.findById('log-x');
      expect(prisma.auditLog.findUnique).toHaveBeenCalledWith({ where: { id: 'log-x' } });
    });

    it('retorna null quando não encontrado', async () => {
      prisma.auditLog.findUnique.mockResolvedValue(null);
      const r = await service.findById('inexistente');
      expect(r).toBeNull();
    });
  });

  describe('listRecursosUnicos', () => {
    it('retorna apenas valores de recurso (achatado do groupBy)', async () => {
      prisma.auditLog.groupBy.mockResolvedValue([
        { recurso: 'pedido' },
        { recurso: 'cliente' },
        { recurso: 'comissao' },
      ]);
      const r = await service.listRecursosUnicos();
      expect(r).toEqual(['pedido', 'cliente', 'comissao']);
    });

    it('retorna [] quando não há logs ainda', async () => {
      prisma.auditLog.groupBy.mockResolvedValue([]);
      const r = await service.listRecursosUnicos();
      expect(r).toEqual([]);
    });
  });
});

/**
 * Nome de gente e de coisa na lista (pedido do Léo, 24/09). A tela mostrava
 * UUID e cuid; pra saber "quem desligou o R2?" era preciso traduzir na mão.
 */
describe('AuditService.list — nomes ao lado dos ids', () => {
  const linha = (over: Record<string, unknown>) => ({
    id: 'l',
    acao: 'update',
    recurso: 'fluxo',
    recursoId: 'fx-r2',
    usuarioId: 'u-leo',
    empresaId: 'emp-1',
    detalhes: { via: 'api_token', apiTokenNome: 'MCP master', campos: ['nome'] },
    ip: null,
    criadoEm: new Date(),
    ...over,
  });
  const montar = (linhas: unknown[]) => {
    const prisma = {
      auditLog: {
        findMany: vi.fn().mockResolvedValue(linhas),
        count: vi.fn().mockResolvedValue(linhas.length),
      },
      usuario: {
        findMany: vi.fn().mockResolvedValue([{ id: 'u-leo', nome: 'Leonardo Beltran' }]),
      },
      fluxo: {
        findMany: vi.fn().mockResolvedValue([{ id: 'fx-r2', nome: 'R2 · Liberação de lote' }]),
      },
      proposta: { findMany: vi.fn().mockRejectedValue(new Error('banco fora')) },
    };
    return { svc: new AuditService(prisma as never), prisma };
  };

  it('traz o nome do usuário e o nome do fluxo', async () => {
    const { svc } = montar([linha({})]);
    const r = await svc.list({});
    expect(r.data[0]).toMatchObject({
      usuarioNome: 'Leonardo Beltran',
      recursoNome: 'R2 · Liberação de lote',
      // o que a tela usa pra "de onde veio" e "o que mudou" continua no detalhes
      detalhes: { via: 'api_token', apiTokenNome: 'MCP master', campos: ['nome'] },
    });
  });

  it('UMA consulta por tipo de recurso, não uma por linha', async () => {
    const { svc, prisma } = montar([linha({ id: 'a' }), linha({ id: 'b' }), linha({ id: 'c' })]);
    await svc.list({});
    expect(prisma.fluxo.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.fluxo.findMany.mock.calls[0][0].where.id.in).toEqual(['fx-r2']);
    expect(prisma.usuario.findMany).toHaveBeenCalledTimes(1);
  });

  it('sistema (sem usuário) e recurso sem tradutor ficam com nome null — a linha não some', async () => {
    const { svc } = montar([linha({ usuarioId: null, recurso: 'conversation', recursoId: 'c1' })]);
    const r = await svc.list({});
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ usuarioNome: null, recursoNome: null });
  });

  it('falha ao traduzir um tipo NÃO derruba a lista (best-effort)', async () => {
    const { svc } = montar([linha({}), linha({ id: 'p', recurso: 'proposta', recursoId: 'pr-1' })]);
    const r = await svc.list({});
    expect(r.data).toHaveLength(2);
    expect(r.data[0].recursoNome).toBe('R2 · Liberação de lote');
    expect(r.data[1].recursoNome).toBeNull();
  });
});
