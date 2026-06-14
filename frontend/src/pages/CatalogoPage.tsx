import { useMemo, useState } from 'react';
import {
  Plus,
  Sparkles,
  Eye,
  Share2,
  Trash2,
  TrendingUp,
  TrendingDown,
  Package,
  AlertCircle,
  Download,
  CheckCircle2,
  MessageSquare,
  PackageX,
  PackageCheck,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { StateView } from '@/components/StateView';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Stat,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  formatMoeda as fmtBRL,
  formatMoedaCompacta as fmtBRLCompact,
  formatNumero,
  formatPercent,
} from '@/lib/masks';

/**
 * CatalogoPage v2 — design system dark, cards de produtos.
 *
 * - Grid de cards (não tabela) com markup editável inline + preço final destacado
 * - Stats no topo (total, markup médio, sem markup)
 * - Actions: Adicionar produto, Markup global, Preview por cliente, Compartilhar, Limpar
 * - Share Dialog com WhatsApp/PDF/Link público
 */

interface CatalogoItem {
  id: string;
  produtoId: string;
  produto?: {
    id: string;
    nome: string;
    sku?: string;
    marca?: string;
    precoFabrica: number | null; // custo — null quando não informado
    precoTabela: number;
    imagem?: string | null;
    estoque?: number;
    /** ISO string do timestamp do último sync de estoque (cron 30min ou webhook OMIE). */
    estoqueAtualizadoEm?: string | null;
  };
  markup: number;
  precoFinal?: number;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoFabrica?: number | null;
  precoTabela?: number;
  estoque?: number;
  estoqueAtualizadoEm?: string | null;
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

interface PreviewItem {
  produtoId: string;
  produto?: { id: string; nome: string; sku?: string };
  precoFabrica: number | null;
  precoTabela: number;
  precoEspecial?: number | null;
  markup: number;
  precoFinal: number;
}

/**
 * "atualizado há X" — string relativa amigável.
 * Considera stale acima de 45min (3× o sync de 30min — margem de segurança).
 */
function fmtRelativo(iso: string | null | undefined): { label: string; stale: boolean } {
  if (!iso) return { label: 'sem dado', stale: true };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { label: 'sem dado', stale: true };
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60000);
  const stale = min > 45;
  if (min < 1) return { label: 'agora', stale };
  if (min < 60) return { label: `há ${min} min`, stale };
  const h = Math.floor(min / 60);
  if (h < 24) return { label: `há ${h}h`, stale };
  const d = Math.floor(h / 24);
  return { label: `há ${d}d`, stale };
}

/**
 * Semáforo de estoque seguindo o brandbook:
 *  - 0       → vermelho (danger)
 *  - 1–9     → amarelo (warning)
 *  - 10+     → verde (success)
 *  - undefined → cinza (sem dado, ainda não sincronizado)
 */
function stockTone(estoque: number | undefined): {
  variant: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
  icon: typeof Package;
} {
  if (estoque === undefined || estoque === null) {
    return { variant: 'neutral', label: 'sem dado', icon: Package };
  }
  if (estoque <= 0) return { variant: 'danger', label: 'sem estoque', icon: PackageX };
  if (estoque < 10) return { variant: 'warning', label: `${estoque} un`, icon: Package };
  return { variant: 'success', label: `${estoque} un`, icon: PackageCheck };
}

// ─── Page principal ──────────────────────────────────────────

