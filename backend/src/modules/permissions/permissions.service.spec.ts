import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { PermissionsService } from './permissions.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  permissao: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  } satisfies MockModel,
});

const fakePerm = (overrides: Record<string, unknown> = {}) => ({
  role: 'REP' as UserRole,
  modulo: 'clientes',
  podeVer: true,
  podeEditar: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PermissionsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: PermissionsService;

  beforeEach(async () => {
    prisma = makePrismaMock();
    // No onModuleInit default — let tests control cache state
    prisma.permissao.findMany.mockResolvedValue([]);
    service = new PermissionsService(prisma as never);
    await service.onModuleInit(); // carrega cache vazio inicialmente
  });

  // -------------------------------------------------------------------------
  // userCan
  // -------------------------------------------------------------------------

  describe('userCan', () => {
    it('ADMIN sempre pode fazer qualquer coisa (bypass)', () => {
      const result = service.userCan('ADMIN', 'qualquer-modulo', 'delete');
      expect(result).toBe(true);
    });

    it('retorna false quando permissão não está no cache', () => {
      const result = service.userCan('REP', 'clientes', 'delete');
      expect(result).toBe(false);
    });

    it('retorna true após cache carregado com podeVer=true', async () => {
      prisma.permissao.findMany.mockResolvedValue([fakePerm({ podeVer: true, podeEditar: false })]);
      await service.reloadCache();

      expect(service.userCan('REP', 'clientes', 'view')).toBe(true);
    });

    it('podeEditar=true implica create/edit/delete/approve/export', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        fakePerm({ role: 'GERENTE', podeVer: true, podeEditar: true }),
      ]);
      await service.reloadCache();

      expect(service.userCan('GERENTE', 'clientes', 'create')).toBe(true);
      expect(service.userCan('GERENTE', 'clientes', 'edit')).toBe(true);
      expect(service.userCan('GERENTE', 'clientes', 'delete')).toBe(true);
      expect(service.userCan('GERENTE', 'clientes', 'approve')).toBe(true);
      expect(service.userCan('GERENTE', 'clientes', 'export')).toBe(true);
    });

    it('podeVer=true mas podeEditar=false não permite ação edit', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        fakePerm({ role: 'REP', podeVer: true, podeEditar: false }),
      ]);
      await service.reloadCache();

      expect(service.userCan('REP', 'clientes', 'view')).toBe(true);
      expect(service.userCan('REP', 'clientes', 'edit')).toBe(false);
    });

    it('acoes granular é a fonte da verdade: edit SEM delete não concede delete (raiz #6)', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        fakePerm({
          role: 'REP',
          modulo: 'kanban',
          podeVer: true,
          podeEditar: true,
          acoes: ['view', 'create', 'edit'],
        }),
      ]);
      await service.reloadCache();

      expect(service.userCan('REP', 'kanban', 'edit')).toBe(true);
      // Antes, podeEditar=true expandia pra delete/approve — o granular barra isso.
      expect(service.userCan('REP', 'kanban', 'delete')).toBe(false);
      expect(service.userCan('REP', 'kanban', 'approve')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // reloadCache
  // -------------------------------------------------------------------------

  describe('reloadCache', () => {
    it('limpa e reconstrói o cache a partir do banco', async () => {
      // Primeiro carrega com REP/view
      prisma.permissao.findMany.mockResolvedValueOnce([fakePerm({ podeVer: true })]);
      await service.reloadCache();
      expect(service.userCan('REP', 'clientes', 'view')).toBe(true);

      // Segundo carregamento sem nada — REP/view deve desaparecer
      prisma.permissao.findMany.mockResolvedValueOnce([]);
      await service.reloadCache();
      expect(service.userCan('REP', 'clientes', 'view')).toBe(false);
    });

    it('suporta múltiplos papéis e módulos', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        { role: 'REP', modulo: 'pedidos', podeVer: true, podeEditar: true },
        { role: 'SAC', modulo: 'ocorrencias', podeVer: true, podeEditar: false },
      ]);
      await service.reloadCache();

      expect(service.userCan('REP', 'pedidos', 'create')).toBe(true);
      expect(service.userCan('SAC', 'ocorrencias', 'view')).toBe(true);
      expect(service.userCan('SAC', 'ocorrencias', 'edit')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // upsert
  // -------------------------------------------------------------------------

  describe('upsert', () => {
    it('faz upsert no banco e recarrega o cache', async () => {
      prisma.permissao.upsert.mockResolvedValue({});
      prisma.permissao.findMany.mockResolvedValue([
        { role: 'REP', modulo: 'catalogo', podeVer: true, podeEditar: true },
      ]);

      await service.upsert('REP', 'catalogo', true, true);

      expect(prisma.permissao.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role_modulo: { role: 'REP', modulo: 'catalogo' } },
          // toggle coarse limpa `acoes` (granularidade vive nos defaults).
          update: { podeVer: true, podeEditar: true, acoes: [] },
          create: { role: 'REP', modulo: 'catalogo', podeVer: true, podeEditar: true, acoes: [] },
        }),
      );
      // Cache deve refletir o novo valor
      expect(service.userCan('REP', 'catalogo', 'view')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listForRole
  // -------------------------------------------------------------------------

  describe('listForRole', () => {
    it('retorna mapa de módulo → ações para o papel', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        { role: 'REP', modulo: 'clientes', podeVer: true, podeEditar: false },
        { role: 'REP', modulo: 'pedidos', podeVer: true, podeEditar: true },
      ]);

      const result = await service.listForRole('REP');

      expect(result.clientes).toContain('view');
      expect(result.clientes).not.toContain('edit');
      expect(result.pedidos).toContain('view');
      expect(result.pedidos).toContain('create');
      expect(result.pedidos).toContain('edit');
    });

    it('retorna todos os módulos mesmo sem permissões configuradas', async () => {
      prisma.permissao.findMany.mockResolvedValue([]);

      const result = await service.listForRole('SAC');

      // Todos os módulos devem existir no resultado (arrays vazios)
      expect(Object.keys(result).length).toBeGreaterThan(0);
      for (const actions of Object.values(result)) {
        expect(actions).toEqual([]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // applyDefaults
  // -------------------------------------------------------------------------

  describe('applyDefaults', () => {
    it('faz upsert para cada role × módulo e recarrega cache', async () => {
      prisma.permissao.upsert.mockResolvedValue({});
      prisma.permissao.findMany.mockResolvedValue([]);

      await service.applyDefaults();

      // upsert deve ter sido chamado múltiplas vezes (muitos roles × módulos)
      expect(prisma.permissao.upsert.mock.calls.length).toBeGreaterThan(0);
      // Cache deve ter sido recarregado
      expect(prisma.permissao.findMany).toHaveBeenCalledTimes(2); // onModuleInit + applyDefaults
    });
  });
});
