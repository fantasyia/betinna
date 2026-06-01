import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Zap,
  GitBranch,
  Play,
  Timer,
  MessageSquare,
  Mail,
  CheckSquare,
  Tag,
  ArrowRight,
  UserCheck,
  Webhook,
  Save,
  X as XIcon,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Badge, IconButton, Input, Select, Textarea, Field, FullPageSpinner } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * FluxoEditor — editor visual de fluxos de automação com React Flow.
 *
 * Layout (3 colunas):
 *  - Esquerda (palette): GATILHOS / CONDIÇÕES / AÇÕES / TEMPO — drag pro canvas
 *  - Centro (canvas): React Flow com nós custom e edges
 *  - Direita (inspector): edita props do nó selecionado
 *
 * Persistência: PUT /fluxos/:id com `{ nos, arestas, triggerTipo }`.
 * Backend faz full-replace dos nós e arestas (per schema docs).
 */

// ─── Tipos espelhando o schema do backend ─────────────────────────

export type FluxoNoTipo = 'TRIGGER' | 'CONDICAO' | 'ACAO' | 'DELAY';

export type TriggerTipo =
  | 'LEAD_CRIADO'
  | 'LEAD_ETAPA_MUDOU'
  | 'PEDIDO_APROVADO'
  | 'PEDIDO_ENTREGUE'
  | 'OCORRENCIA_ABERTA'
  | 'CLIENTE_INATIVO_30D'
  | 'AMOSTRA_FOLLOWUP'
  | 'CRON_AGENDADO';

export type AcaoTipo =
  | 'ENVIAR_WHATSAPP'
  | 'ENVIAR_EMAIL'
  | 'CRIAR_TAREFA'
  | 'MUDAR_TAG'
  | 'MOVER_LEAD_ETAPA'
  | 'ATRIBUIR_REP'
  | 'WEBHOOK_EXTERNO';

interface FluxoNoApi {
  id?: string;
  tipo: FluxoNoTipo;
  acaoTipo?: string | null;
  titulo: string;
  config?: Record<string, unknown>;
  posX?: number;
  posY?: number;
}

interface FluxoEdgeApi {
  id?: string;
  sourceNoId: string;
  targetNoId: string;
  label?: string | null;
}

interface FluxoDetailApi {
  id: string;
  nome: string;
  descricao?: string | null;
  status: 'RASCUNHO' | 'ATIVO' | 'PAUSADO' | 'ARQUIVADO';
  triggerTipo?: TriggerTipo | null;
  nos?: FluxoNoApi[];
  arestas?: FluxoEdgeApi[];
}

// ─── Mapeamento UI ───────────────────────────────────────────────

const TRIGGER_LABEL: Record<TriggerTipo, string> = {
  LEAD_CRIADO: 'Lead criado',
  LEAD_ETAPA_MUDOU: 'Lead mudou etapa',
  PEDIDO_APROVADO: 'Pedido aprovado',
  PEDIDO_ENTREGUE: 'Pedido entregue',
  OCORRENCIA_ABERTA: 'Ocorrência aberta',
  CLIENTE_INATIVO_30D: 'Cliente inativo 30d',
  AMOSTRA_FOLLOWUP: 'Amostra follow-up',
  CRON_AGENDADO: 'Cron agendado',
};

const ACAO_LABEL: Record<AcaoTipo, string> = {
  ENVIAR_WHATSAPP: 'Enviar WhatsApp',
  ENVIAR_EMAIL: 'Enviar e-mail',
  CRIAR_TAREFA: 'Criar tarefa',
  MUDAR_TAG: 'Mudar tag',
  MOVER_LEAD_ETAPA: 'Mover lead de etapa',
  ATRIBUIR_REP: 'Atribuir representante',
  WEBHOOK_EXTERNO: 'Webhook externo',
};

