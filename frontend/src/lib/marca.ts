/**
 * Marca do tenant — white-label POR DOMÍNIO.
 *
 * O Betinna é multi-tenant: a Somatec é UM tenant. Então isto nunca é trocar
 * "Betinna" por "Somatec" no código — é o app vestir a marca de quem está
 * acessando, resolvida pelo HOST. Dois domínios no ar mostram marcas
 * diferentes ao mesmo tempo, e um tenant não sabe da existência do outro.
 *
 * Regra dura: **zero string de tenant aqui**. Tudo vem de
 * `GET /public/branding`, e o que faltar cai no `MARCA_PADRAO` (o Betinna).
 *
 * Por que resolver pelo host, e não pela sessão: a tela de LOGIN precisa da
 * marca ANTES de existir usuário. Sem isso a primeira tela que o representante
 * vê é a de outro produto, e só depois de logar viraria a dele.
 */

export interface CoresDaMarca {
  primaria: string;
  secundaria: string;
  acao: string;
}

export interface Marca {
  nome: string;
  nomeCurto: string;
  /** Domínio próprio. `null` = tenant sem white-label (usa o app padrão). */
  dominio: string | null;
  logoUrl: string | null;
  cores: CoresDaMarca;
}

/** O produto sem tenant vestido — precisa bater com o `BRANDING_PADRAO` do backend. */
export const MARCA_PADRAO: Marca = {
  nome: 'Betinna.ai',
  nomeCurto: 'Betinna',
  dominio: null,
  logoUrl: null,
  cores: { primaria: '#201554', secundaria: '#2bcae5', acao: '#bd1fbf' },
};

const CHAVE_CACHE = 'betinna:marca';
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

let atual: Marca = MARCA_PADRAO;

/** A marca em vigor. Resolvida do cache antes do 1º render e revalidada no boot. */
export function marca(): Marca {
  return atual;
}

/** `true` quando o tenant tem marca própria — decide favicon/manifest/logo trocados. */
export function temMarcaPropria(): boolean {
  return atual.dominio !== null;
}

/** Logo da marca, com o do produto como reserva. */
export function logoDaMarca(padrao: string): string {
  return atual.logoUrl || padrao;
}

// ─── Cor: helpers pequenos, sem dependência ────────────────────────────────

interface RGB {
  r: number;
  g: number;
  b: number;
}

function paraRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim();
  const cheio =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = Number.parseInt(cheio.slice(0, 6), 16);
  return Number.isNaN(n)
    ? { r: 0, g: 0, b: 0 }
    : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function paraHex({ r, g, b }: RGB): string {
  const oct = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${oct(r)}${oct(g)}${oct(b)}`;
}

/** Mistura em direção ao preto (`fator` 0..1). */
export function escurecer(hex: string, fator: number): string {
  const { r, g, b } = paraRgb(hex);
  return paraHex({ r: r * (1 - fator), g: g * (1 - fator), b: b * (1 - fator) });
}

/** Mistura em direção ao branco (`fator` 0..1). */
export function clarear(hex: string, fator: number): string {
  const { r, g, b } = paraRgb(hex);
  return paraHex({
    r: r + (255 - r) * fator,
    g: g + (255 - g) * fator,
    b: b + (255 - b) * fator,
  });
}

/** `rgba()` a partir do hex — pros vidros e sombras das telas públicas. */
export function comAlfa(hex: string, alfa: number): string {
  const { r, g, b } = paraRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

/**
 * Paleta das telas PÚBLICAS (login e definição de senha).
 *
 * Essas duas telas não usam os tokens do `index.css` — foram desenhadas com
 * cores fixas, e são justamente onde a marca importa mais (é a primeira coisa
 * que o representante vê). Os nomes seguem os do desenho original pra a troca
 * não virar um redesign.
 */
export function paletaPublica(m: Marca = atual) {
  const { primaria, secundaria, acao } = m.cores;
  return {
    navy: primaria,
    navyDeep: escurecer(primaria, 0.4),
    cyan: secundaria,
    cyanHover: escurecer(secundaria, 0.2),
    magenta: acao,
    magentaHover: escurecer(acao, 0.15),
    magentaLight: clarear(acao, 0.15),
    white: '#F8F7F2',
    danger: '#ee5a5a',
    success: '#4cc984',
  } as const;
}

// ─── Aplicação no documento ────────────────────────────────────────────────

/**
 * Escreve os tokens do tenant numa folha própria, DEPOIS do `index.css`.
 *
 * Folha em vez de estilo inline no `<html>`: inline venceria também o
 * `html.dark`, e o modo escuro ficaria com a paleta do claro. Aqui cada tema
 * recebe o seu bloco, com a mesma especificidade do original — só que depois.
 */
function aplicarCss(m: Marca): void {
  if (typeof document === 'undefined') return;
  const id = 'marca-tenant';
  document.getElementById(id)?.remove();
  if (!m.dominio) return; // sem marca própria, o CSS do produto fica intacto

  const { primaria, secundaria, acao } = m.cores;
  const est = document.createElement('style');
  est.id = id;
  est.textContent = [
    ':root {',
    `  --primary: ${primaria};`,
    `  --primary-hover: ${escurecer(primaria, 0.2)};`,
    `  --primary-light: ${clarear(primaria, 0.9)};`,
    `  --secondary: ${secundaria};`,
    `  --secondary-hover: ${escurecer(secundaria, 0.2)};`,
    `  --secondary-light: ${clarear(secundaria, 0.85)};`,
    `  --magenta: ${acao};`,
    `  --magenta-hover: ${escurecer(acao, 0.15)};`,
    `  --magenta-light: ${clarear(acao, 0.88)};`,
    `  --navy: ${primaria};`,
    `  --border-focus: ${primaria};`,
    `  --surface-hover: ${clarear(primaria, 0.94)};`,
    `  --chart-linha: ${primaria};`,
    `  --chart-barra: ${secundaria};`,
    '}',
    // Mesma relação do tema escuro original: os fundos nascem da cor primária
    // e a cor de AÇÃO assume o papel de primária (contraste em fundo escuro).
    'html.dark {',
    `  --bg: ${escurecer(primaria, 0.55)};`,
    `  --bg-alt: ${escurecer(primaria, 0.45)};`,
    `  --surface: ${escurecer(primaria, 0.3)};`,
    `  --surface-hover: ${escurecer(primaria, 0.15)};`,
    `  --surface-elevated: ${escurecer(primaria, 0.1)};`,
    `  --border: ${clarear(escurecer(primaria, 0.1), 0.12)};`,
    `  --border-strong: ${clarear(primaria, 0.2)};`,
    `  --border-focus: ${acao};`,
    `  --primary: ${acao};`,
    `  --primary-hover: ${clarear(acao, 0.15)};`,
    `  --primary-light: ${escurecer(acao, 0.7)};`,
    `  --secondary: ${secundaria};`,
    `  --secondary-hover: ${clarear(secundaria, 0.2)};`,
    `  --magenta: ${acao};`,
    `  --magenta-hover: ${clarear(acao, 0.15)};`,
    `  --navy: ${primaria};`,
    '}',
  ].join('\n');
  document.head.appendChild(est);
}

/**
 * Aba, favicon, cor da barra do navegador e manifest.
 *
 * O manifest estático é gerado no build (`vite.config.ts`) com o nome do
 * produto. Com marca própria a gente aponta pro manifest do backend, que
 * resolve o tenant pelo host — senão o atalho na tela do celular do
 * representante chama "Betinna".
 */
function aplicarIdentidade(m: Marca): void {
  if (typeof document === 'undefined') return;
  document.title = m.nome;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = m.dominio ? m.cores.acao : MARCA_PADRAO.cores.acao;

  if (!m.dominio) return;

  if (m.logoUrl) {
    for (const rel of ['icon', 'apple-touch-icon']) {
      const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) continue;
      link.href = m.logoUrl;
      link.removeAttribute('type');
    }
  }

  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest) {
    const host = encodeURIComponent(window.location.host);
    manifest.href = `${BASE_URL}/api/v1/public/manifest.webmanifest?host=${host}`;
    // Manifest de outra origem só é aceito com CORS; sem credencial, que o
    // endpoint é público.
    manifest.crossOrigin = 'anonymous';
  }
}

function aplicar(m: Marca): void {
  atual = m;
  aplicarCss(m);
  aplicarIdentidade(m);
}

function ehMarca(v: unknown): v is Marca {
  const m = v as Marca | null;
  return !!m && typeof m.nome === 'string' && !!m.cores && typeof m.cores.primaria === 'string';
}

/**
 * Marca do cache, aplicada ANTES do primeiro render.
 *
 * Sem isto o representante vê a tela de login com a marca do produto por uns
 * 200ms e ela troca na frente dele. O cache é por HOST: dois tenants no mesmo
 * navegador não herdam a marca um do outro.
 */
export function aplicarMarcaCacheada(): void {
  if (typeof window === 'undefined') return;
  try {
    const bruto = localStorage.getItem(`${CHAVE_CACHE}:${window.location.host}`);
    if (!bruto) return;
    const salvo = JSON.parse(bruto) as unknown;
    if (ehMarca(salvo)) aplicar(salvo);
  } catch {
    // Cache corrompido ou indisponível: segue com a marca padrão.
  }
}

/**
 * Busca a marca do host no backend e revalida o cache.
 *
 * `fetch` cru de propósito: é rota pública, e o cliente de API faz
 * refresh-on-401 — que não tem o que fazer numa tela sem sessão.
 */
export async function carregarMarca(): Promise<Marca> {
  if (typeof window === 'undefined') return atual;
  try {
    const host = encodeURIComponent(window.location.host);
    const r = await fetch(`${BASE_URL}/api/v1/public/branding?host=${host}`, {
      credentials: 'omit',
    });
    if (!r.ok) return atual;
    const corpo = (await r.json()) as { data?: unknown };
    if (!ehMarca(corpo.data)) return atual;
    aplicar(corpo.data);
    try {
      localStorage.setItem(`${CHAVE_CACHE}:${window.location.host}`, JSON.stringify(corpo.data));
    } catch {
      // Storage cheio ou bloqueado: a marca só não vem instantânea no próximo boot.
    }
    return corpo.data;
  } catch {
    // Backend fora: a tela de login abre com a marca do cache (ou a padrão).
    return atual;
  }
}

/** Só pra teste: devolve o módulo ao estado inicial. */
export function _resetarMarca(): void {
  atual = MARCA_PADRAO;
  document.getElementById('marca-tenant')?.remove();
}
