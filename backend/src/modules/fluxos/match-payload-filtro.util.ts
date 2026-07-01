/**
 * Filtro de payload para o gatilho WEBHOOK_RECEBIDO — decide se um POST externo
 * dispara o fluxo com base num campo do corpo (ex.: só dispara se evento=='lead_gerado').
 *
 * Função PURA e testável. Cap de profundidade no caminho contra payload atacante
 * (path traversal / DoS por objeto profundo), conforme a revisão adversarial.
 */
export interface FiltroPayload {
  /** Caminho separado por ponto no payload, ex "evento" ou "data.status". */
  caminho: string;
  operador: 'eq' | 'neq' | 'contains';
  valor: string;
}

/** Profundidade máxima do caminho (cada nível = 1 acesso de propriedade). */
const MAX_PROFUNDIDADE = 8;

/** Anda pelo caminho com cap de profundidade; retorna o valor ou undefined. */
export function valorPorCaminho(obj: unknown, caminho: string): unknown {
  const partes = caminho.split('.').filter(Boolean).slice(0, MAX_PROFUNDIDADE);
  if (partes.length === 0) return undefined;
  let cur: unknown = obj;
  for (const p of partes) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** true se o payload casa o filtro. Sem `caminho` → não filtra (retorna true). */
export function matchFiltroPayload(payload: unknown, filtro: FiltroPayload | undefined): boolean {
  if (!filtro?.caminho?.trim()) return true;
  const raw = valorPorCaminho(payload, filtro.caminho);
  const atual = raw == null ? '' : String(raw);
  const alvo = filtro.valor ?? '';
  switch (filtro.operador) {
    case 'eq':
      return atual === alvo;
    case 'neq':
      return atual !== alvo;
    case 'contains':
      return atual.includes(alvo);
    default:
      return true;
  }
}
