// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  aplicarMarca,
  cacheDe,
  criarServidor,
  paginaPrivacidade,
  slugDaPrivacidade,
} from '../server.mjs';

/**
 * Servidor do front (server.mjs), que substituiu o `serve dist -s`.
 *
 * O que precisa ficar travado: (1) o resto do app continua igual — arquivos,
 * cabeçalhos de segurança e de cache do antigo serve.json, fallback de SPA;
 * (2) o PREVIEW do link no domínio de um tenant sai com a marca DELE; (3) a
 * raiz do domínio com vitrine vai pra vitrine; (4) API fora nunca derruba o app.
 */

const INDEX = `<!doctype html><html><head>
    <title>Betinna.ai — Plataforma comercial B2B</title>
    <meta name="description" content="CRM + pedidos" />
    <meta property="og:title" content="Betinna.ai — Plataforma comercial B2B" />
    <meta property="og:description" content="CRM + pedidos" />
    <meta property="og:image" content="/betinna-symbol.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Betinna.ai" />
    <meta name="twitter:description" content="Plataforma comercial B2B" />
  </head><body><div id="root"></div></body></html>`;

const RIBELT = {
  nome: 'Ribelt Distribuidora Têxtil',
  dominio: 'atacado.ribelt.com.br',
  tituloApp: 'Ribelt Atacado',
  descricao: 'Moda masculina no atacado "direto" da produção',
  imagemCompartilhamento: '/marcas/ribelt-og.png',
  logoUrl: 'https://atacado.ribelt.com.br/marcas/ribelt-nominal.png',
  vitrineSlug: 'atacado-ribelt',
};

let dir: string;
let server: Server;
let base: string;
const POLITICA = {
  titulo: 'Política de Privacidade · Ribelt Têxtil',
  marca: 'Ribelt Têxtil',
  atualizadaEm: '2026-10-09',
  secoes: [
    { titulo: 'Quem somos', paragrafos: ['Controlador: <Ribelt> & cia'] },
    { titulo: 'Seus direitos', paragrafos: ['Você pode pedir:'], itens: ['acesso', 'correção'] },
  ],
};
const fetchFn = vi.fn(async (url: string) => {
  const priv = /\/public\/vitrine\/([^/]+)\/privacidade$/.exec(new URL(url).pathname);
  if (priv) {
    if (priv[1] === 'api-fora') throw new Error('timeout');
    if (priv[1] !== 'atacado-ribelt') return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ success: true, data: POLITICA }), { status: 200 });
  }
  const host = new URL(url).searchParams.get('host');
  if (host === 'api-fora.com') throw new Error('timeout');
  const data = host === 'atacado.ribelt.com.br' ? RIBELT : { nome: 'Betinna.ai', dominio: null };
  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
});

