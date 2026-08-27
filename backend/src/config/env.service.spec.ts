import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { EnvService } from './env.service';
import type { Env } from './env.schema';

/**
 * Testa a trava de go-live do ERP em `auditProductionReadiness` /
 * `enforceProductionReadiness`.
 *
 * Regra: demo em produção é só AVISO por padrão (dormente). Quando
 * `ERP_REQUIRE_REAL=true`, vira CRÍTICO e o boot deve abortar.
 */

// Chave hex forte (64 chars, não-repetida) pra não disparar o alerta de ENCRYPTION_KEY fraca.
const STRONG_KEY = 'a3f1c29b4d7e0856b1f2a9c3d4e5f6079a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3';

function makeEnv(overrides: Record<string, unknown>): EnvService {
  const values: Record<string, unknown> = {
    NODE_ENV: 'production',
    ENCRYPTION_KEY: STRONG_KEY,
    SUPABASE_JWT_SECRET: 'algum-segredo-jwt',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'no-reply@betinna.ai',
    REDIS_URL: 'rediss://default:token@real-redis.upstash.io:6379',
    ...overrides,
  };
  const stub = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>;
  return new EnvService(stub);
}

describe('EnvService — aviso de e-mail (Resend) ausente', () => {
  it('produção sem RESEND_API_KEY → AVISO destacado (não aborta)', () => {
    const env = makeEnv({ ERP_DEMO_MODE: false, RESEND_API_KEY: '' });
    const issues = env.auditProductionReadiness();
    const resend = issues.find((i) => i.key === 'RESEND_API_KEY');
    expect(resend?.severity).toBe('warning');
    expect(resend?.message).toContain('RESEND_API_KEY');
    expect(() => env.enforceProductionReadiness()).not.toThrow();
  });

  it('produção sem RESEND_FROM_EMAIL → AVISO', () => {
    const env = makeEnv({ ERP_DEMO_MODE: false, RESEND_FROM_EMAIL: '' });
    const resend = env.auditProductionReadiness().find((i) => i.key === 'RESEND_API_KEY');
    expect(resend?.severity).toBe('warning');
    expect(resend?.message).toContain('RESEND_FROM_EMAIL');
  });

  it('produção com Resend configurado → sem aviso', () => {
    const env = makeEnv({ ERP_DEMO_MODE: false });
    expect(env.auditProductionReadiness().find((i) => i.key === 'RESEND_API_KEY')).toBeUndefined();
  });

  it('desenvolvimento sem Resend → sem aviso (só vale em produção)', () => {
    const env = makeEnv({ NODE_ENV: 'development', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'RESEND_API_KEY')).toBeUndefined();
  });
});

describe('EnvService — REDIS_URL obrigatório em produção', () => {
  it('produção + REDIS_URL localhost → CRÍTICO (aborta o boot)', () => {
    const env = makeEnv({ REDIS_URL: 'redis://localhost:6379' });
    const issue = env.auditProductionReadiness().find((i) => i.key === 'REDIS_URL');
    expect(issue?.severity).toBe('critical');
    expect(() => env.enforceProductionReadiness()).toThrow();
  });

  it('produção + 127.0.0.1 também é CRÍTICO', () => {
    const env = makeEnv({ REDIS_URL: 'redis://127.0.0.1:6379' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'REDIS_URL')?.severity).toBe(
      'critical',
    );
  });

  it('produção + Redis real (rediss://upstash) → sem alerta', () => {
    const env = makeEnv({ REDIS_URL: 'rediss://default:tok@host.upstash.io:6379' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'REDIS_URL')).toBeUndefined();
    expect(() => env.enforceProductionReadiness()).not.toThrow();
  });

  it('produção + localhost COM auth (user:pass@localhost) → ainda CRÍTICO', () => {
    const env = makeEnv({ REDIS_URL: 'redis://user:pass@localhost:6379' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'REDIS_URL')?.severity).toBe(
      'critical',
    );
  });

  it('produção + Redis interno do Railway (redis.railway.internal) → sem alerta', () => {
    const env = makeEnv({ REDIS_URL: 'redis://default:senha@redis.railway.internal:6379' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'REDIS_URL')).toBeUndefined();
  });

  it('desenvolvimento + localhost → sem alerta (localhost é esperado em dev)', () => {
    const env = makeEnv({ NODE_ENV: 'development', REDIS_URL: 'redis://localhost:6379' });
    expect(env.auditProductionReadiness().find((i) => i.key === 'REDIS_URL')).toBeUndefined();
  });
});
