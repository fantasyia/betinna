import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { IntegracoesService } from './integracoes.service';

// ---------------------------------------------------------------------------
// Mock CryptoUtil — sem crypto real em testes unitários
// ---------------------------------------------------------------------------
vi.mock('@shared/utils/crypto.util', () => ({
  CryptoUtil: vi.fn().mockImplementation(() => ({
    encrypt: vi.fn((text: string) => `enc:${text}`),
    decrypt: vi.fn((text: string) => {
      if (text.startsWith('enc:')) return text.slice(4);
      throw new Error('Invalid ciphertext');
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  integracaoConexao: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  } satisfies MockModel,
});

const makeEnv = () => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      ENCRYPTION_KEY: 'a'.repeat(64), // 32 bytes hex fake
    };
    return map[k] ?? '';
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeConexao = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  empresaId: 'emp-1',
  servico: 'omie',
  ativo: true,
  credenciais: 'enc:{"appKey":"key123","appSecret":"secret"}',
  externalAccountId: null,
  ultimoSync: null,
  errosRecentes: 0,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('IntegracoesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let env: ReturnType<typeof makeEnv>;
  let service: IntegracoesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    env = makeEnv();
    // Mock do semáforo de status (Sprint 2.1) — não é foco deste spec.
    const statusMock = {
      registrarSucesso: vi.fn().mockResolvedValue(undefined),
      registrarErro: vi.fn().mockResolvedValue(undefined),
      marcarDesconectado: vi.fn().mockResolvedValue(undefined),
      listar: vi.fn().mockResolvedValue([]),
    };
    service = new IntegracoesService(prisma as never, env as never, statusMock as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('retorna conexões da empresa sem credenciais expostas', async () => {
      prisma.integracaoConexao.findMany.mockResolvedValue([fakeConexao()]);

      const result = await service.list(fakeUser(), {});

      expect(result).toHaveLength(1);
      // Credenciais mascaradas na saída pública: o tipo ConexaoPublica omite o
      // campo e o runtime ainda o devolve como null. Lemos via Record pra
      // confirmar o mascaramento sem reexpor o campo no contrato público.
      expect((result[0] as Record<string, unknown>).credenciais).toBeNull();
      // Mas campos detectados
      expect(result[0].credenciaisConfiguradas).toBe(true);
      expect(result[0].camposCredenciais).toContain('appKey');
    });

    it('filtra por empresaId do usuário', async () => {
      prisma.integracaoConexao.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ empresaIdAtiva: 'emp-5' }), {});

      const args = prisma.integracaoConexao.findMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-5');
    });

    it('filtra por servico quando passado', async () => {
      prisma.integracaoConexao.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { servico: 'omie' as never });

      const args = prisma.integracaoConexao.findMany.mock.calls[0][0];
      expect(args.where.servico).toBe('omie');
    });

    it('filtra por ativo quando passado', async () => {
      prisma.integracaoConexao.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ativo: false });

      const args = prisma.integracaoConexao.findMany.mock.calls[0][0];
      expect(args.where.ativo).toBe(false);
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(service.list(fakeUser({ empresaIdAtiva: null }), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // findByServico
  // -------------------------------------------------------------------------

  describe('findByServico', () => {
    it('retorna conexão pública quando encontrada', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(fakeConexao());

      const result = await service.findByServico(fakeUser(), 'omie' as never);

      expect(result).not.toBeNull();
      expect(result!.servico).toBe('omie');
    });

    it('retorna null quando não existe', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(null);

      const result = await service.findByServico(fakeUser(), 'shopee' as never);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // conectar
  // -------------------------------------------------------------------------

  describe('conectar', () => {
    const directorUser = (overrides: Partial<AuthenticatedUser> = {}) =>
      fakeUser({ role: 'DIRECTOR' as UserRole, ...overrides });

    it('upserta conexão com credenciais criptografadas', async () => {
      const conn = fakeConexao();
      prisma.integracaoConexao.upsert.mockResolvedValue(conn);

      const result = await service.conectar(directorUser(), {
        servico: 'omie' as never,
        credenciais: { appKey: 'k', appSecret: 's' },
      });

      expect(result.credenciaisConfiguradas).toBe(true);

      // Verifica que credenciais foram criptografadas antes de salvar
      const upsertArgs = prisma.integracaoConexao.upsert.mock.calls[0][0];
      const savedCreds = upsertArgs.create.credenciais as string;
      expect(savedCreds).toMatch(/^enc:/); // mock prefix
    });

    it('invalida o cache após upsert', async () => {
      prisma.integracaoConexao.upsert.mockResolvedValue(fakeConexao());

      // Popula cache manualmente via obterCredenciaisInternas
      prisma.integracaoConexao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));
      await service.obterCredenciaisInternas('emp-1', 'omie' as never);
      // Agora conectar deve invalidar
      await service.conectar(directorUser(), {
        servico: 'omie' as never,
        credenciais: { appKey: 'new' },
      });
      // Próximo obterCredenciaisInternas deve ir ao banco de novo
      prisma.integracaoConexao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));
      await service.obterCredenciaisInternas('emp-1', 'omie' as never);

      // findUnique chamado 2x: primeira consulta + após invalidação
      expect(prisma.integracaoConexao.findUnique).toHaveBeenCalledTimes(2);
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.conectar(directorUser({ empresaIdAtiva: null }), {
          servico: 'omie' as never,
          credenciais: {},
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // D48: requerDirector aceita DIRECTOR (mandatário do tenant) OU ADMIN
    // (master da plataforma — opera cross-tenant como suporte/override).
    // Outros papéis seguem bloqueados.
    describe('D48: requerDirector aceita DIRECTOR ou ADMIN', () => {
      it.each(['GERENTE', 'REP', 'SAC'] as const)(
        '%s não pode conectar OMIE (sem escopo cross-tenant nem mandato de tenant)',
        async (role) => {
          await expect(
            service.conectar(fakeUser({ role: role as UserRole }), {
              servico: 'omie' as never,
              credenciais: {},
            }),
          ).rejects.toBeInstanceOf(ForbiddenException);
        },
      );

      it('DIRECTOR pode conectar OMIE (mandatário do tenant)', async () => {
        prisma.integracaoConexao.upsert.mockResolvedValue(fakeConexao());

        await expect(
          service.conectar(fakeUser({ role: 'DIRECTOR' as UserRole }), {
            servico: 'omie' as never,
            credenciais: { appKey: 'k', appSecret: 's' },
          }),
        ).resolves.toBeDefined();
      });

      it('ADMIN pode conectar OMIE (master da plataforma — cross-tenant override)', async () => {
        prisma.integracaoConexao.upsert.mockResolvedValue(fakeConexao());

        await expect(
          service.conectar(fakeUser({ role: 'ADMIN' as UserRole }), {
            servico: 'omie' as never,
            credenciais: { appKey: 'k', appSecret: 's' },
          }),
        ).resolves.toBeDefined();
      });

      it.each([
        'omie',
        'whatsapp',
        'mercadolivre',
        'shopee',
        'amazon',
        'tiktok',
        'instagram',
        'facebook',
      ] as const)('GERENTE bloqueado em %s (todas as integrações empresa)', async (servico) => {
        await expect(
          service.conectar(fakeUser({ role: 'GERENTE' as UserRole }), {
            servico: servico as never,
            credenciais: {},
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });
  });

  // -------------------------------------------------------------------------
  // desconectar
  // -------------------------------------------------------------------------

  describe('desconectar', () => {
    const directorUser = () => fakeUser({ role: 'DIRECTOR' as UserRole });

    it('desativa conexão existente', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));
      prisma.integracaoConexao.update.mockResolvedValue(fakeConexao({ ativo: false }));

      const result = await service.desconectar(directorUser(), 'omie' as never);

      expect(result).toEqual({ ok: true });
      const updateArgs = prisma.integracaoConexao.update.mock.calls[0][0];
      expect(updateArgs.data.ativo).toBe(false);
    });

    it('lança NotFoundException quando conexão não existe', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(null);

      await expect(service.desconectar(directorUser(), 'omie' as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.integracaoConexao.update).not.toHaveBeenCalled();
    });

    // D48 — DIRECTOR ou ADMIN pode desconectar; outros papéis bloqueados
    it('ADMIN pode desconectar OMIE (master da plataforma)', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));

      await expect(
        service.desconectar(fakeUser({ role: 'ADMIN' as UserRole }), 'omie' as never),
      ).resolves.toBeDefined();
    });

    it('GERENTE não pode desconectar OMIE (sem escopo cross-tenant)', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));

      await expect(
        service.desconectar(fakeUser({ role: 'GERENTE' as UserRole }), 'omie' as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // obterCredenciaisInternas
  // -------------------------------------------------------------------------

  describe('obterCredenciaisInternas', () => {
    it('retorna credenciais descriptografadas', async () => {
      const conn = fakeConexao({
        credenciais: 'enc:{"appKey":"key123","appSecret":"s3cr3t"}',
        ativo: true,
      });
      prisma.integracaoConexao.findUnique.mockResolvedValue(conn);

      const result = await service.obterCredenciaisInternas('emp-1', 'omie' as never);

      expect(result.credenciais).toEqual({ appKey: 'key123', appSecret: 's3cr3t' });
    });

    it('cacheia resultado e não consulta o banco na 2a chamada', async () => {
      const conn = fakeConexao({ ativo: true });
      prisma.integracaoConexao.findUnique.mockResolvedValue(conn);

      await service.obterCredenciaisInternas('emp-1', 'omie' as never);
      await service.obterCredenciaisInternas('emp-1', 'omie' as never); // cache hit

      expect(prisma.integracaoConexao.findUnique).toHaveBeenCalledTimes(1);
    });

    it('lança BusinessRuleException quando conexão não existe', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(null);

      await expect(
        service.obterCredenciaisInternas('emp-1', 'omie' as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando conexão está inativa', async () => {
      const conn = fakeConexao({ ativo: false });
      prisma.integracaoConexao.findUnique.mockResolvedValue(conn);

      await expect(
        service.obterCredenciaisInternas('emp-1', 'omie' as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando credenciais corrompidas', async () => {
      const conn = fakeConexao({ credenciais: 'dados_invalidos_sem_prefixo', ativo: true });
      prisma.integracaoConexao.findUnique.mockResolvedValue(conn);

      await expect(
        service.obterCredenciaisInternas('emp-1', 'omie' as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // salvarCredenciaisInternas (par de escrita do obterCredenciaisInternas)
  // -------------------------------------------------------------------------

  describe('salvarCredenciaisInternas', () => {
    it('cifra as credenciais e faz upsert (ativo, erros zerados, externalAccountId)', async () => {
      prisma.integracaoConexao.upsert.mockResolvedValue(fakeConexao());
      prisma.integracaoConexao.updateMany.mockResolvedValue({ count: 1 });

      await service.salvarCredenciaisInternas(
        'emp-1',
        'mercadolivre' as never,
        { accessToken: 'at', refreshToken: 'rt', userId: '999' },
        '999',
      );

      const args = prisma.integracaoConexao.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        empresaId_servico: { empresaId: 'emp-1', servico: 'mercadolivre' },
      });
      // Credenciais cifradas (prefixo do mock) tanto no create quanto no update.
      expect(args.create.credenciais).toMatch(/^enc:/);
      expect(args.update.credenciais).toMatch(/^enc:/);
      // O texto cifrado embute o JSON das credenciais (nunca persiste em claro).
      expect(args.create.credenciais).toContain('"userId":"999"');
      expect(args.create.ativo).toBe(true);
      expect(args.update.ativo).toBe(true);
      expect(args.update.errosRecentes).toBe(0);
      expect(args.create.externalAccountId).toBe('999');
      expect(args.update.externalAccountId).toBe('999');
    });

    it('grava externalAccountId igual em create E update (contrato sem assimetria null)', async () => {
      prisma.integracaoConexao.upsert.mockResolvedValue(fakeConexao());
      prisma.integracaoConexao.updateMany.mockResolvedValue({ count: 1 });

      await service.salvarCredenciaisInternas(
        'emp-1',
        'shopee' as never,
        { token: 'x' },
        'shop-77',
      );

      const args = prisma.integracaoConexao.upsert.mock.calls[0][0];
      // Contrato endurecido: externalAccountId é obrigatório e gravado idêntico nos
      // dois lados — nunca undefined (que preservaria no update mas viraria NULL no create).
      expect(args.create.externalAccountId).toBe('shop-77');
      expect(args.update.externalAccountId).toBe('shop-77');
    });

    it('invalida o cache após salvar (write-through — não serve credencial velha)', async () => {
      // 1) popula o cache com a credencial antiga
      prisma.integracaoConexao.findUnique.mockResolvedValue(
        fakeConexao({ credenciais: 'enc:{"token":"velho"}', ativo: true }),
      );
      const antes = await service.obterCredenciaisInternas('emp-1', 'omie' as never);
      expect(antes.credenciais).toEqual({ token: 'velho' });

      // 2) grava credencial nova (passa por registrarSyncOk → invalidarCache)
      prisma.integracaoConexao.upsert.mockResolvedValue(fakeConexao());
      prisma.integracaoConexao.updateMany.mockResolvedValue({ count: 1 });
      await service.salvarCredenciaisInternas('emp-1', 'omie' as never, { token: 'novo' }, 'acc-1');

      // 3) próxima leitura vai ao banco de novo (cache invalidado) e vê a nova
      prisma.integracaoConexao.findUnique.mockResolvedValue(
        fakeConexao({ credenciais: 'enc:{"token":"novo"}', ativo: true }),
      );
      const depois = await service.obterCredenciaisInternas('emp-1', 'omie' as never);
      expect(depois.credenciais).toEqual({ token: 'novo' });
      expect(prisma.integracaoConexao.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // registrarSyncOk / registrarSyncErro
  // -------------------------------------------------------------------------

  describe('registrarSyncOk', () => {
    it('atualiza ultimoSync e zera errosRecentes', async () => {
      prisma.integracaoConexao.updateMany.mockResolvedValue({ count: 1 });

      await service.registrarSyncOk('emp-1', 'omie' as never);

      const args = prisma.integracaoConexao.updateMany.mock.calls[0][0];
      expect(args.data.errosRecentes).toBe(0);
      expect(args.data.ultimoSync).toBeInstanceOf(Date);
    });
  });

  describe('registrarSyncErro', () => {
    it('incrementa errosRecentes', async () => {
      prisma.integracaoConexao.updateMany.mockResolvedValue({ count: 1 });

      await service.registrarSyncErro('emp-1', 'omie' as never);

      const args = prisma.integracaoConexao.updateMany.mock.calls[0][0];
      expect(args.data.errosRecentes).toEqual({ increment: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // listarAtivasPorServico
  // -------------------------------------------------------------------------

  describe('listarAtivasPorServico', () => {
    it('retorna mapeamento empresaId/conexaoId de conexões ativas', async () => {
      prisma.integracaoConexao.findMany.mockResolvedValue([
        { id: 'conn-1', empresaId: 'emp-1' },
        { id: 'conn-2', empresaId: 'emp-2' },
      ]);

      const result = await service.listarAtivasPorServico('omie' as never);

      expect(result).toEqual([
        { empresaId: 'emp-1', conexaoId: 'conn-1' },
        { empresaId: 'emp-2', conexaoId: 'conn-2' },
      ]);

      const args = prisma.integracaoConexao.findMany.mock.calls[0][0];
      expect(args.where.servico).toBe('omie');
      expect(args.where.ativo).toBe(true);
    });
  });
});
