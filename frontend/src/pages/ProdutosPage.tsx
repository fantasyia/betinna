import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { PageLayout } from '@/components/PageLayout';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Select } from '@/components/FormField';
import { Checkbox } from '@/components/ui';
import { Sparkles } from 'lucide-react';
import { useEstoqueModo, textoMontagem } from '@/hooks/useEstoqueModo';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL } from '@/lib/masks';

interface Produto {
  id: string;
  nome: string;
  sku?: string | null;
  codigoErp?: string | null;
  descricao?: string | null;
  marca?: string | null;
  linha?: string | null;
  categoria?: string | null;
  unidade?: string | null;
  /** Preço de VENDA. `null` pro REP — ele loca, não vende. */
  precoTabela: number | null;
  precoFabrica: number | null; // custo — null quando não informado
  /** Mensalidade de locação (tabela própria, como no ERP). */
  precoLocacaoMensal: number | null;
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
  // Locação x venda: o catálogo tem os dois, e os Master Block base são as DUAS
  // coisas — por isso cada opção filtra "dá pra oferecer assim", não "é disso".
  const [modalidade, setModalidade] = useState('');
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
    if (modalidade) qs.set('modalidade', modalidade);
    return `/produtos?${qs.toString()}`;
  }, [page, buscaDebounced, linha, categoria, marca, ativo, semEstoque, modalidade]);

  const toast = useToast();
  const role = useRole();
  // D45/D50: sincronizar o ERP é ADMIN ou DIRETOR — nunca outro papel.
  const podeSincronizarErp = role === 'ADMIN' || role === 'DIRECTOR';
  // REP loca, não vende: a coluna de venda (e o custo dentro dela) não é dele.
  const podeVerVenda = role !== 'REP';
  const [sincronizandoErp, setSincronizandoErp] = useState(false);
  const {
    data: pageResp,
    loading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse<Produto>>(listPath);
  const { data: facets } = useApiQuery<Facets>('/produtos/facets');
  // O catálogo do próprio usuário — serve pra marcar aqui o que já está lá e
  // não deixar ninguém "adicionar" o que já tem.
  const { data: meuCatalogo, refetch: refetchCatalogo } = useApiQuery<
    Array<{ produtoId: string }> | { data: Array<{ produtoId: string }> }
  >('/catalogo');
  const jaNoCatalogo = useMemo(() => {
    const lista = Array.isArray(meuCatalogo) ? meuCatalogo : (meuCatalogo?.data ?? []);
    return new Set(lista.map((i) => i.produtoId));
  }, [meuCatalogo]);

  const estoqueModo = useEstoqueModo();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [adicionando, setAdicionando] = useState(false);

  const daPagina = pageResp?.data ?? [];
  const selecionaveis = daPagina.filter((p) => !jaNoCatalogo.has(p.id));
  const paginaToda = selecionaveis.length > 0 && selecionaveis.every((p) => selecionados.has(p.id));

  function alternarProduto(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function alternarPagina() {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (paginaToda) for (const p of selecionaveis) proximo.delete(p.id);
      else for (const p of selecionaveis) proximo.add(p.id);
      return proximo;
    });
  }

  /**
   * Levar produto pro catálogo daqui é o caminho natural: é nesta lista que se
   * FILTRA e se COMPARA. Antes só dava pra montar catálogo de dentro do
   * "Meu catálogo", um produto por vez, digitando o nome de cabeça.
   */
  async function adicionarAoCatalogo() {
    if (selecionados.size === 0 || adicionando) return;
    setAdicionando(true);
    try {
      const itens = [...selecionados].map((produtoId) => ({ produtoId }));
      await api.post('/catalogo/bulk', { itens });
      toast.success(
        `${itens.length} produto${itens.length === 1 ? '' : 's'} no seu catálogo`,
        'Veja em Catálogo → Meu catálogo',
      );
      setSelecionados(new Set());
      refetchCatalogo();
    } catch (err) {
      toast.error(
        'Falha ao adicionar ao catálogo',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setAdicionando(false);
    }
  }

  async function sincronizarErp() {
    if (sincronizandoErp) return;
    setSincronizandoErp(true);
    toast.info('Sincronizando produtos do ERP (Tiny)… pode levar alguns segundos.');
    try {
      // ERP = Tiny (D50). Apontava pro ERP, que estava em modo DEMO e
      // despejou três produtos fictícios de mercearia no catálogo real.
      const r = await api.post<{
        lidos?: number;
        criados?: number;
        atualizados?: number;
        erros?: number;
      }>('/integracoes/tiny/sync/produtos?modo=completo', {});
      toast.success(
        `Produtos sincronizados do ERP — ${r.criados ?? 0} novos, ${r.atualizados ?? 0} atualizados` +
          (r.erros ? `, ${r.erros} com erro` : '.'),
      );
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Falha ao sincronizar do ERP. Verifique a integração Tiny em Integrações.',
      );
    } finally {
      setSincronizandoErp(false);
    }
  }

  const todasColunas: Column<Produto>[] = [
    {
      key: 'sel',
      // Cabeçalho vazio de propósito: em telas pequenas a Table repete o
      // cabeçalho de cada coluna dentro do card, e um "selecionar tudo" por
      // linha não faz sentido. O selecionar-tudo vive na barra acima.
      header: '',
      width: 36,
      render: (p) =>
        jaNoCatalogo.has(p.id) ? (
          <span title="Já está no seu catálogo" className="text-success">
            ✓
          </span>
        ) : (
          <Checkbox
            data-testid={`prod-sel-${p.id}`}
            checked={selecionados.has(p.id)}
            onChange={() => alternarProduto(p.id)}
            aria-label={`Selecionar ${p.nome}`}
          />
        ),
    },
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
              {[p.sku ?? p.codigoErp, p.marca].filter(Boolean).join(' · ') || '—'}
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
      header: 'Venda',
      render: (p) => (
        <div>
          <strong>{p.precoTabela != null ? fmtBRL(p.precoTabela) : '—'}</strong>
          <div className="text-[11px] text-muted">
            {p.precoFabrica != null ? `custo: ${fmtBRL(p.precoFabrica)}` : 'custo não informado'}
          </div>
        </div>
      ),
    },
    {
      key: 'locacao',
      header: 'Locação / mês',
      render: (p) => (
        <div>
          <strong>{p.precoLocacaoMensal != null ? fmtBRL(p.precoLocacaoMensal) : '—'}</strong>
          {p.precoLocacaoMensal == null && (
            <div className="text-[11px] text-muted">não cadastrado no ERP</div>
          )}
        </div>
      ),
    },
    {
      key: 'estoque',
      header: 'Estoque',
      // Sob encomenda o produto e montado DEPOIS do pedido (uma OP por pedido),
      // entao saldo zero e o estado normal — pintar de vermelho todo dia ensina
      // o time a ignorar a cor.
      render: (p) =>
        estoqueModo.sobEncomenda ? (
          <span className="text-[12px] text-muted">
            {p.estoque > 0 ? `${p.estoque} pronto(s)` : 'sob encomenda'}
            <span className="block text-[10px] text-muted-light">
              {textoMontagem(estoqueModo.diasMontagem)}
            </span>
          </span>
        ) : (
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
      // LEITURA. Era um botão que chamava `PUT /produtos/:id/ativo` — rota que
      // deixou de existir quando o ERP virou fonte da verdade (a21a073). Ficou
      // clicável, então qualquer papel que apertasse o selo levava erro: a tela
      // prometia uma ação que o backend já não tinha. Ativar/desativar produto
      // é no ERP.
      render: (p) => (
        <span
          data-testid={`prod-status-${p.id}`}
          className={cn(
            'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]',
            p.ativo ? 'bg-success/12 text-success' : 'bg-muted/12 text-muted',
          )}
        >
          {p.ativo ? 'Ativo' : 'Inativo'}
        </span>
      ),
    },
    // SEM coluna de ações: produto NÃO se edita pelo app — nem rep, nem
    // gerente, nem diretor, nem admin. A fonte da verdade é o ERP, e o app
    // espelha. Botão de editar aqui criaria duas verdades: alguém mudaria o
    // preço no Betinna, o próximo sync sobrescreveria, e ninguém entenderia
    // por quê.
  ];
  const columns: Column<Produto>[] = todasColunas
    // A coluna de VENDA some inteira pro REP: ele loca, não vende. Esconder a
    // coluna é mais honesto que mostrar "—" numa coluna chamada "Venda", que só
    // levanta a pergunta "por que eu não vejo isso?".
    .filter((c) => podeVerVenda || c.key !== 'preco');

  return (
    <PageLayout
      title="Produtos"
      description="Espelho do catálogo do ERP (Tiny). Cadastro, preço e edição acontecem no ERP — aqui é só leitura. Use 'Sincronizar do ERP' pra trazer as mudanças."
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
              title="Baixa o catálogo completo do ERP (Tiny)."
              className="bg-surface text-text border border-border-strong rounded-md py-2 px-4 text-sm font-semibold cursor-pointer disabled:opacity-60"
            >
              {sincronizandoErp ? 'Sincronizando…' : '↻ Sincronizar do ERP'}
            </button>
          )}
          {/* Sem "novo produto": cadastro é no ERP. */}
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
            data-testid="filter-modalidade"
            value={modalidade}
            onChange={(e) => {
              setModalidade(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Locação + venda</option>
            <option value="locacao">Só o que é locado</option>
            <option value="venda">Só o que é vendido</option>
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
          {/* Sob encomenda, "apenas sem estoque" traria o catálogo inteiro — filtro
              que não separa nada é só mais um controle pra ignorar. */}
          {!estoqueModo.sobEncomenda && (
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
          )}
        </FilterBar>

        <div className="flex flex-wrap items-center gap-3 py-2">
          <Checkbox
            data-testid="prod-sel-pagina"
            label="Selecionar todos desta página"
            checked={paginaToda}
            disabled={selecionaveis.length === 0}
            onChange={alternarPagina}
          />
          {selecionados.size > 0 && (
            <>
              <button
                type="button"
                data-testid="prod-add-catalogo"
                onClick={adicionarAoCatalogo}
                disabled={adicionando}
                className="inline-flex items-center gap-1.5 rounded-md border-none bg-primary px-4 py-2 text-sm font-semibold text-white cursor-pointer disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {adicionando ? 'Adicionando…' : `Adicionar ${selecionados.size} ao meu catálogo`}
              </button>
              <button
                type="button"
                onClick={() => setSelecionados(new Set())}
                className="text-xs text-muted hover:text-text"
              >
                Limpar seleção
              </button>
            </>
          )}
        </div>

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
    </PageLayout>
  );
}