const ACAO_ICONS: Record<AcaoTipo, typeof MessageSquare> = {
  ENVIAR_WHATSAPP: MessageSquare,
  ENVIAR_EMAIL: Mail,
  CRIAR_TAREFA: CheckSquare,
  MUDAR_TAG: Tag,
  MOVER_LEAD_ETAPA: ArrowRight,
  ATRIBUIR_REP: UserCheck,
  WEBHOOK_EXTERNO: Webhook,
};

// ─── Palette items (categorias do print) ────────────────────────

interface PaletteItem {
  id: string;
  label: string;
  tipo: FluxoNoTipo;
  acaoTipo?: AcaoTipo;
  triggerTipo?: TriggerTipo;
}

const PALETTE_CATEGORIES: Array<{ title: string; items: PaletteItem[] }> = [
  {
    title: 'Gatilhos',
    items: [
      { id: 't-lead', label: 'Lead criado', tipo: 'TRIGGER', triggerTipo: 'LEAD_CRIADO' },
      { id: 't-etapa', label: 'Lead mudou etapa', tipo: 'TRIGGER', triggerTipo: 'LEAD_ETAPA_MUDOU' },
      { id: 't-pedido-ok', label: 'Pedido aprovado', tipo: 'TRIGGER', triggerTipo: 'PEDIDO_APROVADO' },
      { id: 't-pedido-ent', label: 'Pedido entregue', tipo: 'TRIGGER', triggerTipo: 'PEDIDO_ENTREGUE' },
      { id: 't-ocor', label: 'Ocorrência aberta', tipo: 'TRIGGER', triggerTipo: 'OCORRENCIA_ABERTA' },
      { id: 't-inat', label: 'Cliente inativo 30d', tipo: 'TRIGGER', triggerTipo: 'CLIENTE_INATIVO_30D' },
      { id: 't-amos', label: 'Amostra follow-up', tipo: 'TRIGGER', triggerTipo: 'AMOSTRA_FOLLOWUP' },
      { id: 't-cron', label: 'Cron agendado', tipo: 'TRIGGER', triggerTipo: 'CRON_AGENDADO' },
    ],
  },
  {
    title: 'Condições',
    items: [{ id: 'c-cond', label: 'Condição', tipo: 'CONDICAO' }],
  },
  {
    title: 'Ações',
    items: [
      { id: 'a-wa', label: 'Enviar WhatsApp', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP' },
      { id: 'a-em', label: 'Enviar e-mail', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL' },
      { id: 'a-task', label: 'Criar tarefa', tipo: 'ACAO', acaoTipo: 'CRIAR_TAREFA' },
      { id: 'a-tag', label: 'Mudar tag', tipo: 'ACAO', acaoTipo: 'MUDAR_TAG' },
      { id: 'a-mov', label: 'Mover lead', tipo: 'ACAO', acaoTipo: 'MOVER_LEAD_ETAPA' },
      { id: 'a-atr', label: 'Atribuir rep', tipo: 'ACAO', acaoTipo: 'ATRIBUIR_REP' },
      { id: 'a-hook', label: 'Webhook externo', tipo: 'ACAO', acaoTipo: 'WEBHOOK_EXTERNO' },
    ],
  },
  {
    title: 'Tempo',
    items: [{ id: 'd-delay', label: 'Aguardar', tipo: 'DELAY' }],
  },
];

// ─── Node data interno ────────────────────────────────────────────

interface NodePayload extends Record<string, unknown> {
  titulo: string;
  tipo: FluxoNoTipo;
  acaoTipo?: AcaoTipo;
  triggerTipo?: TriggerTipo;
  config: Record<string, unknown>;
}

type FlowNode = Node<NodePayload>;

// ─── Custom Node component ───────────────────────────────────────

function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const tipo = data.tipo;
  const Icon = pickIcon(data);
  const accent = TIPO_ACCENT[tipo];

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface min-w-[180px] shadow-md',
        'transition-all duration-100',
        selected ? 'border-primary shadow-lg ring-2 ring-primary/30' : 'border-border-strong',
      )}
    >
      {/* Top connection (todos exceto TRIGGER) */}
      {tipo !== 'TRIGGER' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2 !h-2 !bg-primary !border-bg !border-2"
        />
      )}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border" style={{ borderTopColor: accent, borderTopWidth: 3, borderTopStyle: 'solid', borderRadius: 'inherit' }}>
        <span
          className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
          style={{ background: accent + '20', color: accent }}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
          {TIPO_LABEL[tipo]}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <div className="text-sm font-medium text-text leading-tight">{data.titulo}</div>
        {(data.acaoTipo || data.triggerTipo) && (
          <div className="text-[10px] text-muted mt-1">
            {data.acaoTipo
              ? ACAO_LABEL[data.acaoTipo]
              : data.triggerTipo
                ? TRIGGER_LABEL[data.triggerTipo]
                : ''}
          </div>
        )}
      </div>
      {/* Bottom connection (todos exceto DELAY/CONDICAO podem ter 1; CONDICAO tem 2) */}
      {tipo === 'CONDICAO' ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!w-2 !h-2 !bg-success !border-bg !border-2"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!w-2 !h-2 !bg-danger !border-bg !border-2"
            style={{ left: '70%' }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-2 !h-2 !bg-primary !border-bg !border-2"
        />
      )}
    </div>
  );
}

