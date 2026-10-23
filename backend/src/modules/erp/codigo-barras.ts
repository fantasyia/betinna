/**
 * Código de barras da etiqueta da peça (Léo, 20/10) — PURO, sem dependência.
 *
 * Devolve a sequência de MÓDULOS (1 = barra, 0 = espaço); quem desenha
 * multiplica pela largura do módulo. EAN-13 quando a peça tem EAN; Code 128
 * (conjunto B) do SKU quando não tem.
 */

const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const EAN_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
/** Paridade L/G dos 6 primeiros dígitos, pelo 1º dígito (que não vira barra). */
const EAN_PARIDADE = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

/** 95 módulos do EAN-13 (sem as zonas quietas). Recusa código inválido. */
export function modulosEan13(ean: string): string {
  if (!/^\d{13}$/.test(ean)) throw new Error(`EAN-13 inválido: ${ean}`);
  const d = ean.split('').map(Number);
  const paridade = EAN_PARIDADE[d[0]!]!;
  let s = '101';
  for (let i = 1; i <= 6; i++) s += (paridade[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]!]!;
  s += '01010';
  for (let i = 7; i <= 12; i++) s += EAN_R[d[i]!]!;
  return s + '101';
}

/** Padrões do Code 128 (larguras barra/espaço), índice = valor do símbolo. */
const C128 = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];
const START_B = 104;
const STOP = 106;

/** Módulos do Code 128-B de um texto ASCII imprimível (32–126). */
export function modulosCode128(texto: string): string {
  const valores = [START_B];
  for (const ch of texto) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Caractere fora do Code 128-B: ${ch}`);
    valores.push(c - 32);
  }
  const soma = valores.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
  valores.push(soma % 103, STOP);
  let s = '';
  for (const v of valores) {
    const larguras = C128[v]!;
    for (let i = 0; i < larguras.length; i++)
      s += (i % 2 === 0 ? '1' : '0').repeat(Number(larguras[i]));
  }
  return s;
}

/** Corridas de barras [início, largura] em módulos — o que vira retângulo no PDF. */
export function barras(modulos: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < modulos.length) {
    if (modulos[i] === '1') {
      let j = i;
      while (j < modulos.length && modulos[j] === '1') j++;
      out.push([i, j - i]);
      i = j;
    } else i++;
  }
  return out;
}
