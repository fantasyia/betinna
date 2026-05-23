import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AgendaService } from './agenda.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  agendaItem: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  } satisfies MockModel,
  cliente: {
    findFirst: vi.fn(),
  } satisfies MockModel,
});

const makeUserIntegracoesMock = () => ({
  findByServico: vi.fn().mockResolvedValue(null), // sem integração google por default
});

const makeGoogleCalendarMock = () => ({
  criarEvento: vi.fn().mockResolvedValue({ id: 'gcal-event-1' }),
  atualizarEvento: vi.fn().mockResolvedValue(undefined),
  deletarEvento: vi.fn().mockResolvedValue(undefined),
});

const makeRepScopeMock = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a', 'rep-b'];
    return null;
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeAgendaItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'ag-1',
  empresaId: 'emp-1',
  usuarioId: 'user-1',
  clienteId: null,
  titulo: 'Visita ao cliente',
  data: new Date('2026-06-01T10:00:00Z'),
  duracao: 60,
  tipo: 'VISITA',
  observacao: null,
  googleEventId: null,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  cliente: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AgendaService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let userIntegracoes: ReturnType<typeof makeUserIntegracoesMock>;
  let googleCalendar: ReturnType<typeof makeGoogleCalendarMock>;
  let repScope: ReturnType<typeof makeRepScopeMock>;
  let service: AgendaService;

  beforeEach(() => {
    prisma = makePrismaMock();
    userIntegracoes = makeUserIntegracoesMock();
    googleCalendar = makeGoogleCalendarMock();
    repScope = makeRepScopeMock();
    service = new AgendaService(
      prisma as never,
      userIntegracoes as never,
      googleCalendar as never,
      repScope as never,
    );
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    const baseDto = {
      titulo: 'Visita',
      data: new Date('2026-06-01T10:00:00Z'),
      duracao: 60,
      tipo: 'VISITA' as const,
    };

    it('cria item com empresaId e usuarioId do JWT', async () => {
      prisma.agendaItem.create.mockResolvedValue(fakeAgendaItem());

      await service.create(fakeUser({ id: 'user-42', empresaIdAtiva: 'emp-5' }), baseDto);

      const data = prisma.agendaItem.create.mock.calls[0][0].data;
      expect(data.usuarioId).toBe('user-42');
      expect(data.empresaId).toBe('emp-5');
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.create(fakeUser({ empresaIdAtiva: null }), baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('valida clienteId quando fornecido — lança NotFoundException se não existe', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null);

      await expect(
        service.create(fakeUser(), { ...baseDto, clienteId: 'cli-inexistente' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.agendaItem.create).not.toHaveBeenCalled();
    });

    it('REP lança BusinessRuleException para cliente fora da carteira', async () => {
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1', representanteId: 'rep-outro' });

      await expect(
        service.create(fakeUser({ role: 'REP', id: 'rep-77' }), {
          ...baseDto,
          clienteId: 'cli-1',
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('não espelha no Google quando espelharGoogle não passado', async () => {
      prisma.agendaItem.create.mockResolvedValue(fakeAgendaItem());

      await service.create(fakeUser(), baseDto);

      expect(googleCalendar.criarEvento).not.toHaveBeenCalled();
    });

    it('espelha no Google quando espelharGoogle=true e integração ativa', async () => {
      prisma.agendaItem.create.mockResolvedValue(fakeAgendaItem());
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.update.mockResolvedValue(fakeAgendaItem({ googleEventId: 'gcal-1' }));

      await service.create(fakeUser(), { ...baseDto, espelharGoogle: true });

      expect(googleCalendar.criarEvento).toHaveBeenCalledOnce();
      expect(prisma.agendaItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { googleEventId: 'gcal-event-1' } }),
      );
    });

    it('não espelha no Google quando integração não está ativa', async () => {
      prisma.agendaItem.create.mockResolvedValue(fakeAgendaItem());
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: false });

      await service.create(fakeUser(), { ...baseDto, espelharGoogle: true });

      expect(googleCalendar.criarEvento).not.toHaveBeenCalled();
    });

    it('falha no Google não derruba criação local (best-effort)', async () => {
      prisma.agendaItem.create.mockResolvedValue(fakeAgendaItem());
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      googleCalendar.criarEvento.mockRejectedValue(new Error('Google API error'));

      // Não deve lançar — best-effort
      await expect(
        service.create(fakeUser(), { ...baseDto, espelharGoogle: true }),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('lista agenda do próprio usuário', async () => {
      prisma.agendaItem.findMany.mockResolvedValue([fakeAgendaItem()]);

      const result = await service.list(fakeUser({ id: 'user-1' }), {});

      expect(result).toHaveLength(1);
      const where = prisma.agendaItem.findMany.mock.calls[0][0].where;
      expect(where.usuarioId).toBe('user-1');
    });

    it('REP não pode ver agenda de outro usuário → ForbiddenException', async () => {
      await expect(
        service.list(fakeUser({ role: 'REP', id: 'rep-1' }), { usuarioId: 'rep-outro' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN pode ver agenda de qualquer usuário', async () => {
      prisma.agendaItem.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), { usuarioId: 'qualquer-user' });

      const where = prisma.agendaItem.findMany.mock.calls[0][0].where;
      expect(where.usuarioId).toBe('qualquer-user');
    });

    it('GERENTE só pode ver agenda de REP sob sua gerência', async () => {
      prisma.agendaItem.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'GERENTE', id: 'ger-1' }), { usuarioId: 'rep-a' });

      // não deve lançar (rep-a está no scope)
      expect(prisma.agendaItem.findMany).toHaveBeenCalled();
    });

    it('GERENTE não pode ver agenda de REP fora da gerência', async () => {
      await expect(
        service.list(fakeUser({ role: 'GERENTE', id: 'ger-1' }), { usuarioId: 'rep-fora' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por período (inicio/fim)', async () => {
      prisma.agendaItem.findMany.mockResolvedValue([]);
      const inicio = new Date('2026-06-01');
      const fim = new Date('2026-06-30');

      await service.list(fakeUser(), { inicio, fim });

      const where = prisma.agendaItem.findMany.mock.calls[0][0].where;
      expect(where.data.gte).toEqual(inicio);
      expect(where.data.lte).toEqual(fim);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna item do próprio usuário', async () => {
      const item = fakeAgendaItem({ usuarioId: 'user-1' });
      prisma.agendaItem.findFirst.mockResolvedValue(item);

      const result = await service.findById(fakeUser({ id: 'user-1' }), 'ag-1');

      expect(result).toEqual(item);
    });

    it('ADMIN pode ver item de qualquer usuário', async () => {
      const item = fakeAgendaItem({ usuarioId: 'outro-user' });
      prisma.agendaItem.findFirst.mockResolvedValue(item);

      await expect(service.findById(fakeUser({ role: 'ADMIN' }), 'ag-1')).resolves.toBeDefined();
    });

    it('REP não pode ver item de outro usuário → ForbiddenException', async () => {
      const item = fakeAgendaItem({ usuarioId: 'outro-user' });
      prisma.agendaItem.findFirst.mockResolvedValue(item);

      await expect(
        service.findById(fakeUser({ role: 'REP', id: 'rep-1' }), 'ag-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lança NotFoundException quando item não existe', async () => {
      prisma.agendaItem.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza item do próprio usuário', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1' });
      const updated = fakeAgendaItem({ titulo: 'Visita Atualizada' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.agendaItem.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.update(fakeUser({ id: 'user-1' }), 'ag-1', {
        titulo: 'Visita Atualizada',
      });

      expect(result.titulo).toBe('Visita Atualizada');
    });

    it('apenas o dono pode editar → ForbiddenException para outro usuário', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'outro-user' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);

      await expect(
        service.update(fakeUser({ id: 'user-1' }), 'ag-1', { titulo: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.agendaItem.updateMany).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando item não existe', async () => {
      prisma.agendaItem.findFirst.mockResolvedValue(null);

      await expect(service.update(fakeUser(), 'nao-existe', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('falha no Google Calendar não derruba o update local (best-effort)', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1', googleEventId: 'gcal-123' });
      const updated = fakeAgendaItem({ titulo: 'Nova Visita' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.agendaItem.findUniqueOrThrow.mockResolvedValue(updated);
      googleCalendar.atualizarEvento.mockRejectedValue(new Error('Google offline'));

      await expect(
        service.update(fakeUser({ id: 'user-1' }), 'ag-1', { titulo: 'Nova Visita' }),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('deleta item do próprio usuário', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1', empresaId: 'emp-1' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.delete(fakeUser({ id: 'user-1' }), 'ag-1');

      expect(result).toEqual({ ok: true, deleted: 1 });
      const args = prisma.agendaItem.deleteMany.mock.calls[0][0];
      expect(args.where.id).toBe('ag-1');
      expect(args.where.empresaId).toBe('emp-1');
    });

    it('apenas o dono pode deletar → ForbiddenException', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'outro-user' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);

      await expect(service.delete(fakeUser({ id: 'user-1' }), 'ag-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lança NotFoundException quando item não existe', async () => {
      prisma.agendaItem.findFirst.mockResolvedValue(null);

      await expect(service.delete(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('tenta deletar evento no Google se googleEventId existir (best-effort)', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1', googleEventId: 'gcal-ev-1' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.delete(fakeUser({ id: 'user-1' }), 'ag-1');

      expect(googleCalendar.deletarEvento).toHaveBeenCalledWith('user-1', 'gcal-ev-1');
    });

    it('falha no Google Calendar não derruba o delete local (best-effort)', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1', googleEventId: 'gcal-ev-1' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 1 });
      googleCalendar.deletarEvento.mockRejectedValue(new Error('Google offline'));

      await expect(service.delete(fakeUser({ id: 'user-1' }), 'ag-1')).resolves.toEqual({
        ok: true,
        deleted: 1,
      });
    });
  });
});
