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
 */
const marcadores = new Set<string>();

/** Marca/desmarca uma tela como "tem alteração não salva". */
export function marcarSujo(id: string, sujo: boolean): void {
  if (sujo) marcadores.add(id);
  else marcadores.delete(id);
}

/** Alguma tela tem alteração não salva agora? */
export function temAlteracaoNaoSalva(): boolean {
  return marcadores.size > 0;
}

/** Só pra teste/diagnóstico. */
export function limparMarcadores(): void {
  marcadores.clear();
}
