import { useState } from 'react';
import {
  Target,
  Plus,
  Trash2,
  Edit3,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  User,
  Building2,
  AlertCircle,
} from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { StateView } from '@/components/StateView';
import { AsyncCombobox } from '@/components/AsyncCombobox';
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
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoedaCompacta as fmtBRLCompact } from '@/lib/masks';

interface MetaComProgresso {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: 'FATURAMENTO' | 'PEDIDOS';
  valorAlvo: number;
  alvoTipo: 'EMPRESA' | 'REP' | 'GERENTE';
  alvoId: string | null;
  alvoNome?: string;
  periodicidade: 'MES' | 'TRIMESTRE' | 'ANO';
  inicio: string;
  fim: string;
  ativo: boolean;
  atingido: number;
  progresso: number;
  risco: boolean;
}

interface UsuarioOpt {
  id: string;
  nome: string;
  email?: string;
  role?: string;
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch {
    return d;
  }
}

/**
 * Calcula dias restantes pra meta fechar.
 * Negativo se já passou; >365 trunca pra "1 ano+".
 */
function diasRestantes(fim: string): { texto: string; tone: 'normal' | 'warning' | 'danger' } {
  try {
    const fimMs = new Date(fim).getTime();
    const agora = Date.now();
    const dias = Math.ceil((fimMs - agora) / (1000 * 60 * 60 * 24));
    if (dias < 0) return { texto: 'Encerrada', tone: 'danger' };
    if (dias === 0) return { texto: 'Encerra hoje', tone: 'danger' };
    if (dias === 1) return { texto: '1 dia restante', tone: 'warning' };
    if (dias <= 7) return { texto: `${dias} dias restantes`, tone: 'warning' };
    if (dias > 365) return { texto: '1 ano+', tone: 'normal' };
    return { texto: `${dias} dias restantes`, tone: 'normal' };
  } catch {
    return { texto: '—', tone: 'normal' };
  }
}

