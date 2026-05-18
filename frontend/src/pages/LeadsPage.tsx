import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { maskTelefone, normalizeUF } from '@/lib/masks';
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
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  valorEstimado: number;
  canalOrigem: CanalOrigem;
  etapa: LeadEtapa;
  score: number;
  proximaAcao?: string | null;
  observacoes?: string | null;
  representante?: { id: string; nome: string } | null;
  criadoEm: string;
  etapaDesde?: string;
}

type KanbanResponse = Record<LeadEtapa, Lead[]>;

const ETAPAS_PIPELINE: LeadEtapa[] = [
  'NOVO',
  'QUALIFICANDO',
  'PROPOSTA',
  'NEGOCIACAO',
  'GANHO',
  'PERDIDO',
];

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

const ETAPA_ACCENT: Record<LeadEtapa, string> = {
  NOVO: 'var(--info)',
  QUALIFICANDO: 'var(--primary)',
  PROPOSTA: 'var(--warning)',
  NEGOCIACAO: 'var(--warning)',
  GANHO: 'var(--success)',
  PERDIDO: 'var(--danger)',
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

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtBRLCompact(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return fmtBRL(v);
}

// ─── Page principal ────────────────────────────────────────────────

export default function LeadsPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<KanbanResponse>('/leads/kanban');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  // Optimistic state: clone do data pra mover localmente durante drag
  const [optimistic, setOptimistic] = useState<KanbanResponse | null>(null);
  useEffect(() => {
    setOptimistic(data ?? null);
  }, [data]);

  // Drag state
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  // Reason dialog quando dropa em GANHO/PERDIDO
  const [reasonDialog, setReasonDialog] = useState<{
    lead: Lead;
    targetEtapa: LeadEtapa;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (!optimistic) return;
    for (const etapa of ETAPAS_PIPELINE) {
      const found = optimistic[etapa]?.find((l) => l.id === id);
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
    const targetEtapa = String(over.id) as LeadEtapa;
    if (!ETAPAS_PIPELINE.includes(targetEtapa)) return;

    // Encontra lead
    let lead: Lead | undefined;
    let sourceEtapa: LeadEtapa | undefined;
    for (const etapa of ETAPAS_PIPELINE) {
      const found = optimistic[etapa]?.find((l) => l.id === leadId);
      if (found) {
        lead = found;
        sourceEtapa = etapa;
        break;
      }
    }
    if (!lead || !sourceEtapa) return;
    if (sourceEtapa === targetEtapa) return;

    // Etapas que exigem motivo abrem dialog
    if (targetEtapa === 'GANHO' || targetEtapa === 'PERDIDO') {
      setReasonDialog({ lead, targetEtapa });
      return;
    }

    // Otimisticamente move
    moveLeadLocal(leadId, sourceEtapa, targetEtapa, lead);

    // Chama API
    try {
      await api.put(`/leads/${leadId}/etapa`, { etapa: targetEtapa });
      toast.success(`Movido para ${ETAPA_LABEL[targetEtapa]}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao mover lead', err instanceof ApiError ? err.message : undefined);
      // Reverte (refetch pegará o estado real)
      refetch();
    }
  }

  function moveLeadLocal(
    leadId: string,
    from: LeadEtapa,
    to: LeadEtapa,
    lead: Lead,
  ) {
    setOptimistic((cur) => {
      if (!cur) return cur;
      const next = { ...cur } as KanbanResponse;
      next[from] = (next[from] ?? []).filter((l) => l.id !== leadId);
      next[to] = [{ ...lead, etapa: to }, ...(next[to] ?? [])];
      return next;
    });
  }

  async function confirmMoveWithReason(motivo: string) {
    if (!reasonDialog) return;
    const { lead, targetEtapa } = reasonDialog;
    setReasonDialog(null);
    moveLeadLocal(lead.id, lead.etapa, targetEtapa, lead);
    try {
      await api.put(`/leads/${lead.id}/etapa`, { etapa: targetEtapa, motivo });
      toast.success(`Lead marcado como ${ETAPA_LABEL[targetEtapa]}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao mover', err instanceof ApiError ? err.message : undefined);
      refetch();
    }
  }

  const totals = useMemo(() => {
    if (!optimistic) return null;
    const totalLeads = ETAPAS_PIPELINE.reduce(
      (s, e) => s + (optimistic[e]?.length ?? 0),
      0,
    );
    const ativos = ['NOVO', 'QUALIFICANDO', 'PROPOSTA', 'NEGOCIACAO'] as LeadEtapa[];
    const totalAtivos = ativos.reduce(
      (s, e) =>
        s + (optimistic[e]?.reduce((ss, l) => ss + l.valorEstimado, 0) ?? 0),
      0,
    );
    return { totalLeads, totalAtivos };
  }, [optimistic]);

  return (
    <PageLayout
      title="Pipeline de leads"
      description={
        totals
          ? `${totals.totalLeads} leads · ${fmtBRLCompact(totals.totalAtivos)} em ativo`
          : undefined
      }
      actions={
        <Button
          data-testid="lead-new-btn"
          onClick={() => setCreating(true)}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
        >
          Novo lead
        </Button>
      }
    >
      <StateView loading={loading && !optimistic} error={error} onRetry={refetch}>
        {optimistic && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveLead(null)}
          >
            <div className="grid grid-cols-[repeat(6,minmax(260px,1fr))] gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {ETAPAS_PIPELINE.map((etapa) => (
                <KanbanColumn
                  key={etapa}
                  etapa={etapa}
                  leads={optimistic[etapa] ?? []}
                  onCardClick={setSelected}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead && (
                <div
                  className={cn(
                    'rotate-2 shadow-xl border border-primary/40 bg-surface rounded-md p-2.5',
                  )}
                >
                  <LeadCardInner lead={activeLead} dragging />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </StateView>

      {creating && (
        <LeadFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refetch();
          }}
        />
      )}

      {selected && (
        <LeadDetailDrawer
          lead={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}

      {reasonDialog && (
        <ReasonDialog
          targetEtapa={reasonDialog.targetEtapa}
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
  etapa: LeadEtapa;
  leads: Lead[];
  onCardClick: (l: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
  const total = leads.reduce((s, l) => s + l.valorEstimado, 0);

  return (
    <div
      data-testid={`kanban-col-${etapa}`}
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
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: ETAPA_ACCENT[etapa] }}
            aria-hidden
          />
          <span className="text-sm font-semibold text-text tracking-tight">
            {ETAPA_LABEL[etapa]}
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

function LeadDetailDrawer({
  lead,
  onClose,
  onChanged,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function callDelete() {
    setBusy(true);
    try {
      await api.delete(`/leads/${lead.id}`);
      toast.success('Lead excluído');
      onChanged();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
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
              loading={busy}
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
            <InfoCell icon={<User />} label="Representante">
              {lead.representante?.nome ?? 'sem rep'}
            </InfoCell>
            <InfoCell icon={<TrendingUp />} label="Canal de origem">
              {CANAL_LABEL[lead.canalOrigem]}
            </InfoCell>
          </div>
        </section>

        {lead.proximaAcao && (
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
              Próxima ação
            </h4>
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-text">
              {lead.proximaAcao}
            </div>
          </section>
        )}

        {lead.observacoes && (
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
              Observações
            </h4>
            <p className="text-sm text-text whitespace-pre-wrap m-0">
              {lead.observacoes}
            </p>
          </section>
        )}

        <p className="text-xs text-muted-light italic">
          Use o drag-and-drop no Kanban pra mover entre etapas.
        </p>
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

// ─── Reason dialog (GANHO/PERDIDO) ─────────────────────────────

function ReasonDialog({
  targetEtapa,
  leadNome,
  onCancel,
  onConfirm,
}: {
  targetEtapa: LeadEtapa;
  leadNome: string;
  onCancel: () => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Marcar como ${ETAPA_LABEL[targetEtapa]}?`}
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
            variant={targetEtapa === 'GANHO' ? 'primary' : 'danger'}
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
            targetEtapa === 'GANHO'
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
  onClose,
  onSaved,
}: {
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
          <Field label="Cidade">
            <Input value={form.cidade} onChange={(e) => setF('cidade', e.target.value)} />
          </Field>
          <Field label="UF" error={fieldErrors.uf}>
            <Input
              data-testid="lead-uf-input"
              maxLength={2}
              value={form.uf}
              onChange={(e) => setF('uf', normalizeUF(e.target.value))}
              placeholder="SP"
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
