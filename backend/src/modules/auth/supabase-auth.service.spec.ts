import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { SupabaseAuthService } from './supabase-auth.service';

// ---------------------------------------------------------------------------
// Mock jose — sem JWTs reais em testes unitários
// ---------------------------------------------------------------------------

const { mockJwtVerify, mockCreateRemoteJWKSet } = vi.hoisted(() => ({
  mockJwtVerify: vi.fn(),
  mockCreateRemoteJWKSet: vi.fn(() => 'fake-jwks-client'),
}));

vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SupabaseAuthService', () => {
  let service: SupabaseAuthService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('com SUPABASE_JWT_SECRET configurado (HS256)', () => {
    beforeEach(() => {
      service = new SupabaseAuthService(makeEnv() as never);
    });

    it('verifica token HS256 válido e retorna payload', async () => {
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      const result = await service.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIGNATURE');

      expect(result.sub).toBe('user-uuid-123');
      expect(mockJwtVerify).toHaveBeenCalledOnce();
    });

    it('chama jwtVerify com audience=authenticated e algorithm pinning HS256', async () => {
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      await service.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIGNATURE');

      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[2]).toMatchObject({
        audience: 'authenticated',
        algorithms: ['HS256'],
      });
    });

    it('lança UnauthorizedException quando token está ausente/curto', async () => {
      await expect(service.verifyToken('')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.verifyToken('short')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('lança UnauthorizedException para token sem sub (payload inválido)', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { aud: 'authenticated' } }); // sem sub

      await expect(service.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIGNATURE')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lança UnauthorizedException com código AUTH_EXPIRED_TOKEN para token expirado', async () => {
      const expError = new Error('exp claim expired');
      mockJwtVerify.mockRejectedValue(expError);

      try {
        await service.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjF9.EXPIRED');
        expect.fail('Deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        expect((e as { code?: string }).code ?? (e as { errorCode?: string }).errorCode).toContain('EXPIRED');
      }
    });

    it('lança UnauthorizedException para token inválido genérico', async () => {
      mockJwtVerify.mockRejectedValue(new Error('Signature verification failed'));

      await expect(service.verifyToken('ineyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIGNATURE')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('relança UnauthorizedException sem alterar', async () => {
      const e = new UnauthorizedException('já era unauthorized');
      mockJwtVerify.mockRejectedValue(e);

      await expect(service.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.anytoken')).rejects.toBe(e);
    });
  });

  describe('sem SUPABASE_JWT_SECRET — fallback JWKS (RS256)', () => {
    beforeEach(() => {
      service = new SupabaseAuthService(makeEnv({ SUPABASE_JWT_SECRET: '' }) as never);
    });

    it('usa JWKS client quando não há secret', async () => {
      mockJwtVerify.mockResolvedValue({ payload: fakePayload() });

      const result = await service.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIGNATURE');

      expect(result.sub).toBe('user-uuid-123');
      // Deve ter chamado jwtVerify com o JWKS client (string 'fake-jwks-client')
      const callArgs = mockJwtVerify.mock.calls[0];
      expect(callArgs[1]).toBe('fake-jwks-client');
      expect(callArgs[2]).toMatchObject({
        audience: 'authenticated',
        algorithms: ['RS256'],
      });
    });
  });

  describe('sem secret e sem JWKS (configuração inválida)', () => {
    it('lança UnauthorizedException quando nenhum método de auth está disponível', async () => {
      // Simulamos um env sem secret e fazemos o createRemoteJWKSet falhar
      const brokenService = new SupabaseAuthService(
        makeEnv({ SUPABASE_JWT_SECRET: '' }) as never,
      );
      // Força jwksClient a ser undefined simulando uma falha de configuração
      // (na prática isso não acontece via construtor normal, mas cobre o branch)
      (brokenService as unknown as { jwksClient: undefined }).jwksClient = undefined;
      (brokenService as unknown as { hsSecret: undefined }).hsSecret = undefined;

      await expect(brokenService.verifyToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.anytoken')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
