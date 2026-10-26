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
 *  - Página do PRODUTO (`/p/<slug>` no domínio da vitrine, ou
 *    `/v/<vitrine>/p/<slug>`, 23/10): o index.html com título, descrição,
 *    imagem, canonical e JSON-LD `Product` DAQUELE modelo — o Google e o
 *    WhatsApp leem o HTML cru. O app abre já no produto.
 *  - `/sitemap.xml` e `/robots.txt` próprios do domínio da vitrine.
 *  - GEO (23/10): os robôs das IAs NÃO rodam JavaScript. A raiz e cada
 *    produto saem com o CONTEÚDO em texto dentro do #root (o app substitui ao
 *    carregar), JSON-LD OnlineStore + FAQPage na raiz; `/faq` em HTML pronto;
 *    `/llms.txt` de verdade; robots liberando os robôs das IAs.
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
  '.xml': 'application/xml; charset=utf-8',
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
  // Cor da barra do navegador = a da marca (não o magenta do Betinna).
  const cor = marca.cores?.primaria;
  if (cor && /^#[0-9a-fA-F]{6}$/.test(cor)) {
    out = out.replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1${cor}$2`);
  }
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

/** Qual produto a URL pede. null = não é página de produto. PURO. */
export function produtoDaRota(caminho, marca, doTenant) {
  const m = /^\/v\/([a-z0-9-]{3,40})\/p\/([a-z0-9-]{1,90})\/?$/.exec(caminho);
  if (m) return { vitrine: m[1], produto: m[2] };
  const t = /^\/p\/([a-z0-9-]{1,90})\/?$/.exec(caminho);
  if (t && doTenant && marca?.vitrineSlug) return { vitrine: marca.vitrineSlug, produto: t[1] };
  return null;
}

/** Menor e maior preço por peça do modelo (atacadão → entrada). PURO. */
export function faixaDePreco(modelo) {
  const precos = [];
  for (const l of modelo.linhas ?? []) {
    for (const v of [l.precoAtacadao, l.precoVolume, l.precoEntrada]) {
      if (typeof v === 'number' && v > 0) precos.push(v);
    }
  }
  return precos.length ? { min: Math.min(...precos), max: Math.max(...precos) } : null;
}

const reais = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;

/** Capa do produto (1ª foto da 1ª cor) e as demais, absolutas. */
function fotosDo(modelo, base) {
  const out = [];
  for (const c of modelo.cores ?? []) {
    const f = c.fotos?.[0];
    if (f?.url) out.push(new URL(f.url, base).toString());
  }
  return out;
}

/** Os dados de SEO do produto, prontos pro HTML. PURO. */
export function seoDoProduto(modelo, vitrine, { base, caminho }) {
  const marca = vitrine?.empresa?.nome || 'Atacado';
  const faixa = faixaDePreco(modelo);
  const cores = (modelo.cores ?? []).map((c) => c.nome);
  const tamanhos = [...new Set((modelo.linhas ?? []).flatMap((l) => (l.tamanhos ?? []).map((t) => t.nome)))];
  const partes = [
    'Atacado direto da confecção',
    faixa ? `a partir de ${reais(faixa.min)}/peça` : null,
    cores.length ? `${cores.length} ${cores.length === 1 ? 'cor' : 'cores'}` : null,
    tamanhos.length ? `tamanhos ${tamanhos[0]} a ${tamanhos[tamanhos.length - 1]}` : null,
  ].filter(Boolean);
  const nomeSeo = modelo.tituloSeo || modelo.nome;
  const descricao = `${nomeSeo}: ${partes.join(' · ')}.`;
  const palavras = Array.isArray(modelo.palavrasSeo) ? modelo.palavrasSeo.filter(Boolean) : [];
  const url = new URL(caminho, base).toString();
  const fotos = fotosDo(modelo, base);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: nomeSeo,
    description: modelo.descricao || descricao,
    ...(palavras.length ? { keywords: palavras.join(', ') } : {}),
    url,
    ...(fotos.length ? { image: fotos } : {}),
    brand: { '@type': 'Brand', name: marca },
    ...(modelo.composicao ? { material: modelo.composicao } : {}),
    ...(cores.length ? { color: cores.join(', ') } : {}),
    ...(faixa
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'BRL',
            lowPrice: faixa.min.toFixed(2),
            highPrice: faixa.max.toFixed(2),
            availability: 'https://schema.org/InStock',
            url,
          },
        }
      : {}),
  };
  return { titulo: `${nomeSeo} · ${marca}`, descricao, url, imagem: fotos[0] ?? null, jsonLd, palavras };
}

/** index.html vestido com o produto (título, descrição, OG, canonical, JSON-LD). */
export function aplicarProduto(html, seo) {
  // `</` dentro do JSON fecharia o <script>: escapa a barra.
  const ld = JSON.stringify(seo.jsonLd).replace(/<\//g, '<\\/');
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapar(seo.titulo)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapar(seo.descricao)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapar(seo.titulo)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapar(seo.descricao)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapar(seo.titulo)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escapar(seo.descricao)}$2`)
    // A marca já pôs og:url da raiz: o do produto manda.
    .replace(/\s*<meta property="og:url" content="[^"]*" \/>/g, '');
  if (seo.imagem) {
    out = /<meta property="og:image" content="/.test(out)
      ? out.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${escapar(seo.imagem)}$2`)
      : out.replace('</head>', `  <meta property="og:image" content="${escapar(seo.imagem)}" />\n  </head>`);
    out = out.replace(/(<meta name="twitter:card" content=")[^"]*(")/, '$1summary_large_image$2');
  }
  const extra = [
    `<link rel="canonical" href="${escapar(seo.url)}" />`,
    ...(seo.palavras?.length ? [`<meta name="keywords" content="${escapar(seo.palavras.join(', '))}" />`] : []),
    `<meta property="og:url" content="${escapar(seo.url)}" />`,
    `<meta property="og:type" content="product" />`,
    `<script type="application/ld+json">${ld}</script>`,
  ].join('\n    ');
  return out.replace('</head>', `    ${extra}\n  </head>`);
}

// ─── GEO: conteúdo em texto pros robôs das IAs (23/10) ─────────────────────

const NOME_FAIXA = { entrada: 'Entrada', volume: 'Volume', atacadao: 'Atacadão' };

/** "até 199 peças / a partir de 200 / a partir de 1.000" pela regra da vitrine. PURO. */
export function faixasEmTexto(faixas) {
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  const out = [];
  const vol = faixas?.minimoVolume;
  const ata = faixas?.minimoAtacadao;
  out.push({ chave: 'entrada', rotulo: vol ? `até ${fmt(vol - 1)} peças` : 'qualquer quantidade' });
  if (vol) out.push({ chave: 'volume', rotulo: `a partir de ${fmt(vol)} peças` });
  if (ata) out.push({ chave: 'atacadao', rotulo: `a partir de ${fmt(ata)} peças` });
  return out;
}

const PRECO_DA = { entrada: 'precoEntrada', volume: 'precoVolume', atacadao: 'precoAtacadao' };

/** Texto do pedido mínimo ("50 peças ou R$ 600, o que bater primeiro"). PURO. */
export function minimoEmTexto(m) {
  if (!m) return null;
  const partes = [];
  if (m.quantidadeMin) partes.push(`${m.quantidadeMin} peças`);
  // R$ 600 (sem ,00) — é como o Léo escreve o mínimo.
  if (m.valorMin) partes.push(Number.isInteger(m.valorMin) ? `R$ ${m.valorMin.toLocaleString('pt-BR')}` : reais(m.valorMin));
  if (!partes.length) return null;
  return partes.length === 2
    ? `${partes[0]} ${m.modo === 'E' ? 'e' : 'ou'} ${partes[1]}${m.modo === 'E' ? '' : ', o que bater primeiro'}`
    : partes[0];
}

const h = (s) => escapar(s ?? '');

/** Conteúdo da RAIZ em HTML puro (vai dentro do #root; o app troca ao carregar). PURO. */
export function conteudoDaHome(v, { base }) {
  const nome = v?.empresa?.nome || 'Atacado';
  const geo = v?.geo ?? {};
  const linhas = (v?.linhas ?? []).map((l) => (l.selo ? `${l.nome} (${l.selo})` : l.nome));
  const minimo = minimoEmTexto(v?.pedidoMinimo);
  const produtos = (v?.modelos ?? []).map((m) => {
    const f = faixaDePreco(m);
    const nomeP = m.tituloSeo || m.nome;
    return `<li><a href="${h(new URL(`/p/${m.slug}`, base).toString())}">${h(nomeP)}</a>${f ? ` · a partir de ${h(reais(f.min))}/peça` : ''}</li>`;
  });
  const faixas = faixasEmTexto(v?.faixas).map((x) => `<li>${h(NOME_FAIXA[x.chave])}: ${h(x.rotulo)}</li>`);
  const contato = v?.empresa?.whatsapp ? `WhatsApp +${h(v.empresa.whatsapp)}` : '';
  return `<main class="seo-conteudo">
<h1>${h(geo.titulo || `${nome} · Atacado`)}</h1>
${geo.sobre ? `<p>${h(geo.sobre)}</p>` : ''}
${linhas.length ? `<p>Linhas: ${h(linhas.join(' · '))}.</p>` : ''}
${minimo ? `<p>Pedido mínimo: ${h(minimo)}.</p>` : ''}
${faixas.length ? `<h2>Preço por quantidade</h2><ul>${faixas.join('')}</ul>` : ''}
${produtos.length ? `<h2>Produtos</h2><ul>${produtos.join('')}</ul>` : ''}
${v?.pagamentoOnline ? '<p>Pagamento pelo site: Pix ou cartão de crédito.</p>' : ''}
<p><a href="/faq">Perguntas frequentes</a>${contato ? ` · ${contato}` : ''}</p>
</main>`;
}

/** Conteúdo do PRODUTO em HTML puro: preços por linha e faixa, cores, tamanhos, composição e medidas. PURO. */
export function conteudoDoProduto(m, v) {
  const faixas = faixasEmTexto(v?.faixas);
  const linhas = (m.linhas ?? []).map((l) => {
    const precos = faixas
      .map((f) => (typeof l[PRECO_DA[f.chave]] === 'number' ? `${NOME_FAIXA[f.chave]} (${f.rotulo}): ${reais(l[PRECO_DA[f.chave]])}` : null))
      .filter(Boolean);
    const tams = (l.tamanhos ?? []).map((t) => t.nome).join(', ');
    const tab = l.tabelaMedidas?.linhas?.length
      ? `<table><caption>Medidas · ${h(l.nome)}</caption><tr><th>Tamanho</th>${(l.tabelaMedidas.colunas ?? []).map((c) => `<th>${h(c)}</th>`).join('')}</tr>${l.tabelaMedidas.linhas
          .map((r) => `<tr><td>${h(r.tamanho)}</td>${(r.valores ?? []).map((x) => `<td>${h(x)}</td>`).join('')}</tr>`)
          .join('')}</table>`
      : '';
    return `<section><h2>${h(l.nome)}</h2>${tams ? `<p>Tamanhos: ${h(tams)}.</p>` : ''}${precos.length ? `<ul>${precos.map((p) => `<li>${h(p)}</li>`).join('')}</ul>` : ''}${typeof l.precoSugerido === 'number' ? `<p>Preço sugerido de revenda: ${h(reais(l.precoSugerido))}.</p>` : ''}${tab}</section>`;
  });
  const cores = (m.cores ?? []).map((c) => c.nome).join(', ');
  return `<main class="seo-conteudo">
<h1>${h(m.tituloSeo || m.nome)}</h1>
${m.descricao ? `<p>${h(m.descricao)}</p>` : ''}
${cores ? `<p>Cores: ${h(cores)}.</p>` : ''}
${m.composicao ? `<p>Composição: ${h(m.composicao)}.</p>` : ''}
${linhas.join('\n')}
<p><a href="/">Ver todos os produtos</a> · <a href="/faq">Perguntas frequentes</a></p>
</main>`;
}

/** Coloca o conteúdo dentro do #root (o React substitui ao montar). */
export function comConteudo(html, conteudo) {
  // Pra quem RODA JavaScript (o cliente) o bloco fica escondido até o app
  // montar no lugar — sem piscar texto cru; robô sem JS lê normal.
  const esconde =
    '<script>document.documentElement.className+=" js"</script>' +
    '<style>.js .seo-conteudo{display:none}</style>';
  return html
    .replace('</head>', `    ${esconde}
  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${conteudo}</div>`);
}

/** JSON-LD da RAIZ: a loja (OnlineStore) e, havendo, a FAQ. PURO. */
export function jsonLdDaHome(v, { base }) {
  const geo = v?.geo ?? {};
  const loja = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: v?.empresa?.nome,
    url: new URL('/', base).toString(),
    ...(v?.empresa?.logoUrl ? { logo: v.empresa.logoUrl } : {}),
    ...(geo.sobre ? { description: geo.sobre } : {}),
    ...(geo.redes?.length ? { sameAs: geo.redes } : {}),
    ...(v?.empresa?.whatsapp ? { telephone: `+${v.empresa.whatsapp}` } : {}),
  };
  const out = [loja];
  if (geo.faq?.length) out.push(jsonLdFaq(geo.faq));
  return out;
}

export function jsonLdFaq(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((x) => ({
      '@type': 'Question',
      name: x.pergunta,
      acceptedAnswer: { '@type': 'Answer', text: x.resposta },
    })),
  };
}

const scriptLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/<\//g, '<\\/')}</script>`;

/** Página /faq em HTML pronto (sem JavaScript). PURO. */
export function paginaFaq(v, { base }) {
  const nome = v?.empresa?.nome || 'Atacado';
  const faq = v?.geo?.faq ?? [];
  const itens = faq.map((x) => `<section><h2>${h(x.pergunta)}</h2><p>${h(x.resposta)}</p></section>`).join('\n');
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${h(`Perguntas frequentes · ${nome}`)}</title>
<meta name="description" content="${h(`Pedido mínimo, pagamento, frete, prazo e trocas no atacado da ${nome}.`)}" />
<link rel="canonical" href="${h(new URL('/faq', base).toString())}" />
<meta name="robots" content="index,follow" />
${faq.length ? scriptLd(jsonLdFaq(faq)) : ''}
<style>${ESTILO_PAGINA}</style>
</head><body><main>
<a class="voltar" href="/">← Ver os produtos</a>
<h1>${h(`Perguntas frequentes · ${nome}`)}</h1>
${itens || '<p>Em breve.</p>'}
</main></body></html>`;
}

/** /llms.txt: resumo em markdown pra quem lê com IA. PURO. */
export function llmsTxt(v, { base }) {
  const nome = v?.empresa?.nome || 'Atacado';
  const geo = v?.geo ?? {};
  const u = (p) => new URL(p, base).toString();
  const minimo = minimoEmTexto(v?.pedidoMinimo);
  const linhas = [
    `# ${geo.titulo || nome}`,
    '',
    `> ${geo.sobre || `${nome}: loja de atacado.`}`,
    '',
    ...(minimo ? [`- Pedido mínimo: ${minimo}.`] : []),
    ...faixasEmTexto(v?.faixas).map((f) => `- Preço ${NOME_FAIXA[f.chave]}: ${f.rotulo}.`),
    ...(v?.pagamentoOnline ? ['- Pagamento pelo site: Pix ou cartão de crédito.'] : []),
    ...(v?.empresa?.whatsapp ? [`- WhatsApp: +${v.empresa.whatsapp}`] : []),
    ...(geo.redes ?? []).map((r) => `- ${r}`),
    '',
    '## Produtos',
    '',
    ...(v?.modelos ?? []).map((m) => {
      const f = faixaDePreco(m);
      return `- [${m.tituloSeo || m.nome}](${u(`/p/${m.slug}`)})${f ? `: a partir de ${reais(f.min)}/peça` : ''}`;
    }),
    '',
    '## Perguntas frequentes',
    '',
    `- [Todas as perguntas](${u('/faq')})`,
    ...(geo.faq ?? []).map((x) => `- **${x.pergunta}** ${x.resposta}`),
    '',
  ];
  return linhas.join('\n');
}