const NODE_TYPES = { fluxo: NodeCard };

const TIPO_LABEL: Record<FluxoNoTipo, string> = {
  TRIGGER: 'Gatilho',
  CONDICAO: 'Condição',
  ACAO: 'Ação',
  DELAY: 'Tempo',
};

const TIPO_ACCENT: Record<FluxoNoTipo, string> = {
  TRIGGER: 'var(--success)',
  CONDICAO: 'var(--warning)',
  ACAO: 'var(--info)',
  DELAY: 'var(--muted)',
};

function pickIcon(data: NodePayload) {
  if (data.tipo === 'TRIGGER') return Zap;
  if (data.tipo === 'CONDICAO') return GitBranch;
  if (data.tipo === 'DELAY') return Timer;
  if (data.acaoTipo) return ACAO_ICONS[data.acaoTipo];
  return Play;
}

// ─── Editor principal ────────────────────────────────────────────

export function FluxoEditor({
  fluxoId,
  onClose,
  onSaved,
}: {
  fluxoId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <FluxoEditorInner fluxoId={fluxoId} onClose={onClose} onSaved={onSaved} />
    </ReactFlowProvider>
  );
}

function FluxoEditorInner({
  fluxoId,
  onClose,
  onSaved,
}: {
  fluxoId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const { data, loading, refetch } = useApiQuery<FluxoDetailApi>(`/fluxos/${fluxoId}`);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Mobile: painéis viram drawers sobrepostos (só um aberto por vez). Em desktop
  // (md+) os painéis são fixos e este estado é ignorado pelo layout.
  const [mobilePanel, setMobilePanel] = useState<'palette' | 'inspector' | null>(null);
  const [saving, setSaving] = useState(false);
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
    setName(data.nome);
    setTriggerTipo(data.triggerTipo ?? '');
    const initialNodes: FlowNode[] = (data.nos ?? []).map((n, i) => ({
      id: n.id ?? `node-${i}`,
      type: 'fluxo',
      position: { x: n.posX ?? 100 + i * 60, y: n.posY ?? 80 + i * 80 },
      data: {
        titulo: n.titulo,
        tipo: n.tipo,
        acaoTipo: n.acaoTipo as AcaoTipo | undefined,
        triggerTipo: undefined,
        config: (n.config as Record<string, unknown>) ?? {},
      },
    }));
    const initialEdges: Edge[] = (data.arestas ?? []).map((e, i) => ({
      id: e.id ?? `edge-${i}`,
      source: e.sourceNoId,
      target: e.targetNoId,
      label: e.label ?? undefined,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'var(--border-strong)' },
    }));
    setNodes(initialNodes);
    setEdges(initialEdges);
    setDirty(false);
    // Reset history quando recarrega fluxo
    historyRef.current = [{ nodes: initialNodes, edges: initialEdges }];
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
          titulo: item.label,
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
            type: 'smoothstep',
            animated: true,
            style: { stroke: 'var(--border-strong)' },
            label: conn.sourceHandle === 'true' ? 'Sim' : conn.sourceHandle === 'false' ? 'Não' : undefined,
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

  // Save
  async function handleSave() {
    setSaving(true);
    try {
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
      if (triggerTipo) payload.triggerTipo = triggerTipo;
      await api.put(`/fluxos/${fluxoId}`, payload);
      toast.success('Fluxo salvo');
      setDirty(false);
      onSaved?.();
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
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

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-[110] bg-bg flex items-center justify-center">
        <FullPageSpinner label="Carregando fluxo…" />
      </div>
    );
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="fixed inset-0 z-[110] bg-bg flex flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 h-[56px] border-b border-border bg-bg-alt shrink-0">
        <IconButton aria-label="Fechar editor" variant="ghost" icon={<XIcon />} onClick={onClose} />
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="max-w-md font-semibold"
            placeholder="Nome do fluxo"
          />
          <Badge
            variant={data.status === 'ATIVO' ? 'success' : 'neutral'}
            className="hidden sm:inline-flex"
          >
            {data.status}
          </Badge>
          {dirty && (
            <Badge variant="warning" size="sm">
              Alterações não salvas
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Mobile: toggles dos painéis (viram drawers). Escondidos no desktop. */}
          <div className="flex items-center gap-1 md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobilePanel((p) => (p === 'palette' ? null : 'palette'))}
              data-testid="fluxo-mobile-blocos"
            >
              Blocos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobilePanel((p) => (p === 'inspector' ? null : 'inspector'))}
              data-testid="fluxo-mobile-editar"
            >
              Editar
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
          </div>
          {/* v1.5.0 — Undo/Redo (desktop; no mobile some pra ganhar espaço) */}
          <div className="hidden md:flex items-center gap-2">
            <IconButton
              aria-label="Desfazer (Cmd+Z)"
              title="Desfazer (Cmd/Ctrl+Z)"
              variant="ghost"
              icon={<Undo2 className="h-4 w-4" />}
              onClick={undo}
              disabled={!canUndo}
              data-testid="fluxo-undo"
            />
            <IconButton
              aria-label="Refazer (Cmd+Shift+Z)"
              title="Refazer (Cmd/Ctrl+Shift+Z ou Cmd/Ctrl+Y)"
              variant="ghost"
              icon={<Redo2 className="h-4 w-4" />}
              onClick={redo}
              disabled={!canRedo}
              data-testid="fluxo-redo"
            />
            <div className="w-px h-6 bg-border mx-1" />
          </div>
          <Button variant="ghost" className="hidden md:inline-flex" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
            leftIcon={<Save className="h-3.5 w-3.5" />}
          >
            Salvar
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Backdrop dos drawers (só mobile, quando um painel está aberto) */}
        {mobilePanel && (
          <button
            type="button"
            aria-label="Fechar painel"
            className="absolute inset-0 z-10 bg-black/40 md:hidden"
            onClick={() => setMobilePanel(null)}
          />
        )}
        {/* Palette — fixa no desktop; drawer pela esquerda no mobile */}
        <aside
          className={`w-[78vw] max-w-[240px] md:w-[240px] shrink-0 border-r border-border bg-bg-alt overflow-y-auto
            absolute inset-y-0 left-0 z-20 shadow-xl transition-transform duration-200
            md:static md:z-auto md:shadow-none md:translate-x-0
            ${mobilePanel === 'palette' ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="p-3 border-b border-border">
            <Field label="Trigger global" hint="Quando o fluxo dispara">
              <Select
                size="sm"
                value={triggerTipo}
                onChange={(e) => {
                  setTriggerTipo(e.target.value as TriggerTipo | '');
                  setDirty(true);
                }}
              >
                <option value="">Manual (sem trigger)</option>
                {(Object.keys(TRIGGER_LABEL) as TriggerTipo[]).map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="p-3 flex flex-col gap-4">
            {PALETTE_CATEGORIES.map((cat) => (
              <div key={cat.title}>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 px-1">
                  {cat.title}
                </h4>
                <div className="flex flex-col gap-1">
                  {cat.items.map((item) => (
                    <PaletteItemView key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div
          ref={wrapperRef}
          className="flex-1 relative"
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow<FlowNode, Edge>
            nodes={nodes}
            edges={edges}
            onNodesChange={(c) => {
              onNodesChange(c);
              if (c.some((ch) => ch.type === 'position' && ch.dragging === false)) setDirty(true);
            }}
            onEdgesChange={(c) => {
              onEdgesChange(c);
              if (c.length > 0) setDirty(true);
            }}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onNodeClick={(_, n) => {
              setSelectedNodeId(n.id);
              setMobilePanel('inspector'); // mobile: abre o editor do nó (ignorado no desktop)
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setMobilePanel(null);
            }}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            colorMode="dark"
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: true,
              style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls
              position="bottom-left"
              showInteractive={false}
              className="!bg-surface !border !border-border !rounded-md"
            />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              maskColor="rgba(0,0,0,0.5)"
              className="!bg-bg-alt !border !border-border !rounded-md"
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-muted-light flex flex-col items-center gap-2">
                <Play className="h-8 w-8" />
                <p className="text-sm font-medium">Arraste itens da paleta pra começar</p>
                <p className="text-xs text-muted-light">
                  Conecte os nós arrastando das bolinhas inferiores às superiores
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Inspector — fixo no desktop; drawer pela direita no mobile */}
        <aside
          className={`w-[88vw] max-w-[320px] md:w-[300px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto
            absolute inset-y-0 right-0 z-20 shadow-xl transition-transform duration-200
            md:static md:z-auto md:shadow-none md:translate-x-0
            ${mobilePanel === 'inspector' ? 'translate-x-0' : 'translate-x-full'}`}
        >
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              onUpdate={updateSelectedNode}
              onDelete={deleteSelectedNode}
            />
          ) : (
            <div className="p-4 text-center flex flex-col items-center gap-2 mt-8">
              <AlertCircle className="h-6 w-6 text-muted-light" />
              <p className="text-sm text-muted">Selecione um nó pra editar</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Palette item (draggable) ───────────────────────────────────

function PaletteItemView({ item }: { item: PaletteItem }) {
  const Icon =
    item.tipo === 'TRIGGER'
      ? Zap
      : item.tipo === 'CONDICAO'
        ? GitBranch
        : item.tipo === 'DELAY'
          ? Timer
          : item.acaoTipo
            ? ACAO_ICONS[item.acaoTipo]
            : Play;
  const accent = TIPO_ACCENT[item.tipo];

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/fluxo-node', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-grab',
        'border border-border bg-surface',
        'hover:border-border-strong hover:bg-surface-hover transition-colors',
        'active:cursor-grabbing active:scale-95',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
      <span className="text-xs font-medium text-text truncate">{item.label}</span>
    </div>
  );
}

// ─── Inspector (right panel) ────────────────────────────────────

function NodeInspector({
  node,
  onUpdate,
  onDelete,
}: {
  node: FlowNode;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  onDelete: () => void;
}) {
  const { data } = node;
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <Badge variant="neutral">{TIPO_LABEL[data.tipo]}</Badge>
          <IconButton
            aria-label="Excluir nó"
            variant="danger"
            size="sm"
            icon={<Trash2 />}
            onClick={onDelete}
          />
        </div>
        <Field label="Título" required>
          <Input
            value={data.titulo}
            onChange={(e) => onUpdate((d) => ({ ...d, titulo: e.target.value }))}
          />
        </Field>
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        {data.tipo === 'TRIGGER' && (
          <Field label="Tipo de gatilho">
            <Select
              size="sm"
              value={data.triggerTipo ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, triggerTipo: (e.target.value || undefined) as TriggerTipo | undefined }))
              }
            >
              <option value="">Selecionar…</option>
              {(Object.keys(TRIGGER_LABEL) as TriggerTipo[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {data.tipo === 'ACAO' && (
          <Field label="Tipo de ação">
            <Select
              size="sm"
              value={data.acaoTipo ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, acaoTipo: (e.target.value || undefined) as AcaoTipo | undefined }))
              }
            >
              <option value="">Selecionar…</option>
              {(Object.keys(ACAO_LABEL) as AcaoTipo[]).map((t) => (
                <option key={t} value={t}>
                  {ACAO_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {data.tipo === 'DELAY' && (
          <>
            <Field label="Aguardar quantidade">
              <Input
                type="number"
                min={1}
                value={(data.config.quantidade as number) ?? 1}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, quantidade: Number(e.target.value) } }))
                }
              />
            </Field>
            <Field label="Unidade">
              <Select
                size="sm"
                value={(data.config.unidade as string) ?? 'minutos'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, unidade: e.target.value } }))
                }
              >
                <option value="minutos">minutos</option>
                <option value="horas">horas</option>
                <option value="dias">dias</option>
              </Select>
            </Field>
          </>
        )}

        {data.tipo === 'CONDICAO' && (
          <Field
            label="Expressão / regra"
            hint="Por enquanto via JSON. Editor visual de condições vem depois."
          >
            <Textarea
              rows={6}
              value={JSON.stringify(data.config, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  onUpdate((d) => ({ ...d, config: parsed }));
                } catch {
                  // Mantém valor inválido no estado pro user corrigir
                }
              }}
              className="font-mono text-xs"
            />
          </Field>
        )}

        {data.acaoTipo === 'ENVIAR_WHATSAPP' && (
          <Field label="Mensagem" hint="Use {{nome}}, {{empresa}} pra variáveis">
            <Textarea
              rows={5}
              value={(data.config.mensagem as string) ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, config: { ...d.config, mensagem: e.target.value } }))
              }
              placeholder="Olá {{nome}}, tudo bem?"
            />
          </Field>
        )}

        {data.acaoTipo === 'ENVIAR_EMAIL' && (
          <>
            <Field label="Assunto">
              <Input
                value={(data.config.assunto as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, assunto: e.target.value } }))
                }
              />
            </Field>
            <Field label="Corpo HTML">
              <Textarea
                rows={6}
                value={(data.config.corpo as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, corpo: e.target.value } }))
                }
              />
            </Field>
          </>
        )}

        {data.acaoTipo === 'WEBHOOK_EXTERNO' && (
          <>
            <Field label="URL">
              <Input
                placeholder="https://exemplo.com/hook"
                value={(data.config.url as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, url: e.target.value } }))
                }
              />
            </Field>
            <Field label="Método">
              <Select
                size="sm"
                value={(data.config.method as string) ?? 'POST'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, method: e.target.value } }))
                }
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
              </Select>
            </Field>
          </>
        )}

        {/* Raw config debug — colapsado */}
        <details className="mt-3 text-xs">
          <summary className="text-muted cursor-pointer select-none">Config (avançado)</summary>
          <pre className="mt-2 p-2 rounded-md bg-bg border border-border overflow-x-auto font-mono text-[10px]">
            {JSON.stringify(data.config, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function defaultConfig(item: PaletteItem): Record<string, unknown> {
  if (item.tipo === 'DELAY') return { quantidade: 1, unidade: 'horas' };
  if (item.acaoTipo === 'ENVIAR_WHATSAPP') return { mensagem: '' };
  if (item.acaoTipo === 'ENVIAR_EMAIL') return { assunto: '', corpo: '' };
  if (item.acaoTipo === 'WEBHOOK_EXTERNO') return { url: '', method: 'POST' };
  return {};
}

// Re-export pra outros consumirem
useMemo;
