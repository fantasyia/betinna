/**
 * SKU e EAN-13 das peças (Léo, 20/10) — PURO.
 *
 * A Ribelt NÃO tem prefixo GS1 (Léo, 20/10). O EAN gerado fica na faixa de
 * USO INTERNO (começa com 2): vale pro estoque e pra etiqueta, mas marketplace
 * não aceita. Quando houver prefixo, é trocar a base aqui (`BASE_INTERNA`).
 */

/** Dígito verificador do EAN-13 a partir dos 12 primeiros dígitos. */
export function digitoEan(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

/** 13 dígitos e dígito verificador certo. */
export function eanValido(ean: string): boolean {
  return /^\d{13}$/.test(ean) && digitoEan(ean.slice(0, 12)) === Number(ean[12]);
}

/** Faixa interna: "2" + 11 dígitos de sequência + verificador. */
const BASE_INTERNA = '2';

/**
 * Próximos `n` EANs internos livres, continuando do maior já usado na faixa
 * (não reaproveita buraco — um EAN que já esteve numa etiqueta não volta).
 */
export function proximosEansInternos(usados: Iterable<string>, n: number): string[] {
  let maior = 0;
  for (const e of usados) {
    if (e.startsWith(BASE_INTERNA) && eanValido(e)) maior = Math.max(maior, Number(e.slice(1, 12)));
  }
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    const doze = BASE_INTERNA + String(maior + k).padStart(11, '0');
    out.push(doze + String(digitoEan(doze)));
  }
  return out;
}

/** "Bermuda Moletom Summer" → "BERMUDA-MOLETOM-SUMMER" (sem acento, até `max`). */
function parte(texto: string, max: number): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '');
}

/**
 * SKU legível modelo-cor-linha-tamanho, sem repetir os já usados (sufixo -2,
 * -3…). Cabe nos 60 caracteres do campo.
 */
export function skuSugerido(
  p: { modelo: string; cor: string; linha: string; tamanho: string },
  usados: Set<string>,
): string {
  const base = [parte(p.modelo, 24), parte(p.cor, 14), parte(p.linha, 10), parte(p.tamanho, 6)]
    .filter(Boolean)
    .join('-');
  let sku = base;
  for (let k = 2; usados.has(sku); k++) sku = `${base}-${k}`;
  usados.add(sku);
  return sku;
}
