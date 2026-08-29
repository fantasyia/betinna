import { useMemo, useState } from 'react';
import {
  Plus,
  Eye,
  Share2,
  Trash2,
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
import { ProdutoPickerDialog } from '@/components/ProdutoPickerDialog';
import { useEstoqueModo, textoMontagem } from '@/hooks/useEstoqueModo';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
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
  Stat,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL, formatNumero } from '@/lib/masks';

/**
 * CatalogoPage v2 — design system dark, cards de produtos.
 *
 * - Grid de cards (não tabela) com o preço definido pela empresa (tabela MSM)
 * - Stats no topo (total de produtos, sem estoque)
 * - Actions: Adicionar produto, Preview por cliente, Compartilhar, Limpar
 * - Share Dialog com WhatsApp/PDF/Link público
 */

interface CatalogoItem {
  id: string;
  produtoId: string;
  produto?: {
    id: string;
    nome: string;
    sku?: string | null;
    marca?: string | null;
    linha?: string | null;
    precoFabrica: number | null; // custo — null quando não informado
    precoTabela: number | null;
    precoLocacaoMensal?: number | null;
    imagem?: string | null;
    estoque?: number;
    /** ISO string do timestamp do último sync de estoque (vem do sync do ERP). */
    estoqueAtualizadoEm?: string | null;
  };
  precoFinal?: number | null;
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

/**
 * O que `GET /catalogo/preview` devolve DE VERDADE: o item do catálogo inteiro
 * (com produto, foto e estoque) mais o preço resolvido pro cliente.
 *
 * A versão anterior inventava `precoFabrica`/`precoTabela`/`precoEspecial` no
 * topo — campos que a API nunca mandou. A tabela mostrava "—" e "R$ 0,00" em
 * colunas com nome de dinheiro, que é o pior jeito de errar: parece dado.
 */
interface PreviewItem extends CatalogoItem {
  /** Preço que ESTE cliente vê. `null` quando não há mensalidade definida. */
  precoFinal: number | null;
  /** Veio de acordo negociado com o cliente (não é a tabela). */
  precoNegociado: boolean;
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
function stockTone(
  estoque: number | undefined,
  sobEncomenda = false,
): {
  variant: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
  icon: typeof Package;
} {
  // Sob encomenda, saldo zero (ou negativo, quando o ERP já reservou pra uma OP)
  // e o estado NORMAL — alarme aqui so ensina o time a ignorar alarme.
  if (sobEncomenda) {
    return estoque !== undefined && estoque !== null && estoque > 0
      ? { variant: 'success', label: `${estoque} pronto(s)`, icon: PackageCheck }
      : { variant: 'neutral', label: 'sob encomenda', icon: Package };
  }
  if (estoque === undefined || estoque === null) {
    return { variant: 'neutral', label: 'sem dado', icon: Package };
  }
  if (estoque <= 0) return { variant: 'danger', label: 'sem estoque', icon: PackageX };
  if (estoque < 10) return { variant: 'warning', label: `${estoque} un`, icon: Package };
  return { variant: 'success', label: `${estoque} un`, icon: PackageCheck };
}

// ─── Page principal ──────────────────────────────────────────

/**
 * Qual tabela de preços o material mostra.
 *
 * O REP fica preso em locação (ele loca, não vende) — e isso é decidido no
 * backend, não aqui: esconder o seletor é conforto de tela, não regra.
 */
type TabelaDePrecos = 'venda' | 'locacao' | 'ambos';

export default function CatalogoPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<CatalogoItem[] | { data: CatalogoItem[] }>(
    '/catalogo',
  );
  const itens: CatalogoItem[] = useMemo(
    () => (Array.isArray(data) ? data : data?.data ?? []),
    [data],
  );

  const estoqueModo = useEstoqueModo();
  const role = useRole();
  // Quem loca não escolhe tabela: o rep sai sempre com a mensalidade.
  const podeEscolherTabela = role !== 'REP';
  const [tabelaPrecos, setTabelaPrecos] = useState<TabelaDePrecos>('venda');
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  const [adding, setAdding] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [search, setSearch] = useState('');

