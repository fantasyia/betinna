import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Users,
  Filter,
  Save,
  X as XIcon,
  ArrowLeft,
  AlertCircle,
  PieChart,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import {
  Avatar,
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
import { cn } from '@/lib/cn';

type Logic = 'AND' | 'OR';
type FiltroCampo =
  | 'status'
  | 'omieStatus'
  | 'segmento'
  | 'cidade'
  | 'uf'
  | 'regiao'
  | 'score'
  | 'prazoPagamento'
  | 'limiteCredito'
  | 'representanteId';
type FiltroOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

interface Condition {
  campo: FiltroCampo;
  op: FiltroOp;
  valor: string | number | string[] | number[];
}

interface Regras {
  logic: Logic;
  conditions: Condition[];
}

interface Segmento {
  id: string;
  nome: string;
  descricao?: string | null;
  regrasJson: Regras;
  cor?: string | null;
  ativo: boolean;
  atualizadoEm: string;
}

interface PreviewResult {
  clientes: Array<{
    id: string;
    nome: string;
    cnpj?: string | null;
    cidade?: string | null;
    uf?: string | null;
    status: string;
    score: number;
    representante?: { nome: string } | null;
  }>;
  total: number;
}

const CAMPO_LABEL: Record<FiltroCampo, string> = {
  status: 'Status',
  omieStatus: 'Status OMIE',
  segmento: 'Segmento',
  cidade: 'Cidade',
  uf: 'UF',
  regiao: 'Região',
  score: 'Score',
  prazoPagamento: 'Prazo (dias)',
  limiteCredito: 'Limite crédito',
  representanteId: 'Representante (ID)',
};

const OP_LABEL: Record<FiltroOp, string> = {
  eq: 'igual a',
  neq: 'diferente de',
  gt: 'maior que',
  gte: 'maior ou igual',
  lt: 'menor que',
  lte: 'menor ou igual',
  in: 'em (lista)',
  contains: 'contém',
};

const CAMPO_OPS: Record<FiltroCampo, FiltroOp[]> = {
  status: ['eq', 'neq', 'in'],
  omieStatus: ['eq', 'neq'],
  segmento: ['eq', 'neq', 'contains'],
  cidade: ['eq', 'neq', 'contains'],
  uf: ['eq', 'neq', 'in'],
  regiao: ['eq', 'neq', 'contains'],
  score: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  prazoPagamento: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  limiteCredito: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  representanteId: ['eq', 'neq'],
};

export default function SegmentosPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<Segmento[]>('/segmentos');
  const [editing, setEditing] = useState<Segmento | 'new' | null>(null);
  const [viewing, setViewing] = useState<Segmento | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Segmento | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/segmentos/${confirmDelete.id}`);
      toast.success('Segmento removido');
      refetch();
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Falha', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (viewing) {
    return <SegmentoViewer segmento={viewing} onClose={() => setViewing(null)} />;
  }

  if (editing) {
    return (
      <SegmentoBuilder
        segmento={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refetch();
        }}
      />
    );
  }

  return (
    <PageLayout
      title="Segmentação"
      description="Crie grupos de clientes com filtros encadeáveis. Use pra campanhas, fluxos ou análise."
      actions={
        <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Novo segmento
        </Button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<PieChart />}
            title="Nenhum segmento criado"
            description="Crie um segmento pra agrupar clientes por status, score, região, etc."
            action={
              <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Criar primeiro segmento
              </Button>
            }
          />
        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.map((s) => (
              <SegmentoCard
                key={s.id}
                segmento={s}
                onView={() => setViewing(s)}
                onEdit={() => setEditing(s)}
                onDelete={() => setConfirmDelete(s)}
              />
            ))}
          </div>
        ) : null}
      </StateView>

      {confirmDelete && (
        <Dialog
          open
          onClose={() => setConfirmDelete(null)}
          title="Excluir segmento?"
          description={`"${confirmDelete.nome}" será removido.`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={busy} onClick={handleDelete}>
                Confirmar
              </Button>
            </>
          }
        >
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm">
            Esta ação não pode ser desfeita. Os clientes não são afetados.
          </div>
        </Dialog>
      )}
    </PageLayout>
  );
}

function SegmentoCard({
  segmento,
  onView,
  onEdit,
  onDelete,
}: {
  segmento: Segmento;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card padding="md" className="flex flex-col gap-3 group">
      <header className="flex items-start gap-3">
        <div
          className="h-9 w-9 rounded-md shrink-0 flex items-center justify-center"
          style={{ backgroundColor: (segmento.cor ?? '#facc15') + '20' }}
        >
          <Filter className="h-4 w-4" style={{ color: segmento.cor ?? '#facc15' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-md font-semibold text-text tracking-tight truncate">
            {segmento.nome}
          </h3>
          {segmento.descricao && (
            <p className="text-xs text-text-subtle line-clamp-2 mt-0.5">{segmento.descricao}</p>
          )}
        </div>
        <Badge variant={segmento.ativo ? 'success' : 'neutral'} size="sm">
          {segmento.ativo ? 'Ativo' : 'Inativo'}
        </Badge>
      </header>

      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <Badge variant="outline" size="sm">
          {segmento.regrasJson.conditions.length} regras
        </Badge>
        <Badge variant="outline" size="sm">
          {segmento.regrasJson.logic}
        </Badge>
      </div>

      <footer className="flex items-center justify-between pt-3 border-t border-border">
        <Button variant="secondary" size="sm" onClick={onView} leftIcon={<Users className="h-3 w-3" />}>
          Ver clientes
        </Button>
        <div className="flex items-center gap-1">
          <IconButton aria-label="Editar" variant="ghost" size="sm" icon={<Edit3 />} onClick={onEdit} />
          <IconButton
            aria-label="Excluir"
            variant="ghost"
            size="sm"
            icon={<Trash2 className="text-danger" />}
            onClick={onDelete}
          />
        </div>
      </footer>
    </Card>
  );
}

// ─── Viewer (lista clientes do segmento) ───────────────

function SegmentoViewer({
  segmento,
  onClose,
}: {
  segmento: Segmento;
  onClose: () => void;
}) {
  const { data, loading, error } = useApiQuery<PreviewResult>(`/segmentos/${segmento.id}/clientes?limit=100`);

  return (
    <PageLayout
      title={segmento.nome}
      description={segmento.descricao ?? undefined}
      actions={
        <Button variant="secondary" onClick={onClose} leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}>
          Voltar
        </Button>
      }
    >
      <StateView loading={loading} error={error}>
        {data && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Badge variant="primary">{data.total.toLocaleString('pt-BR')} clientes</Badge>
              <span className="text-sm text-muted">
                Mostrando primeiros {Math.min(data.clientes.length, 100)}
              </span>
            </div>
            <Card padding="none" className="overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-alt">
                    <Th>Cliente</Th>
                    <Th>Local</Th>
                    <Th>Representante</Th>
                    <Th>Status</Th>
                    <Th align="right">Score</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.clientes.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-surface-hover">
                      <Td>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar name={c.nome} size="sm" />
                          <div className="min-w-0">
                            <div className="text-sm text-text truncate">{c.nome}</div>
                            {c.cnpj && (
                              <div className="text-[11px] text-muted tabular">{c.cnpj}</div>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-sm text-text-subtle">
                          {c.cidade ?? '—'}
                          {c.uf && <span className="text-muted">/{c.uf}</span>}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm text-text-subtle">
                          {c.representante?.nome ?? '—'}
                        </span>
                      </Td>
                      <Td>
                        <Badge variant="neutral">{c.status}</Badge>
                      </Td>
                      <Td align="right">
                        <span className="text-sm font-semibold tabular text-text">{c.score}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </StateView>
    </PageLayout>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      className={cn('px-4 py-2.5 align-middle', align === 'right' ? 'text-right' : 'text-left')}
    >
      {children}
    </td>
  );
}

// ─── Builder (full page) ──────────────────────────────

function SegmentoBuilder({
  segmento,
  onClose,
  onSaved,
}: {
  segmento: Segmento | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = segmento === null;
  const toast = useToast();
  const [nome, setNome] = useState(segmento?.nome ?? '');
  const [descricao, setDescricao] = useState(segmento?.descricao ?? '');
  const [cor, setCor] = useState(segmento?.cor ?? '#facc15');
  const [ativo, setAtivo] = useState(segmento?.ativo ?? true);
  const [logic, setLogic] = useState<Logic>(segmento?.regrasJson?.logic ?? 'AND');
  const [conditions, setConditions] = useState<Condition[]>(
    segmento?.regrasJson?.conditions ?? [{ campo: 'status', op: 'eq', valor: 'ATIVO' }],
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-preview com debounce
  const regrasKey = useMemo(() => JSON.stringify({ logic, conditions }), [logic, conditions]);
  useEffect(() => {
    const t = setTimeout(() => {
      void runPreview();
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regrasKey]);

  async function runPreview() {
    if (conditions.length === 0) return;
    setPreviewLoading(true);
    try {
      const r = await api.post<PreviewResult>('/segmentos/preview', {
        regras: { logic, conditions },
        limit: 20,
      });
      setPreview(r);
    } catch (err) {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function addCondition() {
    setConditions((cs) => [...cs, { campo: 'status', op: 'eq', valor: '' }]);
  }
  function updateCondition(idx: number, patch: Partial<Condition>) {
    setConditions((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeCondition(idx: number) {
    setConditions((cs) => cs.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setError(null);
    if (nome.trim().length < 2) {
      setError('Nome obrigatório.');
      return;
    }
    if (conditions.length === 0) {
      setError('Adicione ao menos 1 condição.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        regras: { logic, conditions },
        cor,
        ativo,
      };
      if (isNew) await api.post('/segmentos', payload);
      else await api.put(`/segmentos/${segmento!.id}`, payload);
      toast.success(isNew ? 'Segmento criado' : 'Segmento atualizado');
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] bg-bg flex flex-col">
      <header className="flex items-center gap-3 px-4 h-[56px] border-b border-border bg-bg-alt shrink-0">
        <IconButton aria-label="Voltar" variant="ghost" icon={<ArrowLeft />} onClick={onClose} />
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do segmento"
          className="max-w-md font-semibold"
        />
        <input
          type="color"
          value={cor}
          onChange={(e) => setCor(e.target.value)}
          className="h-8 w-12 rounded-md border border-border-strong bg-transparent cursor-pointer"
          title="Cor"
        />
        <Badge variant={ativo ? 'success' : 'neutral'}>{ativo ? 'Ativo' : 'Inativo'}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving} leftIcon={<Save className="h-3.5 w-3.5" />}>
            Salvar
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Builder de regras */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            <Card padding="md">
              <Field label="Descrição">
                <Textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={2}
                  placeholder="Pra que esse segmento serve?"
                />
              </Field>
            </Card>

            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-text">Regras</h3>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">Combinar com:</span>
                  <Select size="sm" value={logic} onChange={(e) => setLogic(e.target.value as Logic)}>
                    <option value="AND">TODAS (E)</option>
                    <option value="OR">QUALQUER UMA (OU)</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {conditions.map((c, idx) => (
                  <ConditionRow
                    key={idx}
                    condition={c}
                    showLogic={idx > 0}
                    logic={logic}
                    onChange={(patch) => updateCondition(idx, patch)}
                    onRemove={() => removeCondition(idx)}
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={addCondition}
                leftIcon={<Plus className="h-3 w-3" />}
                className="mt-2"
              >
                Adicionar regra
              </Button>

              {error && (
                <div className="mt-3 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}
            </Card>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="seg-ativo"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="accent-primary"
              />
              <label htmlFor="seg-ativo" className="text-sm text-text">
                Segmento ativo
              </label>
            </div>
          </div>
        </main>

        {/* Preview ao vivo */}
        <aside className="w-[360px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto p-4">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3">
            Preview ao vivo
          </h4>
          {previewLoading ? (
            <div className="text-sm text-muted text-center py-8">Calculando…</div>
          ) : preview ? (
            <>
              <div className="text-center py-3 rounded-md bg-surface border border-border mb-3">
                <div className="text-3xl font-bold text-text tabular tracking-tight">
                  {preview.total.toLocaleString('pt-BR')}
                </div>
                <div className="text-[11px] text-muted">clientes batem com essas regras</div>
              </div>
              <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                Primeiros {Math.min(preview.clientes.length, 20)}
              </h5>
              <div className="flex flex-col gap-1.5">
                {preview.clientes.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface border border-border"
                  >
                    <Avatar name={c.nome} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text truncate">{c.nome}</div>
                      {c.cidade && (
                        <div className="text-[10px] text-muted truncate">
                          {c.cidade}
                          {c.uf && `/${c.uf}`}
                        </div>
                      )}
                    </div>
                    <Badge variant="neutral" size="sm">
                      {c.score}
                    </Badge>
                  </div>
                ))}
                {preview.clientes.length === 0 && (
                  <p className="text-sm text-muted-light italic text-center py-4">
                    Nenhum cliente bate com essas regras.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted text-center py-8">Aguardando regras…</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  showLogic,
  logic,
  onChange,
  onRemove,
}: {
  condition: Condition;
  showLogic: boolean;
  logic: Logic;
  onChange: (patch: Partial<Condition>) => void;
  onRemove: () => void;
}) {
  const availableOps = CAMPO_OPS[condition.campo];

  return (
    <div className="flex items-center gap-2">
      {showLogic && (
        <Badge variant="primary" size="sm" className="shrink-0">
          {logic}
        </Badge>
      )}
      {!showLogic && (
        <span className="text-[10px] text-muted-light uppercase shrink-0 w-9 text-center">
          QUANDO
        </span>
      )}
      <Select
        size="sm"
        value={condition.campo}
        onChange={(e) => onChange({ campo: e.target.value as FiltroCampo })}
        className="min-w-[140px]"
      >
        {(Object.keys(CAMPO_LABEL) as FiltroCampo[]).map((c) => (
          <option key={c} value={c}>
            {CAMPO_LABEL[c]}
          </option>
        ))}
      </Select>
      <Select
        size="sm"
        value={condition.op}
        onChange={(e) => onChange({ op: e.target.value as FiltroOp })}
        className="min-w-[120px]"
      >
        {availableOps.map((op) => (
          <option key={op} value={op}>
            {OP_LABEL[op]}
          </option>
        ))}
      </Select>
      <Input
        size="sm"
        value={Array.isArray(condition.valor) ? condition.valor.join(',') : String(condition.valor)}
        onChange={(e) => {
          // Pra `in`, usa lista separada por vírgula
          if (condition.op === 'in') {
            onChange({ valor: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) });
          } else {
            // Tenta converter pra número se campo é numérico
            const numCampos = ['score', 'prazoPagamento', 'limiteCredito'];
            const v = e.target.value;
            if (numCampos.includes(condition.campo) && v !== '') {
              const n = Number(v);
              onChange({ valor: Number.isFinite(n) ? n : v });
            } else {
              onChange({ valor: v });
            }
          }
        }}
        placeholder={condition.op === 'in' ? 'valor1, valor2, ...' : 'Valor'}
        className="flex-1 min-w-0"
      />
      <IconButton
        aria-label="Remover regra"
        variant="ghost"
        size="sm"
        icon={<XIcon className="text-danger" />}
        onClick={onRemove}
      />
    </div>
  );
}
