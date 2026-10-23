/**
 * Microsoft Clarity na vitrine (card cmvk9lwrp — #04/Léo, 22/10): gravação de
 * sessão e mapa de calor. Não carrega na visita da equipe (modo interno), e os
 * blocos com dado pessoal ou de pagamento vão marcados `data-clarity-mask`.
 */

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] };
declare global {
  interface Window {
    clarity?: ClarityFn;
  }
}

let carregado = false;

/** ID do projeto: letras minúsculas e números (o backend já valida). PURO. */
export function idClarityValido(id: string): boolean {
  return /^[a-z0-9]{6,20}$/.test(id);
}

/** Carrega a tag oficial do Clarity uma vez. `interno` = equipe: não carrega. */
export function iniciarClarity(projetoId: string, opts: { interno?: boolean } = {}): boolean {
  if (typeof window === 'undefined' || carregado || opts.interno || !idClarityValido(projetoId)) {
    return false;
  }
  // O snippet oficial: a fila guarda as chamadas até o script chegar.
  if (!window.clarity) {
    const fila: ClarityFn = function clarity(...args: unknown[]) {
      (fila.q = fila.q ?? []).push(args);
    };
    window.clarity = fila;
  }
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.clarity.ms/tag/${projetoId}`;
  document.head.appendChild(s);
  carregado = true;
  return true;
}

/** Só pro teste: esquece que já carregou. */
export function _resetClarity(): void {
  carregado = false;
}

/** Atributo que manda o Clarity mascarar o bloco inteiro (formulário de dados). */
export const MASCARA_CLARITY = { 'data-clarity-mask': 'true' } as const;