  const stats = useMemo(() => {
    const totalItens = itens.length;
    const semEstoque = itens.filter((i) => (i.produto?.estoque ?? 0) <= 0).length;
    // Estoque mais antigo do catálogo (= mais stale) — usado pra alerta global
    const oldestSync = itens.reduce<string | null>((oldest, i) => {
      const t = i.produto?.estoqueAtualizadoEm;
      if (!t) return oldest;
      if (!oldest) return t;
      return new Date(t).getTime() < new Date(oldest).getTime() ? t : oldest;
    }, null);
    return { totalItens, semEstoque, oldestSync };
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

  async function baixarPdfDoCatalogo() {
    setBaixandoPdf(true);
    try {
      await baixarCatalogoPdf(undefined, tabelaPrecos);
      toast.success('PDF do catálogo gerado');
    } catch (err) {
      toast.error('Falha ao gerar o PDF', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBaixandoPdf(false);
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
          {podeEscolherTabela && (
            <Select
              data-testid="catalogo-tabela-precos"
              aria-label="Tabela de preços do PDF"
              value={tabelaPrecos}
              onChange={(e) => setTabelaPrecos(e.target.value as TabelaDePrecos)}
              className="w-[168px]"
            >
              <option value="venda">Preço de venda</option>
              <option value="locacao">Locação / mês</option>
              <option value="ambos">Venda + locação</option>
            </Select>
          )}
          <Button
            variant="secondary"
            data-testid="catalogo-pdf"
            onClick={baixarPdfDoCatalogo}
            // Botão desabilitado sem explicação vira "não funciona". Diz por quê.
            title={
              itens.length === 0
                ? 'Adicione produtos ao catálogo pra gerar o PDF'
                : 'Baixa o catálogo em PDF (foto, preço e disponibilidade)'
            }
            disabled={itens.length === 0 || baixandoPdf}
            loading={baixandoPdf}
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            PDF
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
            Adicionar produtos
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
        {estoqueModo.sobEncomenda ? (
          <Stat
            label="Entrega"
            icon={<PackageCheck className="text-info" />}
            value={textoMontagem(estoqueModo.diasMontagem)}
            hint="cada pedido vira uma OP no ERP — não depende de saldo"
          />
        ) : (
          <Stat
            label="Sem estoque"
            icon={<PackageX className={stats.semEstoque > 0 ? 'text-danger' : 'text-muted'} />}
            value={formatNumero(stats.semEstoque)}
            hint={
              stats.semEstoque > 0
                ? 'representante pode lançar — ERP gera OP de reposição'
                : 'tudo disponível'
            }
          />
        )}
      </div>

      {/* Banner de sync (mostra "atualizado há X" + alerta de stale) */}
      {itens.length > 0 && (
        <SyncBanner oldestSync={stats.oldestSync} sobEncomenda={estoqueModo.sobEncomenda} />
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
                    Adicionar produtos
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
                  sobEncomenda={estoqueModo.sobEncomenda}
                  onRemove={() => removeItem(item.produtoId)}
                />
              ))}
            </div>
          )}
        </StateView>
      </Card>

      {adding && (
        <ProdutoPickerDialog
          jaNoCatalogo={new Set(itens.map((i) => i.produtoId))}
          onClose={() => setAdding(false)}
          onAdicionados={(qtd) => {
            setAdding(false);
            toast.success(
              `${qtd} produto${qtd === 1 ? '' : 's'} adicionado${qtd === 1 ? '' : 's'} ao catálogo`,
            );
            refetch();
          }}
        />
      )}
      {previewOpen && (
        <PreviewClienteDialog
          onClose={() => setPreviewOpen(false)}
          sobEncomenda={estoqueModo.sobEncomenda}
          diasMontagem={estoqueModo.diasMontagem}
        />
      )}
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

function SyncBanner({
  oldestSync,
  sobEncomenda = false,
}: {
  oldestSync: string | null;
  sobEncomenda?: boolean;
}) {
  const rel = fmtRelativo(oldestSync);
  // Sob encomenda o saldo nao decide venda nenhuma — avisar que ele "pode estar
  // desatualizado" e assustar com um numero que ninguem usa pra decidir.
  const alerta = rel.stale && !sobEncomenda;
  return (
    <div
      className={cn(
        'mb-4 px-3 py-2 rounded-md text-sm flex items-center gap-2 border',
        alerta
          ? 'bg-warning/10 border-warning/30 text-warning'
          : 'bg-success/5 border-success/20 text-success',
      )}
      data-testid="catalogo-sync-banner"
    >
      <RefreshCw className={cn('h-3.5 w-3.5 shrink-0', alerta && 'animate-pulse')} />
      <span className="flex-1">
        Estoque sincronizado do ERP <strong className="font-semibold">{rel.label}</strong>
        {alerta && ' — pode estar desatualizado'}
        {sobEncomenda && ' — produtos sob encomenda, o saldo não trava venda'}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted">
        1 sync por dia + botão
      </span>
    </div>
  );
}

// ─── Produto card ──────────────────────────────────────────────

function ProdutoCard({
  item,
  onRemove,
  sobEncomenda = false,
}: {
  item: CatalogoItem;
  onRemove: () => void;
  sobEncomenda?: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // O REP loca, não vende: o backend zera o preço de venda pra ele e manda a
  // mensalidade. Quando não há mensalidade cadastrada vem null — e a tela
  // mostra "—" em vez de cair pro valor de venda, que seria o número errado
  // na mão de quem negocia.
  const locacao = item.produto?.precoLocacaoMensal ?? null;
  const venda = item.produto?.precoTabela ?? null;

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
        <StockBadge produto={item.produto} sobEncomenda={sobEncomenda} testId={`stock-${item.produtoId}`} />
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

      {/* Preço: mensalidade de locação (rep) ou preço de venda (gestão) */}
      <div className="px-3 pb-3 border-t border-border pt-3 bg-bg-alt">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
          {venda == null ? 'Locação / mês' : 'Preço (tabela)'}
        </div>
        <div className="text-lg font-bold text-text tabular tracking-tight">
          {venda != null ? fmtBRL(venda) : locacao != null ? fmtBRL(locacao) : '—'}
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
  sobEncomenda = false,
}: {
  produto?: CatalogoItem['produto'];
  testId?: string;
  sobEncomenda?: boolean;
}) {
  const tone = stockTone(produto?.estoque, sobEncomenda);
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

// ─── Preview cliente dialog ──────────────────────────────────

function PreviewClienteDialog({
  onClose,
  sobEncomenda,
  diasMontagem,
}: {
  onClose: () => void;
  sobEncomenda: boolean;
  diasMontagem: number | null;
}) {
  const toast = useToast();
  const role = useRole();
  const podeEscolherTabela = role !== 'REP';
  const [tabela, setTabela] = useState<TabelaDePrecos>(
    podeEscolherTabela ? 'venda' : 'locacao',
  );
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [baixando, setBaixando] = useState(false);
  const previewPath = cliente ? `/catalogo/preview?clienteId=${cliente.id}` : null;
  const { data, loading, error } = useApiQuery<PreviewItem[] | { data: PreviewItem[] }>(previewPath);
  const itens: PreviewItem[] = Array.isArray(data) ? data : (data?.data ?? []);

  async function baixarPdf() {
    setBaixando(true);
    try {
      await baixarCatalogoPdf(cliente?.id, tabela);
      toast.success('PDF gerado');
    } catch (err) {
      toast.error('Falha ao gerar o PDF', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Preview do catálogo"
      description="Escolha o cliente pra ver exatamente o que ele enxerga — com o preço que vale pra ele."
      size="xl"
      footer={
        <>
          <span className="mr-auto text-sm text-muted">
            {cliente ? `${itens.length} produto(s)` : 'Nenhum cliente selecionado'}
          </span>
          {podeEscolherTabela && (
            <Select
              data-testid="preview-tabela-precos"
              aria-label="Tabela de preços"
              value={tabela}
              onChange={(e) => setTabela(e.target.value as TabelaDePrecos)}
              className="w-[168px]"
            >
              <option value="venda">Preço de venda</option>
              <option value="locacao">Locação / mês</option>
              <option value="ambos">Venda + locação</option>
            </Select>
          )}
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button
            data-testid="preview-pdf"
            onClick={baixarPdf}
            loading={baixando}
            title={!cliente ? 'Escolha um cliente primeiro' : 'Baixa o catálogo com o preço deste cliente'}
            disabled={!cliente || itens.length === 0}
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            Baixar PDF
          </Button>
        </>
      }
    >
      <ClientePicker value={cliente} onChange={setCliente} />

      {cliente && (
        <div className="mt-4">
          {loading && <div className="text-muted text-sm py-4 text-center">Calculando preços…</div>}
          {error && (
            <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm">
              {error}
            </div>
          )}
          {!loading && !error && itens.length === 0 && (
            <EmptyState
              icon={<Package />}
              title="Catálogo vazio"
              description="Adicione produtos pra ver o preview deste cliente."
              className="m-2 border-0"
            />
          )}
          {!loading && !error && itens.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {itens.map((i) => (
                <li key={i.produtoId} className="flex items-center gap-3 px-3 py-2">
                  <Thumb src={i.produto?.imagem} alt={i.produto?.nome ?? ''} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">
                      {i.produto?.nome ?? '—'}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {[i.produto?.sku, i.produto?.marca, i.produto?.linha]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                  <span className="hidden text-xs text-muted sm:block w-40 text-right">
                    {textoDisponibilidade(i.produto?.estoque, sobEncomenda, diasMontagem)}
                  </span>
                  <div className="flex shrink-0 gap-3 text-right">
                    {colunasDePreco(tabela, i).map((c) => (
                      <div key={c.rotulo} className="w-28">
                        <div className="text-[10px] uppercase tracking-wider text-muted">
                          {c.rotulo}
                        </div>
                        <div className="tabular text-sm font-bold text-text">
                          {c.valor != null ? fmtBRL(c.valor) : '—'}
                        </div>
                      </div>
                    ))}
                    {i.precoNegociado && (
                      <Badge variant="warning" size="sm">
                        negociado
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Escolher cliente por LISTA, não por caixinha de busca.
 *
 * O combobox anterior mostrava um item por vez numa caixa estreita: só servia
 * pra quem já sabia o nome de cor. Aqui a lista aparece, com CNPJ e cidade, e a
 * busca só filtra.
 */
function ClientePicker({
  value,
  onChange,
}: {
  value: ClienteOpt | null;
  onChange: (c: ClienteOpt | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebouncedValue(busca, 300);
  const path = useMemo(() => {
    const qs = new URLSearchParams({ page: '1', limit: '12' });
    if (buscaDebounced.trim()) qs.set('search', buscaDebounced.trim());
    return `/clientes?${qs.toString()}`;
  }, [buscaDebounced]);
  const { data, loading } = useApiQuery<{ data: ClienteOpt[] } | ClienteOpt[]>(path);
  const clientes: ClienteOpt[] = Array.isArray(data) ? data : (data?.data ?? []);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text">{value.nome}</div>
          <div className="truncate text-xs text-muted">{value.cnpj ?? 'sem CNPJ'}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Trocar cliente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        data-testid="preview-cliente-busca"
        autoFocus
        placeholder="Buscar cliente por nome ou CNPJ…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {loading && <div className="px-3 py-3 text-sm text-muted">Buscando…</div>}
        {!loading && clientes.length === 0 && (
          <div className="px-3 py-3 text-sm text-muted">Nenhum cliente encontrado.</div>
        )}
        <ul className="divide-y divide-border">
          {clientes.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid={`preview-cliente-${c.id}`}
                onClick={() => onChange(c)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">{c.nome}</div>
                  <div className="truncate text-xs text-muted">{c.cnpj ?? 'sem CNPJ'}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Miniatura do produto — a foto vem do ERP; sem ela, o ícone neutro. */
function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-alt">
        <Package className="h-4 w-4 text-muted" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
    />
  );
}

/** Mesma frase do PDF: sob encomenda, o que vale é o PRAZO, não o saldo. */
function textoDisponibilidade(
  estoque: number | undefined,
  sobEncomenda: boolean,
  diasMontagem: number | null,
): string {
  if (sobEncomenda) return `Sob encomenda · ${textoMontagem(diasMontagem)}`;
  if (estoque == null) return 'sem dado';
  return estoque > 0 ? `${estoque} em estoque` : 'sob consulta';
}

/**
 * Mesmas colunas que o PDF mostra — a tela e o papel não podem divergir.
 * (Pro REP o backend força locação, então aqui é só o reflexo.)
 */
function colunasDePreco(
  tabela: TabelaDePrecos,
  item: PreviewItem,
): Array<{ rotulo: string; valor: number | null }> {
  const venda = { rotulo: 'Venda', valor: item.precoFinal ?? null };
  const locacao = { rotulo: 'Locação / mês', valor: item.produto?.precoLocacaoMensal ?? null };
  if (tabela === 'locacao') return [locacao];
  if (tabela === 'ambos') return [venda, locacao];
  return [venda];
}

/** Baixa o PDF do catálogo (com ou sem cliente vinculado). */
async function baixarCatalogoPdf(clienteId?: string, precos?: TabelaDePrecos): Promise<void> {
  const qs = new URLSearchParams();
  if (clienteId) qs.set('clienteId', clienteId);
  if (precos) qs.set('precos', precos);
  const r = await api.get<{ filename: string; base64: string }>(
    `/catalogo/pdf${qs.toString() ? `?${qs.toString()}` : ''}`,
  );
  const bytes = atob(r.base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buf[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = r.filename;
  // O <a> PRECISA estar no documento antes do clique: âncora solta é ignorada
  // por parte dos navegadores, e o download não acontece — sem erro nenhum,
  // que é como isto passou despercebido. (Mesmo caminho já usado na proposta.)
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Share dialog ─────────────────────────────────────────────

function ShareDialog({ onClose }: { onClose: () => void }) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [canal, setCanal] = useState<'whatsapp' | 'pdf'>('whatsapp');
  const [validoAte, setValidoAte] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ pdfBaixado?: boolean; sentToWhatsApp?: boolean } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // PDF é ARQUIVO, não link: baixa aqui e pronto. A tela esperava um
      // `pdfBase64` na resposta do /share que o backend nunca mandou — quem
      // escolhia PDF via "compartilhado com sucesso" e ficava sem arquivo.
      if (canal === 'pdf') {
        await baixarCatalogoPdf(cliente?.id);
        setResult({ pdfBaixado: true });
        return;
      }
      const payload: Record<string, unknown> = { canal };
      if (cliente) payload.clienteId = cliente.id;
      if (validoAte) payload.validoAte = validoAte;
      const r = await api.post<{ sentToWhatsApp?: boolean }>('/catalogo/share', payload);
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
      description="Envie o catálogo via WhatsApp ou PDF. Vincular cliente é opcional — sem cliente, o preço é o de tabela da MSM."
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
            <ClientePicker value={cliente} onChange={setCliente} />
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
            {result.pdfBaixado ? 'PDF do catálogo gerado.' : 'Catálogo compartilhado com sucesso.'}
          </div>

          {result.sentToWhatsApp && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-channel-whatsapp/10 border border-channel-whatsapp/30 text-channel-whatsapp text-sm">
              <MessageSquare className="h-4 w-4" />
              Enviado via WhatsApp pro cliente.
            </div>
          )}

          {result.pdfBaixado && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-info/10 border border-info/30 text-info text-sm">
              <Download className="h-4 w-4" />
              PDF baixado — está na pasta de downloads.
            </div>
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

