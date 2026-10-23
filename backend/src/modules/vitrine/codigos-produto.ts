/**
 * SKU e EAN-13 das peças (Léo, 20/10) — PURO.
 *
 * Prefixo GS1 por empresa em `Empresa.config.codigos.prefixoGs1` (22/10: a
 * Ribelt usa o da planilha dela). Sem prefixo, o EAN fica na faixa de USO
 * INTERNO (começa com 2): vale pra etiqueta e estoque, não pra marketplace.
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

/** Prefixo GS1 aceitável: só dígitos, de 6 a 10 (o resto é o número do item). */
export function prefixoGs1(config: unknown): string | null {
  const p = ((config ?? {}) as { codigos?: { prefixoGs1?: unknown } }).codigos?.prefixoGs1;
  return typeof p === 'string' && /^\d{6,10}$/.test(p) ? p : null;
}

/**
 * EANs já usados FORA do app (22/10): a planilha da empresa tem códigos de
 * produto que não está no catálogo. `codigos.eanUsadosAte` = o maior deles —
 * o gerador começa depois, senão repetiria um EAN que existe no físico.
 */
export function eanUsadosAte(config: unknown): string | null {
  const v = ((config ?? {}) as { codigos?: { eanUsadosAte?: unknown } }).codigos?.eanUsadosAte;
  return typeof v === 'string' && eanValido(v) ? v : null;
}

/**
 * Próximos `n` EANs livres na base (prefixo GS1 da empresa, ou a faixa
 * interna 2), continuando do MAIOR já usado nela — não reaproveita buraco:
 * um EAN que já esteve numa etiqueta não volta. Estoura se a faixa acabar.
 */
export function proximosEans(
  usados: Iterable<string>,
  n: number,
  prefixo?: string | null,
): string[] {
  const base = prefixo ?? BASE_INTERNA;
  const casas = 12 - base.length;
  let maior = 0;
  for (const e of usados) {
    if (e.startsWith(base) && eanValido(e))
      maior = Math.max(maior, Number(e.slice(base.length, 12)));
  }
  if (maior + n >= 10 ** casas) throw new Error(`Faixa de EAN ${base}… esgotada`);
  const out: string[] = [];
  for (let k = 1; k <= n; k++) {
    const doze = base + String(maior + k).padStart(casas, '0');
    out.push(doze + String(digitoEan(doze)));
  }
  return out;
}

/** Faixa interna (sem prefixo GS1). */
export const proximosEansInternos = (usados: Iterable<string>, n: number) =>
  proximosEans(usados, n, null);

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
