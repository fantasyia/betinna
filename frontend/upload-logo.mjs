// Sobe o logo da empresa pro bucket do app (multipart), autenticado como admin.
// uso: node upload-logo.mjs <empresaId> <caminho-do-arquivo>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

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

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, senha: SENHA, password: SENHA }),
});
const lb = await login.json();
const token = lb?.data?.accessToken ?? lb?.accessToken;
if (!token) {
  console.error('login falhou', login.status);
  process.exit(1);
}

const [, , empresaId, caminho] = process.argv;
const bytes = readFileSync(caminho);
const form = new FormData();
form.append('logo', new Blob([bytes], { type: 'image/png' }), basename(caminho));

const r = await fetch(`${API}/empresas/${empresaId}/logo`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
console.log(r.status, (await r.text()).slice(0, 500));
