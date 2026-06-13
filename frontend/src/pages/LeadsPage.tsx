import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Plus,
  MapPin,
  Briefcase,
  User,
  ArrowRight,
  Target,
  AlertCircle,
  Trash2,
  TrendingUp,
  ExternalLink,
  Settings,
  UserCog,
  CalendarPlus,
  Building2,
  Upload,
  X,
  Tag as TagIcon,
  Phone,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { ImportLeadsModal } from '@/components/ImportLeadsModal';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import {
  maskTelefone,
  formatMoeda as fmtBRL,
  formatMoedaCompacta as fmtBRLCompact,
} from '@/lib/masks';
import { UfSelect, CidadeSelect } from '@/components/LocalidadeSelects';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * LeadsPage v2 — Kanban visual com drag-drop entre etapas.
 *
 * - Colunas droppables (NOVO/QUALIFICANDO/PROPOSTA/NEGOCIACAO/GANHO/PERDIDO)
 * - Cards draggables com handle visual (cursor grab)
 * - Drop em GANHO/PERDIDO abre dialog pedindo motivo antes de confirmar
 * - Click no card abre detail drawer
 * - Header com filtros + métricas + botão novo lead
 */

type LeadEtapa = 'NOVO' | 'QUALIFICANDO' | 'PROPOSTA' | 'NEGOCIACAO' | 'GANHO' | 'PERDIDO';
type CanalOrigem =
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'FORMULARIO'
  | 'SITE'
  | 'EMAIL'
  | 'TELEFONE'
  | 'INDICACAO'
  | 'OUTRO';

interface Lead {
  id: string;
  nome: string;
  contatoNome?: string | null;
  contatoTelefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  valorEstimado: number;
  canalOrigem: CanalOrigem;
  etapa: LeadEtapa;
  funilId?: string | null;
  funilEtapaId?: string | null;
  score: number;
  proximaAcao?: string | null;
  observacoes?: string | null;
  representante?: { id: string; nome: string } | null;
  cliente?: { id: string; nome: string } | null;
  funil?: { id: string; nome: string; cor: string } | null;
  funilEtapa?: {
    id: string;
    nome: string;
    cor: string;
    ordem: number;
    tipo: FunilEtapaTipo;
    probabilidade: number;
  } | null;
  tags?: LeadTagRef[];
  criadoEm: string;
  etapaDesde?: string;
}

interface LeadTagRef {
  tag: { id: string; nome: string; cor: string; categoria?: string | null };
}

type FunilEtapaTipo = 'ATIVA' | 'GANHO' | 'PERDIDO';

interface FunilEtapaLite {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
  tipo: FunilEtapaTipo;
  probabilidade: number;
}

interface KanbanResponse {
  funil: {
    id: string | null;
    nome: string;
    cor: string;
    etapas: FunilEtapaLite[];
  };
  /** Mapa etapaId → leads (etapaId = FunilEtapa.id ou enum name no fallback) */
  grupos: Record<string, Lead[]>;
}

interface FunilListItem {
  id: string;
  nome: string;
  descricao?: string | null;
  cor: string;
  ordem: number;
  ativo: boolean;
  isPadrao: boolean;
  etapas: FunilEtapaLite[];
  _count?: { leads: number };
}

const ETAPA_LABEL: Record<LeadEtapa, string> = {
  NOVO: 'Novo',
  QUALIFICANDO: 'Qualificando',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  GANHO: 'Ganho',
  PERDIDO: 'Perdido',
};

const ETAPA_VARIANT: Record<
  LeadEtapa,
  'info' | 'primary' | 'warning' | 'warning' | 'success' | 'danger'
> = {
  NOVO: 'info',
  QUALIFICANDO: 'primary',
  PROPOSTA: 'warning',
  NEGOCIACAO: 'warning',
  GANHO: 'success',
  PERDIDO: 'danger',
};

const CANAIS: CanalOrigem[] = [
  'WHATSAPP',
  'INSTAGRAM',
  'FACEBOOK',
  'FORMULARIO',
  'SITE',
  'EMAIL',
  'TELEFONE',
  'INDICACAO',
  'OUTRO',
];

const CANAL_LABEL: Record<CanalOrigem, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  FORMULARIO: 'Formulário',
  SITE: 'Site',
  EMAIL: 'E-mail',
  TELEFONE: 'Telefone',
  INDICACAO: 'Indicação',
  OUTRO: 'Outro',
};

