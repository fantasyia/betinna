// Screenshot de qualquer rota do Betinna (prod) — visão própria via Playwright.
// uso: node shot.mjs /rota saida.png   (creds via env BET_EMAIL/BET_SENHA)
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://frontend-production-fd70.up.railway.app';
const EMAIL = process.env.BET_EMAIL || 'admin@betinna.ai';
const SENHA = process.env.BET_SENHA || 'Betinna@2026';
const ROUTE = process.argv[2] || '/dashboard';
const OUT = process.argv[3] || 'shot.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('OK screenshot ->', OUT, '(url', page.url() + ')');
} catch (e) {
  console.error('ERRO:', e.message);
  await page.screenshot({ path: OUT }).catch(() => {});
} finally {
  await browser.close();
}