const xml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** sitemap.xml: a raiz + 1 URL por produto ATIVO (a vitrine pública só traz ativos). PURO. */
export function sitemapXml(vitrine, base) {
  const urls = [
    `<url><loc>${xml(new URL('/', base).toString())}</loc></url>`,
    ...(vitrine?.modelos ?? [])
      .filter((m) => m.slug)
      .map((m) => {
        const lastmod = m.atualizadoEm ? `<lastmod>${xml(String(m.atualizadoEm).slice(0, 10))}</lastmod>` : '';
        return `<url><loc>${xml(new URL(`/p/${m.slug}`, base).toString())}</loc>${lastmod}</url>`;
      }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** robots.txt do domínio da vitrine: tudo aberto, menos o link do modo interno. PURO. */
export function robotsDaVitrine(base) {
  // Robôs das IAs liberados com nome (GEO, 23/10) — além do `*`.
  const ias = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];
  return [
    ...ias.flatMap((b) => [`User-agent: ${b}`, 'Allow: /', 'Disallow: /*?interno=', '']),
    'User-agent: *',
    'Allow: /',
    // Link que marca o aparelho da equipe (modo interno) e o de sair dele.
    'Disallow: /*?interno=',
    'Disallow: /*&interno=',
    '',
    `Sitemap: ${new URL('/sitemap.xml', base).toString()}`,
    '',
  ].join('\n');
}

/**
 * Site estático por DOMÍNIO (24/10, landing do ribelt.com.br): a pasta
 * `sites/<host sem www>/` responde por aquele host inteiro, sem passar pelo
 * SPA. Um arquivo `.noindex` na pasta põe `X-Robots-Tag: noindex` em tudo
 * (endereço de teste); um `.redirect` com uma URL manda 301 de tudo pra lá
 * (endereço aposentado, ex.: lp → ribelt.com.br). Arquivo começado com ponto
 * nunca é servido.
 */
export async function arquivoDoSite(sitesDir, host, caminho) {
  if (!sitesDir) return null;
  const nome = normalizarHost(host);
  if (!nome || !/^[a-z0-9.-]+$/.test(nome) || nome.includes('..')) return null;
  const pasta = resolve(sitesDir, nome);
  try {
    if (!(await stat(pasta)).isDirectory()) return null;
  } catch {
    return null;
  }
  let noindex = false;
  try {
    noindex = (await stat(join(pasta, '.noindex'))).isFile();
  } catch {
    // sem marcador: indexa
  }
  try {
    const destino = (await readFile(join(pasta, '.redirect'), 'utf8')).trim();
    if (/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(destino)) {
      return { pasta, noindex, alvo: null, redirect: destino };
    }
  } catch {
    // sem redirect
  }
  const rel = caminho.replace(/^\/+/, '');
  if (rel.split('/').some((p) => p.startsWith('.'))) return { pasta, noindex, alvo: null };
  const tentativas = rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}.html`];
  for (const t of tentativas) {
    const alvo = normalize(join(pasta, t));
    if (alvo !== pasta && !alvo.startsWith(pasta + sep)) continue;
    try {
      if ((await stat(alvo)).isFile()) return { pasta, noindex, alvo };
    } catch {
      // tenta a próxima
    }
  }
  return { pasta, noindex, alvo: null };
}

export function criarServidor({ dist, apiUrl, fetchFn = fetch, ttlMs = 5 * 60_000, sites = null }) {
  const raiz = resolve(dist);
  const cacheMarca = new Map();
  const cacheVitrine = new Map();

  /** Vitrine pública (produtos, preços, fotos) — cache de 5 min; API fora = null. */
  async function vitrineDo(slug) {
    if (!apiUrl) return null;
    const c = cacheVitrine.get(slug);
    if (c && c.exp > Date.now()) return c.v;
    try {
      const r = await fetchFn(
        `${apiUrl.replace(/\/+$/, '')}/api/v1/public/vitrine/${encodeURIComponent(slug)}`,
        { signal: AbortSignal.timeout(3000) },
      );
      const v = r.ok ? ((await r.json())?.data ?? null) : null;
      cacheVitrine.set(slug, { v, exp: Date.now() + (v ? ttlMs : 15_000) });
      return v;
    } catch {
      cacheVitrine.set(slug, { v: null, exp: Date.now() + 15_000 });
      return null;
    }
  }

  function texto(res, req, status, tipo, conteudo, cache) {
    const corpo = Buffer.from(conteudo, 'utf8');
    res.writeHead(status, { 'Content-Type': tipo, 'Content-Length': corpo.length, 'Cache-Control': cache, ...SEGURANCA });
    return res.end(req.method === 'HEAD' ? undefined : corpo);
  }
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

      // www.<domínio> → <domínio> (26/10): clientes digitavam www.atacado… e a
      // vitrine caía no login (a API só aceita a origem sem www). Um endereço só,
      // pro cliente e pro Google; caminho e query vão junto.
      const hostCru = String(host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
      if (hostCru.startsWith('www.') && hostCru.split('.').length > 3) {
        res.writeHead(301, {
          Location: `https://${hostCru.slice(4)}${url.pathname}${url.search}`,
          'Cache-Control': 'public, max-age=3600',
          ...SEGURANCA,
        });
        return res.end();
      }

      // Domínio com site estático próprio (landing): responde tudo dali.
      const site = await arquivoDoSite(sites, host, caminho);
      if (site) {
        const extra = site.noindex ? { 'X-Robots-Tag': 'noindex, nofollow' } : {};
        if (site.redirect) {
          const destino = new URL(caminho + url.search, site.redirect).toString();
          res.writeHead(301, { Location: destino, 'Cache-Control': 'public, max-age=3600', ...SEGURANCA, ...extra });
          return res.end();
        }
        if (!site.alvo) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEGURANCA, ...extra });
          return res.end(req.method === 'HEAD' ? undefined : 'Página não encontrada');
        }
        const corpo = await readFile(site.alvo);
        const ext = extname(site.alvo).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Content-Length': corpo.length,
          'Cache-Control': ext === '.html' || ext === '.txt' || ext === '.xml' ? SEM_CACHE : 'public, max-age=86400',
          ...SEGURANCA,
          ...extra,
        });
        return res.end(req.method === 'HEAD' ? undefined : corpo);
      }

      // robots.txt e sitemap.xml DO DOMÍNIO DA VITRINE (o arquivo do dist é o do app).
      if (caminho === '/robots.txt' || caminho === '/sitemap.xml' || caminho === '/llms.txt' || caminho === '/faq' || caminho === '/faq/') {
        const m = await marcaDo(host);
        const daVitrine = m?.dominio && normalizarHost(m.dominio) === normalizarHost(host) && m.vitrineSlug;
        if (daVitrine) {
          const base = `https://${normalizarHost(host)}`;
          if (caminho === '/robots.txt') {
            return texto(res, req, 200, MIME['.txt'], robotsDaVitrine(base), 'public, max-age=3600');
          }
          const v = await vitrineDo(m.vitrineSlug);
          if (!v) return texto(res, req, 503, MIME['.txt'], 'indisponível', SEM_CACHE);
          if (caminho === '/llms.txt') {
            return texto(res, req, 200, 'text/markdown; charset=utf-8', llmsTxt(v, { base }), 'public, max-age=3600');
          }
          if (caminho.startsWith('/faq')) {
            return texto(res, req, 200, MIME['.html'], paginaFaq(v, { base }), 'public, max-age=300');
          }
          return texto(res, req, 200, 'application/xml; charset=utf-8', sitemapXml(v, base), 'public, max-age=3600');
        }
      }

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
      // A vitrine mora na RAIZ do domínio próprio (Léo, 14/10: na barra, só
      // "atacado.ribelt.com.br"). O link antigo /v/<slug>, já compartilhado em
      // WhatsApp e anúncio, vem pra raiz levando a query (utm, fbclid). 302,
      // não 301: o navegador não grava pra sempre se um dia mudar de novo.
      if (doTenant && marca.vitrineSlug && caminho.replace(/\/+$/, '') === `/v/${marca.vitrineSlug}`) {
        res.writeHead(302, {
          Location: `/${url.search}`,
          'Cache-Control': SEM_CACHE,
          ...SEGURANCA,
        });
        return res.end();
      }
      let html = aplicarMarca(await indexHtml(), marca, { host, caminho });
      let status = 200;
      // Página do produto: o HTML já sai com os dados DELE (robô não roda o app).
      const prod = produtoDaRota(caminho, marca, doTenant);
      if (prod) {
        const v = await vitrineDo(prod.vitrine);
        const modelo = v?.modelos?.find((x) => x.slug === prod.produto);
        // Endereço antigo (o nome mudou): 301 pro atual, levando a query.
        const renomeado = !modelo && v?.modelos?.find((x) => (x.slugsAntigos ?? []).includes(prod.produto));
        if (renomeado) {
          const destino = doTenant ? `/p/${renomeado.slug}` : `/v/${prod.vitrine}/p/${renomeado.slug}`;
          res.writeHead(301, { Location: `${destino}${url.search}`, 'Cache-Control': 'public, max-age=3600', ...SEGURANCA });
          return res.end();
        }
        if (modelo) {
          const base = `https://${normalizarHost(host)}`;
          const canonico = doTenant ? `/p/${modelo.slug}` : `/v/${prod.vitrine}/p/${modelo.slug}`;
          html = aplicarProduto(html, seoDoProduto(modelo, v, { base, caminho: canonico }));
          html = comConteudo(html, conteudoDoProduto(modelo, v));
        } else if (v) {
          // Produto que não existe (ou saiu da vitrine): o app abre a vitrine,
          // mas o Google não indexa essa URL.
          status = 404;
          html = html.replace('</head>', '  <meta name="robots" content="noindex" />\n  </head>');
        }
      }
      // Raiz do domínio da vitrine: título da vitrine, JSON-LD da loja/FAQ e o
      // conteúdo em texto (os robôs das IAs não rodam o app).
      if (!prod && doTenant && marca.vitrineSlug && (caminho === '/' || caminho === '')) {
        const v = await vitrineDo(marca.vitrineSlug);
        if (v) {
          const base = `https://${normalizarHost(host)}`;
          if (v.geo?.titulo) {
            html = html
              .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapar(v.geo.titulo)}</title>`)
              .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapar(v.geo.titulo)}$2`)
              .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapar(v.geo.titulo)}$2`);
          }
          const ld = jsonLdDaHome(v, { base }).map(scriptLd).join('\n    ');
          html = html.replace('</head>', `    <link rel="canonical" href="${escapar(new URL('/', base).toString())}" />\n    ${ld}\n  </head>`);
          html = comConteudo(html, conteudoDaHome(v, { base }));
        }
      }
      const corpo = Buffer.from(html, 'utf8');
      res.writeHead(status, {
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
  const sites = join(fileURLToPath(new URL('.', import.meta.url)), 'sites');
  criarServidor({ dist, apiUrl, sites }).listen(porta, () => {
    console.log(`[front] servindo ${dist} na porta ${porta} (marca via ${apiUrl || 'sem API — HTML padrão'})`);
  });
}
