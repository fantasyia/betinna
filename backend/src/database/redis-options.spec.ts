import { describe, expect, it } from 'vitest';
import {
  buildBullMqConnection,
  buildRedisOptions,
  isTlsUrl,
} from './redis-options';

/**
 * Hotfix 2026-05-16 — TLS detection deve ser pelo SCHEME da URL,
 * não por env var. Railway production crash loop estava acontecendo
 * porque RAILWAY_ENVIRONMENT forçava TLS mesmo em URL `redis://` (sem TLS).
 */
describe('redis-options — TLS detection by URL scheme', () => {
  describe('isTlsUrl', () => {
    it('returns true for rediss://...', () => {
      expect(isTlsUrl('rediss://default:pwd@host.upstash.io:6379')).toBe(true);
      expect(isTlsUrl('rediss://localhost:6379')).toBe(true);
    });

    it('returns false for redis://...', () => {
      expect(isTlsUrl('redis://default:pwd@redis.railway.internal:6379')).toBe(false);
      expect(isTlsUrl('redis://localhost:6379')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isTlsUrl('REDISS://host:6379')).toBe(true);
      expect(isTlsUrl('REDIS://host:6379')).toBe(false);
      expect(isTlsUrl('Rediss://host:6379')).toBe(true);
    });

    it('tolerates leading/trailing whitespace', () => {
      expect(isTlsUrl('  rediss://host:6379  ')).toBe(true);
      expect(isTlsUrl('\nredis://host:6379\t')).toBe(false);
    });

    it('returns false for invalid/empty input', () => {
      expect(isTlsUrl('')).toBe(false);
      expect(isTlsUrl('localhost:6379')).toBe(false);
      expect(isTlsUrl('not-a-url')).toBe(false);
      // @ts-expect-error - defensivo: aceitar inputs inválidos
      expect(isTlsUrl(undefined)).toBe(false);
      // @ts-expect-error
      expect(isTlsUrl(null)).toBe(false);
    });
  });

  describe('buildRedisOptions', () => {
    it('does NOT include tls option for redis://... (Railway internal default)', () => {
      const opts = buildRedisOptions('redis://default:pwd@redis.railway.internal:6379');
      expect(opts).not.toHaveProperty('tls');
      // Confirma defaults preservados
      expect(opts.enableReadyCheck).toBe(true);
      expect(opts.lazyConnect).toBe(false);
    });

    it('includes tls { rejectUnauthorized: false } for rediss://...', () => {
      const opts = buildRedisOptions('rediss://default:pwd@host.upstash.io:6379');
      expect(opts.tls).toEqual({ rejectUnauthorized: false });
    });

    it('respeita overrides do caller', () => {
      const opts = buildRedisOptions('redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      expect(opts.maxRetriesPerRequest).toBeNull();
      expect(opts.enableReadyCheck).toBe(false);
      expect(opts).not.toHaveProperty('tls');
    });

    it('ignora variáveis de ambiente (NÃO usa RAILWAY_ENVIRONMENT mais)', () => {
      // Mesmo se Railway setar a var, a decisão é pela URL
      const originalEnv = process.env.RAILWAY_ENVIRONMENT;
      const originalEnvName = process.env.RAILWAY_ENVIRONMENT_NAME;
      try {
        process.env.RAILWAY_ENVIRONMENT = 'production';
        process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
        const opts = buildRedisOptions('redis://internal.railway:6379');
        expect(opts).not.toHaveProperty('tls');
      } finally {
        process.env.RAILWAY_ENVIRONMENT = originalEnv;
        process.env.RAILWAY_ENVIRONMENT_NAME = originalEnvName;
      }
    });

    it('aplica TLS quando URL é rediss:// mesmo sem env vars', () => {
      const originalEnv = process.env.RAILWAY_ENVIRONMENT;
      try {
        delete process.env.RAILWAY_ENVIRONMENT;
        const opts = buildRedisOptions('rediss://upstash.io:6379');
        expect(opts.tls).toEqual({ rejectUnauthorized: false });
      } finally {
        process.env.RAILWAY_ENVIRONMENT = originalEnv;
      }
    });
  });

  describe('buildBullMqConnection', () => {
    it('returns { url, ...opts } sem TLS para redis://...', () => {
      const url = 'redis://default:pwd@redis.railway.internal:6379';
      const conn = buildBullMqConnection(url);
      expect(conn.url).toBe(url);
      expect(conn).not.toHaveProperty('tls');
    });

    it('returns { url, tls } para rediss://...', () => {
      const url = 'rediss://default:pwd@host.upstash.io:6379';
      const conn = buildBullMqConnection(url);
      expect(conn.url).toBe(url);
      expect(conn.tls).toEqual({ rejectUnauthorized: false });
    });

    it('aplica overrides + detecta TLS via URL', () => {
      const conn = buildBullMqConnection('rediss://host:6379', {
        maxRetriesPerRequest: 3,
      });
      expect(conn.maxRetriesPerRequest).toBe(3);
      expect(conn.tls).toEqual({ rejectUnauthorized: false });
    });
  });

  describe('regressão crash loop Railway 2026-05-16', () => {
    it('Railway internal redis:// NÃO força TLS (hotfix)', () => {
      // Cenário exato do crash loop:
      //   REDIS_URL=redis://default:senha@redis.railway.internal:6379
      //   RAILWAY_ENVIRONMENT pode estar setada ou não — não importa
      const opts = buildRedisOptions(
        'redis://default:senha@redis.railway.internal:6379',
      );
      expect(opts.tls).toBeUndefined();
    });
  });
});
