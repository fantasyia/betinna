// Batch 12 — fluxo E2E via MCP (item 6 da spec).
// Uso: node teste-e2e-batch12.mjs <token>
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
  } catch {}
});
const rpc = (method, params) =>
  new Promise((res) => {
    const id = ++seq;
    pendentes.set(id, res);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return JSON.parse(r.result.content[0].text.replace(/^ERRO: /, '"ERRO"') ?? 'null');
};

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-12', version: '1' } });
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

// 1. listar boards, achar o E2E
const boards = await call('kanban_listar_boards', {});
const board = boards.find((b) => b.nome.startsWith('E2E'));
console.log('1. BOARD E2E encontrado:', board.nome);

// 2. ver board, achar Card A
const b = await call('kanban_ver_board', { boardId: board.id });
const cardA = b.listas.flatMap((l) => l.cards).find((c) => c.titulo.startsWith('Card A'));
console.log('2. CARD A:', cardA.titulo, '| checklist:', cardA.checklist);

// 3. mover pra Em execução
console.log('3. MOVER →', JSON.stringify(await call('kanban_mover_card', { cardId: cardA.id, listaDestino: 'Em execução' })));

// 4. comentar início
await call('kanban_comentar_card', { cardId: cardA.id, texto: '🤖 Iniciando o Card A (E2E Batch 12) — vou concluir os 3 passos.' });
console.log('4. COMENTARIO de início registrado');

// 5. ver card, pegar itens; atualizar item 1 (delegar por email + prazo novo)
const card = await call('kanban_ver_card', { cardId: cardA.id });
const itens = card.checklists[0].itens;
console.log('5. ITENS:', itens.map((i) => `${i.texto}${i.responsavel ? ' @' + i.responsavel : ''}`).join(' | '));
await call('kanban_atualizar_item', {
  itemId: itens[0].id,
  responsavelEmail: 'admin@betinna.ai',
  dataEntrega: '2026-07-14T12:00:00Z',
});
console.log('6. ATUALIZAR_ITEM: passo 1 re-delegado com prazo 14/07');

// 7. marcar os 3 itens como concluídos
for (const item of itens) {
  await call('kanban_marcar_item', { itemId: item.id, concluido: true });
}
console.log('7. 3 ITENS CONCLUIDOS');

// 8. concluir o card + mover pra Concluído + comentário final
await call('kanban_atualizar_card', { cardId: cardA.id, concluido: true });
console.log('8. MOVER →', JSON.stringify(await call('kanban_mover_card', { cardId: cardA.id, listaDestino: 'Concluído' })));
await call('kanban_comentar_card', { cardId: cardA.id, texto: '🤖 Card A concluído: 3/3 passos feitos. Resumo: fluxo E2E validado ponta a ponta.' });
console.log('9. COMENTARIO final registrado');

// 10. atividade recente
const ativ = await call('kanban_atividade_recente', { boardId: board.id, limit: 8 });
console.log('10. ATIVIDADE:', ativ.map((a) => a.tipo).join(', '));

proc.kill();
process.exit(0);
