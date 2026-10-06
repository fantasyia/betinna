// Gate do npm audit: quebra em HIGH/CRITICAL, exceto advisories liberados abaixo
// COM MOTIVO. O `npm audit` não tem lista de exceção própria — daí este script.
//
// Uso (na pasta do serviço): npm audit --json | node ../.github/scripts/npm-audit-gate.mjs <backend|frontend>
//
// Regra pra entrar na lista: o pacote NÃO roda em produção (só build/dev) e não
// existe versão corrigida sem migração grande. Advisory liberado que some do
// audit vira aviso — é a deixa pra tirar daqui.

const LIBERADOS_POR_SERVICO = {
  backend: {},
  frontend: {
    // braces ≤3.0.3 (DoS com padrão glob aninhado). Vem do Tailwind 3 (chokidar,
    // micromatch, fast-glob) e só roda no BUILD, com os globs do nosso
    // tailwind.config — nunca com entrada de usuário. Não existe braces corrigido;
    // sai na migração pro Tailwind 4. Liberado pelo Léo em 06/10/2026.
    'GHSA-vfj7-8cjw-p6xm': 'braces via Tailwind 3 (só build)',
  },
};

const servico = process.argv[2];
const LIBERADOS = LIBERADOS_POR_SERVICO[servico];
if (!LIBERADOS) {
  console.error(`serviço desconhecido: ${servico} (use backend ou frontend)`);
  process.exit(1);
}

const BLOQUEIA = new Set(['high', 'critical']);

let entrada = '';
for await (const pedaco of process.stdin) entrada += pedaco;

const relatorio = JSON.parse(entrada);
if (relatorio.error) {
  console.error('npm audit falhou:', relatorio.error.summary ?? relatorio.error);
  process.exit(1);
}

// Cada pacote vulnerável lista em `via` o advisory (objeto) ou o pacote de onde
// herdou (string). A cadeia sempre termina num advisory, então basta olhar esses.
const advisories = new Map();
for (const vuln of Object.values(relatorio.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue;
    const id = via.url?.split('/').pop() ?? String(via.source);
    advisories.set(id, via);
  }
}

const barrados = [];
const vistos = new Set();
for (const [id, adv] of advisories) {
  if (!BLOQUEIA.has(adv.severity)) continue;
  if (LIBERADOS[id]) {
    vistos.add(id);
    console.log(`liberado  ${id}  ${adv.name} (${adv.severity}) — ${LIBERADOS[id]}`);
    continue;
  }
  barrados.push(`${id}  ${adv.name} ${adv.range} (${adv.severity}) — ${adv.title}`);
}

for (const id of Object.keys(LIBERADOS)) {
  if (!vistos.has(id)) console.log(`aviso: ${id} não aparece mais neste audit — dá pra tirar da lista`);
}

if (barrados.length) {
  console.error(`\n${barrados.length} advisory(s) HIGH+ sem liberação:`);
  for (const linha of barrados) console.error(`  ${linha}`);
  console.error('\nCorrija com `npm audit fix` ou, se for só build/dev e sem correção, libere com motivo em .github/scripts/npm-audit-gate.mjs');
  process.exit(1);
}
console.log('npm audit: nenhum HIGH/CRITICAL fora da lista de liberados.');
