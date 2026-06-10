import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Undo2, Redo2, PowerOff } from 'lucide-react';
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
  useReactFlow,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type EdgeProps,
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
  Bot,
  Send,
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
  | 'CRON_AGENDADO'
  | 'LEAD_RESPONDEU'
  | 'LEAD_SEM_RESPOSTA'
  | 'IA_CLASSIFICOU'
  | 'LEAD_RECEBEU_TAG'
  | 'MENSAGEM_CANAL'
  | 'WEBHOOK_RECEBIDO';

export type AcaoTipo =
  | 'ENVIAR_WHATSAPP'
  | 'ENVIAR_EMAIL'
  | 'CRIAR_TAREFA'
  | 'MUDAR_TAG'
  | 'MOVER_LEAD_ETAPA'
  | 'ATRIBUIR_REP'
  | 'WEBHOOK_EXTERNO'
  | 'CONVERSAR_IA'
  | 'LIBERAR_LOTE'
  | 'PAUSAR_IA';

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
  LEAD_RESPONDEU: 'Lead respondeu',
  LEAD_SEM_RESPOSTA: 'Lead sem resposta',
  IA_CLASSIFICOU: 'IA classificou',
  LEAD_RECEBEU_TAG: 'Lead recebeu tag',
  MENSAGEM_CANAL: 'Mensagem chegou (canal)',
  WEBHOOK_RECEBIDO: 'Webhook recebido',
};

const ACAO_LABEL: Record<AcaoTipo, string> = {
  ENVIAR_WHATSAPP: 'Enviar WhatsApp',
  ENVIAR_EMAIL: 'Enviar e-mail',
  CRIAR_TAREFA: 'Criar tarefa',
  MUDAR_TAG: 'Mudar tag',
  MOVER_LEAD_ETAPA: 'Mover lead de etapa',
  ATRIBUIR_REP: 'Atribuir representante',
  WEBHOOK_EXTERNO: 'Webhook externo',
  CONVERSAR_IA: 'Conversar com IA',
  LIBERAR_LOTE: 'Liberar lote',
  PAUSAR_IA: 'Pausar IA na conversa',
};

