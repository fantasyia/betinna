import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARCA_PADRAO,
  _resetarMarca,
  aplicarMarcaCacheada,
  carregarMarca,
  comAlfa,
  escurecer,
  logoDaMarca,
  marca,
  paletaPublica,
  temMarcaPropria,
} from './marca';

/**
 * White-label POR DOMÍNIO — não é rename.
 *
 * O que estes testes protegem é a propriedade que faz o produto continuar sendo
 * multi-tenant: quem entra pelo domínio de um tenant vê a marca DELE, e quem
 * entra por qualquer outro host continua vendo o Betinna. Se um dia alguém
 * "simplificar" isso pra uma marca só, quebra aqui.
 */
const SOMATEC = {
  nome: 'Somatec Blocking',
  nomeCurto: 'Somatec',
  dominio: 'app.somatecblocking.com.br',
  logoUrl: 'https://x/logo.png',
  cores: { primaria: '#00416E', secundaria: '#008CC8', acao: '#F39200' },
};

const responder = (data: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve({ data }) });

const cssDaMarca = () => document.getElementById('marca-tenant')?.textContent ?? '';

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#bd1fbf">' +
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">' +
    '<link rel="manifest" href="/manifest.webmanifest">';
  localStorage.clear();
});

afterEach(() => {
  _resetarMarca();
  vi.unstubAllGlobals();
});

describe('marca do tenant', () => {
  it('sem backing nenhum, o app é o BETINNA — é o que separa white-label de rename', () => {
    expect(marca()).toEqual(MARCA_PADRAO);
    expect(temMarcaPropria()).toBe(false);
  });

  it('host do tenant veste a marca dele: cores, título e logo', async () => {
    vi.stubGlobal('fetch', responder(SOMATEC));

    await carregarMarca();

    expect(marca().nome).toBe('Somatec Blocking');
    expect(document.title).toBe('Somatec Blocking');
    expect(cssDaMarca()).toContain('--primary: #00416E');
    expect(logoDaMarca('/betinna-horizontal.svg')).toBe('https://x/logo.png');
  });

  it('tenant SEM marca própria não recebe folha de estilo nenhuma', async () => {
    vi.stubGlobal('fetch', responder(MARCA_PADRAO));

    await carregarMarca();

    // Escrever os tokens do padrão por cima do `index.css` seria empatar com o
    // brandbook por acidente — e qualquer ajuste lá deixaria de valer.
    expect(document.getElementById('marca-tenant')).toBeNull();
  });

  it('o modo escuro é vestido também — senão o rep vê o fundo do outro produto', async () => {
    vi.stubGlobal('fetch', responder(SOMATEC));

    await carregarMarca();

    const css = cssDaMarca();
    expect(css).toContain('html.dark {');
    // A cor de AÇÃO assume o papel de primária no escuro, como no tema original.
    expect(css.slice(css.indexOf('html.dark'))).toContain('--primary: #F39200');
  });

  it('backend fora não deixa a tela de login sem marca nenhuma', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede fora')));

    expect(await carregarMarca()).toEqual(MARCA_PADRAO);
  });

  it('resposta em formato inesperado é ignorada (não vira marca vazia)', async () => {
    vi.stubGlobal('fetch', responder({ nome: 'sem cores' }));

    expect(await carregarMarca()).toEqual(MARCA_PADRAO);
  });

  it('a marca volta do cache ANTES do 1º render — sem piscar a marca errada', async () => {
    vi.stubGlobal('fetch', responder(SOMATEC));
    await carregarMarca();
    _resetarMarca();

    aplicarMarcaCacheada();

    expect(marca().nome).toBe('Somatec Blocking');
  });

  it('o cache é POR HOST: um tenant não herda a marca do outro no mesmo navegador', () => {
    localStorage.setItem('betinna:marca:outro-tenant.com.br', JSON.stringify(SOMATEC));

    aplicarMarcaCacheada();

    expect(marca()).toEqual(MARCA_PADRAO);
  });

  it('marca própria troca favicon, manifest e cor da barra do navegador', async () => {
    vi.stubGlobal('fetch', responder(SOMATEC));

    await carregarMarca();

    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toContain('logo.png');
    expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href).toContain(
      '/public/manifest.webmanifest?host=',
    );
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      '#F39200',
    );
  });
});

describe('paleta das telas públicas', () => {
  it('deriva os tons do tenant sem pedir mais nada pra ele', () => {
    const p = paletaPublica(SOMATEC);

    expect(p.navy).toBe('#00416E');
    expect(p.cyan).toBe('#008CC8');
    expect(p.magenta).toBe('#F39200');
    // O fundo é o primário escurecido — 3 cores no config bastam pra tela toda.
    expect(p.navyDeep).toBe(escurecer('#00416E', 0.4));
  });

  it('comAlfa devolve rgba a partir do hex (vidro e sombra do card de login)', () => {
    expect(comAlfa('#00416E', 0.88)).toBe('rgba(0, 65, 110, 0.88)');
  });
});
