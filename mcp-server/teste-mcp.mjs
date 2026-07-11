// Teste JSON-RPC via stdio do betinna-kanban-mcp (fluxo do caso de uso real).
// Uso: node teste-mcp.mjs <token>
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const token = process.argv[2];
const proc = spawn('node', ['dist/index.js'], {
  env: { ...process.env, BETINNA_API_URL: 'http://localhost:3001', BETINNA_API_TOKEN: token },
  stdio: ['pipe', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => console.error('[server]', String(d).trim()));

const rl = createInterface({ input: proc.stdout });
const pendentes = new Map();
let seq = 0;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pendentes.has(msg.id)) {
      pendentes.get(msg.id)(msg);
      pendentes.delete(msg.id);
    }
  } catch { /* ignora não-JSON */ }
});

function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve) => {
    pendentes.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
const texto = (r) => JSON.parse(r.result.content[0].text);

// ── fluxo ──
await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'teste-batch-11', version: '1.0' },
});
notify('notifications/initialized');

const tools = await rpc('tools/list', {});
console.log('1. TOOLS:', tools.result.tools.length, '—', tools.result.tools.map((t) => t.name).join(', '));

const boards = await rpc('tools/call', { name: 'kanban_listar_boards', arguments: {} });
const listaBoards = texto(boards);
console.log('2. LISTAR_BOARDS:', listaBoards.length, 'quadro(s):', listaBoards[0]?.nome);

const board = await rpc('tools/call', {
  name: 'kanban_ver_board',
  arguments: { boardId: listaBoards[0].id },
});
const b = texto(board);
const card = b.listas.flatMap((l) => l.cards)[0];
console.log('3. VER_BOARD:', b.listas.map((l) => `${l.nome}(${l.cards.length})`).join(' | '), '— card alvo:', card.titulo);

const mover = await rpc('tools/call', {
  name: 'kanban_mover_card',
  arguments: { cardId: card.id, listaDestino: 'Em execução' },
});
console.log('4. MOVER_CARD:', JSON.stringify(texto(mover)));

const comentar = await rpc('tools/call', {
  name: 'kanban_comentar_card',
  arguments: { cardId: card.id, texto: 'Batch 11 em execução — comentário enviado pelo MCP 🤖' },
});
console.log('5. COMENTAR:', JSON.stringify(texto(comentar)));

const checklist = await rpc('tools/call', {
  name: 'kanban_criar_checklist',
  arguments: {
    cardId: card.id,
    titulo: 'Checklist via MCP',
    itens: [
      { texto: 'item criado pelo MCP' },
      { texto: 'item delegado pelo MCP', responsavelEmail: 'admin@betinna.ai', dataEntrega: '2026-07-18T12:00:00Z' },
    ],
  },
});
const ck = texto(checklist);
console.log('6. CRIAR_CHECKLIST:', ck.itens.length, 'itens');

const marcar = await rpc('tools/call', {
  name: 'kanban_marcar_item',
  arguments: { itemId: ck.itens[0].id, concluido: true },
});
console.log('7. MARCAR_ITEM:', JSON.stringify(texto(marcar)));

const meus = await rpc('tools/call', { name: 'kanban_meus_itens', arguments: {} });
console.log('8. MEUS_ITENS:', texto(meus).length, 'item(ns) delegados');

// erro acionável: lista inexistente
const erroLista = await rpc('tools/call', {
  name: 'kanban_mover_card',
  arguments: { cardId: card.id, listaDestino: 'Lista Que Nao Existe' },
});
console.log('9. ERRO ACIONAVEL:', erroLista.result.content[0].text.slice(0, 90));

const atividade = await rpc('tools/call', {
  name: 'kanban_atividade_recente',
  arguments: { boardId: listaBoards[0].id, limit: 3 },
});
console.log('10. ATIVIDADE:', texto(atividade).map((a) => a.tipo).join(', '));

proc.kill();
process.exit(0);
