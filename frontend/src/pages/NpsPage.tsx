import { useState } from 'react';
import {
  Star,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Meh,
  AlertCircle,
  BarChart3,
  ArrowLeft,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Stat,
  Switch,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

interface PesquisaListItem {
  id: string;
  slug: string;
  titulo: string;
  descricao?: string | null;
  ativo: boolean;
  expiraEm?: string | null;
  atualizadoEm: string;
  _count?: { respostas?: number };
}

interface RespostaNPS {
  id: string;
  nota: number;
  comentario?: string | null;
  contato?: string | null;
  categoria: 'DETRATOR' | 'PASSIVO' | 'PROMOTOR';
  criadoEm: string;
}

interface NPSDashboard {
  pesquisa: PesquisaListItem;
  stats: {
    total: number;
    promotores: number;
    passivos: number;
    detratores: number;
    score: number;
    mediaNota: number;
  };
  distribuicao: number[];
  respostas: RespostaNPS[];
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function fmtDateTime(d: string) {
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export default function NpsPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<PesquisaListItem[]>('/nps');
  const [editing, setEditing] = useState<PesquisaListItem | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PesquisaListItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/nps/${confirmDelete.id}`);
      toast.success('Pesquisa removida');
      refetch();
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Falha', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  function copyUrl(slug: string) {
    const url = `${window.location.origin}/n/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado');
  }

  if (viewing) {
    return <NpsDashboard id={viewing} onClose={() => setViewing(null)} />;
  }

  return (
    <PageLayout
      title="Pesquisas NPS"
      description="Meça a satisfação dos seus clientes com o Net Promoter Score (NPS)."
      actions={
        <Button
          onClick={() => setEditing('new')}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          data-testid="nps-new-btn"
        >
          Nova pesquisa
        </Button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<Star />}
            title="Nenhuma pesquisa NPS criada"
            description="Crie uma pesquisa pra medir a satisfação dos seus clientes. Compartilhe o link após cada interação importante."
            action={
              <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Criar primeira pesquisa
              </Button>
            }
          />
        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.map((p) => (
              <PesquisaCard
                key={p.id}
                pesquisa={p}
                onEdit={() => setEditing(p)}
                onView={() => setViewing(p.id)}
                onCopyUrl={() => copyUrl(p.slug)}
                onDelete={() => setConfirmDelete(p)}
              />
            ))}
          </div>
        ) : null}
      </StateView>

      {editing && (
        <PesquisaFormDialog
          pesquisa={editing === 'new' ? null : editing}
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
          title="Excluir pesquisa?"
          description={`"${confirmDelete.titulo}" e todas as respostas serão removidas.`}
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

function PesquisaCard({
  pesquisa,
  onEdit,
  onView,
  onCopyUrl,
  onDelete,
}: {
  pesquisa: PesquisaListItem;
  onEdit: () => void;
  onView: () => void;
  onCopyUrl: () => void;
  onDelete: () => void;
}) {
  const expirou = pesquisa.expiraEm && new Date(pesquisa.expiraEm) < new Date();
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-text tracking-tight truncate">
            {pesquisa.titulo}
          </h3>
          <code className="text-[11px] text-muted tabular">/n/{pesquisa.slug}</code>
          {pesquisa.descricao && (
            <CardDescription className="line-clamp-2 mt-1">{pesquisa.descricao}</CardDescription>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={pesquisa.ativo ? 'success' : 'neutral'}>
            {pesquisa.ativo ? 'Ativa' : 'Inativa'}
          </Badge>
          {expirou && (
            <Badge variant="warning" size="sm">
              Expirada
            </Badge>
          )}
        </div>
      </header>

      <div className="flex items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1 tabular">
          <BarChart3 className="h-3 w-3" />
          {pesquisa._count?.respostas ?? 0}{' '}
          {pesquisa._count?.respostas === 1 ? 'resposta' : 'respostas'}
        </span>
        {pesquisa.expiraEm && (
          <span className="tabular">expira {fmtDate(pesquisa.expiraEm)}</span>
        )}
      </div>

      <footer className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={onView} leftIcon={<BarChart3 className="h-3 w-3" />}>
            Score
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Editar
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <IconButton aria-label="Copiar link" variant="ghost" size="sm" icon={<Copy />} onClick={onCopyUrl} />
          <IconButton
            aria-label="Abrir"
            variant="ghost"
            size="sm"
            icon={<ExternalLink />}
            onClick={() => window.open(`/n/${pesquisa.slug}`, '_blank')}
          />
          <IconButton aria-label="Excluir" variant="ghost" size="sm" icon={<Trash2 className="text-danger" />} onClick={onDelete} />
        </div>
      </footer>
    </Card>
  );
}

// ─── Form dialog ──────────────────────────────────────────

function PesquisaFormDialog({
  pesquisa,
  onClose,
  onSaved,
}: {
  pesquisa: PesquisaListItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = pesquisa === null;
  const [titulo, setTitulo] = useState(pesquisa?.titulo ?? '');
  const [slug, setSlug] = useState(pesquisa?.slug ?? '');
  const [descricao, setDescricao] = useState(pesquisa?.descricao ?? '');
  const [pergunta, setPergunta] = useState('O quanto você nos recomendaria de 0 a 10?');
  const [perguntaFollowUp, setPerguntaFollowUp] = useState(
    'Conta pra gente o que motivou essa nota',
  );
  const [mensagemAgradecimento, setMensagemAgradecimento] = useState('');
  const [ativo, setAtivo] = useState(pesquisa?.ativo ?? true);
  const [expiraEm, setExpiraEm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (titulo.trim().length < 2) {
      setError('Título obrigatório.');
      return;
    }
    if (slug.length < 2 || !/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug inválido — apenas a-z, 0-9, hífen.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        slug,
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        pergunta: pergunta.trim() || 'O quanto você nos recomendaria de 0 a 10?',
        perguntaFollowUp: perguntaFollowUp.trim() || null,
        mensagemAgradecimento: mensagemAgradecimento.trim() || null,
        ativo,
      };
      if (expiraEm) payload.expiraEm = new Date(expiraEm).toISOString();

      if (isNew) {
        await api.post('/nps', payload);
      } else {
        await api.put(`/nps/${pesquisa!.id}`, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setSaving(false);
    }
  }

  function autoSlug() {
    setSlug(
      titulo
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60),
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Nova pesquisa NPS' : 'Editar pesquisa'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {isNew ? 'Criar pesquisa' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Título" required>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onBlur={() => !slug && autoSlug()}
            placeholder="Como você avalia nosso atendimento?"
          />
        </Field>
        <Field label="Slug (URL pública)" required hint="Apenas a-z, 0-9 e hífen">
          <Input
            value={slug}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, ''),
              )
            }
            placeholder="atendimento-2026"
          />
        </Field>
        <Field label="Descrição">
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            placeholder="Contexto pro respondente (opcional)"
          />
        </Field>
        <Field label="Pergunta principal" required>
          <Input value={pergunta} onChange={(e) => setPergunta(e.target.value)} />
        </Field>
        <Field label="Pergunta de follow-up (texto livre)">
          <Input
            value={perguntaFollowUp}
            onChange={(e) => setPerguntaFollowUp(e.target.value)}
            placeholder="Por quê?"
          />
        </Field>
        <Field label="Mensagem de agradecimento">
          <Textarea
            value={mensagemAgradecimento}
            onChange={(e) => setMensagemAgradecimento(e.target.value)}
            rows={2}
            placeholder="Obrigado! Sua opinião é fundamental."
          />
        </Field>
        <Field label="Expira em (opcional)">
          <Input type="date" value={expiraEm} onChange={(e) => setExpiraEm(e.target.value)} />
        </Field>
        <Switch
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
          label="Pesquisa ativa"
        />
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

// ─── Dashboard ────────────────────────────────────────────

function NpsDashboard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useApiQuery<NPSDashboard>(`/nps/${id}/dashboard`);

  return (
    <PageLayout
      title={data?.pesquisa.titulo ?? 'Dashboard NPS'}
      description={data?.pesquisa.descricao ?? undefined}
      actions={
        <Button variant="secondary" onClick={onClose} leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}>
          Voltar
        </Button>
      }
    >
      <StateView loading={loading} error={error}>
        {data && (
          <div className="flex flex-col gap-4">
            {/* Score grande */}
            <Card padding="lg" className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
                Net Promoter Score
              </div>
              <div
                className={cn(
                  'text-6xl font-bold tabular tracking-tight',
                  data.stats.score >= 50
                    ? 'text-success'
                    : data.stats.score >= 0
                      ? 'text-warning'
                      : 'text-danger',
                )}
              >
                {data.stats.score > 0 ? '+' : ''}
                {data.stats.score}
              </div>
              <div className="text-sm text-muted mt-2">
                {data.stats.score >= 75 && (
                  <>
                    <TrendingUp className="inline h-4 w-4 mr-1 text-success" />
                    Excelente — clientes fãs.
                  </>
                )}
                {data.stats.score >= 50 && data.stats.score < 75 && 'Bom — espaço pra crescer.'}
                {data.stats.score >= 0 && data.stats.score < 50 && (
                  <>
                    <Meh className="inline h-4 w-4 mr-1 text-warning" />
                    Razoável — atenção aos detratores.
                  </>
                )}
                {data.stats.score < 0 && (
                  <>
                    <TrendingDown className="inline h-4 w-4 mr-1 text-danger" />
                    Crítico — mais detratores que promotores.
                  </>
                )}
              </div>
              <div className="text-[11px] text-muted mt-3 tabular">
                Baseado em {data.stats.total} {data.stats.total === 1 ? 'resposta' : 'respostas'} ·
                Média de nota {data.stats.mediaNota.toFixed(1)}
              </div>
            </Card>

            {/* Stats por categoria */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat
                label="Promotores (9-10)"
                icon={<ThumbsUp className="text-success" />}
                value={data.stats.promotores}
                hint={
                  data.stats.total > 0
                    ? `${((data.stats.promotores / data.stats.total) * 100).toFixed(0)}%`
                    : '0%'
                }
              />
              <Stat
                label="Passivos (7-8)"
                icon={<Meh className="text-warning" />}
                value={data.stats.passivos}
                hint={
                  data.stats.total > 0
                    ? `${((data.stats.passivos / data.stats.total) * 100).toFixed(0)}%`
                    : '0%'
                }
              />
              <Stat
                label="Detratores (0-6)"
                icon={<ThumbsDown className="text-danger" />}
                value={data.stats.detratores}
                hint={
                  data.stats.total > 0
                    ? `${((data.stats.detratores / data.stats.total) * 100).toFixed(0)}%`
                    : '0%'
                }
              />
            </div>

            {/* Distribuição */}
            <Card padding="md">
              <CardHeader>
                <CardTitle>Distribuição de notas</CardTitle>
              </CardHeader>
              <NotaDistribuicao distribuicao={data.distribuicao} total={data.stats.total} />
            </Card>

            {/* Respostas recentes */}
            <Card padding="md">
              <CardHeader>
                <CardTitle>Últimas respostas</CardTitle>
                <CardDescription>{data.respostas.length} mais recentes</CardDescription>
              </CardHeader>
              {data.respostas.length === 0 ? (
                <p className="text-sm text-muted text-center py-4">Sem respostas ainda.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {data.respostas.map((r) => (
                    <RespostaRow key={r.id} resposta={r} />
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </StateView>
    </PageLayout>
  );
}

function NotaDistribuicao({
  distribuicao,
  total,
}: {
  distribuicao: number[];
  total: number;
}) {
  const max = Math.max(...distribuicao, 1);
  return (
    <div className="flex flex-col gap-1.5">
      {distribuicao.map((count, nota) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        const widthPct = (count / max) * 100;
        const isDetrator = nota <= 6;
        const isPromotor = nota >= 9;
        return (
          <div key={nota} className="flex items-center gap-2">
            <span className="w-6 text-xs text-right text-text tabular shrink-0">{nota}</span>
            <div className="flex-1 h-6 rounded-md bg-surface-hover overflow-hidden relative">
              <div
                className={cn(
                  'h-full rounded-md transition-all',
                  isPromotor ? 'bg-success/40' : isDetrator ? 'bg-danger/40' : 'bg-warning/40',
                )}
                style={{ width: `${widthPct}%` }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] tabular text-text">
                {count} ({pct.toFixed(0)}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RespostaRow({ resposta }: { resposta: RespostaNPS }) {
  const Icon =
    resposta.categoria === 'PROMOTOR'
      ? ThumbsUp
      : resposta.categoria === 'DETRATOR'
        ? ThumbsDown
        : Meh;
  const colorClass =
    resposta.categoria === 'PROMOTOR'
      ? 'text-success'
      : resposta.categoria === 'DETRATOR'
        ? 'text-danger'
        : 'text-warning';
  return (
    <div className="py-3 flex items-start gap-3">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-full bg-bg-alt shrink-0', colorClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-bold tabular text-text">Nota {resposta.nota}</span>
          <Badge
            variant={
              resposta.categoria === 'PROMOTOR'
                ? 'success'
                : resposta.categoria === 'DETRATOR'
                  ? 'danger'
                  : 'warning'
            }
            size="sm"
          >
            {resposta.categoria.toLowerCase()}
          </Badge>
          <span className="text-[11px] text-muted tabular ml-auto">
            {fmtDateTime(resposta.criadoEm)}
          </span>
        </div>
        {resposta.comentario && (
          <p className="text-sm text-text-subtle leading-relaxed whitespace-pre-wrap m-0">
            {resposta.comentario}
          </p>
        )}
        {resposta.contato && (
          <p className="text-[11px] text-muted mt-1 tabular">{resposta.contato}</p>
        )}
      </div>
    </div>
  );
}

// Mark unused imports
const _u1 = Heart;
void _u1;