export default function MetasPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<MetaComProgresso[]>('/metas');
  const [editing, setEditing] = useState<MetaComProgresso | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MetaComProgresso | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/metas/${confirmDelete.id}`);
      toast.success('Meta removida');
      refetch();
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Falha', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Stats agregadas
  const stats = data
    ? {
        ativas: data.filter((m) => m.ativo).length,
        atingidas: data.filter((m) => m.progresso >= 100).length,
        risco: data.filter((m) => m.ativo && m.risco).length,
      }
    : null;

  return (
    <PageLayout
      title="Metas"
      description="Defina alvos de faturamento ou pedidos por representante, gerente ou empresa toda."
      actions={
        <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Nova meta
        </Button>
      }
    >
      <VendasTabs />
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="Nenhuma meta definida"
            description="Crie metas pra acompanhar o desempenho do time. Aceita FATURAMENTO ou contagem de PEDIDOS."
            action={
              <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Criar primeira meta
              </Button>
            }
          />
        ) : data ? (
          <>
            {stats && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatPill label="Ativas" value={stats.ativas} icon={<Target />} />
                <StatPill
                  label="Atingidas"
                  value={stats.atingidas}
                  icon={<CheckCircle2 />}
                  tone="success"
                />
                <StatPill
                  label="Em risco"
                  value={stats.risco}
                  icon={<AlertTriangle />}
                  tone={stats.risco > 0 ? 'danger' : 'neutral'}
                />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {data.map((m) => (
                <MetaCard
                  key={m.id}
                  meta={m}
                  onEdit={() => setEditing(m)}
                  onDelete={() => setConfirmDelete(m)}
                />
              ))}
            </div>
          </>
        ) : null}
      </StateView>

      {editing && (
        <MetaFormDialog
          meta={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}

      {confirmDelete && (
        <Dialog
          open
          onClose={() => setConfirmDelete(null)}
          title="Excluir meta?"
          description={`"${confirmDelete.titulo}" será removida permanentemente.`}
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
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            Esta ação não pode ser desfeita.
          </div>
        </Dialog>
      )}
    </PageLayout>
  );
}

function StatPill({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  return (
    <Card padding="md" variant="default" className="flex items-center gap-3">
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md shrink-0 [&>svg]:h-4 [&>svg]:w-4',
          tone === 'success' && 'bg-success/15 text-success',
          tone === 'danger' && 'bg-danger/15 text-danger',
          tone === 'neutral' && 'bg-primary/15 text-primary',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
        <div className="text-xl font-bold text-text tabular tracking-tight">{value}</div>
      </div>
    </Card>
  );
}

function MetaCard({
  meta,
  onEdit,
  onDelete,
}: {
  meta: MetaComProgresso;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const progresso = meta.progresso ?? 0;
  const atingido = meta.atingido ?? 0;
  const valorAlvo = meta.valorAlvo ?? 0;
  const pct = Math.min(progresso, 100);
  const overshoot = progresso > 100;
  const completed = progresso >= 100;
  const valorAtingidoFmt =
    meta.tipo === 'FATURAMENTO' ? fmtBRLCompact(atingido) : atingido.toLocaleString('pt-BR');
  const valorAlvoFmt =
    meta.tipo === 'FATURAMENTO' ? fmtBRLCompact(valorAlvo) : valorAlvo.toLocaleString('pt-BR');

  const AlvoIcon = meta.alvoTipo === 'EMPRESA' ? Building2 : User;

  return (
    <Card
      padding="md"
      variant={meta.risco ? 'outline' : 'default'}
      className={cn(
        'flex flex-col gap-3',
        meta.risco && 'border-warning bg-warning/5',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-text tracking-tight truncate">
            {meta.titulo}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted">
            <AlvoIcon className="h-3 w-3" />
            <span className="truncate">{meta.alvoNome ?? meta.alvoTipo}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton aria-label="Editar" variant="ghost" size="sm" icon={<Edit3 />} onClick={onEdit} />
          <IconButton
            aria-label="Excluir"
            variant="ghost"
            size="sm"
            icon={<Trash2 className="text-danger" />}
            onClick={onDelete}
          />
        </div>
      </header>

      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Atingido</div>
          <div
            className={cn(
              'text-2xl font-bold tabular tracking-tight',
              completed ? 'text-success' : 'text-text',
            )}
          >
            {valorAtingidoFmt}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted">Alvo</div>
          <div className="text-sm text-text-subtle tabular">{valorAlvoFmt}</div>
        </div>
      </div>

      {/* Progress bar com gradient brand (magenta → ciano) quando em andamento */}
      <div className="relative h-2.5 rounded-full bg-surface-hover overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: completed
              ? 'var(--success)'
              : meta.risco
                ? 'var(--warning)'
                : 'linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%)',
          }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] tabular">
        <span className={completed ? 'text-success font-semibold' : 'text-text-subtle'}>
          {progresso.toFixed(1)}%
          {overshoot && <span className="text-success ml-1">(+{(progresso - 100).toFixed(0)}%)</span>}
        </span>
        <span className="text-muted inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {fmtDate(meta.inicio)} → {fmtDate(meta.fim)}
        </span>
      </div>

      {/* Dias restantes — cor dinâmica conforme proximidade */}
      {(() => {
        const dr = diasRestantes(meta.fim);
        const toneClass =
          dr.tone === 'danger'
            ? 'text-danger bg-danger/10 border-danger/30'
            : dr.tone === 'warning'
              ? 'text-warning bg-warning/10 border-warning/30'
              : 'text-muted bg-bg-alt border-border';
        return (
          <div
            data-testid="meta-dias-restantes"
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] self-start',
              toneClass,
            )}
          >
            <Calendar className="h-3 w-3" />
            {dr.texto}
          </div>
        );
      })()}

      {meta.risco && (
        <div className="flex items-center gap-1.5 text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Em risco — passou 70% do tempo, atingiu menos de 70%</span>
        </div>
      )}
      {completed && (
        <div className="flex items-center gap-1.5 text-xs text-success bg-success/10 border border-success/30 rounded-md px-2 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Meta atingida! {overshoot ? `Bateu ${progresso.toFixed(0)}%` : ''}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border text-[11px] text-muted">
        <Badge variant="outline" size="sm">
          {meta.tipo === 'FATURAMENTO' ? 'Faturamento' : 'Pedidos'}
        </Badge>
        <Badge variant="outline" size="sm">
          {meta.periodicidade}
        </Badge>
      </div>
    </Card>
  );
}

// ─── Form dialog ─────────────────────────────────────────

function MetaFormDialog({
  meta,
  onClose,
  onSaved,
}: {
  meta: MetaComProgresso | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = meta === null;
  const [titulo, setTitulo] = useState(meta?.titulo ?? '');
  const [descricao, setDescricao] = useState(meta?.descricao ?? '');
  const [tipo, setTipo] = useState<'FATURAMENTO' | 'PEDIDOS'>(meta?.tipo ?? 'FATURAMENTO');
  const [valorAlvo, setValorAlvo] = useState<number>(meta?.valorAlvo ?? 100000);
  const [alvoTipo, setAlvoTipo] = useState<'EMPRESA' | 'REP' | 'GERENTE'>(meta?.alvoTipo ?? 'REP');
  const [alvo, setAlvo] = useState<UsuarioOpt | null>(
    meta?.alvoId ? ({ id: meta.alvoId, nome: meta.alvoNome ?? '—' } as UsuarioOpt) : null,
  );
  const [periodicidade, setPeriodicidade] = useState<'MES' | 'TRIMESTRE' | 'ANO'>(
    meta?.periodicidade ?? 'MES',
  );
  const [inicio, setInicio] = useState(
    meta ? meta.inicio.slice(0, 10) : firstDayOfMonth().toISOString().slice(0, 10),
  );
  const [fim, setFim] = useState(
    meta ? meta.fim.slice(0, 10) : lastDayOfMonth().toISOString().slice(0, 10),
  );
  const [ativo, setAtivo] = useState(meta?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (titulo.trim().length < 2) {
      setError('Título obrigatório.');
      return;
    }
    if (valorAlvo <= 0) {
      setError('Valor alvo deve ser maior que 0.');
      return;
    }
    if (alvoTipo !== 'EMPRESA' && !alvo) {
      setError(`Selecione o ${alvoTipo === 'REP' ? 'representante' : 'gerente'}.`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        tipo,
        valorAlvo,
        alvoTipo,
        alvoId: alvoTipo === 'EMPRESA' ? null : alvo?.id ?? null,
        periodicidade,
        inicio: new Date(inicio).toISOString(),
        fim: new Date(fim + 'T23:59:59').toISOString(),
        ativo,
      };
      if (isNew) await api.post('/metas', payload);
      else await api.put(`/metas/${meta!.id}`, payload);
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Nova meta' : 'Editar meta'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Título" required>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Meta de faturamento Maio 2026"
          />
        </Field>
        <Field label="Descrição">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as 'FATURAMENTO' | 'PEDIDOS')}>
              <option value="FATURAMENTO">Faturamento (R$)</option>
              <option value="PEDIDOS">Pedidos (contagem)</option>
            </Select>
          </Field>
          <Field label={tipo === 'FATURAMENTO' ? 'Valor alvo (R$)' : 'Quantidade alvo'} required>
            <Input
              type="number"
              min={1}
              step={tipo === 'FATURAMENTO' ? '0.01' : '1'}
              value={valorAlvo}
              onChange={(e) => setValorAlvo(Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Aplica a">
            <Select
              value={alvoTipo}
              onChange={(e) => {
                setAlvoTipo(e.target.value as 'EMPRESA' | 'REP' | 'GERENTE');
                setAlvo(null);
              }}
            >
              <option value="REP">Representante</option>
              <option value="GERENTE">Gerente (somatório dos representantes)</option>
              <option value="EMPRESA">Empresa toda</option>
            </Select>
          </Field>
          {alvoTipo !== 'EMPRESA' && (
            <Field label={alvoTipo === 'REP' ? 'Representante' : 'Gerente'} required>
              <AsyncCombobox<UsuarioOpt>
                endpoint="/users"
                placeholder="Buscar usuário…"
                getLabel={(u) => u.nome}
                getSubLabel={(u) => u.email ?? null}
                getId={(u) => u.id}
                value={alvo}
                onChange={setAlvo}
                extraQuery={{ role: alvoTipo === 'REP' ? 'REP' : 'GERENTE' }}
              />
            </Field>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Período">
            <Select
              value={periodicidade}
              onChange={(e) => setPeriodicidade(e.target.value as 'MES' | 'TRIMESTRE' | 'ANO')}
            >
              <option value="MES">Mensal</option>
              <option value="TRIMESTRE">Trimestral</option>
              <option value="ANO">Anual</option>
            </Select>
          </Field>
          <Field label="Início">
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Field>
          <Field label="Fim">
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </Field>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="meta-ativo"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="accent-primary"
          />
          <label htmlFor="meta-ativo" className="text-sm text-text">
            Meta ativa
          </label>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function firstDayOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function lastDayOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

// Mark unused imports
const _u1 = TrendingUp;
const _u2 = TrendingDown;
void _u1;
void _u2;
