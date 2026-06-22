import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MarketplaceIncidentStatus, type UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { IncidentsService } from './incidents.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  marketplaceIncident: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
  } satisfies MockModel,
  conversation: {
    update: vi.fn(),
  } satisfies MockModel,
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'sac-1',
  email: 'sac@betinna.ai',
  nome: 'SAC',
  role: 'SAC' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeIncident = (overrides: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  empresaId: 'emp-1',
  canal: 'MARKETPLACE_ML',
  externalId: 'ml-claim-42',
  tipo: 'RECLAMACAO',
  status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR,
  motivo: 'Produto com defeito',
  motivoCodigo: null,
  pedidoExternoId: null,
  clienteId: null,
  valor: null,
  valorReembolso: null,
  prazoResposta: null,
  resumo: null,
  metadata: null,
  resolvidoEm: null,
  abertoEm: new Date('2026-06-01'),
  atualizadoEm: new Date('2026-06-01'),
  cliente: null,
  conversations: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('IncidentsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: IncidentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new IncidentsService(prisma as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = { page: 1, limit: 20 };

    it('lista incidentes da empresa', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(1);
      prisma.marketplaceIncident.findMany.mockResolvedValue([fakeIncident()]);

      const result = await service.list(fakeUser(), baseParams);

      expect(result.data).toHaveLength(1);
      const where = prisma.marketplaceIncident.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-1');
    });

    it('REP → ForbiddenException (incidentes restritos a SAC/gerência)', async () => {
      await expect(service.list(fakeUser({ role: 'REP' }), baseParams)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.list(fakeUser({ empresaIdAtiva: null }), baseParams),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por canal quando passado', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, canal: 'MARKETPLACE_ML' as never });

      const where = prisma.marketplaceIncident.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ canal: 'MARKETPLACE_ML' }]));
    });

    it('filtra por status quando passado', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), {
        ...baseParams,
        status: MarketplaceIncidentStatus.EM_MEDIACAO,
      });

      const where = prisma.marketplaceIncident.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([{ status: MarketplaceIncidentStatus.EM_MEDIACAO }]),
      );
    });

    it('filtra por clienteId quando passado', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, clienteId: 'cli-1' });

      const where = prisma.marketplaceIncident.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ clienteId: 'cli-1' }]));
    });

    it('aguardandoMim = true adiciona OR AGUARDANDO_VENDEDOR|ABERTO', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, aguardandoMim: true });

      const where = prisma.marketplaceIncident.findMany.mock.calls[0][0].where;
      const aguardandoCond = (where.AND as Array<Record<string, unknown>>).find((c) => 'OR' in c);
      expect(aguardandoCond).toBeDefined();
      const orCond = (aguardandoCond as { OR: Array<{ status: string }> }).OR;
      expect(orCond).toEqual(
        expect.arrayContaining([
          { status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR },
          { status: MarketplaceIncidentStatus.ABERTO },
        ]),
      );
    });

    it('prazoUrgente = true adiciona filtro prazoResposta próximas 24h', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, prazoUrgente: true });

      const where = prisma.marketplaceIncident.findMany.mock.calls[0][0].where;
      const prazoCond = (where.AND as Array<Record<string, unknown>>).find(
        (c) => 'prazoResposta' in c,
      );
      expect(prazoCond).toBeDefined();
    });

    it('retorna paginação correta', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(50);
      prisma.marketplaceIncident.findMany.mockResolvedValue([fakeIncident()]);

      const result = await service.list(fakeUser(), { page: 2, limit: 10 });

      expect(result.pagination.total).toBe(50);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('ADMIN pode listar incidentes', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await expect(service.list(fakeUser({ role: 'ADMIN' }), baseParams)).resolves.toBeDefined();
    });

    it('GERENTE pode listar incidentes', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.findMany.mockResolvedValue([]);

      await expect(service.list(fakeUser({ role: 'GERENTE' }), baseParams)).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna incidente quando encontrado', async () => {
      const inc = fakeIncident();
      prisma.marketplaceIncident.findFirst.mockResolvedValue(inc);

      const result = await service.findById(fakeUser(), 'inc-1');

      expect(result).toEqual(inc);
      const args = prisma.marketplaceIncident.findFirst.mock.calls[0][0];
      expect(args.where.id).toBe('inc-1');
      expect(args.where.empresaId).toBe('emp-1');
    });

    it('lança NotFoundException quando incidente não existe', async () => {
      prisma.marketplaceIncident.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('REP → ForbiddenException', async () => {
      await expect(service.findById(fakeUser({ role: 'REP' }), 'inc-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.marketplaceIncident.findFirst).not.toHaveBeenCalled();
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.findById(fakeUser({ empresaIdAtiva: null }), 'inc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // resumo
  // -------------------------------------------------------------------------

  describe('resumo', () => {
    it('retorna contagens e porCanal', async () => {
      prisma.marketplaceIncident.count
        .mockResolvedValueOnce(5) // aguardandoMim
        .mockResolvedValueOnce(2) // prazoUrgente
        .mockResolvedValueOnce(1); // emMediacao
      prisma.marketplaceIncident.groupBy.mockResolvedValue([
        { canal: 'MARKETPLACE_ML', _count: { _all: 3 } },
        { canal: 'MARKETPLACE_SHOPEE', _count: { _all: 2 } },
      ]);

      const result = await service.resumo(fakeUser());

      expect(result.aguardandoMim).toBe(5);
      expect(result.prazoUrgente).toBe(2);
      expect(result.emMediacao).toBe(1);
      expect(result.porCanal).toHaveLength(2);
      expect(result.porCanal[0].canal).toBe('MARKETPLACE_ML');
      expect(result.porCanal[0].total).toBe(3);
    });

    it('REP → ForbiddenException', async () => {
      await expect(service.resumo(fakeUser({ role: 'REP' }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(service.resumo(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('usa empresaId correto no baseWhere das 4 queries paralelas', async () => {
      prisma.marketplaceIncident.count.mockResolvedValue(0);
      prisma.marketplaceIncident.groupBy.mockResolvedValue([]);

      await service.resumo(fakeUser({ empresaIdAtiva: 'emp-7' }));

      // Todas as chamadas de count devem filtrar por empresaId correto
      for (const call of prisma.marketplaceIncident.count.mock.calls) {
        expect(call[0].where.empresaId).toBe('emp-7');
      }
    });
  });

  // -------------------------------------------------------------------------
  // registrarIncidente
  // -------------------------------------------------------------------------

  describe('registrarIncidente', () => {
    const baseParams = {
      empresaId: 'emp-1',
      canal: 'MARKETPLACE_ML' as never,
      externalId: 'ml-claim-42',
      tipo: 'RECLAMACAO' as never,
      status: MarketplaceIncidentStatus.ABERTO,
    };

    it('cria novo incidente quando não existe', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident({ id: 'inc-new' }));

      const result = await service.registrarIncidente(baseParams);

      expect(result.incidentId).toBe('inc-new');
      expect(result.duplicada).toBe(false);
      expect(prisma.marketplaceIncident.create).toHaveBeenCalledOnce();
    });

    it('atualiza incidente existente (upsert idempotente)', async () => {
      const existing = {
        id: 'inc-1',
        status: MarketplaceIncidentStatus.ABERTO,
        atualizadoEm: new Date(),
      };
      prisma.marketplaceIncident.findUnique.mockResolvedValue(existing);
      prisma.marketplaceIncident.update.mockResolvedValue(fakeIncident());

      const result = await service.registrarIncidente({
        ...baseParams,
        status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR,
      });

      expect(result.incidentId).toBe('inc-1');
      expect(result.duplicada).toBe(false); // status mudou
      expect(prisma.marketplaceIncident.update).toHaveBeenCalledOnce();
      expect(prisma.marketplaceIncident.create).not.toHaveBeenCalled();
    });

    it('duplicada=true quando status não muda', async () => {
      const existing = {
        id: 'inc-1',
        status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR,
        atualizadoEm: new Date(),
      };
      prisma.marketplaceIncident.findUnique.mockResolvedValue(existing);
      prisma.marketplaceIncident.update.mockResolvedValue(fakeIncident());

      const result = await service.registrarIncidente({
        ...baseParams,
        status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR, // mesmo status
      });

      expect(result.duplicada).toBe(true);
    });

    it('define resolvidoEm quando status = RESOLVIDO', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident());

      await service.registrarIncidente({
        ...baseParams,
        status: MarketplaceIncidentStatus.RESOLVIDO,
      });

      const data = prisma.marketplaceIncident.create.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeInstanceOf(Date);
    });

    it('define resolvidoEm quando status = CANCELADO', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident());

      await service.registrarIncidente({
        ...baseParams,
        status: MarketplaceIncidentStatus.CANCELADO,
      });

      const data = prisma.marketplaceIncident.create.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeInstanceOf(Date);
    });

    it('define resolvidoEm quando status = EXPIRADO', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident());

      await service.registrarIncidente({
        ...baseParams,
        status: MarketplaceIncidentStatus.EXPIRADO,
      });

      const data = prisma.marketplaceIncident.create.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeInstanceOf(Date);
    });

    it('resolvidoEm=null quando status não é terminal', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident());

      await service.registrarIncidente({
        ...baseParams,
        status: MarketplaceIncidentStatus.AGUARDANDO_VENDEDOR,
      });

      const data = prisma.marketplaceIncident.create.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeNull();
    });

    it('vincula conversationId ao incidente quando fornecido (novo)', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident({ id: 'inc-new' }));
      prisma.conversation.update.mockResolvedValue({});

      await service.registrarIncidente({
        ...baseParams,
        conversationId: 'conv-1',
      });

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { incidentId: 'inc-new' },
      });
    });

    it('vincula conversationId ao incidente quando fornecido (atualização)', async () => {
      const existing = {
        id: 'inc-1',
        status: MarketplaceIncidentStatus.ABERTO,
        atualizadoEm: new Date(),
      };
      prisma.marketplaceIncident.findUnique.mockResolvedValue(existing);
      prisma.marketplaceIncident.update.mockResolvedValue(fakeIncident());
      prisma.conversation.update.mockResolvedValue({});

      await service.registrarIncidente({
        ...baseParams,
        conversationId: 'conv-1',
      });

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { incidentId: 'inc-1' },
      });
    });

    it('não chama conversation.update quando conversationId não fornecido', async () => {
      prisma.marketplaceIncident.findUnique.mockResolvedValue(null);
      prisma.marketplaceIncident.create.mockResolvedValue(fakeIncident());

      await service.registrarIncidente(baseParams); // sem conversationId

      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // atualizarStatus
  // -------------------------------------------------------------------------

  describe('atualizarStatus', () => {
    it('atualiza status e retorna incidente', async () => {
      const inc = fakeIncident({ status: MarketplaceIncidentStatus.RESOLVIDO });
      prisma.marketplaceIncident.update.mockResolvedValue(inc);

      const result = await service.atualizarStatus(
        'emp-1',
        'MARKETPLACE_ML',
        'ml-claim-42',
        MarketplaceIncidentStatus.RESOLVIDO,
      );

      expect(result).toEqual(inc);
      const args = prisma.marketplaceIncident.update.mock.calls[0][0];
      expect(args.where.empresaId_canal_externalId).toEqual({
        empresaId: 'emp-1',
        canal: 'MARKETPLACE_ML',
        externalId: 'ml-claim-42',
      });
      expect(args.data.status).toBe(MarketplaceIncidentStatus.RESOLVIDO);
      expect(args.data.resolvidoEm).toBeInstanceOf(Date);
    });

    it('define resolvidoEm quando status CANCELADO', async () => {
      prisma.marketplaceIncident.update.mockResolvedValue(fakeIncident());

      await service.atualizarStatus(
        'emp-1',
        'MARKETPLACE_ML',
        'ml-42',
        MarketplaceIncidentStatus.CANCELADO,
      );

      const data = prisma.marketplaceIncident.update.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeInstanceOf(Date);
    });

    it('define resolvidoEm quando status EXPIRADO', async () => {
      prisma.marketplaceIncident.update.mockResolvedValue(fakeIncident());

      await service.atualizarStatus(
        'emp-1',
        'MARKETPLACE_ML',
        'ml-42',
        MarketplaceIncidentStatus.EXPIRADO,
      );

      const data = prisma.marketplaceIncident.update.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeInstanceOf(Date);
    });

    it('resolvidoEm=null para status não-terminal', async () => {
      prisma.marketplaceIncident.update.mockResolvedValue(fakeIncident());

      await service.atualizarStatus(
        'emp-1',
        'MARKETPLACE_ML',
        'ml-42',
        MarketplaceIncidentStatus.EM_MEDIACAO,
      );

      const data = prisma.marketplaceIncident.update.mock.calls[0][0].data;
      expect(data.resolvidoEm).toBeNull();
    });

    it('retorna null quando update falha (incidente não existe)', async () => {
      prisma.marketplaceIncident.update.mockRejectedValue(new Error('Not found'));

      const result = await service.atualizarStatus(
        'emp-1',
        'MARKETPLACE_ML',
        'inexistente',
        MarketplaceIncidentStatus.RESOLVIDO,
      );

      expect(result).toBeNull();
    });
  });
});
