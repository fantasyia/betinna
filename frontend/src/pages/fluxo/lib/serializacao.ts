import type { Edge } from '@xyflow/react';
import {
  type TriggerTipo,
  type AcaoTipo,
  type FluxoNoApi,
  type FluxoEdgeApi,
  type FluxoDetailApi,
  type NodePayload,
  type FlowNode,
} from './types';
import { reconstruirSourceHandle, dedupConfigSaidas } from './saidas';

/**
 * Serialização ↔ hidratação do GRAFO do fluxo — funções PURAS e testáveis,
 * espelhando byte-a-byte o handleSave e o efeito de hidratação do FluxoEditor.
 *
 * Persistência: PUT /fluxos/:id com `{ nome, nos, arestas, triggerTipo?, triggerConfig? }`.
 * O backend faz full-replace dos nós/arestas e roteia a execução pelo LABEL da
 * aresta — o round-trip (sourceHandle não persiste, só o label) é reconstruído
 * via reconstruirSourceHandle (ver lib/saidas).
 */

// ─── Trigger Manual sintético ────────────────────────────────────

/**
 * Insere o nó "Trigger Manual" no topo do grafo E o conecta aos nós-raiz (os que
 * não têm aresta de entrada e não são TRIGGER) — senão o disparo começaria no
 * gatilho e não chegaria nas ações. Comportamento idêntico ao usado na
 * hidratação (referência) e no Select de "Trigger global".
 *
 * - `manualId`: id do nó sintético (na hidratação = `manual-${fluxoId}`; no Select
 *   = `node-${Date.now()}`).
 * - `posY`: y do nó manual. Na hidratação é 40 fixo; no Select é
 *   `min(y dos nós) - 110` (ou 40 sem nós).
 *
 * Retorna NOVOS arrays (não muta os de entrada).
 */
export function inserirTriggerManual(
  nodes: FlowNode[],
  edges: Edge[],
  opts: { manualId: string; posY?: number },
): { nodes: FlowNode[]; edges: Edge[] } {
  const { manualId, posY = 40 } = opts;
  const manual: FlowNode = {
    id: manualId,
    type: 'fluxo',
    position: { x: 120, y: posY },
    data: { titulo: 'Disparado manualmente', tipo: 'TRIGGER', config: { manual: true, descricao: '' } },
  };
  const comEntrada = new Set(edges.map((e) => e.target));
  const novasEdges: Edge[] = nodes
    .filter((n) => n.id !== manualId && n.data.tipo !== 'TRIGGER' && !comEntrada.has(n.id))
    .map((n) => ({
      id: `edge-${manualId}-${n.id}`,
      source: manualId,
      target: n.id,
      type: 'removivel',
      animated: false,
      style: { stroke: 'var(--secondary)', strokeWidth: 2.5 },
    }));
  return { nodes: [manual, ...nodes], edges: [...edges, ...novasEdges] };
}

// ─── Hidratação (data da API → grafo do canvas) ──────────────────

export interface HidratacaoResultado {
  name: string;
  triggerTipo: TriggerTipo | '';
  nodes: FlowNode[];
  edges: Edge[];
  /** True quando inseriu o Trigger Manual sintético (precisa salvar pra persistir). */
  inseriuManual: boolean;
}

/**
 * Reconstrói o grafo do canvas a partir do payload da API. Espelha o efeito de
 * hidratação do FluxoEditor:
 *  - dedup das saídas do roteador (dedupConfigSaidas);
 *  - espelha o triggerTipo do fluxo no nó TRIGGER (pro inspector);
 *  - reconstrói o sourceHandle das arestas (label + modo do nó de origem);
 *  - insere o Trigger Manual sintético em fluxo manual sem nó de gatilho.
 */
