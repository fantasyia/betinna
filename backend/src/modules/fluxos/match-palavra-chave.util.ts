/**
 * Match de palavra-chave para o gatilho de fluxo MENSAGEM_CANAL.
 *
 * Função PURA e testável: o event-bus a usa pra decidir se uma mensagem inbound
 * dispara o fluxo. NÃO há modo `regex` de propósito — o worker BullMQ é
 * compartilhado entre tenants e um regex custoso (ReDoS) travaria 1/N da
 * capacidade global. `qualquer | todas | exata` cobre os casos reais
 * ("cancelar", "quero comprar", "2ª via").
 */
export type ModoPalavraChave = 'qualquer' | 'todas' | 'exata';

export interface PalavraChaveConfig {
  /** Palavras/expressões a casar. Sem nenhuma → não casa (não vira spam). */
  palavrasChave?: string[];
  /** qualquer (default) = casa ≥1; todas = casa todas; exata = texto inteiro == palavra. */
  modo?: ModoPalavraChave;
  /** Default false (case-insensitive). */
  caseSensitive?: boolean;
  /** Default true (ignora acentos: "2a via" casa "2ª via"). */
  normalizarAcentos?: boolean;
}

function normalizar(s: string, cfg: PalavraChaveConfig): string {
  let out = s.trim();
  if (!cfg.caseSensitive) out = out.toLowerCase();
  // NFKD (não NFD) pra também dobrar compatibilidade: "2ª via" → "2a via", além de tirar acentos.
  if (cfg.normalizarAcentos !== false) out = out.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
  return out;
}

/**
 * Retorna true se `texto` casa a config de palavra-chave.
 * Sem palavras configuradas retorna false (o chamador trata "sem filtro" à parte,
 * preservando o comportamento legado do MENSAGEM_CANAL puro por canal).
 */
export function matchPalavraChave(texto: string, cfg: PalavraChaveConfig): boolean {
  const palavras = (cfg.palavrasChave ?? []).map((p) => p.trim()).filter(Boolean);
  if (palavras.length === 0) return false;
  if (!texto || !texto.trim()) return false;

  const alvo = normalizar(texto, cfg);
  const chaves = palavras.map((p) => normalizar(p, cfg));
  const modo = cfg.modo ?? 'qualquer';

  switch (modo) {
    case 'exata':
      return chaves.some((k) => alvo === k);
    case 'todas':
      return chaves.every((k) => alvo.includes(k));
    case 'qualquer':
    default:
      return chaves.some((k) => alvo.includes(k));
  }
}
