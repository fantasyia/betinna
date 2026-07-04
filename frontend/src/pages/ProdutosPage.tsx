import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { PageLayout } from '@/components/PageLayout';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
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
  tierComercial?: string | null;
  pesoPorUnidade?: number | null;
  atributos?: Record<string, unknown> | null;
}

interface Facets {
  linhas: string[];
  categorias: string[];
  marcas: string[];
}

export default function ProdutosPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // Busca com debounce: o input responde na hora, requisição só ~300ms após parar.
  const buscaDebounced = useDebouncedValue(search, 300);
  const [linha, setLinha] = useState('');
  const [categoria, setCategoria] = useState('');
  const [marca, setMarca] = useState('');
  const [ativo, setAtivo] = useState('');
  const [semEstoque, setSemEstoque] = useState('');
  const [editing, setEditing] = useState<Produto | null>(null);
  const [criando, setCriando] = useState(false);

  // Volta pra página 1 quando a busca (já debounced) muda.
  useEffect(() => {
    setPage(1);
  }, [buscaDebounced]);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (buscaDebounced.trim()) qs.set('search', buscaDebounced.trim());
    if (linha) qs.set('linha', linha);
    if (categoria) qs.set('categoria', categoria);
    if (marca) qs.set('marca', marca);
    if (ativo) qs.set('ativo', ativo);
    if (semEstoque) qs.set('semEstoque', semEstoque);
    return `/produtos?${qs.toString()}`;
  }, [page, buscaDebounced, linha, categoria, marca, ativo, semEstoque]);

  const toast = useToast();
  const role = useRole();
  const podeSincronizarErp = role === 'ADMIN' || role === 'DIRECTOR'; // D45: OMIE é DIRETOR-only
  const [sincronizandoErp, setSincronizandoErp] = useState(false);
  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Produto>>(listPath);
  const { data: facets } = useApiQuery<Facets>('/produtos/facets');

  async function sincronizarErp() {
    if (sincronizandoErp) return;
    setSincronizandoErp(true);
    toast.info('Sincronizando produtos do ERP (Omie)… pode levar alguns segundos.');
    try {
      const r = await api.post<{ produtos?: { inseridos?: number; atualizados?: number } }>(
        '/integracoes/omie/sync/forcar',
        {},
      );
      const p = r.produtos ?? {};
      toast.success(
        `Produtos sincronizados do ERP — ${p.inseridos ?? 0} novos, ${p.atualizados ?? 0} atualizados.`,
      );
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Falha ao sincronizar do ERP. Verifique a integração Omie em Integrações.',
      );
    } finally {
      setSincronizandoErp(false);
    }
  }

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
        <div className="flex gap-2 items-center">
          {p.imagem ? (
            <img
              src={p.imagem}
              alt=""
              className="w-9 h-9 rounded-[4px] object-cover bg-[#f0f0f0]"
            />
          ) : (
            <div className="w-9 h-9 rounded-[4px] bg-[#f0f0f0]" />
          )}
          <div>
            <div className="font-semibold">{p.nome}</div>
            <div className="text-[11px] text-muted">
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
        <div className="text-xs">
          {p.linha && <div>{p.linha}</div>}
          {p.categoria && <div className="text-muted">{p.categoria}</div>}
        </div>
      ),
    },
    {
      key: 'preco',
      header: 'Preço',
      render: (p) => (
        <div>
          <strong>{fmtBRL(p.precoTabela)}</strong>
          <div className="text-[11px] text-muted">
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
          className="font-semibold"
          style={{
            color:
              p.estoque === 0
                ? 'var(--danger)'
                : p.estoque < 10
                ? 'var(--warning)'
                : 'var(--text)',
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
          className={cn(
            'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] cursor-pointer border-none font-[inherit]',
            p.ativo ? 'bg-success/12 text-success' : 'bg-muted/12 text-muted',
          )}
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
          className="bg-surface text-text border border-border-strong rounded-md py-1 px-2.5 text-xs font-medium cursor-pointer tracking-[-0.1px]"
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Produtos"
      description="Cadastre produtos aqui no Betinna, ou sincronize do ERP (Omie) quando integrado. Os campos vindos do ERP ficam read-only; a ficha de marketing (foto, tier, atributos) é editável no app."
    >
      <CatalogoTabs />
      <div className="bg-surface border border-border rounded-[10px] p-6">
        <div className="flex justify-end gap-2 mb-3">
          {podeSincronizarErp && (
            <button
              type="button"
              data-testid="prod-sync-erp"
              onClick={sincronizarErp}
              disabled={sincronizandoErp}
              title="Baixa o catálogo completo do ERP (Omie). Campos do ERP ficam read-only."
              className="bg-surface text-text border border-border-strong rounded-md py-2 px-4 text-sm font-semibold cursor-pointer disabled:opacity-60"
            >
              {sincronizandoErp ? 'Sincronizando…' : '↻ Sincronizar do ERP'}
            </button>
          )}
          <button
            type="button"
            data-testid="prod-novo"
            onClick={() => setCriando(true)}
            className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none"
          >
            + Novo produto
          </button>
        </div>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => setSearch(v)}
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

      {(editing || criando) && (
        <ProdutoFormModal
          produto={editing}
          onClose={() => {
            setEditing(null);
            setCriando(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCriando(false);
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
  tierComercial: string;
  pesoPorUnidade: string;
  atributos: Array<{ chave: string; valor: string }>;
}

/** Converte o valor de um atributo pra número/booleano quando faz sentido (senão texto). */
function parseAttrValor(v: string): unknown {
  const t = v.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  return Number.isFinite(n) && t === String(n) ? n : t;
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
    tierComercial: p?.tierComercial ?? '',
    pesoPorUnidade: p?.pesoPorUnidade?.toString() ?? '',
    atributos: p?.atributos
      ? Object.entries(p.atributos).map(([chave, valor]) => ({ chave, valor: String(valor) }))
      : [],
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
  function setAttr(i: number, field: 'chave' | 'valor', v: string) {
    setForm((s) => ({
      ...s,
      atributos: s.atributos.map((a, idx) => (idx === i ? { ...a, [field]: v } : a)),
    }));
  }
  function addAttr() {
    setForm((s) => ({ ...s, atributos: [...s.atributos, { chave: '', valor: '' }] }));
  }
  function removeAttr(i: number) {
    setForm((s) => ({ ...s, atributos: s.atributos.filter((_, idx) => idx !== i) }));
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
    // Camada de marketing (Fatia 1 do app do rep).
    const tier = form.tierComercial.trim();
    if (tier) payload.tierComercial = tier;
    const peso = form.pesoPorUnidade.trim();
    if (peso && Number(peso) > 0) payload.pesoPorUnidade = Number(peso);
    const attrs = form.atributos.filter((a) => a.chave.trim());
    payload.atributos = attrs.length
      ? Object.fromEntries(attrs.map((a) => [a.chave.trim(), parseAttrValor(a.valor)]))
      : null;
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
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          {isEdit && !confirmDel && (
            <button
              type="button"
              data-testid="prod-delete"
              onClick={() => setConfirmDel(true)}
              className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              Excluir
            </button>
          )}
          {isEdit && confirmDel && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
              >
                Voltar
              </button>
              <button
                type="button"
                data-testid="prod-delete-confirm"
                disabled={busy}
                onClick={doDelete}
                className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
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
              className={cn(
                'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]',
                busy && 'opacity-60',
              )}
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
        <div className="grid grid-cols-3 gap-3">
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
          <FormField label="Tier comercial" htmlFor="p-tier" hint="entrada / valor_agregado / nobre (livre)">
            <Input
              id="p-tier"
              list="tier-opts"
              placeholder="entrada, valor_agregado, nobre…"
              value={form.tierComercial}
              onChange={(e) => setF('tierComercial', e.target.value)}
            />
            <datalist id="tier-opts">
              <option value="entrada" />
              <option value="valor_agregado" />
              <option value="nobre" />
            </datalist>
          </FormField>
          <FormField
            label="Peso por unidade (kg)"
            htmlFor="p-peso"
            hint="só p/ produto não-kg, converte no mínimo por peso"
          >
            <Input
              id="p-peso"
              type="number"
              min={0}
              step="0.001"
              placeholder="ex: 0.95 (molho em L)"
              value={form.pesoPorUnidade}
              onChange={(e) => setF('pesoPorUnidade', e.target.value)}
            />
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
        <FormField
          label="Atributos customizados"
          hint="Dados livres do produto (ex: shelf_life_meses = 12). Chave + valor."
        >
          <div className="flex flex-col gap-2">
            {form.atributos.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  placeholder="chave (ex: shelf_life_meses)"
                  value={a.chave}
                  onChange={(e) => setAttr(i, 'chave', e.target.value)}
                />
                <Input
                  placeholder="valor (ex: 12)"
                  value={a.valor}
                  onChange={(e) => setAttr(i, 'valor', e.target.value)}
                />
                <button
                  type="button"
                  className="text-danger text-[13px] px-2"
                  onClick={() => removeAttr(i)}
                >
                  remover
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-primary text-[13px] self-start"
              onClick={addAttr}
            >
              + adicionar atributo
            </button>
          </div>
        </FormField>
        {error && (
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
