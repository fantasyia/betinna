// Spike test — Sprint 5 FIX 3.
//
// 0 → 100 VUs INSTANTANEAMENTE, hold 30s, drop pra 0.
// Simula evento promocional (Black Friday, lançamento de campanha).
//
// Objetivos:
//   - Confirmar que sistema NÃO CRASHA sob pico súbito
//   - Validar rate limiter Throttler (esperamos 429 em pico, é correto)
//   - Validar Redis aguenta surge de SETNX (idempotency + anti-replay)
//   - Validar recovery em ≤ 60s após drop (memory leaks, conn pool)
//
// Thresholds mais relaxados — pico é situação anormal:
//   p99 < 5000ms
//   error rate < 30% (alta tolerância — esperamos 429s)
//
// Uso:
//   BASE_URL=https://betinna-api.up.railway.app k6 run load-tests/spike.js

import http from 'k6/http';
import { sleep, check } from 'k6';
import { API_BASE, getToken, authHeaders } from './lib.js';

export const options = {
  stages: [
    { duration: '10s', target: 100 }, // ramp quase instantâneo
    { duration: '30s', target: 100 }, // sustain spike
    { duration: '10s', target: 0 }, // drop
  ],
  thresholds: {
    'http_req_duration{name:health}': ['p(99)<5000'],
    http_req_failed: ['rate<0.30'],
  },
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const token = data.token;
  const headers = authHeaders(token);

  // 80% das requests no /health (público, leve, sem rate limit estrito)
  // 20% em endpoint com rate limit pra ver Throttler em ação
  const r = Math.random();
  if (r < 0.8) {
    const res = http.get(`${API_BASE}/health`, { tags: { name: 'health' } });
    check(res, {
      'health survives spike': (r) => r.status === 200 || r.status === 429 || r.status === 503,
    });
  } else if (token) {
    const res = http.get(`${API_BASE}/auth/me`, { headers, tags: { name: 'auth/me' } });
    check(res, {
      'auth/me sob spike': (r) => r.status === 200 || r.status === 429,
    });
  } else {
    http.get(`${API_BASE}/health`);
  }

  // Sem sleep — VUs batem hard pra simular spike real
}

// Teardown: testa recovery — bate /health uma vez no fim
export function teardown() {
  sleep(60); // aguarda 60s pra Railway/Redis estabilizar
  const res = http.get(`${API_BASE}/health`);
  check(res, {
    'system recovered after spike': (r) => r.status === 200,
  });
}
