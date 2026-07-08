import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
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
// Suite — só o logout (a detecção de reuse / refresh-track foi removida)
// ---------------------------------------------------------------------------

describe('RefreshTokenService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let service: RefreshTokenService;

  beforeEach(() => {
    redis = makeRedisMock();
    service = new RefreshTokenService(redis as never);
  });

  describe('signOut', () => {
    it('invalida sessões do usuário e remove as chaves de refresh', async () => {
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