const ACAO_ICONS: Record<AcaoTipo, typeof MessageSquare> = {
  ENVIAR_WHATSAPP: MessageSquare,
  ENVIAR_EMAIL: Mail,
  CRIAR_TAREFA: CheckSquare,
  MUDAR_TAG: Tag,
  MOVER_LEAD_ETAPA: ArrowRight,
  ATRIBUIR_REP: UserCheck,
  WEBHOOK_EXTERNO: Webhook,
  CONVERSAR_IA: Bot,
  LIBERAR_LOTE: Send,
  PAUSAR_IA: PowerOff,
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
      { id: 't-resp', label: 'Lead respondeu', tipo: 'TRIGGER', triggerTipo: 'LEAD_RESPONDEU' },
      { id: 't-semresp', label: 'Lead sem resposta', tipo: 'TRIGGER', triggerTipo: 'LEAD_SEM_RESPOSTA' },
      { id: 't-iaclass', label: 'IA classificou', tipo: 'TRIGGER', triggerTipo: 'IA_CLASSIFICOU' },
      { id: 't-tag', label: 'Lead recebeu tag', tipo: 'TRIGGER', triggerTipo: 'LEAD_RECEBEU_TAG' },
      { id: 't-canal', label: 'Mensagem chegou (canal)', tipo: 'TRIGGER', triggerTipo: 'MENSAGEM_CANAL' },
      { id: 't-webhook', label: 'Webhook recebido', tipo: 'TRIGGER', triggerTipo: 'WEBHOOK_RECEBIDO' },
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
      { id: 'a-atr', label: 'Atribuir representante', tipo: 'ACAO', acaoTipo: 'ATRIBUIR_REP' },
      { id: 'a-hook', label: 'Webhook externo', tipo: 'ACAO', acaoTipo: 'WEBHOOK_EXTERNO' },
      { id: 'a-ia', label: 'Conversar com IA', tipo: 'ACAO', acaoTipo: 'CONVERSAR_IA' },
      { id: 'a-lote', label: 'Liberar lote', tipo: 'ACAO', acaoTipo: 'LIBERAR_LOTE' },
      { id: 'a-pausa-ia', label: 'Pausar IA na conversa', tipo: 'ACAO', acaoTipo: 'PAUSAR_IA' },
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
        'relative rounded-lg border bg-surface min-w-[180px] shadow-md',
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
      {/* Saídas: CONDICAO simples = true/false; CONDICAO roteador = N saídas +
          default; demais = 1. O `id` do handle vira o label da aresta. */}
      {tipo === 'CONDICAO' ? (
        (data.config?.modo as string) === 'roteador' ? (
          <>
            {[...(((data.config?.saidas as string[]) ?? [])), 'default'].map((s, i, arr) => (
              <Handle
                key={s}
                type="source"
                position={Position.Bottom}
                id={s}
                className={`!w-2 !h-2 !border-bg !border-2 ${s === 'default' ? '!bg-muted' : '!bg-primary'}`}
                style={{ left: `${((i + 1) / (arr.length + 1)) * 100}%` }}
              />
            ))}
          </>
        ) : (
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
        )
      ) : data.acaoTipo === 'CONVERSAR_IA' &&
        (data.config?.aguardarResposta as boolean | undefined) !== false &&
        Number(data.config?.timeoutHoras ?? 0) > 0 ? (
        // Conversar com IA aguardando resposta + timeout: 2 saídas distintas.
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="classificou"
            className="!w-2 !h-2 !bg-success !border-bg !border-2"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="timeout"
            className="!w-2 !h-2 !bg-warning !border-bg !border-2"
            style={{ left: '70%' }}
          />
          <div
            className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] leading-none text-success whitespace-nowrap pointer-events-none"
            style={{ left: '30%' }}
          >
            🟢 classificou
          </div>
          <div
            className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] leading-none text-warning whitespace-nowrap pointer-events-none"
            style={{ left: '70%' }}
          >
            🟠 timeout
          </div>
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

/**
 * Aresta com botão "×" pra REMOVER a conexão (antes só dava via Backspace —
 * ninguém descobria). Mostra o label (Sim/Não dos ramos de condição) + o botão.
 */
function EdgeRemovivel({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan flex items-center gap-1"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          {label != null && label !== '' && (
            <span className="rounded bg-surface border border-border px-1.5 py-0.5 text-[10px] font-medium text-text">
              {label}
            </span>
          )}
          <button
            type="button"
            title="Remover conexão"
            aria-label="Remover conexão"
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-danger/40 bg-surface text-danger text-xs leading-none hover:bg-danger hover:text-white transition-colors shadow-sm"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { removivel: EdgeRemovivel };

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

/**
 * Remove saídas duplicadas EXATAS do config de um nó na hidratação. Saída repetida
 * gera handle id/React key duplicado no NodeCard (React Flow exige id único por nó)
 * e faz remover/renomear (por valor) afetar as duas de uma vez. Dedup no load evita
 * esse estado inconsistente (a validação já impede criar novas duplicatas).
 */
function dedupConfigSaidas(config: Record<string, unknown>): Record<string, unknown> {
  const saidas = config['saidas'];
  if (!Array.isArray(saidas)) return config;
  const unicas = Array.from(new Set(saidas as string[]));
  return unicas.length === saidas.length ? config : { ...config, saidas: unicas };
}

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
  // Teste manual — dispara o fluxo agora (do nó gatilho), sem esperar cron/evento.
  const [testarAberto, setTestarAberto] = useState(false);
  const [testLeadId, setTestLeadId] = useState('');
  const [testando, setTestando] = useState(false);
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
      const isRoteador =
        src?.tipo === 'CONDICAO' &&
        (src.config as Record<string, unknown> | undefined)?.['modo'] === 'roteador';
      return {
        id: e.id ?? `edge-${i}`,
        source: e.sourceNoId,
        target: e.targetNoId,
        label: e.label ?? undefined,
        // O sourceHandle não é persistido (só o label). No ROTEADOR o label JÁ é o
        // id do handle (valor da saída / 'default') — usa direto. No SIMPLES,
        // Sim→true / Não→false. (Antes mapeava Sim/Não cego e quebrava roteador
        // com saída chamada "Sim"/"Não".)
        sourceHandle: isRoteador
          ? (e.label ?? undefined)
          : e.label === 'Sim'
            ? 'true'
            : e.label === 'Não'
              ? 'false'
              : (e.label ?? undefined),
        type: 'removivel',
        animated: true,
        style: { stroke: 'var(--border-strong)' },
      };
    });
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
            type: 'removivel',
            animated: true,
            style: { stroke: 'var(--border-strong)' },
            // Condição simples: true→Sim, false→Não. Roteador: o label É o id do
            // handle (o valor da saída, ou 'default'). Demais nós: sem label.
            label:
              conn.sourceHandle === 'true'
                ? 'Sim'
                : conn.sourceHandle === 'false'
                  ? 'Não'
                  : (conn.sourceHandle ?? undefined),
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
      // Fonte da verdade do gatilho = o nó TRIGGER (o inspector edita ali). Antes
      // o save só olhava o estado top-level e ignorava troca feita no inspector,
      // gravando o triggerTipo antigo e deixando a config de filtro órfã.
      const triggerNode = nodes.find((n) => n.data.tipo === 'TRIGGER');
      const ttFinal =
        (triggerNode?.data.triggerTipo as TriggerTipo | undefined) ?? (triggerTipo || undefined);
      if (ttFinal) payload.triggerTipo = ttFinal;
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

  // Dispara um teste manual (POST /fluxos/testar) — salva antes se estiver sujo.
  async function runTeste() {
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
      setTestarAberto(false);
    } catch (err) {
      toast.error('Falha ao testar', err instanceof ApiError ? err.message : undefined);
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
          <Button
            variant="secondary"
            className="hidden md:inline-flex"
            onClick={() => setTestarAberto(true)}
            leftIcon={<Play className="h-3.5 w-3.5" />}
            data-testid="fluxo-testar"
            title="Dispara o fluxo agora (do nó gatilho), sem esperar o cron/evento"
          >
            Testar
          </Button>
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

      {testarAberto && (
        <div
          className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setTestarAberto(false)}
        >
          <div
            className="bg-bg-alt border border-border rounded-lg shadow-xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-text mb-1">Testar fluxo</h3>
            <p className="text-[11px] text-muted mb-3">
              Dispara o fluxo <strong>agora</strong> (a partir do nó gatilho), sem esperar o
              cron/evento. Salva o fluxo antes, se houver mudanças.
            </p>
            <label className="text-xs text-muted">ID do lead (opcional)</label>
            <Input
              value={testLeadId}
              onChange={(e) => setTestLeadId(e.target.value)}
              placeholder="cole o ID do lead aqui"
              data-testid="fluxo-test-lead"
            />
            <p className="text-[10px] text-muted mt-1">
              Vazio = fluxo sem lead (ex: webhook). Pegue o ID na tela de Leads.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setTestarAberto(false)}>
                Cancelar
              </Button>
              <Button
                onClick={runTeste}
                loading={testando}
                leftIcon={<Play className="h-3.5 w-3.5" />}
              >
                Rodar teste
              </Button>
            </div>
          </div>
        </div>
      )}

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
                  const tt = e.target.value as TriggerTipo | '';
                  setTriggerTipo(tt);
                  // Sincroniza o nó TRIGGER pra o inspector mostrar a config do gatilho.
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.data.tipo === 'TRIGGER'
                        ? { ...n, data: { ...n.data, triggerTipo: tt || undefined } }
                        : n,
                    ),
                  );
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
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            colorMode="dark"
            defaultEdgeOptions={{
              type: 'removivel',
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
              onRemoveSaida={removeSaidaDoNoSelecionado}
              onRenameSaida={renameSaidaDoNoSelecionado}
              onChangeModo={trocarModoDoNoSelecionado}
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

/**
 * Linha editável de uma saída do roteador. Renomeia in-place (commit no Enter/blur);
 * se o pai rejeitar (duplicado/reservado), reverte o texto pro valor anterior.
 */
function SaidaEditavel({
  valor,
  onCommit,
  onRemove,
}: {
  valor: string;
  onCommit: (novo: string) => boolean;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(valor);
  useEffect(() => {
    setDraft(valor);
  }, [valor]);
  const commit = () => {
    const v = draft.trim();
    if (!v || v === valor) {
      setDraft(valor);
      return;
    }
    if (!onCommit(v)) setDraft(valor);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="flex-1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(valor);
          }
        }}
      />
      <IconButton
        aria-label="Remover saída"
        variant="ghost"
        size="sm"
        icon={<Trash2 />}
        onClick={onRemove}
      />
    </div>
  );
}

