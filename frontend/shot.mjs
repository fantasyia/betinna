// Screenshot de qualquer rota do Betinna (prod) — visão própria via Playwright.
// uso: node shot.mjs /rota saida.png   (creds via env BET_EMAIL/BET_SENHA ou frontend/.env.local)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

// Senha NUNCA hardcoded (repo já esteve público): env primeiro, senão
// frontend/.env.local (gitignored) — parse simples KEY=VALUE, sem dependência.
function envLocal(chave) {
  try {
    const linha = readFileSync(new URL('./.env.local', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(chave + '='));
    return linha ? linha.slice(chave.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

const BASE = process.env.BASE || 'https://frontend-production-fd70.up.railway.app';
const EMAIL = process.env.BET_EMAIL || envLocal('BET_EMAIL') || 'admin@betinna.ai';
const SENHA = process.env.BET_SENHA || envLocal('BET_SENHA');
if (!SENHA) {
  console.error('BET_SENHA ausente — defina no env ou em frontend/.env.local (gitignored)');
  process.exit(1);
}
const ROUTE = process.argv[2] || '/dashboard';
const OUT = process.argv[3] || 'shot.png';
const CLICK = process.argv[4] || ''; // texto de um botão pra clicar antes do print

const TEMA = process.env.TEMA || 'light'; // TEMA=dark valida o modo escuro

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript((tema) => localStorage.setItem('betinna:theme', tema), TEMA);
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200));
});
try {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByTestId('email').fill(EMAIL);
  await page.getByTestId('password').fill(SENHA);
  await page.getByTestId('login-btn').click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60000 });
  // Fecha o tour de boas-vindas / onboarding se aparecer (fica por cima da tela).
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByText('Pular tour', { exact: false }).click({ timeout: 1500 }).catch(() => {});
  await page.goto(BASE + ROUTE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByText('Pular tour', { exact: false }).click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(800);
  if (CLICK) {
    await page.getByRole('button', { name: CLICK, exact: true }).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('OK screenshot ->', OUT, '(url', page.url() + ')');
} catch (e) {
  console.error('ERRO:', e.message);
  await page.screenshot({ path: OUT }).catch(() => {});
} finally {
  await browser.close();
}
