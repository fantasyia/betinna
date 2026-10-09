#!/usr/bin/env node
/**
 * Servidor do front (SPA) — substitui o `serve dist -s` (07/10/2026).
 *
 * Por que existe: o robô que monta o PREVIEW do link (WhatsApp, Instagram,
 * Facebook…) NÃO roda o app — lê o HTML cru. Com arquivo estático, todo
 * domínio entregava o mesmo `<title>Betinna.ai — Plataforma comercial B2B`,
 * e o link da vitrine da Ribelt saía no WhatsApp com a marca do produto.
 *
 * O que faz, e só isso:
 *  - serve `dist/` com os MESMOS cabeçalhos do antigo `serve.json`
 *    (segurança em tudo; assets imutáveis; html/sw/manifest sem cache);
 *  - no fallback de SPA (qualquer rota que não é arquivo), devolve o
 *    index.html com título, descrição e imagem da marca DO DOMÍNIO, lidos de
 *    `GET /public/branding?host=` (cache de 5 min; API fora = HTML padrão);
 *  - domínio próprio com vitrine ativa: a raiz `/` vai pra `/v/<slug>` — o
 *    link que vai pro lojista é só o domínio;
 *  - Política de Privacidade (`/privacidade` no domínio da vitrine, ou
 *    `/v/<slug>/privacidade`) em HTML PRONTO: o Meta confere a URL com robô,
 *    que não roda o app (09/10 — sem ela, nada de formulário de anúncio).
 *
 * Sem dependência nenhuma (node:http/fs). Exporta `criarServidor` pros testes.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Os mesmos de `public/serve.json` (que o `serve` aplicava). */
const SEGURANCA = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const SEM_CACHE = 'no-cache, must-revalidate';

/** Cache-Control por caminho — mesma regra do `serve.json`. */
export function cacheDe(rel) {
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (
    rel.endsWith('.html') ||
    rel === 'sw.js' ||
    rel === 'registerSW.js' ||
    rel === 'manifest.webmanifest' ||
    /^workbox-[^/]*\.js$/.test(rel)
  ) {
    return SEM_CACHE;
  }
  return null;
}

