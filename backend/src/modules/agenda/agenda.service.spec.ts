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
    findMany: vi.fn().mockResolvedValue([]),
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
  listarEventos: vi.fn().mockResolvedValue([]),
  listarTarefas: vi.fn().mockResolvedValue([]),
  // default: evento ainda existe no Google (reconciliação não remove nada)
  obterEvento: vi.fn().mockResolvedValue({ id: 'gcal-event-1', status: 'confirmed' }),
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
      espelharGoogle: false,
      recorrencia: 'NENHUMA' as const,
      recorrenciaOcorrencias: 12,
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
      prisma.agendaItem.findMany.mockResolvedValue([{ googleEventId: 'gcal-ev-1' }]);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.delete(fakeUser({ id: 'user-1' }), 'ag-1');

      expect(googleCalendar.deletarEvento).toHaveBeenCalledWith('user-1', 'gcal-ev-1');
    });

    it('falha no Google Calendar não derruba o delete local (best-effort)', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1', googleEventId: 'gcal-ev-1' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.findMany.mockResolvedValue([{ googleEventId: 'gcal-ev-1' }]);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 1 });
      googleCalendar.deletarEvento.mockRejectedValue(new Error('Google offline'));

      await expect(service.delete(fakeUser({ id: 'user-1' }), 'ag-1')).resolves.toEqual({
        ok: true,
        deleted: 1,
      });
    });

    it('CAÇADA-BUG #12: delete de SÉRIE apaga TODOS os eventos Google das filhas (não só o clicado)', async () => {
      const existing = fakeAgendaItem({
        usuarioId: 'user-1',
        empresaId: 'emp-1',
        googleEventId: 'gcal-1',
      });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      // A série tem 3 linhas, cada uma com seu evento no Google.
      prisma.agendaItem.findMany.mockResolvedValue([
        { googleEventId: 'gcal-1' },
        { googleEventId: 'gcal-2' },
        { googleEventId: 'gcal-3' },
      ]);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 3 });

      const r = await service.delete(fakeUser({ id: 'user-1' }), 'ag-1', 'series');

      expect(googleCalendar.deletarEvento).toHaveBeenCalledTimes(3);
      expect(googleCalendar.deletarEvento).toHaveBeenCalledWith('user-1', 'gcal-1');
      expect(googleCalendar.deletarEvento).toHaveBeenCalledWith('user-1', 'gcal-2');
      expect(googleCalendar.deletarEvento).toHaveBeenCalledWith('user-1', 'gcal-3');
      expect(r.deleted).toBe(3);
    });

    it('#12: não chama deletarEvento em itens de tarefa (gtask:) nem em linhas sem googleEventId', async () => {
      const existing = fakeAgendaItem({ usuarioId: 'user-1', empresaId: 'emp-1' });
      prisma.agendaItem.findFirst.mockResolvedValue(existing);
      prisma.agendaItem.findMany.mockResolvedValue([
        { googleEventId: null },
        { googleEventId: 'gtask:tk-1' },
        { googleEventId: 'gcal-ok' },
      ]);
      prisma.agendaItem.deleteMany.mockResolvedValue({ count: 3 });

      await service.delete(fakeUser({ id: 'user-1' }), 'ag-1', 'series');

      // só o evento de calendário real é apagado no Google
      expect(googleCalendar.deletarEvento).toHaveBeenCalledTimes(1);
      expect(googleCalendar.deletarEvento).toHaveBeenCalledWith('user-1', 'gcal-ok');
    });
  });

  describe('sincronizarGoogle (backfill dos existentes)', () => {
    it('lança se o Google não está conectado', async () => {
      userIntegracoes.findByServico.mockResolvedValue(null);
      await expect(service.sincronizarGoogle(fakeUser({ id: 'u1' }))).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('espelha os itens futuros sem googleEventId e salva o id', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.findMany.mockResolvedValue([
        {
          id: 'a1',
          empresaId: 'emp-1',
          titulo: 'Visita',
          data: new Date(),
          duracao: 30,
          observacao: null,
        },
        {
          id: 'a2',
          empresaId: 'emp-1',
          titulo: 'Ligação',
          data: new Date(),
          duracao: 15,
          observacao: null,
        },
      ]);
      googleCalendar.criarEvento
        .mockResolvedValueOnce({ id: 'gcal-a1' })
        .mockResolvedValueOnce({ id: 'gcal-a2' });

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(r).toEqual({ sincronizados: 2, importados: 0, removidos: 0, total: 2 });
      expect(googleCalendar.criarEvento).toHaveBeenCalledTimes(2);
      expect(prisma.agendaItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { googleEventId: 'gcal-a1' } }),
      );
    });

    it('falha num item não derruba os demais (best-effort)', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.findMany.mockResolvedValue([
        {
          id: 'a1',
          empresaId: 'emp-1',
          titulo: 'X',
          data: new Date(),
          duracao: 30,
          observacao: null,
        },
        {
          id: 'a2',
          empresaId: 'emp-1',
          titulo: 'Y',
          data: new Date(),
          duracao: 30,
          observacao: null,
        },
      ]);
      googleCalendar.criarEvento
        .mockRejectedValueOnce(new Error('Google API error'))
        .mockResolvedValueOnce({ id: 'gcal-a2' });

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));
      expect(r).toEqual({ sincronizados: 1, importados: 0, removidos: 0, total: 2 });
    });

    it('mão-dupla: item espelhado apagado no Google é REMOVIDO da Betinna', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      // 1ª findMany (pendentes p/ empurrar) = vazia; 2ª (espelhados) = 1 item com googleEventId
      prisma.agendaItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'ag-x', empresaId: 'emp-1', googleEventId: 'gcal-del' }]);
      // Google não acha mais o evento (apagado/cancelado) → null
      googleCalendar.obterEvento.mockResolvedValue(null);

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(googleCalendar.obterEvento).toHaveBeenCalledWith('u1', 'gcal-del');
      expect(prisma.agendaItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ag-x', empresaId: 'emp-1' },
      });
      expect(r).toEqual({ sincronizados: 0, importados: 0, removidos: 1, total: 0 });
    });

    it('#R3: listarTarefas FALHA → NÃO apaga tarefas gtask locais (sem perda de dados)', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      const dataNaJanela = new Date(Date.now() + 5 * 86_400_000); // 5 dias à frente (dentro dos 180d)
      prisma.agendaItem.findMany
        .mockResolvedValueOnce([]) // pendentes (nada a empurrar)
        .mockResolvedValueOnce([
          // tarefa gtask: local que existe hoje na Betinna
          { id: 'ag-t', empresaId: 'emp-1', googleEventId: 'gtask:abc', data: dataNaJanela },
        ]);
      // A Tasks API cai (5xx transiente / escopo perdido).
      googleCalendar.listarTarefas.mockRejectedValue(new Error('503 Service Unavailable'));

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      // Guard #R3: reconciliação de tarefas pulada → nada apagado.
      expect(prisma.agendaItem.deleteMany).not.toHaveBeenCalled();
      expect(r.removidos).toBe(0);
    });

    it('import: evento novo no Google (com hora) vira compromisso da Betinna', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.findMany
        .mockResolvedValueOnce([]) // pendentes (nada a empurrar)
        .mockResolvedValueOnce([]); // espelhados (nada a reconciliar)
      googleCalendar.listarEventos.mockResolvedValue([
        {
          id: 'gcal-novo',
          status: 'confirmed',
          summary: 'Reunião no Google',
          location: 'Sala 3',
          description: 'pauta',
          start: { dateTime: '2026-07-10T14:00:00-03:00' },
          end: { dateTime: '2026-07-10T15:00:00-03:00' },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
        },
      ]);
      prisma.agendaItem.create.mockResolvedValue({ id: 'ag-imp' });

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(prisma.agendaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titulo: 'Reunião no Google',
            local: 'Sala 3',
            duracao: 60,
            alertas: [30],
            googleEventId: 'gcal-novo',
          }),
        }),
      );
      expect(r).toEqual({ sincronizados: 0, importados: 1, removidos: 0, total: 0 });
    });

    it('import: NÃO reimporta espelhado + importa dia-inteiro como bloco de dia', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'ag-x', empresaId: 'emp-1', googleEventId: 'gcal-existe' }]);
      googleCalendar.obterEvento.mockResolvedValue({ id: 'gcal-existe', status: 'confirmed' });
      googleCalendar.listarEventos.mockResolvedValue([
        // já espelhado → não reimporta
        {
          id: 'gcal-existe',
          status: 'confirmed',
          summary: 'já tenho',
          start: { dateTime: '2026-07-10T14:00:00-03:00' },
          end: { dateTime: '2026-07-10T15:00:00-03:00' },
        },
        // dia inteiro (só date) → importa como bloco de dia (duracao 1440)
        {
          id: 'gcal-allday',
          status: 'confirmed',
          summary: 'Aniversário',
          start: { date: '2026-07-12' },
        },
      ]);
      prisma.agendaItem.create.mockResolvedValue({ id: 'ag-imp' });

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(prisma.agendaItem.create).toHaveBeenCalledTimes(1);
      expect(prisma.agendaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titulo: 'Aniversário',
            duracao: 1440,
            googleEventId: 'gcal-allday',
          }),
        }),
      );
      expect(r.importados).toBe(1);
    });

    it('import: TAREFA do Google (com due) vira AgendaItem tipo TAREFA (gtask:)', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      googleCalendar.listarEventos.mockResolvedValue([]);
      googleCalendar.listarTarefas.mockResolvedValue([
        {
          id: 'tk-1',
          title: 'Ligar pro cliente',
          notes: 'urgente',
          status: 'needsAction',
          due: '2026-07-04T00:00:00.000Z',
        },
        { id: 'tk-2', title: 'sem data', status: 'needsAction' }, // sem due → ignorada
      ]);
      prisma.agendaItem.create.mockResolvedValue({ id: 'ag-tk' });

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(prisma.agendaItem.create).toHaveBeenCalledTimes(1);
      expect(prisma.agendaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titulo: 'Ligar pro cliente',
            tipo: 'TAREFA',
            observacao: 'urgente',
            googleEventId: 'gtask:tk-1',
          }),
        }),
      );
      expect(r.importados).toBe(1);
    });

    it('reconciliação NÃO event-reconcilia itens de tarefa (gtask:) e mantém tarefa ainda presente', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      const amanha = new Date(Date.now() + 86_400_000);
      prisma.agendaItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'ag-t', empresaId: 'emp-1', googleEventId: 'gtask:tk-9', data: amanha },
        ]);
      // A tarefa tk-9 AINDA existe no Google → não pode ser removida.
      googleCalendar.listarTarefas.mockResolvedValue([
        { id: 'tk-9', title: 'viva', status: 'needsAction', due: '2026-08-01T00:00:00.000Z' },
      ]);

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      // gtask: nunca vai pro obterEvento (senão 404 apagaria a tarefa)
      expect(googleCalendar.obterEvento).not.toHaveBeenCalled();
      // ainda presente na listagem → NÃO remove; e já espelhada → NÃO reimporta
      expect(prisma.agendaItem.deleteMany).not.toHaveBeenCalled();
      expect(r.removidos).toBe(0);
    });

    it('CAÇADA-BUG #11: tarefa concluída/apagada no Google (não vem na listagem) é REMOVIDA', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      const amanha = new Date(Date.now() + 86_400_000);
      prisma.agendaItem.findMany
        .mockResolvedValueOnce([]) // pendentes
        .mockResolvedValueOnce([
          { id: 'ag-tk', empresaId: 'emp-1', googleEventId: 'gtask:tk-sumida', data: amanha },
        ]);
      googleCalendar.listarEventos.mockResolvedValue([]);
      googleCalendar.listarTarefas.mockResolvedValue([]); // Google não tem mais a tarefa

      const r = await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(googleCalendar.obterEvento).not.toHaveBeenCalled(); // gtask não passa por evento
      expect(prisma.agendaItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ag-tk', empresaId: 'emp-1' },
      });
      expect(r.removidos).toBe(1);
    });

    it('CAÇADA-BUG #13: evento all-day MULTI-DIA usa end.date → duração = N dias × 1440', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      prisma.agendaItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      googleCalendar.listarEventos.mockResolvedValue([
        {
          id: 'gcal-viagem',
          status: 'confirmed',
          summary: 'Viagem 3 dias',
          start: { date: '2026-07-12' },
          end: { date: '2026-07-15' }, // exclusivo → 12,13,14 = 3 dias
        },
      ]);
      prisma.agendaItem.create.mockResolvedValue({ id: 'ag-v' });

      await service.sincronizarGoogle(fakeUser({ id: 'u1' }));

      expect(prisma.agendaItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titulo: 'Viagem 3 dias',
            duracao: 4320, // 3 × 1440
            googleEventId: 'gcal-viagem',
          }),
        }),
      );
    });
  });

  describe('listarGoogleEventos (overlay read-only)', () => {
    it('não conectado → conectado:false e lista vazia', async () => {
      userIntegracoes.findByServico.mockResolvedValue(null);
      const r = await service.listarGoogleEventos(fakeUser(), new Date(), new Date());
      expect(r).toEqual({ conectado: false, eventos: [] });
      expect(googleCalendar.listarEventos).not.toHaveBeenCalled();
    });

    it('mapeia eventos (com hora e dia-todo) e ignora cancelados', async () => {
      userIntegracoes.findByServico.mockResolvedValue({ id: 'conn-1', ativo: true });
      googleCalendar.listarEventos.mockResolvedValue([
        {
          id: 'g1',
          status: 'confirmed',
          summary: 'Reunião',
          start: { dateTime: '2026-08-10T14:00:00-03:00' },
          end: { dateTime: '2026-08-10T15:00:00-03:00' },
          htmlLink: 'https://cal/g1',
        },
        {
          id: 'g2',
          status: 'confirmed',
          summary: 'Feriado',
          start: { date: '2026-08-15' },
          end: { date: '2026-08-16' },
        },
        { id: 'g3', status: 'cancelled', summary: 'Cancelado', start: {}, end: {} },
      ]);

      const r = await service.listarGoogleEventos(
        fakeUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      );

      expect(r.conectado).toBe(true);
      expect(r.eventos).toHaveLength(2); // cancelado fora
      expect(r.eventos[0]).toMatchObject({ id: 'g1', titulo: 'Reunião', allDay: false });
      expect(r.eventos[1]).toMatchObject({ id: 'g2', allDay: true });
    });
  });
});