/** Editor visual da Condição: modo Simples (true/false) ou Roteador (N saídas). */
function CondicaoEditor({
  data,
  onUpdate,
  variaveis,
  onRemoveSaida,
  onRenameSaida,
  onChangeModo,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  variaveis: Array<{ id: string; chave: string }>;
  onRemoveSaida: (valor: string) => void;
  onRenameSaida: (antigo: string, novo: string) => void;
  onChangeModo: (novoModo: string) => void;
}) {
  const toast = useToast();
  const [novaSaida, setNovaSaida] = useState('');
  const modo = (data.config.modo as string) ?? 'simples';
  const saidas = (data.config.saidas as string[]) ?? [];
  const setCfg = (patch: Record<string, unknown>) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, ...patch } }));
  // Reservados: colidiriam com os handles implícitos (true/false do simples e o
  // 'default' do roteador) e quebrariam o roteamento da aresta.
  const RESERVADOS = ['default', 'true', 'false', 'sim', 'não', 'nao'];
  // Normaliza igual ao matching do backend (avaliarCondicao: trim + toLowerCase),
  // colapsando espaços internos. Duas saídas que normalizam igual roteariam ambas
  // pro PRIMEIRO match no motor → a segunda viraria ramo morto. Por isso bloqueamos.
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const valido = (v: string, ignorar?: string): boolean => {
    if (saidas.some((s) => s !== ignorar && norm(s) === norm(v))) {
      toast.error('Essa saída já existe (ignorando maiúsculas/espaços)');
      return false;
    }
    if (RESERVADOS.includes(norm(v))) {
      toast.error(`"${v}" é um nome reservado — escolha outro valor pra saída`);
      return false;
    }
    return true;
  };
  const addSaida = () => {
    const v = novaSaida.trim();
    if (!v || !valido(v)) return;
    setCfg({ saidas: [...saidas, v] });
    setNovaSaida('');
  };
  // Renomeia in-place (config + arestas via callback do pai). Retorna se aplicou —
  // a linha editável reverte o texto quando rejeitado (duplicado/reservado).
  const handleRename = (antigo: string, novo: string): boolean => {
    const v = novo.trim();
    if (!v || v === antigo) return false;
    if (!valido(v, antigo)) return false;
    onRenameSaida(antigo, v);
    return true;
  };
  return (
    <>
      <Field label="Modo">
        <Select size="sm" value={modo} onChange={(e) => onChangeModo(e.target.value)}>
          <option value="simples">Simples (Sim / Não)</option>
          <option value="roteador">Roteador (uma saída por valor)</option>
        </Select>
      </Field>
      {modo === 'roteador' ? (
        <>
          <Field
            label="Variável"
            hint="Roteia pelo valor desta variável (ex: classificacao_final)"
          >
            <div>
              <Input
                list="fluxo-variaveis"
                value={(data.config.variavel as string) ?? ''}
                onChange={(e) => setCfg({ variavel: e.target.value })}
                placeholder="classificacao_final"
              />
              <datalist id="fluxo-variaveis">
                {variaveis.map((v) => (
                  <option key={v.id} value={v.chave} />
                ))}
              </datalist>
            </div>
          </Field>
          <Field label="Saídas (valores)" hint="Cada valor vira uma saída. Há sempre a saída 'default'.">
            <div className="flex flex-col gap-1.5">
              {saidas.map((s, i) => (
                <SaidaEditavel
                  key={`${s}-${i}`}
                  valor={s}
                  onCommit={(novo) => handleRename(s, novo)}
                  onRemove={() => onRemoveSaida(s)}
                />
              ))}
              <div className="flex items-center gap-1.5">
                <Input
                  value={novaSaida}
                  onChange={(e) => setNovaSaida(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSaida();
                    }
                  }}
                  placeholder="Ex: Forte Sinergia (Enter)"
                />
                <Button type="button" size="sm" variant="secondary" onClick={addSaida}>
                  +
                </Button>
              </div>
              <span className="text-[11px] text-muted">
                No canvas, conecte cada saída (o rótulo do valor) ao próximo nó.
              </span>
            </div>
          </Field>
        </>
      ) : (
        <>
          <Field label="Variável / campo" hint="Ex: classificacao_final, lead.etapa">
            <div>
              <Input
                list="fluxo-variaveis"
                value={(data.config.campo as string) ?? ''}
                onChange={(e) => setCfg({ campo: e.target.value })}
                placeholder="classificacao_final"
              />
              <datalist id="fluxo-variaveis">
                {variaveis.map((v) => (
                  <option key={v.id} value={v.chave} />
                ))}
              </datalist>
            </div>
          </Field>
          <Field label="Operador">
            <Select
              size="sm"
              value={(data.config.operador as string) ?? 'eq'}
              onChange={(e) => setCfg({ operador: e.target.value })}
            >
              <option value="eq">= igual</option>
              <option value="neq">≠ diferente</option>
              <option value="contains">contém</option>
              <option value="gt">&gt; maior</option>
              <option value="lt">&lt; menor</option>
              <option value="gte">≥ maior ou igual</option>
              <option value="lte">≤ menor ou igual</option>
            </Select>
          </Field>
          <Field label="Valor">
            <Input
              value={((data.config.valor as string | number | undefined) ?? '').toString()}
              onChange={(e) => setCfg({ valor: e.target.value })}
            />
          </Field>
        </>
      )}
    </>
  );
}

