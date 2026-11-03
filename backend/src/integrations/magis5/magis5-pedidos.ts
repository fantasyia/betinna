/**
 * Leitura dos pedidos do Magis5 (Fase 1, 03/11). PURO. A documentação não mostra
 * a resposta da listagem, e a conta ainda não tem pedido: por isso o pedido é
 * guardado inteiro em `dados`, e uma resposta sem lista ESTOURA. Devolver vazio
 * aqui seria um "sem pedido" plausível e impossível de notar.
 */

/** A lista dentro da resposta: a própria resposta ou o primeiro campo que for lista. */
export function listaDaResposta(corpo: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(corpo)) return corpo as Array<Record<string, unknown>>;
  if (corpo && typeof corpo === 'object') {
    const lista = Object.values(corpo).find((v) => Array.isArray(v));
    if (lista) return lista as Array<Record<string, unknown>>;
  }
  throw new Error('Magis5: resposta sem lista');
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Campos pra busca; null em `numero` = pedido sem identificação. */
export function lerPedido(o: Record<string, unknown>) {
  const id = typeof o.id === 'number' ? String(o.id) : texto(o.id);
  const data = texto(o.dateCreated);
  const pedidoEm = data ? new Date(data) : null;
  return {
    numero: texto(o.completeOrderNumber) ?? id,
    canal: texto(o.channel),
    status: texto(o.status),
    pedidoEm: pedidoEm && !Number.isNaN(pedidoEm.getTime()) ? pedidoEm : null,
  };
}

/** De onde recomeça a leitura: sobrepõe 15 min; a primeira vez pega 30 dias. */
export function inicioDaLeitura(ultimoSync: Date | null, agora: Date): Date {
  return ultimoSync
    ? new Date(ultimoSync.getTime() - 15 * 60_000)
    : new Date(agora.getTime() - 30 * 86_400_000);
}
