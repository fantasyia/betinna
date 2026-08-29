// Chama a API de produção autenticado como admin — visão própria, sem depender da tela.
// uso: node api.mjs GET /pedidos?limit=5
//      node api.mjs POST /propostas '{"clienteId":"..."}'
// Credenciais: env BET_EMAIL/BET_SENHA ou frontend/.env.local (gitignored).
import { readFileSync } from 'node:fs';

function envLocal(chave) {
  try {
    const linha = readFileSync(new URL('./.env.local', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(chave + '='));
    if (!linha) return undefined;
    const valor = linha.slice(chave.length + 1).trim();
    const comAspas = /^(['"])(.*)\1$/.exec(valor);
    return comAspas ? comAspas[2] : valor;
  } catch {
    return undefined;
  }
}

const API = process.env.BET_API || 'https://api-production-9426.up.railway.app/api/v1';
const EMAIL = process.env.BET_EMAIL || envLocal('BET_EMAIL') || 'admin@betinna.ai';
const SENHA = process.env.BET_SENHA || envLocal('BET_SENHA');
if (!SENHA) {
  console.error('BET_SENHA ausente — defina no env ou em frontend/.env.local');
  process.exit(1);
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, senha: SENHA, password: SENHA }),
});
const loginBody = await login.json();
const token = loginBody?.data?.accessToken ?? loginBody?.accessToken ?? loginBody?.data?.access_token;
if (!token) {
  console.error('login falhou:', login.status, JSON.stringify(loginBody).slice(0, 400));
  process.exit(1);
}

const [, , metodo = 'GET', caminho = '/health', corpo] = process.argv;
const r = await fetch(`${API}${caminho}`, {
  method: metodo,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: corpo && metodo !== 'GET' ? corpo : undefined,
});
const texto = await r.text();
console.log(r.status);
try {
  console.log(JSON.stringify(JSON.parse(texto), null, 1).slice(0, 6000));
} catch {
  console.log(texto.slice(0, 3000));
}
