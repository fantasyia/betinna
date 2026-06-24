import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Trash2,
  AlertCircle,
  GripVertical,
  Pencil,
  CheckCircle2,
  Target,
  Funnel,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { cn } from '@/lib/cn';

/**
 * FunisPage — CRUD de funis customizados (inspirado em SimplesDesk).
 *
 * Cada empresa cadastra múltiplos funis (Vendas B2B, Inbound, Reativação,
 * etc), cada um com etapas próprias (nome, cor, ordem, tipo).
 *
 * Layout: lista de funis à esquerda; editor de etapas à direita quando
 * algum funil estiver selecionado.
 */

type EtapaTipo = 'ATIVA' | 'GANHO' | 'PERDIDO';

interface FunilEtapa {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
  tipo: EtapaTipo;
  probabilidade: number;
  slaDias: number | null;
  slaHoras?: number | null;
  capacidadeMaxima?: number | null;
}

interface Funil {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  ordem: number;
  ativo: boolean;
  isPadrao: boolean;
  tagsPermitidas?: string[] | null;
  etapas: FunilEtapa[];
  _count?: { leads: number };
}

const ETAPA_TIPO_LABEL: Record<EtapaTipo, string> = {
  ATIVA: 'Ativa',
  GANHO: 'Ganho (terminal +)',
  PERDIDO: 'Perdido (terminal −)',
};

const ETAPA_TIPO_VARIANT: Record<EtapaTipo, 'success' | 'danger' | 'primary'> = {
  ATIVA: 'primary',
  GANHO: 'success',
  PERDIDO: 'danger',
};

const CORES_SUGERIDAS = [
  '#201554',
  '#bd1fbf',
  '#2bcae5',
  '#5C88DA',
  '#2d8f5e',
  '#b07820',
  '#c43c3c',
  '#7c3aed',
  '#0891b2',
  '#6b6580',
];

