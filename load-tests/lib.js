// Helpers compartilhados pelos 3 load tests (smoke, stress, spike).
//
// Convenções:
//  - BASE_URL aceita com ou sem `/api/v1` no final — normalizamos
//  - getToken() faz login via Supabase Auth, cacheia token na VU iteration
//  - Headers comum (Content-Type, Authorization) extraídos pra reuso

import http from 'k6/http';
import { check, fail } from 'k6';

const BASE_RAW = __ENV.BASE_URL || 'http://localhost:3001';
// Normaliza — aceita com ou sem `/api/v1`
export const API_BASE = BASE_RAW.endsWith('/api/v1')
  ? BASE_RAW
  : `${BASE_RAW.replace(/\/$/, '')}/api/v1`;

export const SUPABASE_URL = __ENV.SUPABASE_URL || '';
export const SUPABASE_KEY = __ENV.SUPABASE_ANON_KEY || '';
export const TEST_EMAIL = __ENV.TEST_EMAIL || 'admin@betinna.ai';
// Senha NUNCA hardcoded no repo — passe -e TEST_PASSWORD=... ao rodar o k6.
export const TEST_PASSWORD = __ENV.TEST_PASSWORD || '';
if (!TEST_PASSWORD) {
  throw new Error('TEST_PASSWORD ausente — rode o k6 com -e TEST_PASSWORD=<senha>');
}

/**
 * Faz login via Supabase Auth e retorna o access_token.
 * Cacheado por VU (1 login por iteration setup).
 */
export function getToken() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Modo "sem auth" — retorna null e os tests apenas batem /health
    return null;
  }
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
      },
      tags: { setup: 'true' },
    },
  );
  if (res.status !== 200) {
    fail(`Falha login Supabase (${res.status}): ${res.body}`);
  }
  const body = res.json();
  return body && body.access_token ? body.access_token : null;
}

/** Headers básicos com Authorization opcional. */
export function authHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Wrap pra check + fail-fast quando rota crítica retorna 5xx. */
export function expectOk(res, name) {
  return check(res, {
    [`${name} status 2xx/3xx`]: (r) => r.status < 400,
    [`${name} p95 ok`]: (r) => r.timings.duration < 10_000,
  });
}