/** Campo de destinatários do e-mail: usuário / papel / e-mail fixo / variável. */
function DestinatariosField({
  data,
  onUpdate,
  usuarios,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  usuarios: Array<{ id: string; nome: string; role: string }>;
}) {
  const [novoEmail, setNovoEmail] = useState('');
  const lista = (data.config.destinatarios as string[]) ?? [];
  const PAPEIS = ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP'];
  const setLista = (next: string[]) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, destinatarios: next } }));
  const add = (tok: string) => {
    const v = tok.trim();
    if (v && !lista.includes(v)) setLista([...lista, v]);
  };
  const rotulo = (tok: string) => {
    if (tok.startsWith('user:')) {
      const u = usuarios.find((x) => x.id === tok.slice(5));
      return u ? `👤 ${u.nome}` : tok;
    }
    if (tok.startsWith('papel:')) return `🏷️ ${tok.slice(6)}`;
    return tok;
  };
  return (
    <Field label="Destinatários" hint="Usuário, papel, e-mail fixo ou {{variável}}">
      <div className="flex flex-col gap-1.5">
        {lista.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lista.map((tok, i) => (
              <span
                key={`${tok}-${i}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border bg-surface"
              >
                {rotulo(tok)}
                <button
                  type="button"
                  aria-label="Remover destinatário"
                  onClick={() => setLista(lista.filter((_, j) => j !== i))}
                  className="text-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <Select
          size="sm"
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">+ adicionar usuário / papel…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={`user:${u.id}`}>
              👤 {u.nome}
            </option>
          ))}
          {PAPEIS.map((p) => (
            <option key={p} value={`papel:${p}`}>
              🏷️ Papel: {p}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            value={novoEmail}
            onChange={(e) => setNovoEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(novoEmail);
                setNovoEmail('');
              }
            }}
            placeholder="e-mail fixo ou {{variavel}} (Enter)"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              add(novoEmail);
              setNovoEmail('');
            }}
          >
            +
          </Button>
        </div>
      </div>
    </Field>
  );
}

function NodeInspector({
  node,
  onUpdate,
  onDelete,
  onRemoveSaida,
  onRenameSaida,
  onChangeModo,
}: {
  node: FlowNode;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  onDelete: () => void;
  onRemoveSaida: (valor: string) => void;
  onRenameSaida: (antigo: string, novo: string) => void;
  onChangeModo: (novoModo: string) => void;
}) {
  const { data } = node;
  // Listas pros seletores das ações novas (orquestração Fase B).
  const { data: tags } = useApiQuery<Array<{ id: string; nome: string }>>('/tags');
  const { data: prompts } = useApiQuery<Array<{ id: string; nome: string; isPadrao?: boolean }>>(
    '/mullerbot/prompts',
  );
  const { data: funis } = useApiQuery<
    Array<{ id: string; nome: string; etapas: Array<{ id: string; nome: string }> }>
  >('/funis');
  const etapasOpts = (funis ?? []).flatMap((f) =>
    (f.etapas ?? []).map((e) => ({ id: e.id, label: `${f.nome} · ${e.nome}` })),
  );
  // Usuários (responsável/destinatário) + variáveis customizadas (roteador/condição).
  const { data: usersResp } = useApiQuery<{
    data: Array<{ id: string; nome: string; role: string }>;
  }>('/users?limit=100&status=ATIVO');
  const usuarios = usersResp?.data ?? [];
  const { data: variaveisData } = useApiQuery<
    Array<{ id: string; chave: string }> | { data: Array<{ id: string; chave: string }> }
  >('/orquestracao/variaveis');
  const variaveis = Array.isArray(variaveisData) ? variaveisData : (variaveisData?.data ?? []);
  // Contatos WhatsApp da inbox — pro destinatário "contato salvo" do Enviar WhatsApp.
  const { data: contatosWa } = useApiQuery<Array<{ telefone: string; nome: string }>>(
    '/inbox/contatos-whatsapp',
  );
  /** Etapas de UM funil — pros dropdowns dependentes do funil escolhido. */
  const etapasDoFunil = (funilId?: string) =>
    (funis ?? []).find((f) => f.id === funilId)?.etapas ?? [];
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

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'MENSAGEM_CANAL' && (
          <p className="text-[11px] text-muted">
            O fluxo recebe <code className="text-text">{'{{canal}}'}</code>{' '}
            (whatsapp/instagram/...). Use um nó <strong>Condição</strong> com campo{' '}
            <code className="text-text">canal</code> pra rotear por canal.
          </p>
        )}

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'WEBHOOK_RECEBIDO' && (
          <WebhookTriggerConfig />
        )}

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'LEAD_ETAPA_MUDOU' && (
          <>
            <Field label="Funil" hint="Qual funil observar">
              <Select
                size="sm"
                value={(data.config.funil as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    // trocar o funil limpa as etapas (podem não existir no novo)
                    config: {
                      ...d.config,
                      funil: e.target.value || undefined,
                      paraEtapa: undefined,
                      deEtapa: undefined,
                    },
                  }))
                }
              >
                <option value="">Selecionar funil…</option>
                {(funis ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Para etapa" hint="Dispara quando o lead ENTRA nesta etapa">
              <Select
                size="sm"
                value={(data.config.paraEtapa as string) ?? ''}
                disabled={!data.config.funil}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, paraEtapa: e.target.value || undefined } }))
                }
              >
                <option value="">
                  {data.config.funil ? 'Selecionar etapa…' : 'Escolha o funil primeiro'}
                </option>
                {etapasDoFunil(data.config.funil as string | undefined).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="De etapa (opcional)"
              hint="Só dispara se veio desta etapa. Vazio = qualquer origem"
            >
              <Select
                size="sm"
                value={(data.config.deEtapa as string) ?? ''}
                disabled={!data.config.funil}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, deEtapa: e.target.value || undefined } }))
                }
              >
                <option value="">Qualquer origem</option>
                {etapasDoFunil(data.config.funil as string | undefined).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </>
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
          <CondicaoEditor
            data={data}
            onUpdate={onUpdate}
            variaveis={variaveis}
            onRemoveSaida={onRemoveSaida}
            onRenameSaida={onRenameSaida}
            onChangeModo={onChangeModo}
          />
        )}

        {data.acaoTipo === 'ENVIAR_WHATSAPP' && (
          <>
            <Field label="Destinatário">
              <Select
                size="sm"
                value={(data.config.destinatarioModo as string) ?? 'lead'}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, destinatarioModo: e.target.value },
                  }))
                }
              >
                <option value="lead">Lead / cliente da conversa</option>
                <option value="numero">Número específico</option>
                <option value="contato">Contato salvo (inbox)</option>
              </Select>
            </Field>
            {(data.config.destinatarioModo as string) === 'numero' && (
              <Field label="Número (com DDI)" hint="Ex: +55 11 99999-9999">
                <Input
                  value={(data.config.destinatarioNumero as string) ?? ''}
                  onChange={(e) =>
                    onUpdate((d) => ({
                      ...d,
                      config: { ...d.config, destinatarioNumero: e.target.value },
                    }))
                  }
                  placeholder="+55 11 99999-9999"
                />
              </Field>
            )}
            {(data.config.destinatarioModo as string) === 'contato' && (
              <Field label="Contato" hint="Conversas de WhatsApp da inbox">
                <Select
                  size="sm"
                  value={(data.config.destinatarioContato as string) ?? ''}
                  onChange={(e) =>
                    onUpdate((d) => ({
                      ...d,
                      config: { ...d.config, destinatarioContato: e.target.value },
                    }))
                  }
                >
                  <option value="">Selecionar…</option>
                  {/* Preserva o contato salvo mesmo se a lista ainda não carregou. */}
                  {(data.config.destinatarioContato as string) &&
                    !(contatosWa ?? []).some(
                      (c) => c.telefone === (data.config.destinatarioContato as string),
                    ) && (
                      <option value={data.config.destinatarioContato as string}>
                        {data.config.destinatarioContato as string}
                      </option>
                    )}
                  {(contatosWa ?? []).map((c) => (
                    <option key={c.telefone} value={c.telefone}>
                      {c.nome} · {c.telefone}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
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
          </>
        )}

        {data.acaoTipo === 'ENVIAR_EMAIL' && (
          <>
            <DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />
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

        {data.acaoTipo === 'MOVER_LEAD_ETAPA' && (
          <Field label="Etapa de destino" hint="Etapa do funil pra onde o lead vai">
            <Select
              size="sm"
              value={(data.config.funilEtapaId as string) ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({
                  ...d,
                  config: { ...d.config, funilEtapaId: e.target.value || undefined },
                }))
              }
            >
              <option value="">Selecionar etapa…</option>
              {etapasOpts.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {data.acaoTipo === 'CRIAR_TAREFA' && (
          <>
            <Field label="Título da tarefa" hint="Aceita {{nome}}, {{cidade}}…">
              <Input
                value={(data.config.titulo as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, titulo: e.target.value } }))
                }
              />
            </Field>
            <Field label="Descrição (opcional)">
              <Textarea
                rows={3}
                value={(data.config.descricao as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, descricao: e.target.value } }))
                }
              />
            </Field>
            <Field label="Responsável" hint="Vazio = rep do cliente / admin">
              <Select
                size="sm"
                value={(data.config.responsavelId as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, responsavelId: e.target.value || undefined },
                  }))
                }
              >
                <option value="">Automático (rep do cliente)</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prazo (dias a partir de hoje)" hint="0 = hoje">
              <Input
                type="number"
                min={0}
                value={(data.config.diasApartirDeHoje as number) ?? 0}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, diasApartirDeHoje: Number(e.target.value) },
                  }))
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

        {data.acaoTipo === 'MUDAR_TAG' && (
          <>
            <Field label="Operação">
              <Select
                size="sm"
                value={(data.config.operacao as string) ?? 'adicionar'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, operacao: e.target.value } }))
                }
              >
                <option value="adicionar">Adicionar tag</option>
                <option value="remover">Remover tag</option>
              </Select>
            </Field>
            <Field label="Tag" hint="Escolha uma tag (sempre mostra todas ao clicar)">
              <Select
                size="sm"
                value={(data.config.tagNome as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, tagNome: e.target.value } }))
                }
              >
                <option value="">Selecionar…</option>
                {/* Preserva uma tag salva que não esteja (mais) na lista. */}
                {(data.config.tagNome as string) &&
                  !(tags ?? []).some((t) => t.nome === (data.config.tagNome as string)) && (
                    <option value={data.config.tagNome as string}>
                      {data.config.tagNome as string}
                    </option>
                  )}
                {(tags ?? []).map((t) => (
                  <option key={t.id} value={t.nome}>
                    {t.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {data.acaoTipo === 'CONVERSAR_IA' && (
          <>
            <Field label="Prompt" hint="Da biblioteca de prompts. Vazio = prompt padrão da empresa.">
              <Select
                size="sm"
                value={(data.config.promptId as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, promptId: e.target.value || undefined },
                  }))
                }
              >
                <option value="">Prompt padrão da empresa</option>
                {(prompts ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.isPadrao ? ' (padrão)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Aguardar resposta do lead?">
              <Select
                size="sm"
                value={((data.config.aguardarResposta as boolean | undefined) ?? true) ? 'sim' : 'nao'}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, aguardarResposta: e.target.value === 'sim' },
                  }))
                }
              >
                <option value="sim">Sim — pausa até o lead responder</option>
                <option value="nao">Não — segue o fluxo</option>
              </Select>
            </Field>
            <Field label="Timeout (horas)">
              <Input
                type="number"
                min={1}
                value={(data.config.timeoutHoras as number) ?? 24}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, timeoutHoras: Number(e.target.value) },
                  }))
                }
              />
            </Field>
            {(data.config.aguardarResposta as boolean | undefined) !== false &&
              Number(data.config.timeoutHoras ?? 0) > 0 && (
                <p className="text-[11px] text-muted">
                  Com timeout, o nó tem <strong>2 saídas</strong> no canvas: 🟢{' '}
                  <strong>classificou</strong> (IA concluiu) e 🟠 <strong>timeout</strong> (passou o
                  prazo sem resposta) — conecte cada uma a um caminho.
                </p>
              )}
            <Field
              label="Variáveis que a IA pode gravar"
              hint="Separe por vírgula (ex: classificacao, canal). Vazio = livre."
            >
              <Input
                value={
                  Array.isArray(data.config.variaveisGravadas)
                    ? (data.config.variaveisGravadas as string[]).join(', ')
                    : ''
                }
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: {
                      ...d.config,
                      variaveisGravadas: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  }))
                }
                placeholder="classificacao, canal, potencial_pedidos"
              />
            </Field>
          </>
        )}

        {data.acaoTipo === 'LIBERAR_LOTE' && (
          <>
            <Field label="Etapa de origem">
              <Select
                size="sm"
                value={(data.config.etapaOrigemId as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, etapaOrigemId: e.target.value } }))
                }
              >
                <option value="">Selecionar…</option>
                {etapasOpts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Etapa de destino">
              <Select
                size="sm"
                value={(data.config.etapaDestinoId as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, etapaDestinoId: e.target.value } }))
                }
              >
                <option value="">Selecionar…</option>
                {etapasOpts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantidade por execução" hint="Anti-sobrecarga — ex: 50 leads/vez">
              <Input
                type="number"
                min={1}
                max={500}
                value={(data.config.quantidade as number) ?? 50}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, quantidade: Number(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="Critério de ordem" hint="Em que ordem os leads saem da origem">
              <Select
                size="sm"
                value={(data.config.criterioOrdem as string) ?? 'antigos'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, criterioOrdem: e.target.value } }))
                }
              >
                <option value="antigos">Mais antigos primeiro</option>
                <option value="novos">Mais novos primeiro</option>
                <option value="custom">Por campo customizado</option>
              </Select>
            </Field>
            {(data.config.criterioOrdem as string) === 'custom' && (
              <div className="flex gap-2">
                <Field label="Campo (variável)" hint="ex: prioridade_leo">
                  <Input
                    value={(data.config.campoOrdem as string) ?? ''}
                    onChange={(e) =>
                      onUpdate((d) => ({ ...d, config: { ...d.config, campoOrdem: e.target.value } }))
                    }
                    placeholder="prioridade_leo"
                  />
                </Field>
                <Field label="Direção">
                  <Select
                    size="sm"
                    value={(data.config.ordemDir as string) ?? 'asc'}
                    onChange={(e) =>
                      onUpdate((d) => ({ ...d, config: { ...d.config, ordemDir: e.target.value } }))
                    }
                  >
                    <option value="asc">Crescente (ASC)</option>
                    <option value="desc">Decrescente (DESC)</option>
                  </Select>
                </Field>
              </div>
            )}
            <Field
              label="Excluir leads com tag"
              hint="Clique pra marcar — leads com qualquer uma são ignorados (ex: pausado)"
            >
              <div className="flex flex-wrap gap-1.5">
                {(tags ?? []).length === 0 && (
                  <span className="text-[11px] text-muted">Nenhuma tag cadastrada</span>
                )}
                {(tags ?? []).map((t) => {
                  const sel = ((data.config.filtroExcluiTag as string[]) ?? []).includes(t.nome);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        onUpdate((d) => {
                          const atual = (d.config.filtroExcluiTag as string[]) ?? [];
                          const next = atual.includes(t.nome)
                            ? atual.filter((n) => n !== t.nome)
                            : [...atual, t.nome];
                          return { ...d, config: { ...d.config, filtroExcluiTag: next } };
                        })
                      }
                      className={cn(
                        'text-[11px] px-2 py-1 rounded-md border transition-colors',
                        sel
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-text border-border hover:border-border-strong',
                      )}
                    >
                      {t.nome}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field
              label="Só liberar leads com WhatsApp"
              hint="Pula leads sem número — não joga na etapa de abordagem quem a IA não consegue contatar"
            >
              <Select
                value={(data.config.filtroSoComWhatsapp as boolean | undefined) ? 'sim' : 'nao'}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, filtroSoComWhatsapp: e.target.value === 'sim' },
                  }))
                }
              >
                <option value="nao">Não — libera todos da etapa</option>
                <option value="sim">Sim — só quem tem número de WhatsApp</option>
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

function WebhookTriggerConfig() {
  const toast = useToast();
  const { data: webhooks, refetch } = useApiQuery<
    Array<{ id: string; nome: string; token: string }>
  >('/orquestracao/webhooks');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

  async function criar() {
    if (!nome.trim()) return;
    setBusy(true);
    try {
      await api.post('/orquestracao/webhooks', { nome: nome.trim() });
      setNome('');
      refetch();
    } catch (err) {
      toast.error('Falha ao criar webhook', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  async function remover(id: string) {
    try {
      await api.delete(`/orquestracao/webhooks/${id}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted">
        Crie um webhook e cole a URL no sistema externo. Cada POST dispara este fluxo — o
        corpo do request vira <code className="text-text">{'{{custom.*}}'}</code>.
      </p>
      <div className="flex gap-1.5">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do webhook"
        />
        <Button size="sm" loading={busy} disabled={!nome.trim()} onClick={() => void criar()}>
          Criar
        </Button>
      </div>
      {(webhooks ?? []).map((w) => {
        const url = `${apiBase}/webhooks/fluxo/${w.token}`;
        return (
          <div key={w.id} className="rounded-md border border-border p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text">{w.nome}</span>
              <button
                type="button"
                onClick={() => void remover(w.id)}
                className="text-danger hover:underline"
              >
                remover
              </button>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <code className="flex-1 truncate text-muted">{url}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(url);
                  toast.success('URL copiada');
                }}
                className="text-primary hover:underline shrink-0"
              >
                copiar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function defaultConfig(item: PaletteItem): Record<string, unknown> {
  if (item.tipo === 'DELAY') return { quantidade: 1, unidade: 'horas' };
  if (item.tipo === 'CONDICAO') return { modo: 'simples', operador: 'eq' };
  if (item.acaoTipo === 'ENVIAR_WHATSAPP') return { mensagem: '', destinatarioModo: 'lead' };
  if (item.acaoTipo === 'ENVIAR_EMAIL') return { assunto: '', corpo: '' };
  if (item.acaoTipo === 'WEBHOOK_EXTERNO') return { url: '', method: 'POST' };
  if (item.acaoTipo === 'MUDAR_TAG') return { operacao: 'adicionar', tagNome: '' };
  if (item.acaoTipo === 'CONVERSAR_IA') return { aguardarResposta: true, timeoutHoras: 24 };
  if (item.acaoTipo === 'LIBERAR_LOTE') return { quantidade: 50 };
  // Trava simples — sem config visível. Desliga o bot na conversa (botLigado=false).
  // O backend (acaoPausarIa) trata religar:true como religar; ausente = pausar.
  if (item.acaoTipo === 'PAUSAR_IA') return { acao: 'pausar_ia' };
  return {};
}

// Re-export pra outros consumirem
useMemo;
