import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { PermissionsService } from './permissions.service';
import { MODULES } from './permissions.constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  permissao: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  } satisfies MockModel,
  usuarioPermissao: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
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
    // O boot agora roda seedMissingDefaults → limpa o histórico das spies pra
    // cada teste contar só as SUAS chamadas (mantém as implementações/retornos).
    prisma.permissao.findMany.mockClear();
    prisma.permissao.createMany.mockClear();
    prisma.permissao.upsert.mockClear();
    prisma.usuarioPermissao.findMany.mockClear();
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
  // userCanFor (override por usuário)
  // -------------------------------------------------------------------------

  describe('userCanFor', () => {
    it('sem override → cai na matriz do papel', async () => {
      prisma.permissao.findMany.mockResolvedValue([fakePerm({ podeVer: true })]);
      await service.reloadCache();

      expect(service.userCanFor('rep-1', 'REP', 'clientes', 'view')).toBe(true);
      expect(service.userCanFor('rep-1', 'REP', 'clientes', 'edit')).toBe(false);
    });

    it('override NEGA módulo que o papel permite', async () => {
      prisma.permissao.findMany.mockResolvedValue([fakePerm({ podeVer: true, podeEditar: true })]);
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'rep-1', modulo: 'clientes', podeVer: false, podeEditar: false },
      ]);
      await service.reloadCache();

      expect(service.userCanFor('rep-1', 'REP', 'clientes', 'view')).toBe(false);
      expect(service.userCanFor('rep-1', 'REP', 'clientes', 'edit')).toBe(false);
      // Outro rep do MESMO papel continua com a permissão do papel
      expect(service.userCanFor('rep-2', 'REP', 'clientes', 'view')).toBe(true);
    });

    it('override CONCEDE módulo que o papel nega', async () => {
      prisma.permissao.findMany.mockResolvedValue([]); // papel sem nada
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'rep-1', modulo: 'relatorios', podeVer: true, podeEditar: false },
      ]);
      await service.reloadCache();

      expect(service.userCanFor('rep-1', 'REP', 'relatorios', 'view')).toBe(true);
      expect(service.userCanFor('rep-1', 'REP', 'relatorios', 'edit')).toBe(false);
      expect(service.userCanFor('rep-2', 'REP', 'relatorios', 'view')).toBe(false);
    });

    it('ADMIN ignora overrides (bypass)', async () => {
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'adm-1', modulo: 'clientes', podeVer: false, podeEditar: false },
      ]);
      await service.reloadCache();

      expect(service.userCanFor('adm-1', 'ADMIN', 'clientes', 'delete')).toBe(true);
    });

    it('P0: override "editar" concede edit/view mas NÃO escala pra delete/approve além do papel', async () => {
      // Papel REP tem só view+edit em kanban (sem delete/approve).
      prisma.permissao.findMany.mockResolvedValue([
        fakePerm({ role: 'REP', modulo: 'kanban', acoes: ['view', 'edit'] }),
      ]);
      // Usuário recebe override de edição no kanban.
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'rep-1', modulo: 'kanban', podeVer: true, podeEditar: true },
      ]);
      await service.reloadCache();

      // view/edit: o override controla direto
      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'view')).toBe(true);
      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'edit')).toBe(true);
      // delete/approve: papel não tem → override de "editar" NÃO concede (sem escalonamento)
      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'delete')).toBe(false);
      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'approve')).toBe(false);
    });

    it('P0: override que REMOVE edição tira também as ações críticas', async () => {
      // Papel REP tem delete no kanban, mas o override zera a edição do usuário.
      prisma.permissao.findMany.mockResolvedValue([
        fakePerm({ role: 'REP', modulo: 'kanban', acoes: ['view', 'edit', 'delete'] }),
      ]);
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'rep-1', modulo: 'kanban', podeVer: true, podeEditar: false },
      ]);
      await service.reloadCache();

      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'view')).toBe(true);
      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'edit')).toBe(false);
      // podeEditar=false → ação crítica também bloqueada (AND com o papel)
      expect(service.userCanFor('rep-1', 'REP', 'kanban', 'delete')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // listEffectiveForUser
  // -------------------------------------------------------------------------

  describe('listEffectiveForUser', () => {
    it('mescla papel + override com flag override=true', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        { role: 'REP', modulo: 'clientes', podeVer: true, podeEditar: true },
        { role: 'REP', modulo: 'pedidos', podeVer: true, podeEditar: false },
      ]);
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'rep-1', modulo: 'clientes', podeVer: false, podeEditar: false },
      ]);

      const rows = await service.listEffectiveForUser('rep-1', 'REP');
      const clientes = rows.find((r) => r.modulo === 'clientes');
      const pedidos = rows.find((r) => r.modulo === 'pedidos');

      expect(clientes).toMatchObject({ podeVer: false, podeEditar: false, override: true });
      expect(pedidos).toMatchObject({ podeVer: true, podeEditar: false, override: false });
    });

    it('ADMIN → tudo true sem override', async () => {
      const rows = await service.listEffectiveForUser('adm-1', 'ADMIN');
      expect(rows.every((r) => r.podeVer && r.podeEditar && !r.override)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // upsertUserOverride / removeUserOverride
  // -------------------------------------------------------------------------

  describe('overrides — escrita', () => {
    it('upsertUserOverride grava e recarrega cache', async () => {
      prisma.usuarioPermissao.upsert.mockResolvedValue({});
      prisma.usuarioPermissao.findMany.mockResolvedValue([
        { usuarioId: 'rep-1', modulo: 'catalogo', podeVer: true, podeEditar: true },
      ]);

      await service.upsertUserOverride('rep-1', 'catalogo', true, true);

      expect(prisma.usuarioPermissao.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { usuarioId_modulo: { usuarioId: 'rep-1', modulo: 'catalogo' } },
        }),
      );
      expect(service.userCanFor('rep-1', 'REP', 'catalogo', 'edit')).toBe(true);
    });

    it('removeUserOverride apaga e volta ao padrão do papel', async () => {
      prisma.usuarioPermissao.deleteMany.mockResolvedValue({ count: 1 });
      prisma.permissao.findMany.mockResolvedValue([
        fakePerm({ modulo: 'catalogo', podeVer: true }),
      ]);
      prisma.usuarioPermissao.findMany.mockResolvedValue([]);

      await service.removeUserOverride('rep-1', 'catalogo');

      expect(prisma.usuarioPermissao.deleteMany).toHaveBeenCalledWith({
        where: { usuarioId: 'rep-1', modulo: 'catalogo' },
      });
      expect(service.userCanFor('rep-1', 'REP', 'catalogo', 'view')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listForRoleRows
  // -------------------------------------------------------------------------

  describe('listForRoleRows', () => {
    it('deriva podeVer/podeEditar das ações e cobre todos os módulos', async () => {
      prisma.permissao.findMany.mockResolvedValue([
        { role: 'REP', modulo: 'clientes', podeVer: true, podeEditar: false },
        { role: 'REP', modulo: 'pedidos', podeVer: true, podeEditar: true },
      ]);

      const rows = await service.listForRoleRows('REP');

      expect(rows.find((r) => r.modulo === 'clientes')).toMatchObject({
        podeVer: true,
        podeEditar: false,
      });
      expect(rows.find((r) => r.modulo === 'pedidos')).toMatchObject({
        podeVer: true,
        podeEditar: true,
      });
      // módulo não configurado aparece com tudo false
      expect(rows.find((r) => r.modulo === 'relatorios')).toMatchObject({
        podeVer: false,
        podeEditar: false,
      });
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
      // Cache deve ter sido recarregado (1 findMany do reloadCache do applyDefaults;
      // o histórico do boot foi limpo no beforeEach).
      expect(prisma.permissao.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('seedMissingDefaults (create-only)', () => {
    it('cria só as linhas que faltam e NUNCA toca nas existentes', async () => {
      // Estado tipo-prod: só "quadros" existe pra cada papel; resto faltando.
      const roles: UserRole[] = ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP'];
      prisma.permissao.findMany.mockResolvedValueOnce(
        roles.map((role) => ({ role, modulo: 'quadros' })),
      );

      const n = await service.seedMissingDefaults();

      expect(prisma.permissao.createMany).toHaveBeenCalledTimes(1);
      const data = prisma.permissao.createMany.mock.calls[0][0].data as Array<{
        role: string;
        modulo: string;
        podeVer: boolean;
        acoes: string[];
      }>;
      // Nenhuma linha de "quadros" é recriada (já existe → preservada).
      expect(data.some((d) => d.modulo === 'quadros')).toBe(false);
      // DIRECTOR ganha o "dashboard" que faltava (causa do 403), com view.
      const dash = data.find((d) => d.role === 'DIRECTOR' && d.modulo === 'dashboard');
      expect(dash?.podeVer).toBe(true);
      expect(dash?.acoes).toContain('view');
      expect(n).toBe(data.length);
    });

    it('é no-op quando todas as linhas já existem', async () => {
      const roles: UserRole[] = ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP'];
      const todas = roles.flatMap((role) => MODULES.map((modulo) => ({ role, modulo })));
      prisma.permissao.findMany.mockResolvedValueOnce(todas);

      const n = await service.seedMissingDefaults();

      expect(n).toBe(0);
      expect(prisma.permissao.createMany).not.toHaveBeenCalled();
    });
  });
});
