// Gera `endpoints.txt` (o arquivo pra grep) a partir do openapi.json baixado.
// Uso: node backend/docs/tiny/gerar-indice.js
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'openapi.json'), 'utf8'));
const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

const linhas = [];
for (const [rota, ops] of Object.entries(spec.paths ?? {})) {
  for (const [metodo, op] of Object.entries(ops)) {
    if (!METODOS.includes(metodo)) continue;
    linhas.push(`${metodo.toUpperCase().padEnd(6)} ${rota}  — ${(op.summary || op.operationId || '').trim()}`);
  }
}
linhas.sort((a, b) => a.slice(7).localeCompare(b.slice(7)));
fs.writeFileSync(path.join(dir, 'endpoints.txt'), linhas.join('\n') + '\n');
console.log(`${linhas.length} operações -> endpoints.txt`);
