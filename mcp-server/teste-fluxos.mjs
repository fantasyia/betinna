// Smoke test stdio das tools fluxos_* (Batch 2). Uso: node teste-fluxos.mjs <token>
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const token = process.argv[2];
const proc = spawn('node', ['dist/index.js'], {
  env: { ...process.env, BETINNA_API_URL: 'http://localhost:3001', BETINNA_API_TOKEN: token },
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
  const t = r.result.content[0].text;
  try { return JSON.parse(t); } catch { return t; }
};

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'teste-fluxos', version: '1' } });
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const tools = await rpc('tools/list', {});
const nomes = tools.result.tools.map((t) => t.name);
const kanban = nomes.filter((n) => n.startsWith('kanban_')).length;
const fluxos = nomes.filter((n) => n.startsWith('fluxos_')).length;
console.log(`1. TOOLS: ${nomes.length} (${kanban} kanban_ + ${fluxos} fluxos_)`);

console.log('2. fluxos_listar:', JSON.stringify(await call('fluxos_listar', {})).slice(0, 120));

const cron = await call('fluxos_cron_preview', { expressoes: ['0 9 * * 1-5'], timezone: 'America/Sao_Paulo' });
console.log('3. fluxos_cron_preview (0 9 * * 1-5):', Array.isArray(cron) ? cron.length + ' próximas datas' : JSON.stringify(cron).slice(0, 100));

// importar um fluxo simples → RASCUNHO
const imp = await call('fluxos_importar', {
  nome: 'TESTE MCP — qualificação simples',
  descricao: 'Fluxo de teste criado pelo MCP (Batch 2)',
  triggerTipo: 'LEAD_RECEBEU_TAG',
  triggerConfig: { tag: 'teste-mcp' },
  nos: [
    { id: 'trigger', tipo: 'TRIGGER', titulo: 'Recebeu tag teste-mcp', config: {} },
    { id: 'tarefa', tipo: 'ACAO', acaoTipo: 'CRIAR_TAREFA', titulo: 'Criar tarefa de contato', config: { titulo: 'Ligar pro lead', tipo: 'TAREFA', diasApartirDeHoje: 1 } },
  ],
  arestas: [{ sourceNoId: 'trigger', targetNoId: 'tarefa', label: null }],
});
console.log('4. fluxos_importar:', JSON.stringify(imp));
const fluxoId = imp.id;

if (fluxoId) {
  const ver = await call('fluxos_ver', { fluxoId });
  const nNos = Array.isArray(ver.nos) ? ver.nos.length : (ver.nos ? '?' : 0);
  const nArestas = Array.isArray(ver.arestas) ? ver.arestas.length : (ver.arestas ? '?' : 0);
  console.log(`5. fluxos_ver: status=${ver.status} nos=${nNos} arestas=${nArestas}`);

  // erro acionável: ver fluxo inexistente
  const err = await call('fluxos_ver', { fluxoId: 'naoexiste123' });
  console.log('6. erro acionável (id inválido):', String(err).slice(0, 70));
}

proc.kill();
process.exit(0);
