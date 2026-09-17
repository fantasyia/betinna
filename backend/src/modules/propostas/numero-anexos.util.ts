/**
 * Os números dos dois anexos da proposta.
 *
 * O cabeçalho do documento (tabela 1 do Anexo II) pede:
 *
 * ```
 * Proposta n.                        PT-(código da proposta)
 * Proposta Comercial de referência   PC-(código da proposta)
 * ```
 *
 * 🔴 É **o mesmo código** nos dois, só muda o prefixo (Léo, 17/09: *"o número é
 * o mesmo do documento"*). Por isso NÃO existe campo novo no banco: derivar de
 * `Proposta.numero` mantém uma verdade só. Dois campos guardando o mesmo código
 * é como eles divergem — um é atualizado, o outro fica.
 *
 * - `PT` = Proposta Técnica (Anexo II) — o que vai ser instalado, por quadro;
 * - `PC` = Proposta Comercial (Anexo I) — preço e condições.
 */

/** O código nu, sem prefixo: `PROP-0042` → `0042`. */
export function codigoDaProposta(numero: string): string {
  const limpo = (numero ?? '').trim();
  // Tira QUALQUER prefixo alfabético seguido de hífen — pega `PROP-`, e também
  // `PT-`/`PC-` se alguém passar um número de anexo de volta (idempotente).
  const semPrefixo = limpo.replace(/^[A-Za-z]+-/, '');
  return semPrefixo || limpo;
}

export interface NumerosDosAnexos {
  /** Anexo II — proposta TÉCNICA. */
  tecnica: string;
  /** Anexo I — proposta COMERCIAL. */
  comercial: string;
}

/**
 * `PROP-0042` → `{ tecnica: 'PT-0042', comercial: 'PC-0042' }`.
 *
 * Idempotente: receber `PT-0042` devolve o mesmo par, porque o código é
 * extraído antes. Isso importa porque o número circula em log, e-mail e no PDF —
 * em algum momento alguém passa o do anexo em vez do da proposta.
 */
export function numerosDosAnexos(numeroProposta: string): NumerosDosAnexos {
  const codigo = codigoDaProposta(numeroProposta);
  return { tecnica: `PT-${codigo}`, comercial: `PC-${codigo}` };
}