export default function FunisPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<Funil[]>('/funis');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const [confirmAsync, ConfirmDialog] = useConfirm();

  // Auto-seleciona o padrão quando carrega
  useEffect(() => {
    if (selectedId || !data || data.length === 0) return;
    setSelectedId((data.find((f) => f.isPadrao) ?? data[0]).id);
  }, [data, selectedId]);

  const selected = useMemo(
    () => data?.find((f) => f.id === selectedId) ?? null,
    [data, selectedId],
  );

  async function excluirFunil(funil: Funil) {
    const ok = await confirmAsync({
      title: `Excluir o funil "${funil.nome}"?`,
      message:
        funil._count && funil._count.leads > 0
          ? `O funil tem ${funil._count.leads} lead(s). Mova-os antes de excluir.`
          : 'Excluir o funil + todas as etapas (não pode ser desfeito).',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/funis/${funil.id}`);
      toast.success('Funil excluído');
      setSelectedId(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <PageLayout
      title="Funis"
      description="Personalize as etapas do seu pipeline. Cada funil pode ter nome, cor e ordem próprios."
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => navigate('/leads')}
            leftIcon={<Target className="h-3.5 w-3.5" />}
          >
            Ver kanban
          </Button>
          <Button
            data-testid="funil-new-btn"
            onClick={() => setCreating(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Novo funil
          </Button>
        </>
      }
    >
      <CrmTabs />
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<Funnel />}
            title="Nenhum funil cadastrado"
            description="Crie seu primeiro funil pra começar a organizar os leads."
            action={
              <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Criar primeiro funil
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
            {/* Lista de funis */}
            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-semibold">
                Funis ({data?.length ?? 0})
              </div>
              <ul className="flex flex-col">
                {data?.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(f.id)}
                      data-testid={`funil-row-${f.id}`}
                      className={cn(
                        'w-full text-left flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 transition-colors',
                        selectedId === f.id
                          ? 'bg-primary/10 border-l-2 border-l-primary'
                          : 'hover:bg-surface-hover',
                      )}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: f.cor }}
                        aria-hidden
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-text truncate">
                            {f.nome}
                          </span>
                          {f.isPadrao && (
                            <Badge variant="primary" size="sm">
                              padrão
                            </Badge>
                          )}
                          {!f.ativo && (
                            <Badge variant="neutral" size="sm">
                              inativo
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted">
                          {f.etapas.length} etapa{f.etapas.length === 1 ? '' : 's'}
                          {f._count && f._count.leads > 0 && (
                            <>
                              {' · '}
                              {f._count.leads} lead{f._count.leads === 1 ? '' : 's'}
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Editor do selecionado */}
            {selected ? (
              <FunilEditor
                funil={selected}
                onChanged={refetch}
                onDelete={() => excluirFunil(selected)}
              />
            ) : (
              <Card padding="lg" className="flex items-center justify-center text-muted">
                Selecione um funil pra editar
              </Card>
            )}
          </div>
        )}
      </StateView>

      {creating && (
        <FunilFormDialog
          funil={null}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSelectedId(id);
            refetch();
          }}
        />
      )}
      {ConfirmDialog}
    </PageLayout>
  );
}

// ─── Editor do funil selecionado ───────────────────────────────────

function FunilEditor({
  funil,
  onChanged,
  onDelete,
}: {
  funil: Funil;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [editingInfo, setEditingInfo] = useState(false);
  const [creatingEtapa, setCreatingEtapa] = useState(false);
  const [editingEtapa, setEditingEtapa] = useState<FunilEtapa | null>(null);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  // Optimistic order pra drag-drop de etapas
  const [orderedEtapas, setOrderedEtapas] = useState(funil.etapas);
  useEffect(() => {
    setOrderedEtapas(funil.etapas);
  }, [funil.etapas]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = orderedEtapas.findIndex((e) => e.id === active.id);
    const newIdx = orderedEtapas.findIndex((e) => e.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(orderedEtapas, oldIdx, newIdx);
    setOrderedEtapas(newOrder);
    try {
      await api.put(`/funis/${funil.id}/etapas/reordenar`, {
        etapaIds: newOrder.map((e) => e.id),
      });
      onChanged();
    } catch (err) {
      toast.error('Falha ao reordenar', err instanceof ApiError ? err.message : undefined);
      setOrderedEtapas(funil.etapas); // reverte
    }
  }

  async function removerEtapa(etapa: FunilEtapa) {
    const ok = await confirmAsync({
      title: `Excluir etapa "${etapa.nome}"?`,
      message: 'Não pode ser desfeito. Se houver leads na etapa, mova-os antes.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/funis/${funil.id}/etapas/${etapa.id}`);
      toast.success('Etapa removida');
      onChanged();
    } catch (err) {
      toast.error('Falha ao remover etapa', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ background: funil.cor }}
              aria-hidden
            />
            <h3 className="text-md font-semibold text-text truncate">{funil.nome}</h3>
            {funil.isPadrao && <Badge variant="primary">padrão</Badge>}
            {!funil.ativo && <Badge variant="neutral">inativo</Badge>}
          </div>
          {funil.descricao && (
            <p className="text-xs text-muted m-0 leading-snug">{funil.descricao}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditingInfo(true)}
            leftIcon={<Pencil className="h-3 w-3" />}
            data-testid="funil-edit-btn"
          >
            Editar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            leftIcon={<Trash2 className="h-3 w-3" />}
            data-testid="funil-delete-btn"
          >
            Excluir
          </Button>
        </div>
      </div>

      {/* Etapas */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Etapas ({orderedEtapas.length})
          </h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCreatingEtapa(true)}
            leftIcon={<Plus className="h-3 w-3" />}
            data-testid="etapa-new-btn"
          >
            Adicionar etapa
          </Button>
        </div>

        {orderedEtapas.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="Funil sem etapas"
            description="Adicione pelo menos uma etapa pra começar a usar este funil."
            action={
              <Button onClick={() => setCreatingEtapa(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Criar etapa
              </Button>
            }
            className="border-0"
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedEtapas.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-1.5">
                {orderedEtapas.map((etapa) => (
                  <SortableEtapaRow
                    key={etapa.id}
                    etapa={etapa}
                    onEdit={() => setEditingEtapa(etapa)}
                    onRemove={() => removerEtapa(etapa)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Dialogs */}
      {editingInfo && (
        <FunilFormDialog
          funil={funil}
          onClose={() => setEditingInfo(false)}
          onSaved={() => {
            setEditingInfo(false);
            onChanged();
          }}
        />
      )}
      {creatingEtapa && (
        <EtapaFormDialog
          funilId={funil.id}
          etapa={null}
          onClose={() => setCreatingEtapa(false)}
          onSaved={() => {
            setCreatingEtapa(false);
            onChanged();
          }}
        />
      )}
      {editingEtapa && (
        <EtapaFormDialog
          funilId={funil.id}
          etapa={editingEtapa}
          onClose={() => setEditingEtapa(null)}
          onSaved={() => {
            setEditingEtapa(null);
            onChanged();
          }}
        />
      )}
      {ConfirmDialog}
    </Card>
  );
}

// ─── Sortable row ──────────────────────────────────────────────────

function SortableEtapaRow({
  etapa,
  onEdit,
  onRemove,
}: {
  etapa: FunilEtapa;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: etapa.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 px-2.5 py-2 rounded-md border bg-surface',
        'hover:border-border-strong transition-colors',
        isDragging && 'opacity-50',
      )}
      data-testid={`etapa-row-${etapa.id}`}
    >
      <button
        type="button"
        aria-label="Arrastar"
        {...attributes}
        {...listeners}
        className="shrink-0 p-1 text-muted-light cursor-grab hover:text-text touch-none"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span
        className="h-3 w-3 rounded shrink-0"
        style={{ background: etapa.cor }}
        aria-hidden
      />
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-text">{etapa.nome}</span>
        <Badge variant={ETAPA_TIPO_VARIANT[etapa.tipo]} size="sm">
          {ETAPA_TIPO_LABEL[etapa.tipo]}
        </Badge>
        <span className="text-[10px] text-muted tabular">
          prob {etapa.probabilidade}%
          {etapa.slaHoras
            ? ` · SLA ${etapa.slaHoras}h`
            : etapa.slaDias
              ? ` · SLA ${etapa.slaDias}d`
              : ''}
          {etapa.capacidadeMaxima ? ` · cap ${etapa.capacidadeMaxima}` : ''}
        </span>
      </div>
      <IconButton
        aria-label="Editar etapa"
        variant="ghost"
        size="sm"
        icon={<Pencil className="h-3 w-3" />}
        onClick={onEdit}
        data-testid={`etapa-edit-${etapa.id}`}
      />
      <IconButton
        aria-label="Excluir etapa"
        variant="danger"
        size="sm"
        icon={<Trash2 className="h-3 w-3" />}
        onClick={onRemove}
        data-testid={`etapa-del-${etapa.id}`}
      />
    </li>
  );
}

// ─── Funil form dialog ─────────────────────────────────────────────

function FunilFormDialog({
  funil,
  onClose,
  onSaved,
}: {
  funil: Funil | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [nome, setNome] = useState(funil?.nome ?? '');
  const [descricao, setDescricao] = useState(funil?.descricao ?? '');
  const [cor, setCor] = useState(funil?.cor ?? '#201554');
  const [isPadrao, setIsPadrao] = useState(funil?.isPadrao ?? false);
  const [ativo, setAtivo] = useState(funil?.ativo ?? true);
  const [tagsPermitidas, setTagsPermitidas] = useState(
    funil?.tagsPermitidas?.join(', ') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!funil;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length === 0) {
      setError('Nome obrigatório.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: nome.trim(),
      cor,
      isPadrao,
      ativo,
    };
    if (descricao.trim()) payload.descricao = descricao.trim();
    // Allow-list de tags: vazio = null (todas permitidas); senão array de nomes.
    const tags = tagsPermitidas
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    payload.tagsPermitidas = tags.length > 0 ? tags : null;
    try {
      if (isEdit) {
        const r = await api.patch<{ id: string }>(`/funis/${funil!.id}`, payload);
        onSaved(r.id);
      } else {
        const r = await api.post<{ id: string }>('/funis', payload);
        onSaved(r.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? `Editar "${funil!.nome}"` : 'Novo funil'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="funil-form"
            data-testid="funil-save-btn"
            loading={busy}
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="funil-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Nome" required>
          <Input
            data-testid="funil-nome-input"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={100}
            autoFocus
            placeholder="Ex: Vendas B2B, Inbound, Reativação"
          />
        </Field>
        <Field label="Descrição" hint="Opcional. Aparece como ajuda no editor.">
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </Field>
        <Field label="Cor de destaque">
          <ColorPicker value={cor} onChange={setCor} />
        </Field>
        <Field
          label="Tags permitidas"
          hint="Opcional. Lista separada por vírgula. Vazio = todas as tags da empresa são permitidas neste funil."
        >
          <Input
            data-testid="funil-tags-input"
            value={tagsPermitidas}
            onChange={(e) => setTagsPermitidas(e.target.value)}
            placeholder="Ex: quente, recompra, vip"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isPadrao}
              onChange={(e) => setIsPadrao(e.target.checked)}
              data-testid="funil-padrao-cb"
            />
            <span>Funil padrão da empresa</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            <span>Ativo</span>
          </label>
        </div>
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

// ─── Etapa form dialog ─────────────────────────────────────────────

function EtapaFormDialog({
  funilId,
  etapa,
  onClose,
  onSaved,
}: {
  funilId: string;
  etapa: FunilEtapa | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(etapa?.nome ?? '');
  const [cor, setCor] = useState(etapa?.cor ?? '#7c3aed');
  const [tipo, setTipo] = useState<EtapaTipo>(etapa?.tipo ?? 'ATIVA');
  const [probabilidade, setProbabilidade] = useState(etapa?.probabilidade ?? 50);
  const [slaDias, setSlaDias] = useState(etapa?.slaDias?.toString() ?? '');
  const [slaHoras, setSlaHoras] = useState(etapa?.slaHoras?.toString() ?? '');
  const [capacidadeMaxima, setCapacidadeMaxima] = useState(
    etapa?.capacidadeMaxima?.toString() ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!etapa;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length === 0) {
      setError('Nome obrigatório.');
      return;
    }
    if (probabilidade < 0 || probabilidade > 100) {
      setError('Probabilidade deve estar entre 0 e 100.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: nome.trim(),
      cor,
      tipo,
      probabilidade,
    };
    if (slaDias.trim() && !Number.isNaN(Number(slaDias))) {
      payload.slaDias = Number(slaDias);
    } else {
      payload.slaDias = null;
    }
    payload.slaHoras =
      slaHoras.trim() && !Number.isNaN(Number(slaHoras)) ? Number(slaHoras) : null;
    payload.capacidadeMaxima =
      capacidadeMaxima.trim() && !Number.isNaN(Number(capacidadeMaxima))
        ? Number(capacidadeMaxima)
        : null;
    try {
      if (isEdit) {
        await api.patch(`/funis/${funilId}/etapas/${etapa!.id}`, payload);
      } else {
        await api.post(`/funis/${funilId}/etapas`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? `Editar etapa "${etapa!.nome}"` : 'Nova etapa'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="etapa-form"
            data-testid="etapa-save-btn"
            loading={busy}
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="etapa-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field label="Nome" required>
          <Input
            data-testid="etapa-nome-input"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            autoFocus
            placeholder="Ex: Em qualificação, Aguardando proposta, Fechado"
          />
        </Field>
        <Field
          label="Tipo"
          hint="ATIVA permite movimentação livre. GANHO/PERDIDO são terminais (exigem motivo)."
        >
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as EtapaTipo)}>
            <option value="ATIVA">Ativa</option>
            <option value="GANHO">Ganho (terminal positivo)</option>
            <option value="PERDIDO">Perdido (terminal negativo)</option>
          </Select>
        </Field>
        <Field label="Cor">
          <ColorPicker value={cor} onChange={setCor} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Probabilidade (%)" hint="Peso pro pipeline ponderado">
            <Input
              type="number"
              min={0}
              max={100}
              value={probabilidade}
              onChange={(e) => setProbabilidade(Number(e.target.value))}
              data-testid="etapa-prob-input"
            />
          </Field>
          <Field label="SLA (dias)" hint="Opcional. Aging começa após esse prazo.">
            <Input
              type="number"
              min={1}
              max={365}
              value={slaDias}
              onChange={(e) => setSlaDias(e.target.value)}
              placeholder="—"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="SLA (horas)"
            hint="Opcional. Tem precedência sobre o SLA em dias quando preenchido."
          >
            <Input
              type="number"
              min={1}
              max={8760}
              value={slaHoras}
              onChange={(e) => setSlaHoras(e.target.value)}
              data-testid="etapa-sla-horas-input"
              placeholder="—"
            />
          </Field>
          <Field
            label="Capacidade máxima"
            hint="Opcional. Teto de leads simultâneos nesta etapa (anti-sobrecarga)."
          >
            <Input
              type="number"
              min={1}
              max={100000}
              value={capacidadeMaxima}
              onChange={(e) => setCapacidadeMaxima(e.target.value)}
              data-testid="etapa-capacidade-input"
              placeholder="—"
            />
          </Field>
        </div>
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

// ─── Color picker ──────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        {CORES_SUGERIDAS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            onClick={() => onChange(c)}
            className={cn(
              'h-6 w-6 rounded-md border-2 transition-all',
              value.toLowerCase() === c.toLowerCase()
                ? 'border-text scale-110'
                : 'border-border hover:scale-105',
            )}
            style={{ background: c }}
          />
        ))}
      </div>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="!w-24 font-mono"
        maxLength={7}
        pattern="^#[0-9A-Fa-f]{6}$"
      />
    </div>
  );
}