/** Chip de tag colorido (fundo translúcido na cor da tag). */
function TagChip({
  nome,
  cor,
  onRemove,
}: {
  nome: string;
  cor: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none"
      style={{ background: `${cor}1f`, color: cor, border: `1px solid ${cor}40` }}
    >
      <span className="truncate max-w-[120px]">{nome}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remover tag ${nome}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Page principal ────────────────────────────────────────────────

export default function LeadsPage() {
  const toast = useToast();
  // Lista de funis pro seletor
  const { data: funis } = useApiQuery<FunilListItem[]>('/funis');
  const [funilSelecionadoId, setFunilSelecionadoId] = useState<string | null>(null);

  // Quando carrega a lista, seta o padrão como selecionado se nenhum estiver
  useEffect(() => {
    if (funilSelecionadoId || !funis || funis.length === 0) return;
    const padrao = funis.find((f) => f.isPadrao && f.ativo) ?? funis.find((f) => f.ativo) ?? funis[0];
    setFunilSelecionadoId(padrao?.id ?? null);
  }, [funis, funilSelecionadoId]);

  const kanbanPath = funilSelecionadoId
    ? `/leads/kanban?funilId=${funilSelecionadoId}`
    : '/leads/kanban';
  const { data, loading, error, refetch } = useApiQuery<KanbanResponse>(kanbanPath);

  const role = useRole();
  const canImport = role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  // Optimistic state pra mover durante drag
  const [optimistic, setOptimistic] = useState<KanbanResponse | null>(null);
  useEffect(() => {
    setOptimistic(data ?? null);
  }, [data]);

  // Drag state
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  // Reason dialog quando dropa em etapa terminal (GANHO/PERDIDO)
  const [reasonDialog, setReasonDialog] = useState<{
    lead: Lead;
    targetEtapaId: string;
    targetEtapaNome: string;
    targetTipo: FunilEtapaTipo;
    sourceEtapaId: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (!optimistic) return;
    for (const etapaId of Object.keys(optimistic.grupos)) {
      const found = optimistic.grupos[etapaId]?.find((l) => l.id === id);
      if (found) {
        setActiveLead(found);
        return;
      }
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = event;
    if (!over || !optimistic) return;
    const leadId = String(active.id);
    const targetEtapaId = String(over.id);

    const targetEtapa = optimistic.funil.etapas.find((e) => e.id === targetEtapaId);
    if (!targetEtapa) return;

    // Encontra lead na grupos atual
    let lead: Lead | undefined;
    let sourceEtapaId: string | undefined;
    for (const etapaId of Object.keys(optimistic.grupos)) {
      const found = optimistic.grupos[etapaId]?.find((l) => l.id === leadId);
      if (found) {
        lead = found;
        sourceEtapaId = etapaId;
        break;
      }
    }
    if (!lead || !sourceEtapaId) return;
    if (sourceEtapaId === targetEtapaId) return;

    // Terminais (GANHO/PERDIDO) abrem dialog pedindo motivo
    if (targetEtapa.tipo === 'GANHO' || targetEtapa.tipo === 'PERDIDO') {
      setReasonDialog({
        lead,
        targetEtapaId,
        targetEtapaNome: targetEtapa.nome,
        targetTipo: targetEtapa.tipo,
        sourceEtapaId,
      });
      return;
    }

    moveLeadLocal(leadId, sourceEtapaId, targetEtapaId, lead);
    await persistMove(leadId, targetEtapaId, targetEtapa.nome);
  }

  function moveLeadLocal(
    leadId: string,
    fromEtapaId: string,
    toEtapaId: string,
    lead: Lead,
  ) {
    setOptimistic((cur) => {
      if (!cur) return cur;
      const grupos = { ...cur.grupos };
      grupos[fromEtapaId] = (grupos[fromEtapaId] ?? []).filter((l) => l.id !== leadId);
      grupos[toEtapaId] = [lead, ...(grupos[toEtapaId] ?? [])];
      return { ...cur, grupos };
    });
  }

  async function persistMove(leadId: string, etapaId: string, etapaNome: string, motivo?: string) {
    try {
      // Se etapaId é um cuid (funil customizado), envia funilEtapaId.
      // Senão, é o nome do enum legado.
      const isFunilEtapa = optimistic?.funil.id !== null;
      const payload: Record<string, unknown> = isFunilEtapa
        ? { funilEtapaId: etapaId }
        : { etapa: etapaId };
      if (motivo) payload.motivo = motivo;
      await api.put(`/leads/${leadId}/etapa`, payload);
      toast.success(`Movido para ${etapaNome}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao mover lead', err instanceof ApiError ? err.message : undefined);
      refetch();
    }
  }

  async function confirmMoveWithReason(motivo: string) {
    if (!reasonDialog) return;
    const { lead, targetEtapaId, targetEtapaNome, sourceEtapaId } = reasonDialog;
    setReasonDialog(null);
    moveLeadLocal(lead.id, sourceEtapaId, targetEtapaId, lead);
    await persistMove(lead.id, targetEtapaId, targetEtapaNome, motivo);
  }

  const totals = useMemo(() => {
    if (!optimistic) return null;
    const etapas = optimistic.funil.etapas;
    let totalLeads = 0;
    let totalAtivos = 0;
    for (const e of etapas) {
      const leads = optimistic.grupos[e.id] ?? [];
      totalLeads += leads.length;
      if (e.tipo === 'ATIVA') {
        totalAtivos += leads.reduce((s, l) => s + l.valorEstimado, 0);
      }
    }
    return { totalLeads, totalAtivos };
  }, [optimistic]);

  const cols = optimistic?.funil.etapas.length ?? 6;

  return (
    <PageLayout
      title="Funil"
      description={
        totals
          ? `${totals.totalLeads} leads · ${fmtBRLCompact(totals.totalAtivos)} em ativo`
          : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          {funis && funis.length > 1 && (
            <Select
              data-testid="funil-selector"
              value={funilSelecionadoId ?? ''}
              onChange={(e) => setFunilSelecionadoId(e.target.value)}
              className="min-w-[180px]"
            >
              {funis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                  {f.isPadrao ? ' (padrão)' : ''}
                </option>
              ))}
            </Select>
          )}
          <Link
            to="/funis"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium text-text-subtle hover:text-primary hover:bg-surface-hover transition-colors"
            data-testid="funis-manage-link"
          >
            <Settings className="h-3.5 w-3.5" />
            Funis
          </Link>
          {canImport && (
            <Button
              variant="secondary"
              data-testid="lead-import-btn"
              onClick={() => setImporting(true)}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              Importar
            </Button>
          )}
          <Button
            data-testid="lead-new-btn"
            onClick={() => setCreating(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Novo lead
          </Button>
        </div>
      }
    >
      <CrmTabs />
      <StateView loading={loading && !optimistic} error={error} onRetry={refetch}>
        {optimistic && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveLead(null)}
          >
            <div
              className="grid gap-3 overflow-x-auto pb-2 -mx-1 px-1"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(260px, 1fr))`,
              }}
            >
              {optimistic.funil.etapas.map((etapa) => (
                <KanbanColumn
                  key={etapa.id}
                  etapa={etapa}
                  leads={optimistic.grupos[etapa.id] ?? []}
                  onCardClick={setSelected}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead && (
                <div className="rotate-2 shadow-xl border border-primary/40 bg-surface rounded-md p-2.5">
                  <LeadCardInner lead={activeLead} dragging />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </StateView>

      {creating && (
        <LeadFormModal
          funilSelecionado={
            optimistic?.funil.id
              ? { id: optimistic.funil.id, etapas: optimistic.funil.etapas }
              : null
          }
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refetch();
          }}
        />
      )}

      {importing && (
        <ImportLeadsModal
          funis={funis ?? []}
          defaultFunilId={funilSelecionadoId}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            refetch();
          }}
        />
      )}

      {selected && (
        <LeadDetailDrawer
          lead={selected}
          etapas={optimistic?.funil.etapas ?? []}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
          onMutated={refetch}
        />
      )}

      {reasonDialog && (
        <ReasonDialog
          targetTipo={reasonDialog.targetTipo}
          targetNome={reasonDialog.targetEtapaNome}
          leadNome={reasonDialog.lead.nome}
          onCancel={() => setReasonDialog(null)}
          onConfirm={confirmMoveWithReason}
        />
      )}
    </PageLayout>
  );
}

// ─── Kanban column (droppable) ──────────────────────────────────

function KanbanColumn({
  etapa,
  leads,
  onCardClick,
}: {
  etapa: FunilEtapaLite;
  leads: Lead[];
  onCardClick: (l: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id });
  const total = leads.reduce((s, l) => s + l.valorEstimado, 0);

  return (
    <div
      data-testid={`kanban-col-${etapa.id}`}
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-2 rounded-lg p-2 min-h-[300px]',
        'bg-bg-alt border border-border',
        'transition-colors duration-100',
        isOver && 'bg-surface-hover border-border-strong',
      )}
    >
      <header className="flex items-center justify-between px-1 py-1 sticky top-0 z-10 bg-bg-alt rounded">
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: etapa.cor }}
            aria-hidden
          />
          <span
            className="text-sm font-semibold text-text tracking-tight truncate"
            title={etapa.nome}
          >
            {etapa.nome}
          </span>
          <span className="text-[10px] text-muted tabular bg-surface px-1.5 py-0.5 rounded-full border border-border">
            {leads.length}
          </span>
        </div>
        {total > 0 && (
          <span className="text-[11px] text-muted tabular">{fmtBRLCompact(total)}</span>
        )}
      </header>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Target className="h-4 w-4 text-muted-light mb-1" />
          <span className="text-[11px] text-muted-light">
            Solte um lead aqui
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {leads.map((l) => (
            <DraggableLeadCard key={l.id} lead={l} onClick={onCardClick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Draggable card ────────────────────────────────────────────

/**
 * Card inteiro é o "handle" de drag. O usuário pressiona o card e arrasta.
 * Para abrir o detalhe sem arrastar, há um botão "Abrir" no canto superior
 * direito (não conflita com drag — pointerdown nele para a propagação).
 *
 * dnd-kit's PointerSensor com distance=6 garante que cliques curtos não
 * disparam drag, então um click rápido em outra parte do card também
 * abre o detail.
 */
function DraggableLeadCard({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: (l: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`lead-card-${lead.id}`}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // Se foi marcado como vindo do botão "Abrir", deixa passar.
        // Senão, abre detail por click curto no card (drag não disparou).
        if (!(e.target as HTMLElement).closest('[data-no-drag]')) {
          onClick(lead);
        }
      }}
      className={cn(
        'group relative bg-surface border border-border rounded-md p-2.5',
        'hover:border-border-strong hover:bg-surface-hover transition-colors',
        'cursor-grab active:cursor-grabbing touch-none select-none',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
        isDragging && 'opacity-30',
      )}
    >
      <LeadCardInner lead={lead} onOpenDetail={() => onClick(lead)} />
    </div>
  );
}

function LeadCardInner({
  lead,
  onOpenDetail,
  dragging,
}: {
  lead: Lead;
  onOpenDetail?: () => void;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative',
        dragging && 'shadow-xl',
      )}
    >
      {/* Botão "Abrir" no canto — único elemento que NÃO dispara drag */}
      {onOpenDetail && (
        <button
          type="button"
          aria-label="Abrir detalhes"
          data-no-drag
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
          className={cn(
            'absolute top-0 right-0 p-1 rounded-md text-muted-light',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:text-primary hover:bg-surface-hover',
            'focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary/40',
          )}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}

      <div className="flex items-start gap-2 mb-1.5 pr-5">
        <Avatar name={lead.nome} size="xs" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text leading-tight truncate">
            {lead.nome}
          </div>
          {lead.contatoNome && (
            <div className="text-[10px] text-muted truncate">
              {lead.contatoNome}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {lead.cidade && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted">
            <MapPin className="h-2.5 w-2.5" />
            {lead.cidade}
            {lead.uf ? `/${lead.uf}` : ''}
          </span>
        )}
        {lead.segmento && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted">
            <Briefcase className="h-2.5 w-2.5" />
            {lead.segmento}
          </span>
        )}
      </div>

      {lead.tags && lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {lead.tags.slice(0, 4).map((t) => (
            <TagChip key={t.tag.id} nome={t.tag.nome} cor={t.tag.cor} />
          ))}
          {lead.tags.length > 4 && (
            <span className="text-[10px] text-muted-light">+{lead.tags.length - 4}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text tabular tracking-tight">
          {fmtBRLCompact(lead.valorEstimado)}
        </span>
        {lead.representante ? (
          <Avatar name={lead.representante.nome} size="xs" />
        ) : (
          <Badge variant="neutral" size="sm">
            sem rep
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─── Detail drawer ─────────────────────────────────────────────

interface RepOpt {
  id: string;
  nome: string;
  email?: string;
}

function LeadDetailDrawer({
  lead,
  etapas,
  onClose,
  onChanged,
  onMutated,
}: {
  lead: Lead;
  etapas: FunilEtapaLite[];
  onClose: () => void;
  onChanged: () => void;
  /** Refaz a busca do board SEM fechar o drawer (ex: editar tags). */
  onMutated: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rep, setRep] = useState<RepOpt | null>(lead.representante ?? null);
  const [proximaAcao, setProximaAcao] = useState(lead.proximaAcao ?? '');
  const [observacoes, setObservacoes] = useState(lead.observacoes ?? '');
  const [terminal, setTerminal] = useState<FunilEtapaLite | null>(null);
  const [motivo, setMotivo] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const fechado = lead.etapa === 'GANHO' || lead.etapa === 'PERDIDO';
  const etapaAtualId = lead.funilEtapaId ?? lead.etapa;
  const repMudou = (rep?.id ?? null) !== (lead.representante?.id ?? null);
  const notasMudaram =
    proximaAcao.trim() !== (lead.proximaAcao ?? '') ||
    observacoes.trim() !== (lead.observacoes ?? '');

  function apiMsg(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Falha na operação';
  }
  function etapaPayload(etapa: FunilEtapaLite, motivoArg?: string) {
    const isEnum = Object.prototype.hasOwnProperty.call(ETAPA_LABEL, etapa.id);
    const p: Record<string, unknown> = isEnum ? { etapa: etapa.id } : { funilEtapaId: etapa.id };
    if (motivoArg) p.motivo = motivoArg;
    return p;
  }

  async function mudarEtapa(etapa: FunilEtapaLite, motivoArg?: string) {
    setBusy('etapa');
    setActionError(null);
    try {
      await api.put(`/leads/${lead.id}/etapa`, etapaPayload(etapa, motivoArg));
      toast.success(`Movido para ${etapa.nome}`);
      onChanged();
    } catch (err) {
      setActionError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }
  function onClickEtapa(etapa: FunilEtapaLite) {
    if (etapa.id === etapaAtualId) return;
    if (etapa.tipo === 'GANHO' || etapa.tipo === 'PERDIDO') {
      setMotivo('');
      setTerminal(etapa);
      return;
    }
    void mudarEtapa(etapa);
  }

  async function salvarRep() {
    setBusy('rep');
    setActionError(null);
    try {
      await api.put(`/leads/${lead.id}/representante`, { representanteId: rep?.id ?? null });
      toast.success(rep ? `Atribuído a ${rep.nome}` : 'Representante removido');
      onChanged();
    } catch (err) {
      setActionError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function salvarNotas() {
    setBusy('notas');
    setActionError(null);
    try {
      await api.patch(`/leads/${lead.id}`, {
        proximaAcao: proximaAcao.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
      });
      toast.success('Lead atualizado');
      onChanged();
    } catch (err) {
      setActionError(apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function callDelete() {
    setBusy('delete');
    try {
      await api.delete(`/leads/${lead.id}`);
      toast.success('Lead excluído');
      onChanged();
    } catch (err) {
      toast.error('Falha ao excluir', apiMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={lead.nome}
      description={lead.contatoNome ?? undefined}
      width="md"
      footer={
        confirmDelete ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={callDelete}
              loading={busy === 'delete'}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Confirmar exclusão
            </Button>
          </>
        ) : (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Excluir lead
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Avatar name={lead.nome} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={ETAPA_VARIANT[lead.etapa]}>{ETAPA_LABEL[lead.etapa]}</Badge>
              <Badge variant="neutral" size="sm">
                Score {lead.score}
              </Badge>
            </div>
            <div className="text-2xl font-semibold text-text mt-2 tabular tracking-tight">
              {fmtBRL(lead.valorEstimado)}
            </div>
            <div className="text-[11px] text-muted">valor estimado</div>
          </div>
        </div>

        {/* F2 — Ações rápidas */}
        <div className="flex flex-wrap gap-2">
          {lead.cliente && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="lead-abrir-cliente"
              onClick={() => navigate(`/clientes/${lead.cliente!.id}`)}
              leftIcon={<Building2 className="h-3.5 w-3.5" />}
            >
              Abrir cliente
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            data-testid="lead-agendar"
            onClick={() => navigate('/agenda')}
            leftIcon={<CalendarPlus className="h-3.5 w-3.5" />}
          >
            Agendar visita
          </Button>
        </div>

        {/* F2 — Mudar etapa */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Mover etapa
          </h4>
          {terminal ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-text m-0">
                Motivo pra marcar como <strong>{terminal.nome}</strong>:
              </p>
              <Textarea
                data-testid="lead-etapa-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                placeholder="Ex: Cliente fechou / escolheu concorrente…"
              />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setTerminal(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant={terminal.tipo === 'GANHO' ? 'primary' : 'danger'}
                  disabled={motivo.trim().length === 0}
                  loading={busy === 'etapa'}
                  onClick={() => void mudarEtapa(terminal, motivo.trim())}
                >
                  Confirmar {terminal.nome}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {etapas.map((e) => {
                const atual = e.id === etapaAtualId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-testid={`lead-etapa-${e.id}`}
                    disabled={atual || busy === 'etapa'}
                    onClick={() => onClickEtapa(e)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      atual
                        ? 'border-primary bg-primary/10 text-primary cursor-default'
                        : 'border-border text-text-subtle hover:border-primary hover:text-primary',
                    )}
                  >
                    {e.nome}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* F2 — Representante */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Representante
          </h4>
          <AsyncCombobox<RepOpt>
            testId="lead-rep-picker"
            endpoint="/users"
            placeholder="Buscar representante…"
            getLabel={(r) => r.nome}
            getSubLabel={(r) => r.email ?? null}
            getId={(r) => r.id}
            value={rep}
            onChange={setRep}
            extraQuery={{ role: 'REP' }}
          />
          {repMudou && (
            <Button
              size="sm"
              className="mt-2"
              data-testid="lead-rep-salvar"
              loading={busy === 'rep'}
              onClick={() => void salvarRep()}
              leftIcon={<UserCog className="h-3.5 w-3.5" />}
            >
              {rep ? 'Atribuir representante' : 'Remover representante'}
            </Button>
          )}
        </section>

        {/* Tags (orquestração) */}
        <LeadTagsSection lead={lead} onMutated={onMutated} />

        {/* F2 — Próxima ação + observações (registrar contato/nota) */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Próxima ação & observações
          </h4>
          {fechado && (
            <p className="text-[11px] text-warning mb-1.5">
              Lead fechado — reabra (mova pra uma etapa ativa) pra editar texto.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Input
              data-testid="lead-proxima-acao"
              value={proximaAcao}
              onChange={(e) => setProximaAcao(e.target.value)}
              placeholder="Próxima ação — ex: ligar amanhã 10h"
              disabled={fechado}
            />
            <Textarea
              data-testid="lead-observacoes"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Observações / anotações do contato…"
              disabled={fechado}
            />
            {notasMudaram && !fechado && (
              <Button
                size="sm"
                className="self-start"
                data-testid="lead-notas-salvar"
                loading={busy === 'notas'}
                onClick={() => void salvarNotas()}
              >
                Salvar
              </Button>
            )}
          </div>
        </section>

        {/* Contexto */}
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Contexto
          </h4>
          <div className="grid grid-cols-2 gap-2.5 text-sm">
            <InfoCell icon={<MapPin />} label="Localização">
              {lead.cidade ? `${lead.cidade}${lead.uf ? '/' + lead.uf : ''}` : '—'}
            </InfoCell>
            <InfoCell icon={<Briefcase />} label="Segmento">
              {lead.segmento ?? '—'}
            </InfoCell>
            <InfoCell icon={<TrendingUp />} label="Canal de origem">
              {CANAL_LABEL[lead.canalOrigem]}
            </InfoCell>
            <InfoCell icon={<User />} label="Contato">
              {lead.contatoNome ?? '—'}
            </InfoCell>
            <InfoCell icon={<Phone />} label="WhatsApp">
              {lead.contatoTelefone ? (
                lead.contatoTelefone
              ) : (
                <span className="text-danger font-medium">
                  sem número — não recebe abordagem da IA
                </span>
              )}
            </InfoCell>
          </div>
        </section>

        {actionError && (
          <div
            data-testid="lead-action-error"
            className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {actionError}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function InfoCell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-alt px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted mb-1 [&>svg]:h-3 [&>svg]:w-3">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm text-text truncate">{children}</div>
    </div>
  );
}

// ─── Tags do lead (orquestração) ───────────────────────────────

interface TagOpt {
  id: string;
  nome: string;
  cor: string;
  categoria?: string | null;
}

function LeadTagsSection({ lead, onMutated }: { lead: Lead; onMutated: () => void }) {
  const toast = useToast();
  const { data: todasTags } = useApiQuery<TagOpt[]>('/tags');
  const [tags, setTags] = useState<LeadTagRef[]>(lead.tags ?? []);
  const [busy, setBusy] = useState(false);

  const aplicadasIds = new Set(tags.map((t) => t.tag.id));
  const disponiveis = (todasTags ?? []).filter((t) => !aplicadasIds.has(t.id));

  async function add(tagId: string) {
    if (!tagId) return;
    setBusy(true);
    try {
      const r = await api.post<Lead>(`/leads/${lead.id}/tags`, { tagId });
      setTags(r.tags ?? []);
      onMutated();
    } catch (err) {
      toast.error('Falha ao aplicar tag', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(tagId: string) {
    setBusy(true);
    try {
      const r = await api.delete<Lead>(`/leads/${lead.id}/tags/${tagId}`);
      setTags(r.tags ?? []);
      onMutated();
    } catch (err) {
      toast.error('Falha ao remover tag', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5">
        <TagIcon className="h-3 w-3" /> Tags
      </h4>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((t) => (
            <TagChip
              key={t.tag.id}
              nome={t.tag.nome}
              cor={t.tag.cor}
              onRemove={() => void remove(t.tag.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-light mb-2">Nenhuma tag aplicada.</p>
      )}
      <Select
        data-testid="lead-tag-add"
        value=""
        disabled={busy || disponiveis.length === 0}
        onChange={(e) => void add(e.target.value)}
      >
        <option value="">
          {disponiveis.length === 0 ? 'Sem tags disponíveis' : 'Adicionar tag…'}
        </option>
        {disponiveis.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nome}
          </option>
        ))}
      </Select>
      <Link
        to="/tags"
        className="text-[11px] text-primary hover:underline mt-1.5 inline-block"
      >
        Gerenciar tags →
      </Link>
    </section>
  );
}

// ─── Reason dialog (GANHO/PERDIDO) ─────────────────────────────

function ReasonDialog({
  targetTipo,
  targetNome,
  leadNome,
  onCancel,
  onConfirm,
}: {
  targetTipo: FunilEtapaTipo;
  targetNome: string;
  leadNome: string;
  onCancel: () => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const isGanho = targetTipo === 'GANHO';

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Marcar como ${targetNome}?`}
      description={`${leadNome} — informe o motivo pra registrar no histórico.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            disabled={motivo.trim().length === 0}
            onClick={() => onConfirm(motivo.trim())}
            variant={isGanho ? 'primary' : 'danger'}
          >
            Confirmar
          </Button>
        </>
      }
    >
      <Field label="Motivo" required>
        <Textarea
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder={
            isGanho
              ? 'Ex: Cliente fechou pedido após 3 reuniões. Decisor convencido pelo prazo.'
              : 'Ex: Cliente escolheu concorrente por preço.'
          }
          rows={4}
        />
      </Field>
    </Dialog>
  );
}

// ─── Form modal (Novo lead) ────────────────────────────────────

function LeadFormModal({
  funilSelecionado,
  onClose,
  onSaved,
}: {
  /** Funil selecionado no kanban — usa pra criar o lead no funil correto. */
  funilSelecionado: { id: string; etapas: FunilEtapaLite[] } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nome: '',
    cidade: '',
    uf: '',
    segmento: '',
    contatoNome: '',
    contatoEmail: '',
    contatoTelefone: '',
    valorEstimado: 0,
    canalOrigem: 'WHATSAPP' as CanalOrigem,
    proximaAcao: '',
    observacoes: '',
    score: 50,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setF<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
    // Limpa erro do campo conforme o user digita
    if (fieldErrors[k as string]) {
      setFieldErrors((errs) => {
        const next = { ...errs };
        delete next[k as string];
        return next;
      });
    }
  }

  /**
   * Validação client-side antes do submit. Espelho do createLeadSchema
   * do backend — falhar aqui dá feedback imediato sem perder o roundtrip.
   */
  function validar(): Record<string, string> {
    const errs: Record<string, string> = {};
    const nome = form.nome.trim();
    if (nome.length === 0) errs.nome = 'Nome é obrigatório';
    else if (nome.length < 2) errs.nome = 'Nome precisa ter no mínimo 2 caracteres';
    else if (nome.length > 200) errs.nome = 'Nome não pode passar de 200 caracteres';

    if (form.uf && form.uf.trim().length !== 0 && form.uf.trim().length !== 2) {
      errs.uf = 'UF precisa ter 2 caracteres';
    }
    if (form.contatoEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contatoEmail.trim())) {
      errs.contatoEmail = 'E-mail inválido';
    }
    if (form.valorEstimado < 0) {
      errs.valorEstimado = 'Valor não pode ser negativo';
    }
    if (form.score < 0 || form.score > 100) {
      errs.score = 'Score deve estar entre 0 e 100';
    }
    return errs;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validar();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      // Foca o primeiro campo com erro
      const first = document.querySelector<HTMLInputElement>(
        `[data-testid="lead-${Object.keys(errs)[0]}-input"]`,
      );
      first?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      canalOrigem: form.canalOrigem,
      valorEstimado: form.valorEstimado,
      score: form.score,
    };
    // Cria no funil selecionado, na 1ª etapa ATIVA (se disponível)
    if (funilSelecionado) {
      payload.funilId = funilSelecionado.id;
      const primeiraAtiva = funilSelecionado.etapas.find((e) => e.tipo === 'ATIVA');
      if (primeiraAtiva) payload.funilEtapaId = primeiraAtiva.id;
    }
    for (const k of [
      'cidade',
      'uf',
      'segmento',
      'contatoNome',
      'contatoEmail',
      'contatoTelefone',
      'proximaAcao',
      'observacoes',
    ] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      await api.post('/leads', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar lead');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Novo lead"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="lead-form"
            data-testid="lead-save-btn"
            loading={busy}
          >
            Criar lead
          </Button>
        </>
      }
    >
      <form id="lead-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Nome / Empresa" required error={fieldErrors.nome}>
          <Input
            data-testid="lead-nome-input"
            value={form.nome}
            onChange={(e) => setF('nome', e.target.value)}
            maxLength={200}
            placeholder="Razão social ou nome do prospect"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="UF" error={fieldErrors.uf}>
            <UfSelect
              testId="lead-uf-select"
              value={form.uf}
              onChange={(uf) => setForm((s) => ({ ...s, uf, cidade: '' }))}
            />
          </Field>
          <Field label="Cidade">
            <CidadeSelect
              testId="lead-cidade-select"
              uf={form.uf}
              value={form.cidade}
              onChange={(cidade) => setF('cidade', cidade)}
            />
          </Field>
          <Field label="Segmento">
            <Input value={form.segmento} onChange={(e) => setF('segmento', e.target.value)} />
          </Field>
          <Field label="Canal de origem">
            <Select
              value={form.canalOrigem}
              onChange={(e) => setF('canalOrigem', e.target.value as CanalOrigem)}
            >
              {CANAIS.map((c) => (
                <option key={c} value={c}>
                  {CANAL_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contato (nome)">
            <Input
              value={form.contatoNome}
              onChange={(e) => setF('contatoNome', e.target.value)}
            />
          </Field>
          <Field label="Telefone">
            <Input
              value={form.contatoTelefone}
              onChange={(e) => setF('contatoTelefone', maskTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              maxLength={15}
              inputMode="tel"
            />
          </Field>
          <Field label="E-mail" error={fieldErrors.contatoEmail}>
            <Input
              data-testid="lead-contatoEmail-input"
              type="email"
              value={form.contatoEmail}
              onChange={(e) => setF('contatoEmail', e.target.value)}
            />
          </Field>
          <Field label="Valor estimado" error={fieldErrors.valorEstimado}>
            <Input
              data-testid="lead-valorEstimado-input"
              type="number"
              min={0}
              step="0.01"
              value={form.valorEstimado}
              onChange={(e) => setF('valorEstimado', Number(e.target.value))}
            />
          </Field>
          <Field label="Score (0–100)" error={fieldErrors.score}>
            <Input
              data-testid="lead-score-input"
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(e) => setF('score', Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Próxima ação" hint="Ex: ligar amanhã às 10h">
          <Input
            value={form.proximaAcao}
            onChange={(e) => setF('proximaAcao', e.target.value)}
          />
        </Field>
        <Field label="Observações">
          <Textarea
            value={form.observacoes}
            onChange={(e) => setF('observacoes', e.target.value)}
            rows={3}
          />
        </Field>

        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// Tiny exports pra typescript não reclamar de unused
export type { Lead, LeadEtapa };
export { ArrowRight as _ArrowRight };
