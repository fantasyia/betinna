import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { useToast } from '@/components/toast';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';
import { formatMoeda as fmtBRL } from '@/lib/masks';

interface Produto {
  id: string;
  nome: string;
  sku?: string | null;
  codigoOmie?: string | null;
  descricao?: string | null;
  marca?: string | null;
  linha?: string | null;
  categoria?: string | null;
  unidade?: string | null;
  precoTabela: number;
  precoFabrica: number | null; // custo — null quando não informado
  imagem?: string | null;
  estoque: number;
  popularidade: number;
  ativo: boolean;
}

interface Facets {
  linhas: string[];
  categorias: string[];
  marcas: string[];
}

export default function ProdutosPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [linha, setLinha] = useState('');
  const [categoria, setCategoria] = useState('');
  const [marca, setMarca] = useState('');
  const [ativo, setAtivo] = useState('');
  const [semEstoque, setSemEstoque] = useState('');
  const [editing, setEditing] = useState<Produto | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (linha) qs.set('linha', linha);
    if (categoria) qs.set('categoria', categoria);
    if (marca) qs.set('marca', marca);
    if (ativo) qs.set('ativo', ativo);
    if (semEstoque) qs.set('semEstoque', semEstoque);
    return `/produtos?${qs.toString()}`;
  }, [page, search, linha, categoria, marca, ativo, semEstoque]);

  const toast = useToast();
  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Produto>>(listPath);
  const { data: facets } = useApiQuery<Facets>('/produtos/facets');

  async function toggleAtivo(p: Produto) {
    try {
      await api.put(`/produtos/${p.id}/ativo`, { ativo: !p.ativo });
      toast.success(p.ativo ? 'Produto desativado' : 'Produto ativado');
      refetch();
    } catch (err) {
      toast.error('Falha ao mudar status', err instanceof ApiError ? err.message : undefined);
    }
  }

  const columns: Column<Produto>[] = [
    {
      key: 'nome',
      header: 'Produto',
      render: (p) => (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {p.imagem ? (
            <img
              src={p.imagem}
              alt=""
              style={{
                width: 36,
                height: 36,
                borderRadius: 4,
                objectFit: 'cover',
                background: '#f0f0f0',
              }}
            />
          ) : (
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 4,
                background: '#f0f0f0',
              }}
            />
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{p.nome}</div>
            <div style={{ fontSize: 11, color: colors.muted }}>
              {[p.sku ?? p.codigoOmie, p.marca].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'classif',
      header: 'Classif.',
      render: (p) => (
        <div style={{ fontSize: 12 }}>
          {p.linha && <div>{p.linha}</div>}
          {p.categoria && <div style={{ color: colors.muted }}>{p.categoria}</div>}
        </div>
      ),
    },
    {
      key: 'preco',
      header: 'Preço',
      render: (p) => (
        <div>
          <strong>{fmtBRL(p.precoTabela)}</strong>
          <div style={{ fontSize: 11, color: colors.muted }}>
            {p.precoFabrica != null ? `fábrica: ${fmtBRL(p.precoFabrica)}` : 'custo não informado'}
          </div>
        </div>
      ),
    },
    {
      key: 'estoque',
      header: 'Estoque',
      render: (p) => (
        <span
          style={{
            color:
              p.estoque === 0
                ? colors.danger
                : p.estoque < 10
                ? colors.warning
                : colors.text,
            fontWeight: 600,
          }}
        >
          {p.estoque} {p.unidade ?? 'un'}
        </span>
      ),
    },
    {
      key: 'pop',
      header: 'Popularidade',
      render: (p) => `${p.popularidade}`,
    },
    {
      key: 'ativo',
      header: 'Status',
      render: (p) => (
        <button
          type="button"
          data-testid={`prod-toggle-${p.id}`}
          onClick={() => toggleAtivo(p)}
          style={{
            ...badge(p.ativo ? colors.success : colors.muted),
            cursor: 'pointer',
            border: 'none',
            fontFamily: 'inherit',
          }}
        >
          {p.ativo ? 'Ativo' : 'Inativo'}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <button
          type="button"
          data-testid={`prod-edit-${p.id}`}
          onClick={() => setEditing(p)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Produtos"
      description="Os produtos são sincronizados automaticamente do Omie. Para incluir ou alterar a ficha do produto, edite no Omie e aguarde a próxima sincronização."
    >
      <CatalogoTabs />
      <div style={card}>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Nome, SKU, marca…"
          />
          <Select
            data-testid="filter-linha"
            value={linha}
            onChange={(e) => {
              setLinha(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas linhas</option>
            {facets?.linhas.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-cat"
            value={categoria}
            onChange={(e) => {
              setCategoria(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas categorias</option>
            {facets?.categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-marca"
            value={marca}
            onChange={(e) => {
              setMarca(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas marcas</option>
            {facets?.marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-ativo"
            value={ativo}
            onChange={(e) => {
              setAtivo(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Ativos + inativos</option>
            <option value="true">Apenas ativos</option>
            <option value="false">Apenas inativos</option>
          </Select>
          <Select
            data-testid="filter-estoque"
            value={semEstoque}
            onChange={(e) => {
              setSemEstoque(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Estoque: todos</option>
            <option value="true">Apenas sem estoque</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhum produto encontrado."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(p) => p.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {editing && (
        <ProdutoFormModal
          produto={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────

interface FormState {
  nome: string;
  sku: string;
  codigoOmie: string;
  descricao: string;
  marca: string;
  linha: string;
  categoria: string;
  unidade: string;
  precoTabela: string;
  precoFabrica: string;
  imagem: string;
  estoque: number;
  popularidade: number;
  ativo: boolean;
}

function initial(p?: Produto | null): FormState {
  return {
    nome: p?.nome ?? '',
    sku: p?.sku ?? '',
    codigoOmie: p?.codigoOmie ?? '',
    descricao: p?.descricao ?? '',
    marca: p?.marca ?? '',
    linha: p?.linha ?? '',
    categoria: p?.categoria ?? '',
    unidade: p?.unidade ?? '',
    precoTabela: p?.precoTabela?.toString() ?? '',
    precoFabrica: p?.precoFabrica?.toString() ?? '',
    imagem: p?.imagem ?? '',
    estoque: p?.estoque ?? 0,
    popularidade: p?.popularidade ?? 0,
    ativo: p?.ativo ?? true,
  };
}

function ProdutoFormModal({
  produto,
  onClose,
  onSaved,
}: {
  produto: Produto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(produto);
  const [form, setForm] = useState<FormState>(initial(produto));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  function setF<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  const precoTabela = Number(form.precoTabela);
  // Custo é OPCIONAL: vazio = null ("não informado"). Só validamos quando preenchido.
  const precoFabrica = form.precoFabrica.trim() === '' ? null : Number(form.precoFabrica);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.nome.trim().length < 2) {
      setError('Nome do produto precisa ter no mínimo 2 caracteres.');
      return;
    }
    if (!(precoTabela > 0)) {
      setError('Preço de tabela precisa ser maior que zero.');
      return;
    }
    if (precoFabrica !== null && !(precoFabrica > 0)) {
      setError('Se informar o custo (preço de fábrica), ele precisa ser maior que zero.');
      return;
    }
    if (precoFabrica !== null && precoFabrica > precoTabela) {
      setError('Preço de fábrica não pode ser maior que preço de tabela.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      precoTabela,
      precoFabrica,
      estoque: form.estoque,
      popularidade: form.popularidade,
      ativo: form.ativo,
    };
    for (const k of ['sku', 'codigoOmie', 'descricao', 'marca', 'linha', 'categoria', 'unidade', 'imagem'] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      if (isEdit && produto) {
        await api.patch(`/produtos/${produto.id}`, payload);
      } else {
        await api.post('/produtos', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!produto) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/produtos/${produto.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao excluir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={720}
      title={isEdit ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          {isEdit && !confirmDel && (
            <button
              type="button"
              data-testid="prod-delete"
              onClick={() => setConfirmDel(true)}
              style={btnDanger}
            >
              Excluir
            </button>
          )}
          {isEdit && confirmDel && (
            <>
              <button type="button" onClick={() => setConfirmDel(false)} style={btnSecondary}>
                Voltar
              </button>
              <button
                type="button"
                data-testid="prod-delete-confirm"
                disabled={busy}
                onClick={doDelete}
                style={btnDanger}
              >
                {busy ? '…' : 'Confirmar'}
              </button>
            </>
          )}
          {!confirmDel && (
            <button
              type="submit"
              form="prod-form"
              data-testid="prod-save-btn"
              disabled={busy}
              style={{ ...btn, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </>
      }
    >
      <form id="prod-form" onSubmit={submit}>
        <FormField label="Nome" htmlFor="p-nome" required>
          <Input
            id="p-nome"
            data-testid="prod-nome-input"
            value={form.nome}
            onChange={(e) => setF('nome', e.target.value)}
            minLength={2}
            maxLength={200}
            required
            autoFocus
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <FormField label="SKU" htmlFor="p-sku">
            <Input id="p-sku" value={form.sku} onChange={(e) => setF('sku', e.target.value)} />
          </FormField>
          <FormField label="Código OMIE" htmlFor="p-omie">
            <Input id="p-omie" value={form.codigoOmie} onChange={(e) => setF('codigoOmie', e.target.value)} />
          </FormField>
          <FormField label="Unidade" htmlFor="p-un">
            <Input id="p-un" placeholder="cx, un, kg…" value={form.unidade} onChange={(e) => setF('unidade', e.target.value)} />
          </FormField>
          <FormField label="Marca" htmlFor="p-marca">
            <Input id="p-marca" value={form.marca} onChange={(e) => setF('marca', e.target.value)} />
          </FormField>
          <FormField label="Linha" htmlFor="p-linha">
            <Input id="p-linha" value={form.linha} onChange={(e) => setF('linha', e.target.value)} />
          </FormField>
          <FormField label="Categoria" htmlFor="p-cat">
            <Input id="p-cat" value={form.categoria} onChange={(e) => setF('categoria', e.target.value)} />
          </FormField>
          <FormField label="Preço tabela" htmlFor="p-pt" required>
            <Input
              id="p-pt"
              data-testid="prod-preco-tabela-input"
              type="number"
              min={0.01}
              step="0.01"
              value={form.precoTabela}
              onChange={(e) => setF('precoTabela', e.target.value)}
              required
            />
          </FormField>
          <FormField label="Preço fábrica (custo — opcional)" htmlFor="p-pf">
            <Input
              id="p-pf"
              type="number"
              min={0.01}
              step="0.01"
              placeholder="deixe em branco se não souber o custo"
              value={form.precoFabrica}
              onChange={(e) => setF('precoFabrica', e.target.value)}
            />
          </FormField>
          <FormField label="Estoque" htmlFor="p-est">
            <Input
              id="p-est"
              type="number"
              min={0}
              value={form.estoque}
              onChange={(e) => setF('estoque', Number(e.target.value))}
            />
          </FormField>
          <FormField label="Popularidade (0–100)" htmlFor="p-pop">
            <Input
              id="p-pop"
              type="number"
              min={0}
              max={100}
              value={form.popularidade}
              onChange={(e) => setF('popularidade', Number(e.target.value))}
            />
          </FormField>
          <FormField label="Status" htmlFor="p-at">
            <Select
              id="p-at"
              value={form.ativo ? 'true' : 'false'}
              onChange={(e) => setF('ativo', e.target.value === 'true')}
            >
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </Select>
          </FormField>
        </div>
        <FormField label="Imagem (URL)" htmlFor="p-img">
          <Input
            id="p-img"
            type="url"
            value={form.imagem}
            onChange={(e) => setF('imagem', e.target.value)}
            placeholder="https://…"
          />
        </FormField>
        <FormField label="Descrição" htmlFor="p-desc" hint="Pode incluir composição, modo de uso, etc.">
          <Textarea
            id="p-desc"
            value={form.descricao}
            onChange={(e) => setF('descricao', e.target.value)}
            style={{ minHeight: 100 }}
            maxLength={5000}
          />
        </FormField>
        {error && (
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
