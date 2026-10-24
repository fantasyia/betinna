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
  aplicarProduto,
  produtoDaRota,
  seoDoProduto,
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

let sitesDir = '';
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
const VITRINE = {
  empresa: { nome: 'Ribelt Têxtil', whatsapp: '5511933809738', logoUrl: 'https://atacado.ribelt.com.br/marcas/x.png' },
  faixas: { minimoVolume: 200, minimoAtacadao: 1000 },
  pedidoMinimo: { valorMin: 600, quantidadeMin: 50, modo: 'OU' },
  pagamentoOnline: true,
  linhas: [{ nome: 'Regular', selo: null }, { nome: 'Plus Size', selo: 'veste até 150 kg' }],
  geo: {
    titulo: 'Ribelt Têxtil · Atacado de roupa masculina',
    sobre: 'Roupa masculina no atacado, direto da confecção.',
    faq: [{ pergunta: 'Qual o pedido mínimo?', resposta: '50 peças ou R$ 600, o que bater primeiro.' }],
    redes: ['https://www.instagram.com/_ribelt'],
  },
  modelos: [
    {
      id: 'm1',
      slug: 'bermuda-moletom-summer',
      slugsAntigos: ['bermuda-velha'],
      nome: 'Bermuda Moletom Summer',
      descricao: null,
      composicao: '65% poliéster, 35% algodão',
      atualizadoEm: '2026-10-22T10:00:00.000Z',
      cores: [{ nome: 'Preto', fotos: [{ url: 'https://cdn.test/b.jpg' }] }, { nome: 'Bege', fotos: [] }],
      linhas: [
        { precoEntrada: 19.99, precoVolume: 17.99, precoAtacadao: 16.99, tamanhos: [{ nome: 'P' }, { nome: 'GG' }] },
      ],
    },
  ],
};
const fetchFn = vi.fn(async (url: string) => {
  if (/\/public\/vitrine\/atacado-ribelt$/.test(new URL(url).pathname)) {
    return new Response(JSON.stringify({ success: true, data: VITRINE }), { status: 200 });
  }
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
  // Site estático por domínio: lp.teste.com (teste, com .noindex) e landing.com (indexa).
  const sites = join(dir, '..', `sites-${Date.now()}`);
  sitesDir = sites;
  mkdirSync(join(sites, 'lp.teste.com', 'img'), { recursive: true });
  writeFileSync(join(sites, 'lp.teste.com', 'index.html'), '<h1>landing A</h1>');
  writeFileSync(join(sites, 'lp.teste.com', 'opcao-b.html'), '<h1>landing B</h1>');
  writeFileSync(join(sites, 'lp.teste.com', 'img', 'logo.png'), Buffer.from([0x89, 0x50]));
  writeFileSync(join(sites, 'lp.teste.com', '.noindex'), '');
  mkdirSync(join(sites, 'landing.com'));
  writeFileSync(join(sites, 'landing.com', 'index.html'), '<h1>oficial</h1>');
  server = criarServidor({ dist: dir, apiUrl: 'http://api.test', fetchFn: fetchFn as never, sites });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(sitesDir, { recursive: true, force: true });
});

