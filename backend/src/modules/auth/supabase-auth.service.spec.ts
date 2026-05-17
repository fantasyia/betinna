import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { SupabaseAuthService } from './supabase-auth.service';

// ---------------------------------------------------------------------------
// Mock jose — sem JWTs reais em testes unitários
// ---------------------------------------------------------------------------

const { mockJwtVerify, mockCreateRemoteJWKSet, mockDecodeProtectedHeader } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
  mockCreateRemoteJWKSet: vi.fn(() => 'fake-jwks-client'),
  mockDecodeProtectedHeader: vi.fn(() => ({ alg: 'HS256' })),
}));

vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  decodeProtectedHeader: mockDecodeProtectedHeader,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEnv = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string => {
    const defaults: Record<string, string> = {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_JWT_SECRET: 'super-secret-jwt',
      ...overrides,
    };
    return defaults[k] ?? '';
  }),
});

const fakePayload = (overrides: Record<string, unknown> = {}) => ({
  sub: 'user-uuid-123',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'user@test.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...overrides,
});

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIGNATURE_LONG_ENOUGH_FOR_TEST';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SupabaseAuthService', () => {
  let service: SupabaseAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // default: tokens são HS256 a menos que test sobrescreva
    mockDecodeProtectedHeader.mockReturnValue({ alg: 'HS256' });
  });

  describe('com SUPABASE_JWT_SECRET configurado (HS256)', () => {
    beforeEach(() => {
      service = new SupabaseAuthService(makeEnv() as never);
    });

    it('verifica token HS256 válido e retorna payload', async () => {
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      const result = await service.verifyToken(TOKEN);

      expect(result.sub).toBe('user-uuid-123');
      expect(mockJwtVerify).toHaveBeenCalledOnce();
    });

    it('chama jwtVerify com audience=authenticated e algorithm pinning HS256', async () => {
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      await service.verifyToken(TOKEN);

      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[2]).toMatchObject({
        audience: 'authenticated',
        algorithms: ['HS256'],
      });
    });

    it('aceita issuer com ou sem trailing slash (tolerância config Railway)', async () => {
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      await service.verifyToken(TOKEN);

      const callArgs = mockJwtVerify.mock.calls[0];
      const issuerArg = callArgs[2].issuer;
      // issuer agora é array com variantes
      expect(Array.isArray(issuerArg)).toBe(true);
      expect(issuerArg).toContain('https://test.supabase.co/auth/v1');
      expect(issuerArg).toContain('https://test.supabase.co/auth/v1/');
    });

    it('lança UnauthorizedException quando token está ausente/curto', async () => {
      await expect(service.verifyToken('')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.verifyToken('short')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('lança UnauthorizedException para token sem sub (payload inválido)', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { aud: 'authenticated' } });

      await expect(service.verifyToken(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lança UnauthorizedException com código AUTH_EXPIRED_TOKEN para token expirado', async () => {
      const expError = new Error('exp claim expired');
      mockJwtVerify.mockRejectedValue(expError);

      try {
        await service.verifyToken(TOKEN);
        expect.fail('Deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect((e as { code?: string }).code ?? (e as { errorCode?: string }).errorCode).toContain(
          'EXPIRED',
        );
      }
    });

    it('lança UnauthorizedException para token inválido genérico', async () => {
      mockJwtVerify.mockRejectedValue(new Error('Signature verification failed'));

      await expect(service.verifyToken(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('relança UnauthorizedException sem alterar', async () => {
      const e = new UnauthorizedException('já era unauthorized');
      mockJwtVerify.mockRejectedValue(e);

      await expect(service.verifyToken(TOKEN)).rejects.toBe(e);
    });

    it('lança UnauthorizedException quando token tem header malformado', async () => {
      mockDecodeProtectedHeader.mockImplementation(() => {
        throw new Error('Invalid header');
      });

      await expect(service.verifyToken(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('auto-detecção de algoritmo (HS256 vs RS256)', () => {
    beforeEach(() => {
      service = new SupabaseAuthService(makeEnv() as never);
    });

    it('quando JWT tem alg=RS256 e há JWKS, roteia para JWKS mesmo com HS secret configurado', async () => {
      mockDecodeProtectedHeader.mockReturnValue({ alg: 'RS256' });
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      const result = await service.verifyToken(TOKEN);

      expect(result.sub).toBe('user-uuid-123');
      // Deve ter chamado com JWKS client e RS256
      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[1]).toBe('fake-jwks-client');
      expect(callArgs[2]).toMatchObject({ algorithms: ['RS256'] });
    });

    it('quando JWT tem alg=HS256, usa HS secret mesmo com JWKS disponível', async () => {
      mockDecodeProtectedHeader.mockReturnValue({ alg: 'HS256' });
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      await service.verifyToken(TOKEN);

      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[2]).toMatchObject({ algorithms: ['HS256'] });
    });

    it('rejeita algoritmo não suportado', async () => {
      mockDecodeProtectedHeader.mockReturnValue({ alg: 'none' });

      await expect(service.verifyToken(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('aceita ES256 via JWKS', async () => {
      mockDecodeProtectedHeader.mockReturnValue({ alg: 'ES256' });
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      await service.verifyToken(TOKEN);

      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[2]).toMatchObject({ algorithms: ['ES256'] });
    });
  });

  describe('sem SUPABASE_JWT_SECRET — fallback JWKS (RS256)', () => {
    beforeEach(() => {
      service = new SupabaseAuthService(makeEnv({ SUPABASE_JWT_SECRET: '' }) as never);
    });

    it('rejeita token HS256 quando secret não está configurado', async () => {
      mockDecodeProtectedHeader.mockReturnValue({ alg: 'HS256' });

      await expect(service.verifyToken(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('verifica token RS256 via JWKS', async () => {
      mockDecodeProtectedHeader.mockReturnValue({ alg: 'RS256' });
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      const result = await service.verifyToken(TOKEN);

      expect(result.sub).toBe('user-uuid-123');
      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[1]).toBe('fake-jwks-client');
      expect(callArgs[2]).toMatchObject({ algorithms: ['RS256'] });
    });
  });

  describe('tolerância a SUPABASE_URL com trailing slash', () => {
    it('normaliza SUPABASE_URL removendo trailing slash', async () => {
      service = new SupabaseAuthService(
        makeEnv({ SUPABASE_URL: 'https://test.supabase.co/' }) as never,
      );
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      await service.verifyToken(TOKEN);

      const callArgs = mockJwtVerify.mock.calls[0];
      // Issuer não deve ter slash duplo nem trailing slash incorreto
      expect(callArgs[2].issuer).toContain('https://test.supabase.co/auth/v1');
    });
  });
});