async function get(path: string, host: string, method = 'GET') {
  // `host` é cabeçalho proibido no fetch do Node; o proxy do Railway manda o
  // domínio também em x-forwarded-host, que o servidor lê primeiro.
  return fetch(`${base}${path}`, { method, headers: { 'x-forwarded-host': host }, redirect: 'manual' });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'front-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, 'sw.js'), '// sw');
  writeFileSync(join(dir, 'betinna-symbol.png'), Buffer.from([0x89, 0x50]));
  writeFileSync(join(tmpdir(), 'fora-do-dist.txt'), 'segredo');
  server = criarServidor({ dist: dir, apiUrl: 'http://api.test', fetchFn: fetchFn as never });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('servidor do front — o app continua igual', () => {
  it('arquivo de verdade sai como está, com os cabeçalhos do antigo serve.json', async () => {
    const r = await get('/assets/index-abc.js', 'app.somatecblocking.com.br');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/javascript');
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(await r.text()).toBe('console.log(1)');
  });

  it('regras de cache iguais às do serve.json', () => {
    expect(cacheDe('sw.js')).toBe('no-cache, must-revalidate');
    expect(cacheDe('workbox-1a2b.js')).toBe('no-cache, must-revalidate');
    expect(cacheDe('registerSW.js')).toBe('no-cache, must-revalidate');
    expect(cacheDe('manifest.webmanifest')).toBe('no-cache, must-revalidate');
    expect(cacheDe('betinna-symbol.png')).toBeNull();
  });

  it('rota da SPA (sem arquivo) devolve o index.html; domínio sem marca = Betinna intacto', async () => {
    const r = await get('/pedidos/123', 'app.somatecblocking.com.br');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-cache, must-revalidate');
    expect(await r.text()).toBe(INDEX);
  });

  it('não sai de dentro do dist (../)', async () => {
    const r = await get('/..%2Ffora-do-dist.txt', 'app.somatecblocking.com.br');
    expect(await r.text()).not.toContain('segredo');
  });

  it('API de marca fora: HTML padrão, nunca erro', async () => {
    const r = await get('/login', 'api-fora.com');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(INDEX);
  });

  it('POST não é servido', async () => {
    const r = await get('/x', 'app.somatecblocking.com.br', 'POST');
    expect(r.status).toBe(405);
  });
});

describe('servidor do front — preview do link com a marca do domínio', () => {
  it('domínio do tenant: título, descrição e imagem DELE (absolutas, escapadas)', async () => {
    const r = await get('/v/atacado-ribelt', 'atacado.ribelt.com.br');
    const html = await r.text();
    expect(html).toContain('<title>Ribelt Atacado</title>');
    expect(html).toContain('<meta property="og:title" content="Ribelt Atacado" />');
    expect(html).toContain('content="Moda masculina no atacado &quot;direto&quot; da produção"');
    expect(html).toContain('<meta property="og:image" content="https://atacado.ribelt.com.br/marcas/ribelt-og.png" />');
    expect(html).toContain('<meta property="og:url" content="https://atacado.ribelt.com.br/v/atacado-ribelt" />');
    expect(html).toContain('summary_large_image');
    expect(html).not.toContain('Betinna.ai — Plataforma');
  });

  it('raiz do domínio com vitrine → vitrine (302), mantendo a query', async () => {
    const r = await get('/?utm_source=whatsapp', 'atacado.ribelt.com.br');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/v/atacado-ribelt?utm_source=whatsapp');
  });

  it('a raiz de domínio SEM vitrine segue pro app (sem redirecionar)', async () => {
    const r = await get('/', 'app.somatecblocking.com.br');
    expect(r.status).toBe(200);
  });

  it('marca de outro domínio não vaza: só aplica quando o host É o domínio da marca', () => {
    expect(aplicarMarca(INDEX, RIBELT, { host: 'app.somatecblocking.com.br', caminho: '/' })).toBe(INDEX);
  });

  it('cache de 5 min: a API de marca é consultada uma vez por domínio', async () => {
    fetchFn.mockClear();
    await get('/v/a', 'atacado.ribelt.com.br');
    await get('/v/b', 'atacado.ribelt.com.br');
    expect(fetchFn).toHaveBeenCalledTimes(0); // já estava em cache dos testes acima
  });
});

describe('Política de Privacidade (o Meta confere a URL com robô, sem rodar o app)', () => {
  it('/privacidade no domínio da vitrine: HTML PRONTO, com o texto e escapado', async () => {
    const r = await get('/privacidade', 'atacado.ribelt.com.br');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<h1>Política de Privacidade · Ribelt Têxtil</h1>');
    expect(html).toContain('<li>acesso</li>');
    expect(html).toContain('Última atualização: 09/10/2026');
    expect(html).toContain('&lt;Ribelt&gt; &amp; cia');
    expect(html).not.toContain('<div id="root">'); // não é o app
    expect(html).toContain('href="/"'); // voltar = raiz do domínio (vai pra vitrine)
  });

  it('/v/<slug>/privacidade funciona em qualquer domínio', async () => {
    const r = await get('/v/atacado-ribelt/privacidade', 'app.somatecblocking.com.br');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('href="/v/atacado-ribelt"');
  });

  it('/privacidade fora do domínio de uma vitrine segue pro app (não é página da Ribelt)', async () => {
    const r = await get('/privacidade', 'app.somatecblocking.com.br');
    expect(await r.text()).toContain('<div id="root">');
  });

  it('política não publicada: 404 com aviso; API fora: 503 com aviso (nunca o app vazio)', async () => {
    const naoPub = await get('/v/outra-vitrine/privacidade', 'app.somatecblocking.com.br');
    expect(naoPub.status).toBe(404);
    expect(await naoPub.text()).toContain('ainda não foi publicada');
    const fora = await get('/v/api-fora/privacidade', 'app.somatecblocking.com.br');
    expect(fora.status).toBe(503);
  });

  it('slugDaPrivacidade: só o formato esperado', () => {
    expect(slugDaPrivacidade('/v/atacado-ribelt/privacidade', null, false)).toBe('atacado-ribelt');
    expect(slugDaPrivacidade('/v/../privacidade', null, false)).toBeNull();
    expect(slugDaPrivacidade('/privacidade', RIBELT, false)).toBeNull();
    expect(slugDaPrivacidade('/privacidade', RIBELT, true)).toBe('atacado-ribelt');
    expect(slugDaPrivacidade('/v/atacado-ribelt', RIBELT, true)).toBeNull();
  });

  it('paginaPrivacidade não roda script nenhum', () => {
    expect(paginaPrivacidade(POLITICA, { voltar: '/' })).not.toMatch(/<script/i);
  });
});
