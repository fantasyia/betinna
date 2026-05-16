import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, IntegrationException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { RefreshTokenService } from './refresh-token.service';

// ---------------------------------------------------------------------------
// Mock AuthGuard.invalidate — evita dep circular
// ---------------------------------------------------------------------------

vi.mock('./guards/auth.guard', () => ({
  AuthGuard: {
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRedisMock = () => ({
  eval: vi.fn(),
  del: vi.fn().mockResolvedValue(1),
});

const makeEnv = () => ({
  get: vi.fn(() => ''),
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RefreshTokenService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let service: RefreshTokenService;

  beforeEach(() => {
    redis = makeRedisMock();
    service = new RefreshTokenService(redis as never, makeEnv() as never);
  });

  // -------------------------------------------------------------------------
  // registerCurrent
  // -------------------------------------------------------------------------

  describe('registerCurrent', () => {
    it('aceita FIRST (primeiro registro, sem token anterior)', async () => {
      redis.eval.mockResolvedValue('FIRST');

      await expect(service.registerCurrent('user-1', 'token-abc')).resolves.toBeUndefined();
      expect(redis.eval).toHaveBeenCalledOnce();
    });

    it('aceita IDEMPOTENT (mesmo token registrado novamente)', async () => {
      redis.eval.mockResolvedValue('IDEMPOTENT');

      await expect(service.registerCurrent('user-1', 'token-abc')).resolves.toBeUndefined();
    });

    it('aceita ROTATED (token novo substituindo o anterior)', async () => {
      redis.eval.mockResolvedValue('ROTATED');

      await expect(service.registerCurrent('user-1', 'token-new')).resolves.toBeUndefined();
    });

    it('REUSE → invalida sessões e lança ForbiddenException', async () => {
      redis.eval.mockResolvedValue('REUSE');

      await expect(service.registerCurrent('user-1', 'stolen-token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Deve ter chamado del para invalidar refresh keys
      expect(redis.del).toHaveBeenCalledWith(
        'auth:refresh:current:user-1',
        'auth:refresh:previous:user-1',
      );
    });

    it('Redis indisponível → lança IntegrationException (fail-closed)', async () => {
      redis.eval.mockRejectedValue(new Error('Redis connection refused'));

      await expect(service.registerCurrent('user-1', 'token-abc')).rejects.toBeInstanceOf(
        IntegrationException,
      );
    });

    it('resultado inesperado → lança IntegrationException', async () => {
      redis.eval.mockResolvedValue('UNKNOWN_RESULT');

      await expect(service.registerCurrent('user-1', 'token-abc')).rejects.toBeInstanceOf(
        IntegrationException,
      );
    });

    it('chama eval com as chaves corretas para o userId', async () => {
      redis.eval.mockResolvedValue('FIRST');

      await service.registerCurrent('user-42', 'my-refresh-token');

      const [_script, keys] = redis.eval.mock.calls[0];
      expect(keys).toContain('auth:refresh:current:user-42');
      expect(keys).toContain('auth:refresh:previous:user-42');
    });

    it('passa hash do token (não o token cru) no ARGV[1]', async () => {
      redis.eval.mockResolvedValue('FIRST');
      const token = 'my-refresh-token';

      await service.registerCurrent('user-1', token);

      const [_script, _keys, argv] = redis.eval.mock.calls[0];
      // Hash deve ser hexadecimal de 32 chars (SHA-256 truncado)
      expect((argv[0] as string)).toMatch(/^[0-9a-f]{32}$/);
      expect((argv[0] as string)).not.toBe(token); // não é o token cru
    });
  });

  // -------------------------------------------------------------------------
  // signOut
  // -------------------------------------------------------------------------

  describe('signOut', () => {
    it('invalida sessões do usuário e remove refresh tracking', async () => {
      await service.signOut(fakeUser({ id: 'user-5' }));

      expect(redis.del).toHaveBeenCalledWith(
        'auth:refresh:current:user-5',
        'auth:refresh:previous:user-5',
      );
    });

    it('não lança mesmo se del falhar (já removido)', async () => {
      redis.del.mockRejectedValue(new Error('Redis key not found'));

      await expect(service.signOut(fakeUser())).resolves.toBeUndefined();
    });
  });
});