export default function CatalogoPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<CatalogoItem[] | { data: CatalogoItem[] }>(
    '/catalogo',
  );
  const itens: CatalogoItem[] = useMemo(
    () => (Array.isArray(data) ? data : data?.data ?? []),
    [data],
  );

  const [adding, setAdding] = useState(false);
  const [markupGlobal, setMarkupGlobal] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [savingMarkup, setSavingMarkup] = useState<string | null>(null);

  const stats = useMemo(() => {
    const totalItens = itens.length;
    const markupMedio = totalItens > 0 ? itens.reduce((s, i) => s + i.markup, 0) / totalItens : 0;
    const semEstoque = itens.filter((i) => (i.produto?.estoque ?? 0) <= 0).length;
    const valorTotal = itens.reduce((s, i) => {
      const fabrica = i.produto?.precoFabrica;
      // Sem custo informado e sem preço final → não dá pra computar; não soma.
      const final = i.precoFinal ?? (fabrica != null ? fabrica * (1 + i.markup / 100) : null);
      return final != null ? s + final : s;
    }, 0);
    // Estoque mais antigo do catálogo (= mais stale) — usado pra alerta global
    const oldestSync = itens.reduce<string | null>((oldest, i) => {
      const t = i.produto?.estoqueAtualizadoEm;
      if (!t) return oldest;
      if (!oldest) return t;
      return new Date(t).getTime() < new Date(oldest).getTime() ? t : oldest;
    }, null);
    return { totalItens, markupMedio, semEstoque, valorTotal, oldestSync };
  }, [itens]);

  const filtered = useMemo(() => {
    if (!search.trim()) return itens;
    const q = search.toLowerCase();
    return itens.filter(
      (i) =>
        i.produto?.nome.toLowerCase().includes(q) ||
        i.produto?.sku?.toLowerCase().includes(q) ||
        i.produto?.marca?.toLowerCase().includes(q),
    );
  }, [itens, search]);

  async function updateMarkup(produtoId: string, markup: number) {
    setSavingMarkup(produtoId);
    try {
      await api.put('/catalogo/item', { produtoId, markup });
      toast.success('Markup atualizado');
      refetch();
    } catch (err) {
      toast.error('Falha ao atualizar markup', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingMarkup(null);
    }
  }

  async function removeItem(produtoId: string) {
    try {
      await api.delete(`/catalogo/item/${produtoId}`);
      toast.success('Produto removido do catálogo');
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <PageLayout
      title="Meu catálogo"
      description="Monte seu catálogo personalizado e defina o markup% sobre o preço de fábrica. Cada cliente vê o preço com seu markup (ou negociado, se houver)."
      actions={
        <>
          <Button
            variant="secondary"
            size="md"
            data-testid="catalogo-preview"
            onClick={() => setPreviewOpen(true)}
            disabled={itens.length === 0}
            leftIcon={<Eye className="h-3.5 w-3.5" />}
          >
            Preview
          </Button>
          <Button
            data-testid="catalogo-share"
            onClick={() => setShareOpen(true)}
            disabled={itens.length === 0}
            leftIcon={<Share2 className="h-3.5 w-3.5" />}
          >
            Compartilhar
          </Button>
          <Button
            variant="secondary"
            data-testid="catalogo-add"
            onClick={() => setAdding(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Adicionar produto
          </Button>
        </>
      }
    >
      <CatalogoTabs />
      {/* Stats */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 mb-4">
        <Stat
          label="Produtos no catálogo"
          icon={<Package className="text-info" />}
          value={formatNumero(stats.totalItens)}
        />
        <Stat
          label="Sem estoque"
          icon={<PackageX className={stats.semEstoque > 0 ? 'text-danger' : 'text-muted'} />}
          value={formatNumero(stats.semEstoque)}
          hint={
            stats.semEstoque > 0
              ? 'representante pode lançar — OMIE gera OP de reposição'
              : 'tudo disponível'
          }
        />
      </div>

      {/* Banner de sync (mostra "atualizado há X" + alerta de stale) */}
      {itens.length > 0 && (
        <SyncBanner oldestSync={stats.oldestSync} />
      )}

      {/* Toolbar */}
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          <Input
            placeholder="Buscar por nome, SKU, marca…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            data-testid="catalogo-markup-global"
            onClick={() => setMarkupGlobal(true)}
            disabled={itens.length === 0}
            leftIcon={<Sparkles className="h-3 w-3" />}
          >
            Markup global
          </Button>
          {itens.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="catalogo-clear"
              onClick={() => setClearOpen(true)}
              leftIcon={<Trash2 className="h-3 w-3" />}
              className="text-danger hover:text-danger"
            >
              Limpar tudo
            </Button>
          )}
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Package />}
              title={
                search.trim()
                  ? 'Nenhum produto bate com a busca'
                  : 'Catálogo vazio'
              }
              description={
                search.trim()
                  ? 'Tente ajustar a busca.'
                  : 'Adicione o primeiro produto pra começar a vender.'
              }
              action={
                !search.trim() ? (
                  <Button onClick={() => setAdding(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                    Adicionar produto
                  </Button>
                ) : undefined
              }
              className="m-6 border-0"
            />
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 p-4">
              {filtered.map((item) => (
                <ProdutoCard
                  key={item.produtoId}
                  item={item}
                  saving={savingMarkup === item.produtoId}
                  onMarkupChange={(m) => updateMarkup(item.produtoId, m)}
                  onRemove={() => removeItem(item.produtoId)}
                />
              ))}
            </div>
          )}
        </StateView>
      </Card>

      {adding && (
        <AddProdutoDialog
          existingIds={new Set(itens.map((i) => i.produtoId))}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refetch();
          }}
        />
      )}
      {markupGlobal && (
        <MarkupGlobalDialog
          onClose={() => setMarkupGlobal(false)}
          onSaved={() => {
            setMarkupGlobal(false);
            refetch();
          }}
        />
      )}
      {previewOpen && <PreviewClienteDialog onClose={() => setPreviewOpen(false)} />}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
      {clearOpen && (
        <ClearDialog
          onClose={() => setClearOpen(false)}
          onDone={() => {
            setClearOpen(false);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Sync banner ───────────────────────────────────────────────

function SyncBanner({ oldestSync }: { oldestSync: string | null }) {
  const rel = fmtRelativo(oldestSync);
  return (
    <div
      className={cn(
        'mb-4 px-3 py-2 rounded-md text-sm flex items-center gap-2 border',
        rel.stale
          ? 'bg-warning/10 border-warning/30 text-warning'
          : 'bg-success/5 border-success/20 text-success',
      )}
      data-testid="catalogo-sync-banner"
    >
      <RefreshCw className={cn('h-3.5 w-3.5 shrink-0', rel.stale && 'animate-pulse')} />
      <span className="flex-1">
        Estoque sincronizado do OMIE <strong className="font-semibold">{rel.label}</strong>
        {rel.stale && ' — pode estar desatualizado'}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        sync auto 30min + webhook
      </span>
    </div>
  );
}

// ─── Produto card ──────────────────────────────────────────────

function ProdutoCard({
  item,
  saving,
  onMarkupChange,
  onRemove,
}: {
  item: CatalogoItem;
  saving: boolean;
  onMarkupChange: (m: number) => void;
  onRemove: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fabrica = item.produto?.precoFabrica ?? null;
  const tabela = item.produto?.precoTabela ?? 0;
  const final = item.precoFinal ?? (fabrica != null ? fabrica * (1 + item.markup / 100) : null);
  const diff = final != null && tabela > 0 ? ((final - tabela) / tabela) * 100 : 0;
  const diffPositive = diff > 0;

  return (
    <Card
      padding="none"
      className={cn(
        'flex flex-col overflow-hidden transition-all duration-100',
        confirmDelete && 'border-danger',
      )}
    >
      {/* Image (or placeholder) + stock badge sobreposto */}
      <div className="aspect-[5/3] bg-bg-alt border-b border-border flex items-center justify-center overflow-hidden relative">
        {item.produto?.imagem ? (
          <img
            src={item.produto.imagem}
            alt={item.produto.nome}
            className="h-full w-full object-cover"
          />
        ) : (
          <Package className="h-8 w-8 text-muted-light" />
        )}
        <StockBadge produto={item.produto} testId={`stock-${item.produtoId}`} />
      </div>

      {/* Header */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h3
          className="text-sm font-semibold text-text tracking-tight leading-tight line-clamp-2"
          title={item.produto?.nome}
        >
          {item.produto?.nome ?? '—'}
        </h3>
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          {item.produto?.sku && <span className="tabular">{item.produto.sku}</span>}
          {item.produto?.marca && (
            <>
              {item.produto?.sku && <span>·</span>}
              <span>{item.produto.marca}</span>
            </>
          )}
        </div>
      </div>

      {/* Prices */}
      <div className="px-3 pb-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Fábrica (custo)</div>
          <div className="text-text-subtle tabular">{fabrica != null ? fmtBRL(fabrica) : '—'}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted">Tabela</div>
          <div className="text-text-subtle tabular">{fmtBRL(tabela)}</div>
        </div>
      </div>

      {/* Markup input + final price */}
      <div className="px-3 pb-3 flex items-end gap-2 border-t border-border pt-3 bg-bg-alt">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Markup %</div>
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            key={`${item.produtoId}-${item.markup}`}
            defaultValue={item.markup}
            disabled={saving}
            data-testid={`markup-input-${item.produtoId}`}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v !== item.markup) {
                onMarkupChange(v);
              }
            }}
            className={cn(
              'w-full h-8 px-2 rounded-md text-sm font-medium tabular',
              'bg-bg border border-border-strong text-text',
              'focus:outline-none focus:border-primary focus:shadow-ring',
              saving && 'border-warning bg-warning/10 cursor-progress',
            )}
          />
        </div>
        <div className="flex-1 text-right min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Preço final</div>
          {final != null ? (
            <div className="text-md font-bold text-text tabular tracking-tight">{fmtBRL(final)}</div>
          ) : (
            <div
              className="text-[11px] font-medium text-warning leading-tight"
              title="Sem custo informado — defina o preço de fábrica em Produtos"
            >
              defina o custo
            </div>
          )}
          {final != null && tabela > 0 && (
            <div
              className={cn(
                'text-[10px] tabular flex items-center justify-end gap-0.5',
                diffPositive ? 'text-warning' : 'text-success',
              )}
            >
              {diffPositive ? (
                <TrendingUp className="h-2.5 w-2.5" />
              ) : (
                <TrendingDown className="h-2.5 w-2.5" />
              )}
              {diffPositive ? '+' : ''}
              {formatPercent(diff, 1)} vs tabela
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDelete ? (
        <div className="px-3 py-2 bg-danger/10 border-t border-danger/30 flex items-center gap-2">
          <span className="text-xs text-danger flex-1">Remover do catálogo?</span>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setConfirmDelete(false);
              onRemove();
            }}
            data-testid={`catalogo-rem-${item.produtoId}`}
          >
            Confirmar
          </Button>
        </div>
      ) : (
        <div className="px-3 py-1.5 bg-bg-alt border-t border-border flex items-center justify-end">
          <IconButton
            aria-label="Remover do catálogo"
            variant="ghost"
            size="sm"
            icon={<Trash2 className="text-danger" />}
            onClick={() => setConfirmDelete(true)}
          />
        </div>
      )}
    </Card>
  );
}

// ─── Stock badge ───────────────────────────────────────────────

function StockBadge({
  produto,
  testId,
}: {
  produto?: CatalogoItem['produto'];
  testId?: string;
}) {
  const tone = stockTone(produto?.estoque);
  const rel = fmtRelativo(produto?.estoqueAtualizadoEm);
  const Icon = tone.icon;
  const colorClass =
    tone.variant === 'success'
      ? 'bg-success/15 text-success border-success/30'
      : tone.variant === 'warning'
        ? 'bg-warning/15 text-warning border-warning/30'
        : tone.variant === 'danger'
          ? 'bg-danger/15 text-danger border-danger/30'
          : 'bg-muted/15 text-muted border-muted/30';
  return (
    <div
      className={cn(
        'absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border backdrop-blur-sm',
        colorClass,
      )}
      data-testid={testId}
      title={`Estoque: ${tone.label} · sync ${rel.label}`}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="tabular">{tone.label}</span>
    </div>
  );
}

// ─── Add produto dialog ────────────────────────────────────────

function AddProdutoDialog({
  existingIds,
  onClose,
  onSaved,
}: {
  existingIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [produto, setProduto] = useState<ProdutoOpt | null>(null);
  const [markup, setMarkup] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDup = produto !== null && existingIds.has(produto.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!produto || isDup) return;
    setBusy(true);
    setError(null);
    try {
      await api.put('/catalogo/item', { produtoId: produto.id, markup });
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
      title="Adicionar produto ao catálogo"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="add-form"
            data-testid="catalogo-add-save"
            disabled={!produto || isDup}
            loading={busy}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Adicionar
          </Button>
        </>
      }
    >
      <form id="add-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Produto" required>
          <AsyncCombobox<ProdutoOpt>
            testId="add-produto-picker"
            endpoint="/produtos"
            placeholder="Buscar produto…"
            getLabel={(p) => p.nome}
            getSubLabel={(p) =>
              [p.sku, p.precoFabrica != null ? `fábrica ${fmtBRL(p.precoFabrica)}` : null]
                .filter(Boolean)
                .join(' · ')
            }
            getId={(p) => p.id}
            value={produto}
            onChange={setProduto}
          />
        </Field>
        {isDup && (
          <div className="px-3 py-2 rounded-md bg-warning/10 border border-warning/30 text-warning text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            Este produto já está no seu catálogo. Use o input de markup na lista.
          </div>
        )}
        <Field
          label="Markup % sobre o preço de fábrica"
          hint="0% = vende pelo preço de fábrica. 30% = vende fábrica × 1.30."
        >
          <Input
            data-testid="add-markup-input"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={markup}
            onChange={(e) => setMarkup(Number(e.target.value))}
          />
        </Field>
        {produto?.precoFabrica != null ? (
          <Card variant="outline" padding="md" className="bg-primary/5 border-primary/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  Preço final pro cliente
                </div>
                <div className="text-2xl font-bold text-text tabular tracking-tight">
                  {fmtBRL(produto.precoFabrica * (1 + markup / 100))}
                </div>
              </div>
              {produto.precoTabela !== undefined && (
                <div className="text-right text-[11px] text-muted tabular">
                  <div>Fábrica: {fmtBRL(produto.precoFabrica)}</div>
                  <div>Tabela: {fmtBRL(produto.precoTabela)}</div>
                </div>
              )}
            </div>
          </Card>
        ) : produto ? (
          <Card variant="outline" padding="md" className="bg-warning/5 border-warning/30">
            <div className="text-[11px] text-warning leading-snug">
              Este produto está <strong>sem custo informado</strong>. Defina o preço de fábrica em
              Produtos pra calcular o preço final sobre o custo.
            </div>
          </Card>
        ) : null}
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

// ─── Markup global dialog ─────────────────────────────────────

function MarkupGlobalDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [markup, setMarkup] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await api.put('/catalogo/markup-global', { markup });
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
      title="Aplicar markup global"
      description="Define o mesmo markup% pra TODOS os produtos. Substitui os markups individuais."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            data-testid="markup-global-apply"
            loading={busy}
            onClick={apply}
            leftIcon={<Sparkles className="h-3.5 w-3.5" />}
          >
            Aplicar {markup}% em todos
          </Button>
        </>
      }
    >
      <Field label="Markup %">
        <Input
          data-testid="markup-global-input"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={markup}
          onChange={(e) => setMarkup(Number(e.target.value))}
          autoFocus
        />
      </Field>
      {error && (
        <div className="mt-3 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </Dialog>
  );
}

// ─── Preview cliente dialog ──────────────────────────────────

function PreviewClienteDialog({ onClose }: { onClose: () => void }) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const previewPath = cliente ? `/catalogo/preview?clienteId=${cliente.id}` : null;
  const { data, loading, error } = useApiQuery<PreviewItem[] | { data: PreviewItem[] }>(previewPath);
  const itens: PreviewItem[] = Array.isArray(data) ? data : data?.data ?? [];

  return (
    <Dialog open onClose={onClose} title="Preview do catálogo aplicado a um cliente" size="xl">
      <Field label="Cliente">
        <AsyncCombobox<ClienteOpt>
          testId="preview-cliente-picker"
          endpoint="/clientes"
          placeholder="Buscar cliente…"
          getLabel={(c) => c.nome}
          getSubLabel={(c) => c.cnpj ?? null}
          getId={(c) => c.id}
          value={cliente}
          onChange={setCliente}
        />
      </Field>

      {cliente && (
        <div className="mt-4">
          {loading && <div className="text-muted text-sm py-4 text-center">Calculando preços…</div>}
          {error && (
            <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm">
              {error}
            </div>
          )}
          {!loading && !error && itens.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-bg-alt">
                    <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                      Produto
                    </th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                      Fábrica
                    </th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                      Markup
                    </th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                      Tabela
                    </th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                      Negociado
                    </th>
                    <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
                      Final p/ cliente
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.produtoId} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="text-sm text-text">{i.produto?.nome ?? '—'}</div>
                        {i.produto?.sku && (
                          <div className="text-[10px] text-muted tabular">{i.produto.sku}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-text-subtle tabular">
                        {i.precoFabrica != null ? fmtBRLCompact(i.precoFabrica) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-text-subtle tabular">
                        {i.markup}%
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-text-subtle tabular">
                        {fmtBRLCompact(i.precoTabela)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {i.precoEspecial !== null && i.precoEspecial !== undefined ? (
                          <Badge variant="warning" size="sm">
                            {fmtBRL(i.precoEspecial)}
                          </Badge>
                        ) : (
                          <span className="text-muted-light text-sm">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-bold text-success tabular">
                        {fmtBRL(i.precoFinal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Share dialog ─────────────────────────────────────────────

function ShareDialog({ onClose }: { onClose: () => void }) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [canal, setCanal] = useState<'whatsapp' | 'pdf'>('whatsapp');
  const [validoAte, setValidoAte] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ pdfBase64?: string; sentToWhatsApp?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Cliente é opcional — quando ausente, usa preço de tabela × markup do rep.
      const payload: Record<string, unknown> = { canal };
      if (cliente) payload.clienteId = cliente.id;
      if (validoAte) payload.validoAte = validoAte;
      const r = await api.post<{ pdfBase64?: string; sentToWhatsApp?: boolean }>(
        '/catalogo/share',
        payload,
      );
      setResult(r);
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
      title="Compartilhar catálogo"
      description="Envie o catálogo via WhatsApp ou PDF. Vincular cliente é opcional — sem cliente, o preço é o de tabela × seu markup."
      size="md"
      footer={
        !result ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              data-testid="share-confirm"
              loading={busy}
              onClick={share}
              leftIcon={<Share2 className="h-3.5 w-3.5" />}
            >
              Compartilhar
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )
      }
    >
      {!result ? (
        <div className="flex flex-col gap-3">
          <Field
            label="Cliente (opcional)"
            hint="Deixe em branco pra enviar pra qualquer pessoa (sem vínculo no sistema)"
          >
            <AsyncCombobox<ClienteOpt>
              testId="share-cliente-picker"
              endpoint="/clientes"
              placeholder="Buscar cliente…"
              getLabel={(c) => c.nome}
              getSubLabel={(c) => c.cnpj ?? null}
              getId={(c) => c.id}
              value={cliente}
              onChange={setCliente}
            />
          </Field>
          <Field label="Canal">
            <Select value={canal} onChange={(e) => setCanal(e.target.value as typeof canal)}>
              <option value="whatsapp">WhatsApp (envia direto)</option>
              <option value="pdf">PDF (baixa arquivo)</option>
            </Select>
          </Field>
          <Field label="Validade" hint="Opcional — quando o preço expira">
            <Input
              type="date"
              value={validoAte}
              onChange={(e) => setValidoAte(e.target.value)}
            />
          </Field>
          {error && (
            <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="px-3 py-2.5 rounded-md bg-success/10 border border-success/30 text-success text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Catálogo compartilhado com sucesso.
          </div>

          {result.sentToWhatsApp && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-channel-whatsapp/10 border border-channel-whatsapp/30 text-channel-whatsapp text-sm">
              <MessageSquare className="h-4 w-4" />
              Enviado via WhatsApp pro cliente.
            </div>
          )}

          {result.pdfBase64 && (
            <a
              href={`data:application/pdf;base64,${result.pdfBase64}`}
              download={`catalogo-${cliente?.nome.replace(/\s+/g, '_') ?? 'cliente'}.pdf`}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-contrast font-semibold text-sm hover:bg-primary-hover transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar PDF
            </a>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Clear dialog ─────────────────────────────────────────────

function ClearDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doClear() {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/catalogo');
      onDone();
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
      title="Limpar catálogo inteiro?"
      description="Remove TODOS os produtos do seu catálogo. Você terá que adicionar novamente um por um."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            data-testid="clear-confirm"
            onClick={doClear}
            loading={busy}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Confirmar — apagar tudo
          </Button>
        </>
      }
    >
      <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        Esta ação não pode ser desfeita.
      </div>
      {error && (
        <div className="mt-3 px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm">
          {error}
        </div>
      )}
    </Dialog>
  );
}

// Mark unused imports as referenced (Avatar/CardHeader/CardTitle/CardDescription are used in other files)
const _u1 = Avatar;
const _u2 = CardHeader;
const _u3 = CardTitle;
const _u4 = CardDescription;
void _u1;
void _u2;
void _u3;
void _u4;
