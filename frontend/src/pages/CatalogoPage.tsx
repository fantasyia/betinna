import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

interface CatalogoItem {
  id: string;
  produtoId: string;
  produto?: {
    id: string;
    nome: string;
    sku?: string;
    marca?: string;
    precoFabrica: number;
    precoTabela: number;
    imagem?: string | null;
  };
  markup: number;
  /** Preço final = precoFabrica * (1 + markup/100) — calculado pelo backend */
  precoFinal?: number;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoFabrica?: number;
  precoTabela?: number;
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

interface PreviewItem {
  produtoId: string;
  produto?: { id: string; nome: string; sku?: string };
  precoFabrica: number;
  precoTabela: number;
  precoEspecial?: number | null;
  markup: number;
  /** Preço final aplicado pro cliente (considera negociado se houver) */
  precoFinal: number;
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

export default function CatalogoPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<CatalogoItem[] | { data: CatalogoItem[] }>(
    '/catalogo',
  );
  // useMemo evita nova ref a cada render — o useMemo de `stats` abaixo
  // depende dessa lista; sem isso eslint-react-hooks reclama.
  const itens: CatalogoItem[] = useMemo(
    () => (Array.isArray(data) ? data : data?.data ?? []),
    [data],
  );

  const [adding, setAdding] = useState(false);
  const [markupGlobal, setMarkupGlobal] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  // Stats
  const stats = useMemo(() => {
    const totalItens = itens.length;
    const markupMedio =
      totalItens > 0 ? itens.reduce((s, i) => s + i.markup, 0) / totalItens : 0;
    const semMarkup = itens.filter((i) => i.markup === 0).length;
    return { totalItens, markupMedio, semMarkup };
  }, [itens]);

