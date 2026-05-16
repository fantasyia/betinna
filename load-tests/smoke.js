// Smoke test — Sprint 5 FIX 3.
//
// Sanity check leve: 1 VU, 30s, endpoints críticos.
// Thresholds:
//   p95 < 500ms (latência aceitável dev/prod)
//   error rate < 1%
//
// Uso:
//   BASE_URL=https://betinna-api.up.railway.app \
//   SUPABASE_URL=https://[ref].supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   k6 run load-tests/smoke.js

import http from 'k6/http';
import { sleep, check } from 'k6';
import { API_BASE, getToken, authHeaders } from './lib.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

let token = null;
export function setup() {
  return { token: getToken() };
}

export default function (data) {
  token = data.token;
  const headers = authHeaders(token);

  // 1) GET /health — público, sem auth
  let res = http.get(`${API_BASE}/health`, { tags: { name: 'health' } });
  check(res, {
    'health 200': (r) => r.status === 200,
  });

  // 2) GET /auth/me — exige token Supabase válido
  if (token) {
    res = http.get(`${API_BASE}/auth/me`, { headers, tags: { name: 'auth/me' } });
    check(res, {
      'auth/me 200': (r) => r.status === 200,
    });
  }

  // 3) GET /clientes — lista paginada
  if (token) {
    res = http.get(`${API_BASE}/clientes?page=1&limit=20`, {
      headers,
      tags: { name: 'clientes/list' },
    });
    check(res, {
      'clientes list 200': (r) => r.status === 200,
    });
  }

  // 4) GET /relatorios/vendas — agregação cara
  if (token) {
    res = http.get(`${API_BASE}/relatorios/vendas?periodo=mes`, {
      headers,
      tags: { name: 'relatorios/vendas' },
    });
    check(res, {
      'relatorios vendas 200': (r) => r.status === 200,
    });
  }

  sleep(1); // 1 req/s — mantém 1 VU constante
}
