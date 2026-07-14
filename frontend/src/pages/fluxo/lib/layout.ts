import type { Edge } from '@xyflow/react';
import type { FlowNode } from './types';

/**
 * Auto-layout em camadas (top-down), SEM dependência externa (nada de dagre/elk).
 *
 * - `rank` de cada nó = maior caminho desde uma raiz → gatilho no topo, ações
 *   descendo por nível.
 * - Dentro de cada nível, ordena por baricentro (média da coluna dos pais já
 *   posicionados) pra reduzir cruzamento de arestas; sem pai, cai pro x atual
 *   (preserva a intenção esquerda→direita do usuário).
 * - Centraliza cada nível em relação ao mais largo → árvore simétrica e limpa.
 */

const NODE_W = 220;
const NODE_H = 130;
const GAP_X = 60;
const GAP_Y = 90;
const STEP_X = NODE_W + GAP_X;
const STEP_Y = NODE_H + GAP_Y;

export function organizarNos(nodes: FlowNode[], edges: Edge[]): FlowNode[] {
  if (nodes.length === 0) return nodes;

  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  nodes.forEach((n) => incoming.set(n.id, []));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    incoming.get(e.target)!.push(e.source);
  }

  // rank = maior caminho desde uma raiz (com guard de ciclo)
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const computeRank = (id: string): number => {
    const cached = rank.get(id);
    if (cached != null) return cached;
    if (visiting.has(id)) return 0; // ciclo → corta em 0
    visiting.add(id);
    let r = 0;
    for (const p of incoming.get(id) ?? []) r = Math.max(r, computeRank(p) + 1);
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  nodes.forEach((n) => computeRank(n.id));

  // agrupa por nível
  const byRank = new Map<number, string[]>();
  nodes.forEach((n) => {
    const r = rank.get(n.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(n.id);
  });
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  const posById = new Map(nodes.map((n) => [n.id, n.position] as const));
  const col = new Map<string, number>(); // coluna dentro do nível

  for (const r of ranks) {
    const level = byRank.get(r)!;
    const keyOf = (id: string): number => {
      const preds = (incoming.get(id) ?? []).filter((p) => col.has(p));
      if (preds.length > 0) {
        return preds.reduce((s, p) => s + (col.get(p) ?? 0), 0) / preds.length;
      }
      return (posById.get(id)?.x ?? 0) / STEP_X;
    };
    level.sort((a, b) => keyOf(a) - keyOf(b));
    level.forEach((id, i) => col.set(id, i));
  }

  const maxCols = Math.max(1, ...ranks.map((r) => byRank.get(r)!.length));
  const totalW = (maxCols - 1) * STEP_X;

  return nodes.map((n) => {
    const r = rank.get(n.id) ?? 0;
    const m = byRank.get(r)!.length;
    const startX = (totalW - (m - 1) * STEP_X) / 2;
    const c = col.get(n.id) ?? 0;
    return { ...n, position: { x: startX + c * STEP_X, y: r * STEP_Y } };
  });
}