  // Sinaliza qual linha está com request de markup em curso (feedback visual)
  const [savingMarkup, setSavingMarkup] = useState<string | null>(null);

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
    if (!confirm('Remover este produto do seu catálogo?')) return;
    try {
      await api.delete(`/catalogo/item/${produtoId}`);
      toast.success('Produto removido do catálogo');
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  const columns: Column<CatalogoItem>[] = [
    {
      key: 'produto',
      header: 'Produto',
      render: (i) => (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {i.produto?.imagem ? (
            <img
              src={i.produto.imagem}
              alt=""
              style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: 4, background: '#f0f0f0' }} />
          )}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{i.produto?.nome ?? '—'}</div>
            <div style={{ fontSize: 11, color: colors.muted }}>
              {[i.produto?.sku, i.produto?.marca].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'fabrica',
      header: 'Preço fábrica',
      render: (i) => fmtBRL(i.produto?.precoFabrica ?? 0),
    },
    {
      key: 'tabela',
      header: 'Tabela',
      render: (i) => (
        <span style={{ color: colors.muted }}>{fmtBRL(i.produto?.precoTabela ?? 0)}</span>
      ),
    },
    {
      key: 'markup',
      header: 'Markup %',
      render: (i) => {
        const isSaving = savingMarkup === i.produtoId;
        return (
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            // Uncontrolled — `key` força reset quando i.markup muda externamente
            // (após refetch). Permite digitar livremente entre re-renders.
            key={`${i.produtoId}-${i.markup}`}
            defaultValue={i.markup}
            disabled={isSaving}
            data-testid={`markup-input-${i.produtoId}`}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v !== i.markup) {
                void updateMarkup(i.produtoId, v);
              }
            }}
            style={{
              width: 70,
              padding: '0.25rem 0.5rem',
              border: `1px solid ${isSaving ? colors.warning : colors.borderStrong}`,
              borderRadius: 4,
              fontSize: 14,
              fontFamily: 'inherit',
              background: isSaving ? '#fff8e1' : undefined,
              cursor: isSaving ? 'progress' : 'text',
            }}
          />
        );
      },
    },
    {
      key: 'final',
      header: 'Preço final',
      render: (i) => {
        const fabrica = i.produto?.precoFabrica ?? 0;
        const final = i.precoFinal ?? fabrica * (1 + i.markup / 100);
        const tabela = i.produto?.precoTabela ?? 0;
        const diff = tabela > 0 ? ((final - tabela) / tabela) * 100 : 0;
        return (
          <div>
            <strong>{fmtBRL(final)}</strong>
            {tabela > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: diff < 0 ? colors.success : diff > 0 ? colors.warning : colors.muted,
                }}
              >
                {diff < 0 ? '−' : '+'}
                {Math.abs(diff).toFixed(1)}% vs tabela
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (i) => (
        <button
          type="button"
          data-testid={`catalogo-rem-${i.produtoId}`}
          onClick={() => removeItem(i.produtoId)}
          style={{ ...btnDanger, padding: '0.125rem 0.5rem', fontSize: 11 }}
        >
          Remover
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Meu catálogo"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="catalogo-add"
            onClick={() => setAdding(true)}
            style={btn}
          >
            + Adicionar produto
          </button>
          <button
            type="button"
            data-testid="catalogo-markup-global"
            onClick={() => setMarkupGlobal(true)}
            disabled={itens.length === 0}
            style={{ ...btnSecondary, opacity: itens.length === 0 ? 0.5 : 1 }}
          >
            Aplicar markup global
          </button>
          <button
            type="button"
            data-testid="catalogo-preview"
            onClick={() => setPreviewOpen(true)}
            disabled={itens.length === 0}
            style={{ ...btnSecondary, opacity: itens.length === 0 ? 0.5 : 1 }}
          >
            Preview por cliente
          </button>
          <button
            type="button"
            data-testid="catalogo-share"
            onClick={() => setShareOpen(true)}
            disabled={itens.length === 0}
            style={{ ...btn, opacity: itens.length === 0 ? 0.5 : 1 }}
          >
            Compartilhar
          </button>
        </div>
      }
    >
      <p style={{ color: colors.muted, marginTop: 0, marginBottom: '1rem', fontSize: 14 }}>
        Monte seu catálogo personalizado: escolha produtos e defina o markup% sobre o preço de
        fábrica. Cada cliente vê o preço com seu markup (ou negociado, se houver).
      </p>

      {/* Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <StatBox label="Produtos no catálogo" value={String(stats.totalItens)} />
        <StatBox
          label="Markup médio"
          value={`${stats.markupMedio.toFixed(1)}%`}
          color={colors.primary}
        />
        <StatBox
          label="Sem markup (0%)"
          value={String(stats.semMarkup)}
          color={stats.semMarkup > 0 ? colors.warning : colors.muted}
        />
      </div>

      <div style={card}>
        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && itens.length === 0}
          emptyMessage="Catálogo vazio. Adicione o primeiro produto pra começar."
          onRetry={refetch}
        >
          <Table data={itens} columns={columns} rowKey={(i) => i.produtoId} />
        </StateView>
      </div>

      {itens.length > 5 && (
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="catalogo-clear"
            onClick={() => setClearOpen(true)}
            style={btnDanger}
          >
            Limpar catálogo inteiro
          </button>
        </div>
      )}

      {adding && (
        <AddProdutoModal
          existingIds={new Set(itens.map((i) => i.produtoId))}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refetch();
          }}
        />
      )}
      {markupGlobal && (
        <MarkupGlobalModal
          onClose={() => setMarkupGlobal(false)}
          onSaved={() => {
            setMarkupGlobal(false);
            refetch();
          }}
        />
      )}
      {previewOpen && (
        <PreviewClienteModal onClose={() => setPreviewOpen(false)} />
      )}
      {shareOpen && (
        <ShareModal onClose={() => setShareOpen(false)} />
      )}
      {clearOpen && (
        <ClearModal
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

function StatBox({
  label,
  value,
  color = colors.text,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '0.75rem',
      }}
    >
      <div style={{ fontSize: 11, color: colors.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ─── Adicionar produto ───────────────────────────────────────────────

function AddProdutoModal({
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
    <Modal
      open
      onClose={onClose}
      title="Adicionar produto ao catálogo"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="add-form"
            data-testid="catalogo-add-save"
            disabled={busy || !produto || isDup}
            style={{ ...btn, opacity: busy || !produto || isDup ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Adicionar'}
          </button>
        </>
      }
    >
      <form id="add-form" onSubmit={submit}>
        <FormField label="Produto" required>
          <AsyncCombobox<ProdutoOpt>
            testId="add-produto-picker"
            endpoint="/produtos"
            placeholder="Buscar produto…"
            getLabel={(p) => p.nome}
            getSubLabel={(p) =>
              [p.sku, p.precoFabrica !== undefined ? `fábrica ${fmtBRL(p.precoFabrica)}` : null]
                .filter(Boolean)
                .join(' · ')
            }
            getId={(p) => p.id}
            value={produto}
            onChange={setProduto}
          />
        </FormField>
        {isDup && (
          <p style={{ color: colors.warning, fontSize: 13 }}>
            Este produto já está no seu catálogo. Use o input de markup na lista.
          </p>
        )}
        <FormField
          label="Markup % sobre o preço de fábrica"
          htmlFor="add-markup"
          hint="0% = vende pelo preço de fábrica. 30% = vende fábrica × 1.30."
        >
          <Input
            id="add-markup"
            data-testid="add-markup-input"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={markup}
            onChange={(e) => setMarkup(Number(e.target.value))}
          />
        </FormField>
        {produto?.precoFabrica !== undefined && (
          <div
            style={{
              padding: '0.5rem 0.75rem',
              background: '#fafbfc',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            Preço final: <strong>{fmtBRL(produto.precoFabrica * (1 + markup / 100))}</strong>
            {produto.precoTabela !== undefined && (
              <span style={{ color: colors.muted }}>
                {' '}
                · Tabela: {fmtBRL(produto.precoTabela)}
              </span>
            )}
          </div>
        )}
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}

// ─── Markup global ────────────────────────────────────────────────────

function MarkupGlobalModal({
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
    <Modal
      open
      onClose={onClose}
      title="Aplicar markup global"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid="markup-global-apply"
            disabled={busy}
            onClick={apply}
            style={{ ...btn, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Aplicando…' : `Aplicar ${markup}% em todos`}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14 }}>
        Define o mesmo markup% pra <strong>todos</strong> os produtos do seu catálogo.
        Substitui os markups individuais.
      </p>
      <FormField label="Markup %" htmlFor="mg-input">
        <Input
          id="mg-input"
          data-testid="markup-global-input"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={markup}
          onChange={(e) => setMarkup(Number(e.target.value))}
        />
      </FormField>
      {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}

// ─── Preview por cliente ─────────────────────────────────────────────

function PreviewClienteModal({ onClose }: { onClose: () => void }) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const previewPath = cliente ? `/catalogo/preview?clienteId=${cliente.id}` : null;
  const { data, loading, error } = useApiQuery<PreviewItem[] | { data: PreviewItem[] }>(
    previewPath,
  );
  const itens: PreviewItem[] = Array.isArray(data) ? data : data?.data ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      width={780}
      title="Preview do catálogo aplicado a um cliente"
      footer={
        <button type="button" onClick={onClose} style={btnSecondary}>
          Fechar
        </button>
      }
    >
      <FormField label="Cliente">
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
      </FormField>

      {cliente && (
        <div style={{ marginTop: '1rem' }}>
          {loading && <p style={{ color: colors.muted }}>Calculando preços…</p>}
          {error && <p style={{ color: colors.danger }}>{error}</p>}
          {!loading && !error && (
            <Table
              data={itens}
              rowKey={(i) => i.produtoId}
              columns={[
                {
                  key: 'produto',
                  header: 'Produto',
                  render: (i) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{i.produto?.nome ?? '—'}</div>
                      {i.produto?.sku && (
                        <div style={{ fontSize: 11, color: colors.muted }}>{i.produto.sku}</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'fabrica',
                  header: 'Fábrica',
                  render: (i) => fmtBRL(i.precoFabrica),
                },
                {
                  key: 'markup',
                  header: 'Markup',
                  render: (i) => `${i.markup}%`,
                },
                {
                  key: 'tabela',
                  header: 'Tabela',
                  render: (i) => fmtBRL(i.precoTabela),
                },
                {
                  key: 'especial',
                  header: 'Negociado',
                  render: (i) =>
                    i.precoEspecial !== null && i.precoEspecial !== undefined ? (
                      <span style={badge(colors.warning)}>{fmtBRL(i.precoEspecial)}</span>
                    ) : (
                      <span style={{ color: colors.muted }}>—</span>
                    ),
                },
                {
                  key: 'final',
                  header: 'Final p/ cliente',
                  render: (i) => (
                    <strong style={{ color: colors.success }}>{fmtBRL(i.precoFinal)}</strong>
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Share ────────────────────────────────────────────────────────────

function ShareModal({ onClose }: { onClose: () => void }) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [canal, setCanal] = useState<'whatsapp' | 'pdf' | 'link'>('whatsapp');
  const [validoAte, setValidoAte] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url?: string; pdfBase64?: string; sentToWhatsApp?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    if (!cliente) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = { clienteId: cliente.id, canal };
      if (validoAte) payload.validoAte = validoAte;
      const r = await api.post<{ url?: string; pdfBase64?: string; sentToWhatsApp?: boolean }>(
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
    <Modal
      open
      onClose={onClose}
      title="Compartilhar catálogo com cliente"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {!result && (
            <button
              type="button"
              data-testid="share-confirm"
              disabled={busy || !cliente}
              onClick={share}
              style={{ ...btn, opacity: busy || !cliente ? 0.6 : 1 }}
            >
              {busy ? 'Gerando…' : 'Compartilhar'}
            </button>
          )}
        </>
      }
    >
      {!result && (
        <>
          <FormField label="Cliente" required>
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
          </FormField>
          <FormField label="Canal" htmlFor="share-canal">
            <Select
              id="share-canal"
              value={canal}
              onChange={(e) => setCanal(e.target.value as typeof canal)}
            >
              <option value="whatsapp">WhatsApp (envia direto)</option>
              <option value="pdf">PDF (baixa arquivo)</option>
              <option value="link">Link público (envia por outro meio)</option>
            </Select>
          </FormField>
          <FormField
            label="Validade (opcional)"
            htmlFor="share-validade"
            hint="Quando o link/preço expira"
          >
            <Input
              id="share-validade"
              type="date"
              value={validoAte}
              onChange={(e) => setValidoAte(e.target.value)}
            />
          </FormField>
          {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
        </>
      )}
      {result && (
        <div>
          <p
            style={{
              padding: '0.75rem',
              background: colors.success + '15',
              border: `1px solid ${colors.success}`,
              borderRadius: 6,
              fontSize: 14,
              margin: 0,
            }}
          >
            ✓ Catálogo compartilhado com sucesso.
          </p>
          {result.url && (
            <div style={{ marginTop: '0.75rem' }}>
              <FormField label="Link público gerado" htmlFor="share-url">
                <Input
                  id="share-url"
                  data-testid="share-url"
                  value={result.url}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </FormField>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(result.url ?? '')}
                style={btnSecondary}
              >
                Copiar link
              </button>
            </div>
          )}
          {result.pdfBase64 && (
            <div style={{ marginTop: '0.75rem' }}>
              <a
                href={`data:application/pdf;base64,${result.pdfBase64}`}
                download={`catalogo-${cliente?.nome.replace(/\s+/g, '_') ?? 'cliente'}.pdf`}
                style={{ ...btn, display: 'inline-block', textDecoration: 'none' }}
              >
                Baixar PDF
              </a>
            </div>
          )}
          {result.sentToWhatsApp && (
            <p style={{ fontSize: 14, color: colors.success, marginTop: '0.5rem' }}>
              📲 Enviado via WhatsApp pro cliente.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Clear ────────────────────────────────────────────────────────────

function ClearModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
    <Modal
      open
      onClose={onClose}
      title="Limpar catálogo inteiro"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid="clear-confirm"
            onClick={doClear}
            disabled={busy}
            style={btnDanger}
          >
            {busy ? 'Limpando…' : 'Confirmar — apagar tudo'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14 }}>
        Remove <strong>todos</strong> os produtos do seu catálogo. Você terá que adicionar
        novamente um por um.
      </p>
      <p style={{ fontSize: 13, color: colors.warning }}>
        Esta ação não pode ser desfeita.
      </p>
      {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}
