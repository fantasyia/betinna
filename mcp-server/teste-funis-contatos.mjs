// Smoke test stdio das tools funis_/contatos_ (Batch 3).
// Uso: node teste-funis-contatos.mjs <token-com-escopo-funis-contatos> [API_URL]
// O token PRECISA ter escopo "funis" e "contatos" (Quadros → Tokens de API).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const token = process.argv[2];
const apiUrl = process.argv[3] || 'http://localhost:3001';
if (!token) {
  console.error('Faltou o token. Uso: node teste-funis-contatos.mjs <token> [API_URL]');
  process.exit(1);
}

const proc = spawn('node', ['dist/index.js'], {
  env: { ...process.env, BETINNA_API_URL: apiUrl, BETINNA_API_TOKEN: token },
  stdio: ['pipe', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => console.error('[server]', String(d).trim()));
const rl = createInterface({ input: proc.stdout });
const pend = new Map();
let seq = 0;
rl.on('line', (line) => {
  try {
    const m = JSON.parse(line);
    if (m.id !== undefined && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  } catch {}
});
const rpc = (method, params) => new Promise((res) => {
  const id = ++seq; pend.set(id, res);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r.result?.content?.[0]?.text ?? JSON.stringify(r.result ?? r.error);
  try { return JSON.parse(t); } catch { return t; }
};

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'teste-funis-contatos', version: '1' } });
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const tools = await rpc('tools/list', {});
const nomes = tools.result.tools.map((t) => t.name);
const funis = nomes.filter((n) => n.startsWith('funis_')).length;
const contatos = nomes.filter((n) => n.startsWith('contatos_')).length;
console.log(`1. TOOLS: ${nomes.length} total (${funis} funis_ + ${contatos} contatos_)`);

// 2. funis_listar
const lista = await call('funis_listar', {});
const nFunis = Array.isArray(lista) ? lista.length : 0;
console.log(`2. funis_listar: ${nFunis} funil(is)`, nFunis ? `— 1º: "${lista[0]?.nome}"` : '');

// 3. funis_ver (do 1º funil, se houver)
if (nFunis) {
  const f = await call('funis_ver', { funilId: lista[0].id });
  const nEtapas = Array.isArray(f?.etapas) ? f.etapas.length : '?';
  console.log(`3. funis_ver: funil "${f?.nome}" com ${nEtapas} etapa(s)`);
}

// 4. contatos_listar (página curta — PII, pega só o mínimo)
const cont = await call('contatos_listar', { limit: 3, page: 1 });
const arr = cont?.data?.data ?? cont?.data ?? [];
const total = cont?.data?.pagination?.total ?? cont?.pagination?.total ?? '?';
console.log(`4. contatos_listar: total=${total}, nesta página=${Array.isArray(arr) ? arr.length : '?'}`);

// 5. erro acionável: funil inexistente
const err = await call('funis_ver', { funilId: 'naoexiste123' });
console.log('5. erro acionável (funil inválido):', String(JSON.stringify(err)).slice(0, 90));

proc.kill();
process.exit(0);