export function hidratarFluxo(data: FluxoDetailApi): HidratacaoResultado {
  const initialNodes: FlowNode[] = (data.nos ?? []).map((n, i) => ({
    id: n.id ?? `node-${i}`,
    type: 'fluxo',
    position: { x: n.posX ?? 100 + i * 60, y: n.posY ?? 80 + i * 80 },
    data: {
      titulo: n.titulo,
      tipo: n.tipo,
      acaoTipo: n.acaoTipo as AcaoTipo | undefined,
      // Espelha o triggerTipo do fluxo no nó TRIGGER pra o inspector mostrar
      // a config certa (antes ficava undefined → config do gatilho sumia ao recarregar).
      triggerTipo:
        n.tipo === 'TRIGGER' ? (data.triggerTipo as TriggerTipo | undefined) : undefined,
      config: dedupConfigSaidas((n.config as Record<string, unknown>) ?? {}),
    },
  }));
  // Mapa nó→config pra reconstruir o sourceHandle ciente do MODO do nó de origem.
  const noById = new Map((data.nos ?? []).map((n) => [n.id, n]));
  const initialEdges: Edge[] = (data.arestas ?? []).map((e, i) => {
    const src = noById.get(e.sourceNoId);
    // O sourceHandle não é persistido (só o label) — reconstruído pelo contrato
    // central a partir de (label + modo do nó de origem). Ver lib/saidas.ts.
    const srcData = src
      ? ({
          titulo: src.titulo,
          tipo: src.tipo,
          acaoTipo: src.acaoTipo as AcaoTipo | undefined,
          config: (src.config as Record<string, unknown> | undefined) ?? {},
        } satisfies NodePayload)
      : undefined;
    return {
      id: e.id ?? `edge-${i}`,
      source: e.sourceNoId,
      target: e.targetNoId,
      label: e.label ?? undefined,
      sourceHandle: reconstruirSourceHandle(e.label, srcData),
      type: 'removivel',
      animated: false,
      style: { stroke: 'var(--secondary)', strokeWidth: 2.5 },
    };
  });

  // Fluxo manual (sem triggerTipo) que ainda não tem nó de gatilho visual:
  // insere o "Trigger Manual" no topo E conecta ele aos nós-raiz (sem aresta de
  // entrada) — senão o disparo começa no gatilho e não chega nas ações.
  let nodes = initialNodes;
  let edges = initialEdges;
  let inseriuManual = false;
  if (!data.triggerTipo && !initialNodes.some((n) => n.data.tipo === 'TRIGGER')) {
    const res = inserirTriggerManual(initialNodes, initialEdges, {
      manualId: `manual-${data.id}`,
      posY: 40,
    });
    nodes = res.nodes;
    edges = res.edges;
    inseriuManual = true;
  }

  return {
    name: data.nome,
    triggerTipo: data.triggerTipo ?? '',
    nodes,
    edges,
    inseriuManual,
  };
}

// ─── Serialização (grafo do canvas → payload da API) ─────────────

/**
 * Serializa o grafo do canvas no payload de PUT /fluxos/:id. Espelha o handleSave:
 *  - nós/arestas full-replace (label = string ou null);
 *  - fonte da verdade do gatilho = o nó TRIGGER (fallback no triggerTipo top-level);
 *  - CRON grava triggerConfig {expressao,timezone} à parte (o job lê de lá).
 */
export function serializarFluxo(
  nodes: FlowNode[],
  edges: Edge[],
  name: string,
  triggerTipo: TriggerTipo | '',
): Record<string, unknown> {
  const nos: FluxoNoApi[] = nodes.map((n) => ({
    id: n.id,
    tipo: n.data.tipo,
    acaoTipo: n.data.acaoTipo ?? null,
    titulo: n.data.titulo,
    config: n.data.config,
    posX: n.position.x,
    posY: n.position.y,
  }));
  const arestas: FluxoEdgeApi[] = edges.map((e) => ({
    id: e.id,
    sourceNoId: e.source,
    targetNoId: e.target,
    label: typeof e.label === 'string' ? e.label : null,
  }));
  const payload: Record<string, unknown> = {
    nome: name,
    nos,
    arestas,
  };
  // Fonte da verdade do gatilho = o nó TRIGGER (o inspector edita ali). Antes
  // o save só olhava o estado top-level e ignorava troca feita no inspector,
  // gravando o triggerTipo antigo e deixando a config de filtro órfã.
  const triggerNode = nodes.find((n) => n.data.tipo === 'TRIGGER');
  const ttFinal =
    (triggerNode?.data.triggerTipo as TriggerTipo | undefined) ?? (triggerTipo || undefined);
  if (ttFinal) payload.triggerTipo = ttFinal;
  // CRON: a config de horário vive em Fluxo.triggerConfig (o job lê de lá).
  // Persiste o ARRAY de expressões (múltiplos horários) + expressao (back-compat,
  // a 1ª) + pularFeriados. Antes só ia expressao/timezone → múltiplos horários e
  // "pular feriados" não chegavam no job.
  if (ttFinal === 'CRON_AGENDADO' && triggerNode) {
    const c = triggerNode.data.config ?? {};
    const expressoes =
      Array.isArray(c.expressoes) && c.expressoes.length
        ? (c.expressoes as string[])
        : c.expressao
          ? [c.expressao as string]
          : [];
    payload.triggerConfig = {
      expressoes,
      expressao: expressoes[0] ?? '',
      timezone: (c.timezone as string) ?? 'America/Sao_Paulo',
      pularFeriados: c.pularFeriados === true,
    };
  }
  return payload;
}