const escapar = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Host sem porta, minúsculo, sem www — igual ao backend. */
export function normalizarHost(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

/**
 * Troca título, descrição e imagens do preview pelos da MARCA. Só mexe quando
 * o domínio é DE um tenant (marca.dominio === host); o resto fica Betinna.
 */
export function aplicarMarca(html, marca, { host, caminho }) {
  if (!marca || !marca.dominio || normalizarHost(marca.dominio) !== normalizarHost(host)) return html;
  const base = `https://${normalizarHost(host)}`;
  const titulo = marca.tituloApp || marca.nome;
  const descricao = marca.descricao || `${marca.nome}`;
  const imagemRel = marca.imagemCompartilhamento || marca.logoUrl || null;
  const imagem = imagemRel ? new URL(imagemRel, base).toString() : null;
  const url = new URL(caminho || '/', base).toString();
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapar(titulo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapar(descricao)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapar(titulo)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapar(descricao)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapar(titulo)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escapar(descricao)}$2`);
  out = imagem
    ? out.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${escapar(imagem)}$2`)
    : out.replace(/\s*<meta property="og:image" content="[^"]*" \/>/, '');
  // Site, endereço canônico e imagem grande — o que o WhatsApp usa pro cartão.
  const extra = [
    `<meta property="og:site_name" content="${escapar(marca.nome)}" />`,
    `<meta property="og:url" content="${escapar(url)}" />`,
    imagem ? `<meta property="og:image:alt" content="${escapar(titulo)}" />` : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  out = out.replace('</head>', `    ${extra}\n  </head>`);
  if (imagem) out = out.replace(/(<meta name="twitter:card" content=")[^"]*(")/, '$1summary_large_image$2');
  return out;
}

/** Qual vitrine a URL pede a política. null = não é a página de privacidade. */
export function slugDaPrivacidade(caminho, marca, doTenant) {
  const m = /^\/v\/([a-z0-9-]{3,40})\/privacidade\/?$/.exec(caminho);
  if (m) return m[1];
  if (/^\/privacidade\/?$/.test(caminho) && doTenant && marca?.vitrineSlug) return marca.vitrineSlug;
  return null;
}

const ESTILO_PAGINA = `
  :root{color-scheme:light}
  body{margin:0;background:#fbfaf7;color:#1f2a30;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{max-width:720px;margin:0 auto;padding:28px 18px 48px}
  a{color:inherit}
  .voltar{display:inline-block;margin-bottom:18px;font-size:14px}
  h1{font-size:26px;line-height:1.25;margin:0 0 6px}
  .data{margin:0 0 24px;color:#5f6b70;font-size:14px}
  h2{font-size:18px;margin:28px 0 8px}
  p{margin:0 0 10px}
  ul{margin:0 0 10px;padding-left:20px}
  li{margin:0 0 6px}`;

/** Página HTML completa e sem JavaScript — o que o robô do Meta lê. */
export function paginaPrivacidade(p, { voltar }) {
  const secoes = (p.secoes ?? [])
    .map((s) => {
      const par = (s.paragrafos ?? []).map((x) => `<p>${escapar(x)}</p>`).join('');
      const itens = s.itens?.length ? `<ul>${s.itens.map((x) => `<li>${escapar(x)}</li>`).join('')}</ul>` : '';
      return `<section><h2>${escapar(s.titulo)}</h2>${par}${itens}</section>`;
    })
    .join('\n');
  const data = String(p.atualizadaEm ?? '').slice(0, 10).split('-').reverse().join('/');
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapar(p.titulo)}</title>
<meta name="description" content="${escapar(`Como ${p.marca} trata os seus dados pessoais.`)}" />
<meta name="robots" content="index,follow" />
<style>${ESTILO_PAGINA}</style>
</head><body><main>
<a class="voltar" href="${escapar(voltar)}">← Voltar à vitrine</a>
<h1>${escapar(p.titulo)}</h1>
${data ? `<p class="data">Última atualização: ${escapar(data)}</p>` : ''}
${secoes}
</main></body></html>`;
}

const PAGINA_AVISO = (titulo, texto) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapar(titulo)}</title><meta name="robots" content="noindex" /><style>${ESTILO_PAGINA}</style></head>
<body><main><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></main></body></html>`;

export function criarServidor({ dist, apiUrl, fetchFn = fetch, ttlMs = 5 * 60_000 }) {
  const raiz = resolve(dist);
  const cacheMarca = new Map();
  let modelo = null;

  async function indexHtml() {
    if (!modelo) modelo = await readFile(join(raiz, 'index.html'), 'utf8');
    return modelo;
  }

  async function marcaDo(host) {
    const chave = normalizarHost(host);
    if (!chave || !apiUrl) return null;
    const c = cacheMarca.get(chave);
    if (c && c.exp > Date.now()) return c.marca;
    let marca = null;
    try {
      const r = await fetchFn(
        `${apiUrl.replace(/\/+$/, '')}/api/v1/public/branding?host=${encodeURIComponent(chave)}`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (r.ok) marca = (await r.json())?.data ?? null;
    } catch {
      // API fora: HTML padrão (e tenta de novo logo — cache curto pra falha).
      cacheMarca.set(chave, { marca: null, exp: Date.now() + 15_000 });
      return null;
    }
    cacheMarca.set(chave, { marca, exp: Date.now() + ttlMs });
    return marca;
  }

  async function arquivo(rel) {
    // Sem `..` nem caminho absoluto: tudo tem que morar dentro de dist/.
    const alvo = normalize(join(raiz, rel));
    if (alvo !== raiz && !alvo.startsWith(raiz + sep)) return null;
    try {
      const s = await stat(alvo);
      return s.isFile() ? alvo : null;
    } catch {
      return null;
    }
  }

  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', ...SEGURANCA });
        return res.end();
      }
      const url = new URL(req.url ?? '/', 'http://x');
      let caminho;
      try {
        caminho = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400, SEGURANCA);
        return res.end();
      }
      const rel = caminho.replace(/^\/+/, '');
      const host = req.headers['x-forwarded-host'] || req.headers.host;

      // Arquivo de verdade (assets, ícones, sw…): serve como está.
      const alvo = rel && rel !== 'index.html' ? await arquivo(rel) : null;
      if (alvo) {
        const corpo = await readFile(alvo);
        const cache = cacheDe(rel);
        res.writeHead(200, {
          'Content-Type': MIME[extname(alvo).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': corpo.length,
          ...(cache ? { 'Cache-Control': cache } : {}),
          ...SEGURANCA,
        });
        return res.end(req.method === 'HEAD' ? undefined : corpo);
      }

      // Rota da SPA: index.html com a marca do domínio.
      const marca = await marcaDo(host);
      const doTenant = marca?.dominio && normalizarHost(marca.dominio) === normalizarHost(host);

      const slugPriv = slugDaPrivacidade(caminho, marca, doTenant);
      if (slugPriv) {
        let status = 503;
        let html = PAGINA_AVISO('Política de Privacidade', 'Página indisponível agora. Tente de novo em instantes.');
        try {
          const r = await fetchFn(
            `${apiUrl.replace(/\/+$/, '')}/api/v1/public/vitrine/${encodeURIComponent(slugPriv)}/privacidade`,
            { signal: AbortSignal.timeout(3000) },
          );
          if (r.ok) {
            const politica = (await r.json())?.data;
            if (politica?.secoes) {
              status = 200;
              html = paginaPrivacidade(politica, { voltar: doTenant ? '/' : `/v/${encodeURIComponent(slugPriv)}` });
            }
          } else if (r.status === 404) {
            status = 404;
            html = PAGINA_AVISO('Política de Privacidade', 'Esta página ainda não foi publicada.');
          }
        } catch {
          // API fora: 503 com aviso (nunca o app vazio no lugar da política).
        }
        const corpo = Buffer.from(html, 'utf8');
        res.writeHead(status, {
          'Content-Type': MIME['.html'],
          'Content-Length': corpo.length,
          'Cache-Control': status === 200 ? 'public, max-age=300' : SEM_CACHE,
          ...SEGURANCA,
        });
        return res.end(req.method === 'HEAD' ? undefined : corpo);
      }
      if (caminho === '/' && doTenant && marca.vitrineSlug) {
        res.writeHead(302, {
          Location: `/v/${encodeURIComponent(marca.vitrineSlug)}${url.search}`,
          'Cache-Control': SEM_CACHE,
          ...SEGURANCA,
        });
        return res.end();
      }
      const html = aplicarMarca(await indexHtml(), marca, { host, caminho });
      const corpo = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Length': corpo.length,
        'Cache-Control': SEM_CACHE,
        ...SEGURANCA,
      });
      return res.end(req.method === 'HEAD' ? undefined : corpo);
    } catch (err) {
      console.error('[front] erro servindo', req.url, err);
      if (!res.headersSent) res.writeHead(500, SEGURANCA);
      res.end();
    }
  });
}

// Execução direta: `node server.mjs` (Railway).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const porta = Number(process.env.PORT || 4173);
  const apiUrl = process.env.BRANDING_API_URL || process.env.VITE_API_URL || '';
  const dist = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
  criarServidor({ dist, apiUrl }).listen(porta, () => {
    console.log(`[front] servindo ${dist} na porta ${porta} (marca via ${apiUrl || 'sem API — HTML padrão'})`);
  });
}
