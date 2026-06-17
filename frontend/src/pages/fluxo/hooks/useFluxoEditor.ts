import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  addEdge,
  useNodesState,
  useEdgesState,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/toast';
import {
  type TriggerTipo,
  type FluxoDetailApi,
  type PaletteItem,
  type NodePayload,
  type FlowNode,
} from '@/pages/fluxo/lib/types';
import { labelDaAresta, defaultConfig } from '@/pages/fluxo/lib/saidas';
import {
  serializarFluxo,
  hidratarFluxo,
  inserirTriggerManual,
} from '@/pages/fluxo/lib/serializacao';

/**
 * useFluxoEditor — O CÉREBRO do editor de fluxos.
 *
 * Detém TODO o estado (nodes/edges/selectedNodeId/name/triggerTipo/dirty/saving/
 * reactFlowInstance), o histórico (undo/redo em refs), a hidratação e o save.
 * Expõe todos os handlers consumidos pelo FluxoEditor.
 *
 * COMPORTAMENTO IDÊNTICO ao FluxoEditorInner original — os 4 mutadores que mexem
 * em nodes E edges juntos preservam a atomicidade (poda de arestas órfãs no mesmo
 * tick), pushHistory em toda mutação estrutural, dirty em toda mutação.
 */
export function useFluxoEditor({
  fluxoId,
  data,
  onSaved,
}: {
  fluxoId: string;
  data: FluxoDetailApi | null | undefined;
  onSaved?: () => void;
}) {
  const toast = useToast();

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testando, setTestando] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState('');
  const [triggerTipo, setTriggerTipo] = useState<TriggerTipo | ''>('');
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // v1.5.0 — Undo/Redo history stack
  // Snapshots de { nodes, edges } com max 50 entradas.
  // O ponteiro `historyIdx` aponta pro estado atual; undo decrementa, redo incrementa.
  type Snapshot = { nodes: FlowNode[]; edges: Edge[] };
  const historyRef = useRef<Snapshot[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const skipHistoryRef = useRef<boolean>(false);
  const HISTORY_LIMIT = 50;
  const [, forceRender] = useState(0);

  function pushHistory(snapshot: Snapshot) {
    if (skipHistoryRef.current) return;
    // Trunca o futuro (estados após o ponteiro atual são descartados)
    const next = historyRef.current.slice(0, historyIdxRef.current + 1);
    next.push({
      nodes: snapshot.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: snapshot.edges.map((e) => ({ ...e })),
    });
    // Limite circular: descarta os mais antigos
    if (next.length > HISTORY_LIMIT) next.shift();
    historyRef.current = next;
    historyIdxRef.current = next.length - 1;
    forceRender((v) => v + 1);
  }

  function undo() {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const snap = historyRef.current[historyIdxRef.current];
    skipHistoryRef.current = true;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setDirty(true);
    setTimeout(() => {
      skipHistoryRef.current = false;
    }, 0);
    forceRender((v) => v + 1);
  }

  function redo() {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const snap = historyRef.current[historyIdxRef.current];
    skipHistoryRef.current = true;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    setDirty(true);
    setTimeout(() => {
      skipHistoryRef.current = false;
    }, 0);
    forceRender((v) => v + 1);
  }

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  // Atalhos: Cmd/Ctrl + Z, Cmd/Ctrl + Shift + Z, Cmd/Ctrl + Y
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydratar nodes/edges quando data chega
  useEffect(() => {
    if (!data) return;
    const hidratado = hidratarFluxo(data);
    setName(hidratado.name);
    setTriggerTipo(hidratado.triggerTipo);
    setNodes(hidratado.nodes);
    setEdges(hidratado.edges);
    // Marca dirty só quando inserimos o gatilho manual (precisa salvar pra
    // persistir o nó; "Disparar agora" depende dele estar no backend).
    setDirty(hidratado.inseriuManual);
    // Reset history quando recarrega fluxo
    historyRef.current = [{ nodes: hidratado.nodes, edges: hidratado.edges }];
    historyIdxRef.current = 0;
    forceRender((v) => v + 1);
  }, [data, setNodes, setEdges]);

  // Drop handler
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!reactFlowInstance || !wrapperRef.current) return;
      const raw = event.dataTransfer.getData('application/fluxo-node');
      if (!raw) return;
      const item: PaletteItem = JSON.parse(raw);

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const id = `node-${Date.now()}`;
      const newNode: FlowNode = {
        id,
        type: 'fluxo',
        position,
        data: {
          titulo: item.manual ? 'Disparado manualmente' : item.label,
          tipo: item.tipo,
          acaoTipo: item.acaoTipo,
          triggerTipo: item.triggerTipo,
          config: defaultConfig(item),
        },
      };
      setNodes((nds) => {
        const next = nds.concat(newNode);
        pushHistory({ nodes: next, edges });
        return next;
      });
      setDirty(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reactFlowInstance, setNodes, edges],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Connection
  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => {
        const next = addEdge(
          {
            ...conn,
            type: 'removivel',
            animated: true,
            style: { stroke: 'var(--border-strong)' },
            // O id do handle de saída vira o label da aresta — contrato central em
            // lib/saidas.ts (true→Sim, false→Não, roteador: o próprio id).
            label: labelDaAresta(conn.sourceHandle),
          },
          eds,
        );
        pushHistory({ nodes, edges: next });
        return next;
      });
      setDirty(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges, nodes],
  );

  // Wrappers de onNodesChange/onEdgesChange — marcam dirty no fim do drag/edição.
  const onNodesChangeWrap = useCallback(
    (c: NodeChange<FlowNode>[]) => {
      onNodesChange(c);
      if (c.some((ch) => ch.type === 'position' && ch.dragging === false)) setDirty(true);
    },
    [onNodesChange],
  );

  const onEdgesChangeWrap = useCallback(
    (c: EdgeChange<Edge>[]) => {
      onEdgesChange(c);
      if (c.length > 0) setDirty(true);
    },
    [onEdgesChange],
  );

  const onNodeClick = useCallback((_: unknown, n: FlowNode) => {
    setSelectedNodeId(n.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onInit = useCallback((instance: ReactFlowInstance<FlowNode, Edge>) => {
    setReactFlowInstance(instance);
  }, []);

  // Save
  async function handleSave() {
    setSaving(true);
    try {
      const payload = serializarFluxo(nodes, edges, name, triggerTipo);
      await api.put(`/fluxos/${fluxoId}`, payload);
      toast.success('Fluxo salvo');
      setDirty(false);
      onSaved?.();
    } catch (err) {
      toast.error('Falha ao salvar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  // "Disparar agora" do Trigger Manual: roda o fluxo NA HORA, sem pedir lead
  // (salva antes se estiver sujo, pra o backend ter o nó de gatilho).
  async function dispararManual() {
    setTestando(true);
    try {
      if (dirty) await handleSave();
      const r = await api.post<{ execucaoId: string }>('/fluxos/testar', {
        fluxoId,
        contexto: {},
      });
      toast.success(
        'Fluxo disparado 🚀',
        `Execução ${r.execucaoId.slice(0, 8)}… — veja o resultado em Fluxos › "ver erros".`,
      );
    } catch (err) {
      toast.error('Falha ao disparar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setTestando(false);
    }
  }

  // Dispara um teste manual (POST /fluxos/testar) — salva antes se estiver sujo.
  // Retorna true em sucesso (pra o caller fechar o modal de teste).
  async function runTeste(testLeadId: string): Promise<boolean> {
    setTestando(true);
    try {
      if (dirty) await handleSave();
      const r = await api.post<{ execucaoId: string }>('/fluxos/testar', {
        fluxoId,
        contexto: testLeadId.trim() ? { leadId: testLeadId.trim() } : {},
      });
      toast.success(
        'Teste disparado 🚀',
        `Execução ${r.execucaoId.slice(0, 8)}… — acompanhe em Fluxos › Execuções.`,
      );
      return true;
    } catch (err) {
      toast.error('Falha ao testar', err instanceof ApiError ? err.message : undefined);
      return false;
    } finally {
      setTestando(false);
    }
  }

  // Sync selected node updates back to nodes state
  function updateSelectedNode(updater: (data: NodePayload) => NodePayload) {
    if (!selectedNodeId) return;
    setNodes((nds) => {
      const next = nds.map((n) =>
        n.id === selectedNodeId ? { ...n, data: updater(n.data) } : n,
      );
      pushHistory({ nodes: next, edges });
      return next;
    });
    setDirty(true);
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    const nextNodes = nodes.filter((n) => n.id !== selectedNodeId);
    const nextEdges = edges.filter(
      (e) => e.source !== selectedNodeId && e.target !== selectedNodeId,
    );
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory({ nodes: nextNodes, edges: nextEdges });
    setSelectedNodeId(null);
    setDirty(true);
  }

  /**
   * Remove uma saída do roteador (nó selecionado) E poda as arestas que apontavam
   * pra ela — senão a aresta fica órfã (handle some) e o ramo nunca mais executa.
   */
  function removeSaidaDoNoSelecionado(valor: string) {
    if (!selectedNodeId) return;
    const nextNodes = nodes.map((n) =>
      n.id === selectedNodeId
        ? {
            ...n,
            data: {
              ...n.data,
              config: {
                ...n.data.config,
                saidas: ((n.data.config.saidas as string[]) ?? []).filter((s) => s !== valor),
              },
            },
          }
        : n,
    );
    const nextEdges = edges.filter((e) => !(e.source === selectedNodeId && e.label === valor));
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory({ nodes: nextNodes, edges: nextEdges });
    setDirty(true);
  }

  /**
   * Renomeia uma saída in-place: atualiza o config E propaga o novo valor pras
   * arestas (label + sourceHandle, já que o id do handle = valor da saída).
   */
  function renameSaidaDoNoSelecionado(antigo: string, novo: string) {
    if (!selectedNodeId || antigo === novo) return;
    const nextNodes = nodes.map((n) =>
      n.id === selectedNodeId
        ? {
            ...n,
            data: {
              ...n.data,
              config: {
                ...n.data.config,
                saidas: ((n.data.config.saidas as string[]) ?? []).map((s) =>
                  s === antigo ? novo : s,
                ),
              },
            },
          }
        : n,
    );
    const nextEdges = edges.map((e) =>
      e.source === selectedNodeId && e.label === antigo
        ? { ...e, label: novo, sourceHandle: novo }
        : e,
    );
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory({ nodes: nextNodes, edges: nextEdges });
    setDirty(true);
  }

  /**
   * Troca o modo da Condição (simples ↔ roteador) E poda as arestas que deixam de
   * ter handle no novo modo — senão ficam órfãs (mesmo sintoma do remover saída):
   * simples só tem Sim/Não; roteador só as saídas atuais + 'default'.
   */
  function trocarModoDoNoSelecionado(novoModo: string) {
    if (!selectedNodeId) return;
    const no = nodes.find((n) => n.id === selectedNodeId);
    const saidas = (no?.data.config.saidas as string[]) ?? [];
    const validos = novoModo === 'roteador' ? [...saidas, 'default'] : ['Sim', 'Não'];
    const nextNodes = nodes.map((n) =>
      n.id === selectedNodeId
        ? { ...n, data: { ...n.data, config: { ...n.data.config, modo: novoModo } } }
        : n,
    );
    const nextEdges = edges.filter(
      (e) => e.source !== selectedNodeId || validos.includes(String(e.label)),
    );
    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory({ nodes: nextNodes, edges: nextEdges });
    setDirty(true);
  }

  /**
   * Lógica do Select de "Trigger global" (paleta). Setou pra Manual e não há nó
   * de gatilho → insere o "Trigger Manual" no topo e conecta aos nós-raiz (mesmo
   * comportamento da hidratação). Caso contrário, sincroniza o nó TRIGGER pra o
   * inspector mostrar a config certa.
   */
  function onChangeTriggerGlobal(tt: TriggerTipo | '') {
    setTriggerTipo(tt);
    const temTrigger = nodes.some((n) => n.data.tipo === 'TRIGGER');
    if (tt === '' && !temTrigger) {
      const manualId = `node-${Date.now()}`;
      const topo = nodes.length ? Math.min(...nodes.map((n) => n.position.y)) - 110 : 40;
      const res = inserirTriggerManual(nodes, edges, { manualId, posY: topo });
      setNodes(res.nodes);
      setEdges(res.edges);
    } else {
      // Sincroniza o nó TRIGGER pra o inspector mostrar a config certa.
      setNodes(
        nodes.map((n) =>
          n.data.tipo === 'TRIGGER'
            ? { ...n, data: { ...n.data, triggerTipo: tt || undefined } }
            : n,
        ),
      );
    }
    setDirty(true);
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return {
    // estado
    nodes,
    edges,
    selectedNodeId,
    selectedNode,
    name,
    triggerTipo,
    dirty,
    saving,
    testando,
    reactFlowInstance,
    wrapperRef,
    canUndo,
    canRedo,
    // setters expostos
    setName,
    setTriggerTipo,
    setDirty,
    // handlers de canvas
    onConnect,
    onDrop,
    onDragOver,
    onNodesChange: onNodesChangeWrap,
    onEdgesChange: onEdgesChangeWrap,
    onNodeClick,
    onPaneClick,
    onInit,
    // mutadores do nó selecionado
    updateSelectedNode,
    deleteSelectedNode,
    removeSaidaDoNoSelecionado,
    renameSaidaDoNoSelecionado,
    trocarModoDoNoSelecionado,
    onChangeTriggerGlobal,
    // history
    undo,
    redo,
    pushHistory,
    // save / disparo
    handleSave,
    dispararManual,
    runTeste,
  };
}

/**
 * Contrato do objeto retornado pelo hook — consumido pelas regiões de UI
 * (FluxoToolbar / TestarFluxoModal / PaletteSidebar / FluxoCanvas) como `editor`.
 */
export type FluxoEditorApi = ReturnType<typeof useFluxoEditor>;
