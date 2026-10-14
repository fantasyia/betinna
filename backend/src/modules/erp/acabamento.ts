/**
 * Serviços de ACABAMENTO (Léo, 14/10): a Isabela cobra por tarefa — passar
 * cordão R$ 0,25, dobrar e embalar R$ 0,25, colocar 2 pares de ilhós R$ 0,25.
 * A lista (com preço) é da empresa, em `Empresa.config.acabamento`; cada ficha
 * técnica marca quais serviços a grade leva. Entra no custo previsto da peça e,
 * no fechamento da OP, no custo real (serviços × peças recebidas). Tudo PURO.
 */

export interface ServicoAcabamento {
  id: string;
  nome: string;
  /** R$ por peça. */
  preco: number;
}

export function servicosAcabamento(config: unknown): ServicoAcabamento[] {
  const a = ((config ?? {}) as { acabamento?: { servicos?: unknown } }).acabamento;
  const lista = Array.isArray(a?.servicos) ? (a!.servicos as ServicoAcabamento[]) : [];
  return lista.filter((s) => s && typeof s.id === 'string' && typeof s.preco === 'number');
}

/** R$ por peça da grade: soma dos serviços marcados (id que sumiu da lista não conta). */
export function acabamentoPorPeca(ids: unknown, servicos: ServicoAcabamento[]): number {
  if (!Array.isArray(ids)) return 0;
  const preco = new Map(servicos.map((s) => [s.id, s.preco]));
  return ids.reduce((s: number, id) => s + (preco.get(String(id)) ?? 0), 0);
}

/** Id estável a partir do nome ("Passar cordão" → "passar-cordao"), sem repetir. */
export function idDoServico(nome: string, usados: Set<string>): string {
  const base =
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'servico';
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  usados.add(id);
  return id;
}