describe('site estático por domínio (landing, 24/10)', () => {
  it('domínio com pasta própria serve a landing, não o app; .noindex vira X-Robots-Tag', async () => {
    const r = await get('/', 'lp.teste.com');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('<h1>landing A</h1>');
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(r.headers.get('cache-control')).toBe('no-cache, must-revalidate');
    const b = await get('/opcao-b', 'lp.teste.com');
    expect(await b.text()).toBe('<h1>landing B</h1>');
    const img = await get('/img/logo.png', 'lp.teste.com');
    expect(img.headers.get('content-type')).toBe('image/png');
  });

  it('www cai na mesma pasta; sem .noindex não manda noindex', async () => {
    const r = await get('/', 'www.landing.com');
    expect(await r.text()).toBe('<h1>oficial</h1>');
    expect(r.headers.get('x-robots-tag')).toBeNull();
  });

  it('arquivo com ponto e caminho inexistente dão 404 (nunca o SPA nem o marcador)', async () => {
    expect((await get('/.noindex', 'lp.teste.com')).status).toBe(404);
    expect((await get('/pedidos/1', 'lp.teste.com')).status).toBe(404);
    expect((await get('/%2e%2e/%2e%2e/fora-do-dist.txt', 'lp.teste.com')).status).toBe(404);
  });

  it('domínio sem pasta segue no app como antes', async () => {
    const r = await get('/pedidos/123', 'app.somatecblocking.com.br');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-robots-tag')).toBeNull();
  });
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
    const r = await get('/', 'atacado.ribelt.com.br');
    const html = await r.text();
    // 23/10 (GEO): a raiz da vitrine usa o título da vitrine (config.geo), não o do app.
    expect(html).toContain('<title>Ribelt Têxtil · Atacado de roupa masculina</title>');
    expect(html).toContain('<meta property="og:title" content="Ribelt Têxtil · Atacado de roupa masculina" />');
    expect(html).toContain('content="Moda masculina no atacado &quot;direto&quot; da produção"');
    expect(html).toContain('<meta property="og:image" content="https://atacado.ribelt.com.br/marcas/ribelt-og.png" />');
    expect(html).toContain('<meta property="og:url" content="https://atacado.ribelt.com.br/" />');
    expect(html).toContain('summary_large_image');
    expect(html).not.toContain('Betinna.ai — Plataforma');
  });

  it('14/10: a vitrine mora na RAIZ do domínio — sem redirecionar', async () => {
    const r = await get('/?utm_source=whatsapp', 'atacado.ribelt.com.br');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>Ribelt Têxtil · Atacado de roupa masculina</title>');
  });

  it('link antigo /v/<slug> no domínio da vitrine → raiz (302), mantendo a query', async () => {
    for (const caminho of ['/v/atacado-ribelt', '/v/atacado-ribelt/']) {
      const r = await get(`${caminho}?utm_source=meta&fbclid=abc`, 'atacado.ribelt.com.br');
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('/?utm_source=meta&fbclid=abc');
    }
  });

  it('/v/<slug> no domínio do APP segue como está (sem redirecionar)', async () => {
    const r = await get('/v/atacado-ribelt', 'app.somatecblocking.com.br');
    expect(r.status).toBe(200);
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

describe('página do produto, sitemap e robots (card cmvkaagey, 23/10)', () => {
  it('/p/<slug> no domínio da vitrine: título, preço, foto, canonical e JSON-LD do produto', async () => {
    const r = await get('/p/bermuda-moletom-summer?utm_source=meta', 'atacado.ribelt.com.br');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<title>Bermuda Moletom Summer · Ribelt Têxtil</title>');
    expect(html).toContain('a partir de R$ 16,99/peça');
    expect(html).toContain('<link rel="canonical" href="https://atacado.ribelt.com.br/p/bermuda-moletom-summer" />');
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/b.jpg" />');
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(ld['@type']).toBe('Product');
    expect(ld.offers).toMatchObject({ priceCurrency: 'BRL', lowPrice: '16.99', highPrice: '19.99' });
    // Só um og:url (o do produto), não o da raiz.
    expect(html.match(/property="og:url"/g)).toHaveLength(1);
  });

  it('produto que não existe: 404 com noindex (o app ainda abre)', async () => {
    const r = await get('/p/nao-existe', 'atacado.ribelt.com.br');
    expect(r.status).toBe(404);
    expect(await r.text()).toContain('<meta name="robots" content="noindex" />');
  });

  it('/p/<slug> fora do domínio de uma vitrine não é produto', () => {
    expect(produtoDaRota('/p/x', null, false)).toBeNull();
    expect(produtoDaRota('/v/atacado-ribelt/p/x', null, false)).toEqual({ vitrine: 'atacado-ribelt', produto: 'x' });
  });

  it('sitemap.xml: a raiz + 1 URL por produto, com lastmod', async () => {
    const r = await get('/sitemap.xml', 'atacado.ribelt.com.br');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/xml');
    const x = await r.text();
    expect(x).toContain('<loc>https://atacado.ribelt.com.br/</loc>');
    expect(x).toContain('<loc>https://atacado.ribelt.com.br/p/bermuda-moletom-summer</loc><lastmod>2026-10-22</lastmod>');
  });

  it('robots.txt da vitrine: aberto, sem o link do modo interno, com o sitemap', async () => {
    const t = await (await get('/robots.txt', 'atacado.ribelt.com.br')).text();
    expect(t).toContain('Allow: /');
    expect(t).toContain('Disallow: /*?interno=');
    expect(t).toContain('Sitemap: https://atacado.ribelt.com.br/sitemap.xml');
  });
});

describe('título pro Google, palavras SEO e endereço antigo (23/10)', () => {
  it('endereço antigo (o nome mudou): 301 pro atual, levando a query', async () => {
    const r = await get('/p/bermuda-velha?utm_source=meta', 'atacado.ribelt.com.br');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/p/bermuda-moletom-summer?utm_source=meta');
  });

  it('tituloSeo manda no <title> e no JSON-LD; palavras viram keywords', () => {
    const modelo = {
      ...VITRINE.modelos[0],
      tituloSeo: 'Bermuda de Moletom Masculina no Atacado',
      palavrasSeo: ['bermuda moletom atacado', 'revenda'],
    };
    const seo = seoDoProduto(modelo, VITRINE, { base: 'https://atacado.ribelt.com.br', caminho: '/p/x' });
    expect(seo.titulo).toBe('Bermuda de Moletom Masculina no Atacado · Ribelt Têxtil');
    expect(seo.jsonLd.name).toBe('Bermuda de Moletom Masculina no Atacado');
    expect(seo.jsonLd.keywords).toBe('bermuda moletom atacado, revenda');
    const html = aplicarProduto('<html><head><title>x</title></head></html>', seo);
    expect(html).toContain('<meta name="keywords" content="bermuda moletom atacado, revenda" />');
  });
});

describe('GEO: robôs das IAs leem o conteúdo sem rodar o app (card cmvkab9gl, 23/10)', () => {
  it('raiz da vitrine: título da vitrine, conteúdo em texto, JSON-LD da loja e da FAQ', async () => {
    const html = await (await get('/', 'atacado.ribelt.com.br')).text();
    expect(html).toContain('<title>Ribelt Têxtil · Atacado de roupa masculina</title>');
    expect(html).toContain('Pedido mínimo: 50 peças ou R$ 600, o que bater primeiro.');
    expect(html).toContain('href="https://atacado.ribelt.com.br/p/bermuda-moletom-summer"');
    expect(html).toContain('"@type":"OnlineStore"');
    expect(html).toContain('"@type":"FAQPage"');
    // O cliente (com JS) não vê o texto cru piscando.
    expect(html).toContain('.js .seo-conteudo{display:none}');
  });

  it('produto: preços por faixa e medidas em texto', async () => {
    const html = await (await get('/p/bermuda-moletom-summer', 'atacado.ribelt.com.br')).text();
    expect(html).toContain('Atacadão (a partir de 1.000 peças): R$ 16,99');
    expect(html).toContain('Composição: 65% poliéster, 35% algodão.');
  });

  it('/faq em HTML pronto com FAQPage', async () => {
    const r = await get('/faq', 'atacado.ribelt.com.br');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<h2>Qual o pedido mínimo?</h2>');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).not.toContain('<div id="root">');
  });

  it('/llms.txt é texto de verdade, com produtos e FAQ', async () => {
    const r = await get('/llms.txt', 'atacado.ribelt.com.br');
    expect(r.headers.get('content-type')).toContain('text/markdown');
    const t = await r.text();
    expect(t.startsWith('# Ribelt Têxtil · Atacado de roupa masculina')).toBe(true);
    expect(t).toContain('(https://atacado.ribelt.com.br/p/bermuda-moletom-summer)');
    expect(t).toContain('**Qual o pedido mínimo?**');
  });

  it('robots libera os robôs das IAs pelo nome', async () => {
    const t = await (await get('/robots.txt', 'atacado.ribelt.com.br')).text();
    for (const b of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot']) {
      expect(t).toContain(`User-agent: ${b}
Allow: /`);
    }
  });

  it('/faq e /llms.txt no domínio do APP seguem o app (não são da vitrine)', async () => {
    const r = await get('/llms.txt', 'app.betinna.ai');
    expect(r.headers.get('content-type')).toContain('text/html');
  });
});
