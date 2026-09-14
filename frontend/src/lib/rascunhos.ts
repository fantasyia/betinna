/**
 * Rascunhos — o que estava na tela quando a sessão caiu SOZINHA (G-9).
 *
 * O `dirty.ts` já sabia QUE existe coisa não salva (o reload do PWA consulta
 * antes de recarregar). O que faltava: no 401 definitivo, o `api.ts` chamava
 * `clearSession()` direto, o `ProtectedRoute` mandava pro /login, a tela
 * desmontava — e o que a pessoa tinha digitado sumia sem uma linha de aviso.
 * Ela nem sabia que a sessão tinha caído; via a tela virar login.
 *
 * Aqui o registro vira PERSISTÊNCIA: antes de limpar a sessão, tira o snapshot
 * de quem se registrou com um e guarda no localStorage pra oferecer de volta.
 *
 * Três regras que não são detalhe:
 *
 *  - **Só queda de sessão.** Logout no botão descarta tudo — quem saiu de
 *    propósito não quer o formulário de volta, e dado pessoal não fica no
 *    navegador depois que a pessoa saiu.
 *  - **Só pro MESMO dono.** O rascunho guarda o id de quem o digitou; se quem
 *    voltar for outro usuário (PC compartilhado é a regra aqui, não exceção),
 *    o rascunho é apagado sem ser mostrado.
 *  - **Nunca aplica sozinho.** Esta camada só GUARDA e DEVOLVE. Quem restaura é
 *    a tela, e só depois de a pessoa dizer que quer — restaurar por conta
 *    própria por cima de um fluxo que já mudou seria trocar uma perda por uma
 *    sobrescrita silenciosa, que é pior.
 */
import { getSession } from './auth-store';
import { capturarRascunhos } from './dirty';

const PREFIXO = 'betinna:rascunho:';
/** Depois disto o rascunho é lixo: o mundo mudou, restaurar engana mais do que ajuda. */
const VALIDADE_MS = 24 * 60 * 60 * 1000;
/** Teto por rascunho — o localStorage inteiro tem ~5MB e não é só nosso. */
const MAX_BYTES = 256 * 1024;

export interface RascunhoSalvo<T = unknown> {
  dados: T;
  /** Epoch ms de quando a sessão caiu. */
  quando: number;
  /** Id de quem digitou (null = sessão já não tinha usuário). */
  dono: string | null;
}

function chave(id: string): string {
  return `${PREFIXO}${id}`;
}

function donoAtual(): string | null {
  try {
    return getSession()?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Snapshot de todas as telas sujas que sabem se serializar.
 *
 * Chamado pelo `api.ts` ANTES do `clearSession()` do 401 definitivo — depois
 * dele a sessão já não tem dono pra carimbar, e o React já desmontou a tela.
 *
 * Best-effort de propósito: um rascunho que não serializa (ou que não cabe) não
 * pode impedir o logout. Devolve os ids salvos, pra teste e diagnóstico.
 */
export function salvarRascunhosAbertos(): string[] {
  const dono = donoAtual();
  const salvos: string[] = [];
  for (const [id, ler] of capturarRascunhos()) {
    try {
      const dados = ler();
      if (dados === undefined || dados === null) continue;
      const corpo = JSON.stringify({ dados, quando: Date.now(), dono } satisfies RascunhoSalvo);
      if (corpo.length > MAX_BYTES) {
        console.warn(`[rascunho] "${id}" passou de ${MAX_BYTES} bytes — não foi guardado.`);
        continue;
      }
      window.localStorage.setItem(chave(id), corpo);
      salvos.push(id);
    } catch (err) {
      // localStorage cheio, modo privado, JSON circular: nada disso justifica
      // travar o logout de uma sessão que já caiu.
      console.warn(`[rascunho] não consegui guardar "${id}":`, err);
    }
  }
  return salvos;
}

/**
 * Devolve o rascunho de `id` se ainda valer: dentro da validade e do MESMO
 * dono. Nos outros casos apaga e devolve `null` — rascunho que não pode ser
 * oferecido também não pode continuar guardado.
 */
export function lerRascunho<T = unknown>(id: string): RascunhoSalvo<T> | null {
  let bruto: string | null = null;
  try {
    bruto = window.localStorage.getItem(chave(id));
  } catch {
    return null;
  }
  if (!bruto) return null;

  let salvo: RascunhoSalvo<T>;
  try {
    salvo = JSON.parse(bruto) as RascunhoSalvo<T>;
  } catch {
    descartarRascunho(id);
    return null;
  }
  if (typeof salvo?.quando !== 'number' || !('dados' in salvo)) {
    descartarRascunho(id);
    return null;
  }
  if (Date.now() - salvo.quando > VALIDADE_MS) {
    descartarRascunho(id);
    return null;
  }
  // Dono diferente: PC compartilhado. Some sem mostrar.
  if ((salvo.dono ?? null) !== donoAtual()) {
    descartarRascunho(id);
    return null;
  }
  return salvo;
}

/** Apaga um rascunho (restaurado, recusado ou inválido). */
export function descartarRascunho(id: string): void {
  try {
    window.localStorage.removeItem(chave(id));
  } catch {
    /* best-effort */
  }
}

/**
 * Apaga TODOS os rascunhos. Chamado no logout do botão e na troca de usuário —
 * os dois casos em que guardar formulário de outra pessoa seria o erro.
 */
export function descartarRascunhos(): void {
  try {
    const mortos: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIXO)) mortos.push(k);
    }
    for (const k of mortos) window.localStorage.removeItem(k);
  } catch {
    /* best-effort */
  }
}
