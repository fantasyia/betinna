// Stress test — Sprint 5 FIX 3.
//
// Ramp 0 → 50 VUs em 2 minutos, sustain 1 minuto, ramp down em 1 minuto.
// Total: 4min.
//
// Objetivos:
//   - Validar Railway auto-scaling (Railway pode escalar API service em
//     vertical via plan upgrade — não horizontal por default)
//   - Identificar gargalos sob carga sustentada
//   - Confirmar BullMQ + Redis aguentam pressão
//
// Thresholds:
//   p95 < 2000ms (degradado mas ainda usável)
//   error rate < 5% (alguns 429 são esperados — rate limit)
//
// Uso:
//   BASE_URL=https://betinna-api.up.railway.app k6 run load-tests/stress.js

import http from 'k6/http';
import { sleep, check } from 'k6';
import { API_BASE, getToken, authHeaders } from './lib.js';

export const options = {
  stages: [
    { duration: '2m', target: 50 }, // ramp up
    { duration: '1m', target: 50 }, // sustain
    { duration: '1m', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const token = data.token;
  const headers = authHeaders(token);

  // Mix realista: 60% leitura, 30% listagem, 10% relatório (cara)
  const r = Math.random();

  if (r < 0.6) {
    http.get(`${API_BASE}/health`, { tags: { name: 'health' } });
  } else if (r < 0.9 && token) {
    http.get(`${API_BASE}/clientes?page=1&limit=20`, {
      headers,
      tags: { name: 'clientes/list' },
    });
  } else if (token) {
    const res = http.get(`${API_BASE}/relatorios/vendas?periodo=mes`, {
      headers,
      tags: { name: 'relatorios/vendas' },
    });
    check(res, {
      'relatorios 200 ou 429': (r) => r.status === 200 || r.status === 429,
    });
  } else {
    http.get(`${API_BASE}/health`);
  }

  sleep(0.5);
}
