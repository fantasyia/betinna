import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

/**
 * O gate de secret de webhook em produção derrubou o WORKER em 26/08, quando as
 * variáveis do ERP foram apagadas (o ERP virou Tiny). O worker não serve rota
 * nenhuma de webhook — morreu por um secret que não protegia nada nele.
 *
 * Estes casos fixam as duas metades da regra: continua obrigatório onde protege
 * (api), e não bloqueia onde não protege (worker).
 */
const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@h:5432/d',
  DIRECT_URL: 'postgresql://u:p@h:5432/d',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'a'.repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: 'b'.repeat(40),
  ENCRYPTION_KEY: 'c9f2'.repeat(16),
  META_GRAPH_APP_SECRET: 'x',
  META_GRAPH_VERIFY_TOKEN: 'x',
  SHOPEE_PARTNER_KEY: 'x',
  TIKTOK_APP_SECRET: 'x',
  ML_WEBHOOK_IP_WHITELIST: '1.2.3.4',
};

const erros = (raw: Record<string, unknown>) => {
  const r = envSchema.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('gate de secret de webhook em produção', () => {
  it('api SEM o segredo do Tiny não sobe — a rota ficaria aberta', () => {
    expect(erros({ ...base, SERVICE_TYPE: 'api' })).toContain('TINY_WEBHOOK_SECRET');
  });

  it('api COM o segredo sobe', () => {
    expect(erros({ ...base, SERVICE_TYPE: 'api', TINY_WEBHOOK_SECRET: 's3gr3d0' })).not.toContain(
      'TINY_WEBHOOK_SECRET',
    );
  });

  it('worker sobe sem os secrets de webhook — ele não serve webhook nenhum', () => {
    expect(erros({ ...base, SERVICE_TYPE: 'worker' })).toHaveLength(0);
  });

  it('o ERP saiu da lista: apagar as envs dele não derruba mais o boot', () => {
    // Era exatamente o crash de 26/08 — o ERP virou Tiny e as envs do ERP
    // foram removidas, mas o gate ainda cobrava o secret do ERP aposentado.
    expect(erros({ ...base, SERVICE_TYPE: 'api', TINY_WEBHOOK_SECRET: 's' })).not.toContain(
      'ERP_WEBHOOK_SECRET',
    );
  });
});
