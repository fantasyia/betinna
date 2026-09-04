#!/usr/bin/env node
/**
 * Cadastra (ou lista) o webhook de assinatura na ClickSign.
 *
 * Existe como script, e não como tela, porque é operação de uma vez por
 * ambiente: sandbox tem o seu webhook, produção tem o dela, e o segredo HMAC
 * nasce no cadastro — a ClickSign devolve `attributes.secret` uma vez, e é ele
 * que o app usa pra provar que o evento veio mesmo de lá.
 *
 * Uso:
 *   node scripts/clicksign-webhook.mjs --listar
 *   node scripts/clicksign-webhook.mjs --criar https://.../api/v1/webhooks/clicksign
 *   node scripts/clicksign-webhook.mjs --excluir <id>
 *
 * O `--criar` grava `CLICKSIGN_WEBHOOK_SECRET` no `.env.local` e **não imprime
 * o segredo** — segredo em terminal vira segredo em histórico, print e log.
 * Depois é preciso levar o mesmo valor pro Railway (api).
 *
 * Token e ambiente saem de backend/.env.local (CLICKSIGN_ACCESS_TOKEN e
 * CLICKSIGN_API_URL) — o sandbox e a produção têm token e webhook próprios.
 */
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(BACKEND, '.env.local');

const lerEnv = (caminho) =>
  Object.fromEntries(
    readFileSync(caminho, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        let v = l.slice(i + 1).trim();
        const m = /^(['"])([\s\S]*)\1$/.exec(v);
        if (m) v = m[2];
        return [l.slice(0, i).trim(), v];
      }),
  );

const env = lerEnv(ENV_PATH);
const BASE = (env.CLICKSIGN_API_URL || 'https://app.clicksign.com').replace(/\/$/, '');
const TOKEN = (env.CLICKSIGN_ACCESS_TOKEN || '').replace(/^['"<]+|['">]+$/g, '');
if (!TOKEN) {
  console.error('CLICKSIGN_ACCESS_TOKEN ausente em .env.local');
  process.exit(1);
}

/**
 * Os eventos que mudam alguma coisa deste lado. `document_closed` é o que
 * fecha o contrato ("finalizado e pronto para download"); os outros três são
 * os finais infelizes, que alguém precisa saber no dia — não na semana que vem,
 * quando reparar que a cobrança não começou.
 */
const EVENTOS = ['document_closed', 'auto_close', 'refusal', 'deadline'];

async function api(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}/api/v3${caminho}?access_token=${TOKEN}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}

function gravarSegredo(secret) {
  const linhas = readFileSync(ENV_PATH, 'utf8');
  if (/^CLICKSIGN_WEBHOOK_SECRET=/m.test(linhas)) {
    writeFileSync(
      ENV_PATH,
      linhas.replace(/^CLICKSIGN_WEBHOOK_SECRET=.*$/m, `CLICKSIGN_WEBHOOK_SECRET=${secret}`),
    );
  } else {
    appendFileSync(ENV_PATH, `\nCLICKSIGN_WEBHOOK_SECRET=${secret}\n`);
  }
}

const [acao, arg] = process.argv.slice(2);

if (acao === '--listar') {
  const r = await api('GET', '/webhooks');
  const lista = r?.data ?? [];
  console.log(`${BASE} — ${lista.length} webhook(s):`);
  for (const w of lista) {
    console.log(
      `  ${w.id}  ${w.attributes.status.padEnd(8)} ${w.attributes.endpoint}\n` +
        `      eventos: ${(w.attributes.events || []).join(', ') || '(todos)'}`,
    );
  }
} else if (acao === '--criar') {
  if (!arg) {
    console.error('faltou a URL: node scripts/clicksign-webhook.mjs --criar https://...');
    process.exit(1);
  }
  const r = await api('POST', '/webhooks', {
    data: {
      type: 'webhooks',
      attributes: { endpoint: arg, status: 'active', events: EVENTOS },
    },
  });
  const a = r.data.attributes;
  gravarSegredo(a.secret);
  console.log(`webhook ${r.data.id} criado · ${a.status} · ${a.endpoint}`);
  console.log(`eventos: ${(a.events || []).join(', ')}`);
  console.log(
    `CLICKSIGN_WEBHOOK_SECRET gravado em .env.local (${a.secret.length} caracteres, não impresso).\n` +
      'Falta levar o MESMO valor pro Railway (serviço api).',
  );
} else if (acao === '--excluir') {
  if (!arg) {
    console.error('faltou o id');
    process.exit(1);
  }
  await api('DELETE', `/webhooks/${arg}`);
  console.log(`webhook ${arg} excluído`);
} else {
  console.log('uso: --listar | --criar <url> | --excluir <id>');
}
