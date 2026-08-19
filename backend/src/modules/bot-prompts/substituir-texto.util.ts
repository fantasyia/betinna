/**
 * Busca-e-substituição em texto de prompt, com o contrato de um editor de
 * arquivo: cada trecho tem que casar EXATAMENTE UMA vez.
 *
 * Por que uniqueness importa aqui: um prompt de 64 mil caracteres repete
 * palavra e frase o tempo todo. "Substitui a primeira ocorrência" acertaria a
 * errada em silêncio, e ninguém revisa um diff de 64k pra descobrir. Falhar é a
 * única opção honesta quando o alvo é ambíguo.
 *
 * As substituições são aplicadas EM SEQUÊNCIA sobre o texto que vai saindo
 * (como edições encadeadas). Se qualquer uma falhar, o chamador descarta tudo —
 * nunca grava metade.
 */

export interface SubstituicaoTexto {
  de: string;
  para: string;
}

export class SubstituicaoInvalidaError extends Error {
  constructor(
    readonly indice: number,
    readonly ocorrencias: number,
    readonly trecho: string,
  ) {
    const alvo = trecho.length > 80 ? `${trecho.slice(0, 80)}…` : trecho;
    super(
      ocorrencias === 0
        ? `Substituição ${indice + 1}: trecho não encontrado no prompt — "${alvo}". ` +
            'Confira espaços, acentos e quebras de linha. Nada foi alterado.'
        : `Substituição ${indice + 1}: trecho aparece ${ocorrencias} vezes no prompt — "${alvo}". ` +
            'Inclua mais contexto ao redor pra deixar único. Nada foi alterado.',
    );
    this.name = 'SubstituicaoInvalidaError';
  }
}

/** Quantas vezes `agulha` aparece em `palheiro` (sem regex — trecho é literal). */
export function contarOcorrencias(palheiro: string, agulha: string): number {
  if (!agulha) return 0;
  let n = 0;
  let i = palheiro.indexOf(agulha);
  while (i !== -1) {
    n++;
    i = palheiro.indexOf(agulha, i + agulha.length);
  }
  return n;
}

/**
 * Aplica todas as substituições. Lança na primeira que não casar exatamente
 * uma vez — quem chama só grava se isto voltar.
 */
export function aplicarSubstituicoes(texto: string, subs: SubstituicaoTexto[]): string {
  let atual = texto;
  subs.forEach((s, i) => {
    const n = contarOcorrencias(atual, s.de);
    if (n !== 1) throw new SubstituicaoInvalidaError(i, n, s.de);
    atual = atual.replace(s.de, () => s.para);
  });
  return atual;
}
