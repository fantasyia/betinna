import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { EnvService } from './env.service';

/**
 * Testa a trava de go-live do OMIE em `auditProductionReadiness` /
 * `enforceProductionReadiness`.
 *
 * Regra: demo em produção é só AVISO por padrão (dormente). Quando
 * `OMIE_REQUIRE_REAL=true`, vira CRÍTICO e o boot deve abortar.
 */

// Chave hex forte (64 chars, não-repetida) pra não disparar o alerta de ENCRYPTION_KEY fraca.
const STRONG_KEY = 'a3f1c29b4d7e0856b1f2a9c3d4e5f6079a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3';

function makeEnv(overrides: Record<string, unknown>): EnvService {
  const values: Record<string, unknown> = {
    NODE_ENV: 'production',
    ENCRYPTION_KEY: STRONG_KEY,
    SUPABASE_JWT_SECRET: 'algum-segredo-jwt',
    OMIE_DEMO_MODE: true,
    OMIE_REQUIRE_REAL: false,
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'no-reply@betinna.ai',
    ...overrides,
  };
  const stub = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new EnvService(stub);
}

describe('EnvService — trava OMIE go-live', () => {
  it('produção + demo=true + require_real=false → só AVISO (não aborta)', () => {
    const env = makeEnv({ OMIE_DEMO_MODE: true, OMIE_REQUIRE_REAL: false });
    const issues = env.auditProductionReadiness();
    const omie = issues.find((i) => i.key === 'OMIE_DEMO_MODE');
    expect(omie?.severity).toBe('warning');
    // Não deve lançar (warning não bloqueia boot)
    expect(() => env.enforceProductionReadiness()).not.toThrow();
  });

  it('produção + demo=true + require_real=true → CRÍTICO (aborta o boot)', () => {
    const env = makeEnv({ OMIE_DEMO_MODE: true, OMIE_REQUIRE_REAL: true });
    const issues = env.auditProductionReadiness();
    const omie = issues.find((i) => i.key === 'OMIE_DEMO_MODE');
    expect(omie?.severity).toBe('critical');
    // Crítico em produção deve lançar erro (abortar boot)
    expect(() => env.enforceProductionReadiness()).toThrow();
  });

  it('produção + demo=false → sem alerta de OMIE, mesmo com require_real=true', () => {
    const env = makeEnv({ OMIE_DEMO_MODE: false, OMIE_REQUIRE_REAL: true });
    const issues = env.auditProductionReadiness();
    expect(issues.find((i) => i.key === 'OMIE_DEMO_MODE')).toBeUndefined();
    expect(() => env.enforceProductionReadiness()).not.toThrow();
  });

  it('desenvolvimento + demo=true + require_real=true → não aborta (trava só vale em produção)', () => {
    const env = makeEnv({ NODE_ENV: 'development', OMIE_DEMO_MODE: true, OMIE_REQUIRE_REAL: true });
    const issues = env.auditProductionReadiness();
    expect(issues.find((i) => i.key === 'OMIE_DEMO_MODE')).toBeUndefined();
    expect(() => env.enforceProductionReadiness()).not.toThrow();
  });
});

describe('EnvService — aviso de e-mail (Resend) ausente', () => {
  it('produção sem RESEND_API_KEY → AVISO destacado (não aborta)', () => {
    const env = makeEnv({ OMIE_DEMO_MODE: false, RESEND_API_KEY: '' });
    const issues = env.auditProductionReadiness();
    const resend = issues.find((i) => i.key === 'RESEND_API_KEY');
    expect(resend?.severity).toBe('warning');
    expect(resend?.message).toContain('RESEND_API_KEY');
    expect(() => env.enforceProductionReadiness()).not.toThrow();
  });

  it('produção sem RESEND_FROM_EMAIL → AVISO', () => {
    const env = makeEnv({ OMIE_DEMO_MODE: false, RESEND_FROM_EMAIL: '' });
    const resend = env.auditProductionReadiness().find((i) => i.key === 'RESEND_API_KEY');
    expect(resend?.severity).toBe('warning');
    expect(resend?.message).toContain('RESEND_FROM_EMAIL');
  });

  it('produção com Resend configurado → sem aviso', () => {
    const env = makeEnv({ OMIE_DEMO_MODE: false });
    expect(env.auditProductionReadiness().find((i) => i.key === 'RESEND_API_KEY')).toBeUndefined();
  });

  it('desenvolvimento sem Resend → sem aviso (só vale em produção)', () => {
    const env = makeEnv({ NODE_ENV: 'development', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'RESEND_API_KEY')).toBeUndefined();
  });
});
