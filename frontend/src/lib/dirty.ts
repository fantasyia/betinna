/**
 * Registro global de "tem coisa não salva na tela".
 *
 * AUDITORIA (média): o service worker novo assumia o controle e o app dava
 * `window.location.reload()` INCONDICIONAL. Se o deploy caísse enquanto alguém
 * estava com o editor de fluxo aberto, ou com um pedido meio preenchido, o
 * trabalho ia embora sem aviso — e o usuário não tinha como saber por quê.
 *
 * Quem tem estado não salvo se registra aqui; o reload automático respeita.
 * Deliberadamente simples (contador, sem store): precisa funcionar fora do React
 * e sobreviver a qualquer ordem de montagem.
 *
 * G-9 (14/09): o registro passou a aceitar um SNAPSHOT opcional. O reload do PWA
 * dá pra adiar — a sessão caindo no 401, não: o token morreu, ficar na tela não
 * salvaria nada. Então quem sabe se serializar entrega o conteúdo junto, e o
 * `rascunhos.ts` guarda antes do logout pra oferecer de volta depois do login.
 * A marcação continua sendo booleana pra quem não tem o que guardar.
 */

/** Como a tela se serializa. Devolver `null`/`undefined` = nada a guardar. */
type Snapshot = () => unknown;

const marcadores = new Map<string, Snapshot | null>();

/**
 * Marca/desmarca uma tela como "tem alteração não salva".
 *
 * @param snapshot opcional — chamado só se a sessão cair, pra guardar o que
 * estava digitado. Deve ser síncrono e devolver algo serializável em JSON.
 */
export function marcarSujo(id: string, sujo: boolean, snapshot?: Snapshot): void {
  if (sujo) marcadores.set(id, snapshot ?? null);
  else marcadores.delete(id);
}

/** Alguma tela tem alteração não salva agora? */
export function temAlteracaoNaoSalva(): boolean {
  return marcadores.size > 0;
}

/** As telas sujas que sabem se serializar, na ordem em que se marcaram. */
export function capturarRascunhos(): Array<[string, Snapshot]> {
  const out: Array<[string, Snapshot]> = [];
  for (const [id, snap] of marcadores) if (snap) out.push([id, snap]);
  return out;
}

/** Só pra teste/diagnóstico. */
export function limparMarcadores(): void {
  marcadores.clear();
}
