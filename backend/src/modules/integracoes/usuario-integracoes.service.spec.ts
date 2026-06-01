import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { UsuarioIntegracoesService } from './usuario-integracoes.service';

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
  usuarioIntegracao: {
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
      ENCRYPTION_KEY: 'a'.repeat(64),
    };
    return map[k] ?? '';
  }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'user@betinna.ai',
  nome: 'User',
  role: 'REP' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeConexao = (overrides: Record<string, unknown> = {}) => ({
  id: 'conn-1',
  usuarioId: 'user-1',
  servico: 'openai',
  ativo: true,
  credenciais: 'enc:{"apiKey":"sk-test"}',
  ultimoSync: null,
  errosRecentes: 0,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('UsuarioIntegracoesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let env: ReturnType<typeof makeEnv>;
  let service: UsuarioIntegracoesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    env = makeEnv();
    service = new UsuarioIntegracoesService(prisma as never, env as never);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('retorna conexões do usuário sem credenciais expostas', async () => {
      prisma.usuarioIntegracao.findMany.mockResolvedValue([fakeConexao()]);

      const result = await service.list(fakeUser(), {});

      expect(result).toHaveLength(1);
      expect(result[0].credenciais).toBeNull();
      expect(result[0].credenciaisConfiguradas).toBe(true);
      expect(result[0].camposCredenciais).toContain('apiKey');
    });

    it('filtra por usuarioId do JWT', async () => {
      prisma.usuarioIntegracao.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ id: 'user-42' }), {});

      const args = prisma.usuarioIntegracao.findMany.mock.calls[0][0];
      expect(args.where.usuarioId).toBe('user-42');
    });

    it('filtra por servico quando passado', async () => {
      prisma.usuarioIntegracao.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { servico: 'openai' as never });

      const args = prisma.usuarioIntegracao.findMany.mock.calls[0][0];
      expect(args.where.servico).toBe('openai');
    });

    it('filtra por ativo quando passado', async () => {
      prisma.usuarioIntegracao.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ativo: false });

      const args = prisma.usuarioIntegracao.findMany.mock.calls[0][0];
      expect(args.where.ativo).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // findByServico
  // -------------------------------------------------------------------------

  describe('findByServico', () => {
    it('retorna conexão pública quando encontrada', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(fakeConexao());

      const result = await service.findByServico(fakeUser(), 'openai' as never);

      expect(result).not.toBeNull();
      expect(result!.servico).toBe('openai');
    });

    it('retorna null quando não existe', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(null);

      const result = await service.findByServico(fakeUser(), 'google_calendar' as never);

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // conectar / conectarInterno
  // -------------------------------------------------------------------------

  describe('conectar', () => {
    it('upserta conexão com credenciais criptografadas', async () => {
      const conn = fakeConexao();
      prisma.usuarioIntegracao.upsert.mockResolvedValue(conn);

      const result = await service.conectar(fakeUser(), {
        servico: 'openai' as never,
        credenciais: { apiKey: 'sk-test' },
      });

      expect(result.credenciaisConfiguradas).toBe(true);

      const upsertArgs = prisma.usuarioIntegracao.upsert.mock.calls[0][0];
      const savedCreds = upsertArgs.create.credenciais as string;
      expect(savedCreds).toMatch(/^enc:/);
    });

    it('invalida cache após upsert', async () => {
      prisma.usuarioIntegracao.upsert.mockResolvedValue(fakeConexao({ ativo: true }));
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));

      // Popula cache
      await service.obterCredenciaisInternas('user-1', 'openai' as never);
      // Conectar invalida o cache
      await service.conectar(fakeUser(), {
        servico: 'openai' as never,
        credenciais: { apiKey: 'new' },
      });
      // Próxima chamada deve ir ao banco de novo
      await service.obterCredenciaisInternas('user-1', 'openai' as never);

      expect(prisma.usuarioIntegracao.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('conectarInterno', () => {
    it('upserta com usuarioId passado diretamente (não via JWT)', async () => {
      prisma.usuarioIntegracao.upsert.mockResolvedValue(fakeConexao());

      await service.conectarInterno('user-77', 'google_calendar' as never, { accessToken: 'tok' });

      const upsertArgs = prisma.usuarioIntegracao.upsert.mock.calls[0][0];
      expect(upsertArgs.create.usuarioId).toBe('user-77');
    });
  });

  // -------------------------------------------------------------------------
  // desconectar
  // -------------------------------------------------------------------------

  describe('desconectar', () => {
    it('desativa conexão existente', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));
      prisma.usuarioIntegracao.update.mockResolvedValue(fakeConexao({ ativo: false }));

      const result = await service.desconectar(fakeUser(), 'openai' as never);

      expect(result).toEqual({ ok: true });
      const updateArgs = prisma.usuarioIntegracao.update.mock.calls[0][0];
      expect(updateArgs.data.ativo).toBe(false);
    });

    it('lança NotFoundException quando conexão não existe', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(null);

      await expect(service.desconectar(fakeUser(), 'openai' as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.usuarioIntegracao.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // obterCredenciaisInternas
  // -------------------------------------------------------------------------

  describe('obterCredenciaisInternas', () => {
    it('retorna credenciais descriptografadas', async () => {
      const conn = fakeConexao({
        credenciais: 'enc:{"apiKey":"sk-test123"}',
        ativo: true,
      });
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(conn);

      const result = await service.obterCredenciaisInternas('user-1', 'openai' as never);

      expect(result.credenciais).toEqual({ apiKey: 'sk-test123' });
    });

    it('cacheia resultado e não consulta banco na 2a chamada', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(fakeConexao({ ativo: true }));

      await service.obterCredenciaisInternas('user-1', 'openai' as never);
      await service.obterCredenciaisInternas('user-1', 'openai' as never); // cache hit

      expect(prisma.usuarioIntegracao.findUnique).toHaveBeenCalledTimes(1);
    });

    it('lança BusinessRuleException quando conexão não existe', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(null);

      await expect(
        service.obterCredenciaisInternas('user-1', 'openai' as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando conexão está inativa', async () => {
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(fakeConexao({ ativo: false }));

      await expect(
        service.obterCredenciaisInternas('user-1', 'openai' as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando credenciais corrompidas', async () => {
      const conn = fakeConexao({ credenciais: 'dados_sem_prefixo_invalidos', ativo: true });
      prisma.usuarioIntegracao.findUnique.mockResolvedValue(conn);

      await expect(
        service.obterCredenciaisInternas('user-1', 'openai' as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // registrarSyncOk / registrarSyncErro
  // -------------------------------------------------------------------------

  describe('registrarSyncOk', () => {
    it('atualiza ultimoSync e zera errosRecentes', async () => {
      prisma.usuarioIntegracao.updateMany.mockResolvedValue({ count: 1 });

      await service.registrarSyncOk('user-1', 'openai' as never);

      const args = prisma.usuarioIntegracao.updateMany.mock.calls[0][0];
      expect(args.data.errosRecentes).toBe(0);
      expect(args.data.ultimoSync).toBeInstanceOf(Date);
    });
  });

  describe('registrarSyncErro', () => {
    it('incrementa errosRecentes', async () => {
      prisma.usuarioIntegracao.updateMany.mockResolvedValue({ count: 1 });

      await service.registrarSyncErro('user-1', 'openai' as never);

      const args = prisma.usuarioIntegracao.updateMany.mock.calls[0][0];
      expect(args.data.errosRecentes).toEqual({ increment: 1 });
    });
  });
});
