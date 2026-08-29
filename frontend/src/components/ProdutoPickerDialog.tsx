import { useEffect, useMemo, useState } from 'react';
import { Check, Package, Plus, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { StateView } from '@/components/StateView';
import { useToast } from '@/components/toast';
import { Badge, Button, Checkbox, Dialog, EmptyState, Input } from '@/components/ui';
import { Pagination } from '@/components/Table';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL } from '@/lib/masks';
import { useEstoqueModo } from '@/hooks/useEstoqueModo';

export interface ProdutoDoPicker {
  id: string;
  nome: string;
  sku?: string | null;
  marca?: string | null;
  imagem?: string | null;
  estoque?: number;
  /** Preço de VENDA — chega `null` pro REP, que loca em vez de vender. */
  precoTabela?: number | null;
  precoLocacaoMensal?: number | null;
}

const POR_PAGINA = 24;

/**
 * Escolher produtos pro catálogo — uma LISTA, não um campo de busca.
 *
 * O seletor anterior era um combobox: caixinha estreita, um item por vez, e
 * pra montar um catálogo de dez produtos a pessoa abria o diálogo dez vezes.
 * Pior: só dava pra escolher quem já sabia o nome do produto de cabeça — quem
 * queria "ver o que tem" não tinha como.
 *
 * Aqui a lista é o produto: foto, SKU, preço e estoque visíveis, busca por
 * cima e seleção múltipla. A seleção **sobrevive à busca e à paginação** (fica
 * num mapa por id, não na lista renderizada), senão trocar o termo de busca
 * apagaria o que a pessoa acabou de marcar.
 *
 * O que já está no catálogo aparece marcado e travado — some a dúvida "será que
 * eu já adicionei esse?", que era o outro jeito de errar no seletor antigo.
 */
export function ProdutoPickerDialog({
  jaNoCatalogo,
  onClose,
  onAdicionados,
}: {
  jaNoCatalogo: Set<string>;
  onClose: () => void;
  onAdicionados: (quantidade: number) => void;
}) {
  const toast = useToast();
  const { sobEncomenda } = useEstoqueModo();
  const [busca, setBusca] = useState('');
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [page, setPage] = useState(1);
  const [somenteComEstoque, setSomenteComEstoque] = useState(false);
  // Mapa (não array) porque a seleção precisa atravessar busca e paginação: o
  // produto marcado na página 1 continua marcado depois de filtrar por outro
  // termo, e o rodapé consegue dizer o que está selecionado sem ter a linha
  // renderizada na tela.
  const [selecionados, setSelecionados] = useState<Map<string, ProdutoDoPicker>>(new Map());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [buscaDebounced, somenteComEstoque]);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({
      page: String(page),
      limit: String(POR_PAGINA),
      ativo: 'true',
    });
    if (buscaDebounced.trim()) qs.set('search', buscaDebounced.trim());
    return `/produtos?${qs.toString()}`;
  }, [page, buscaDebounced]);

  const { data, loading, error, refetch } = useApiQuery<PaginatedResponse<ProdutoDoPicker>>(
    listPath,
  );

  const produtos = useMemo(() => {
    const lista = data?.data ?? [];
    return somenteComEstoque ? lista.filter((p) => (p.estoque ?? 0) > 0) : lista;
  }, [data, somenteComEstoque]);

  const selecionaveis = produtos.filter((p) => !jaNoCatalogo.has(p.id));
  const todosDaPagina =
    selecionaveis.length > 0 && selecionaveis.every((p) => selecionados.has(p.id));

  function alternar(p: ProdutoDoPicker) {
    setSelecionados((atual) => {
      const proximo = new Map(atual);
      if (proximo.has(p.id)) proximo.delete(p.id);
      else proximo.set(p.id, p);
      return proximo;
    });
  }

  function alternarPagina() {
    setSelecionados((atual) => {
      const proximo = new Map(atual);
      if (todosDaPagina) for (const p of selecionaveis) proximo.delete(p.id);
      else for (const p of selecionaveis) proximo.set(p.id, p);
      return proximo;
    });
  }

  async function adicionar() {
    if (selecionados.size === 0 || salvando) return;
    setSalvando(true);
    try {
      const itens = [...selecionados.keys()].map((produtoId) => ({ produtoId }));
      await api.post('/catalogo/bulk', { itens });
      onAdicionados(itens.length);
    } catch (err) {
      toast.error('Falha ao adicionar ao catálogo', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Adicionar produtos ao catálogo"
      description="Marque quantos quiser — a seleção continua valendo enquanto você busca e troca de página."
      size="xl"
      footer={
        <>
          <span className="mr-auto text-sm text-muted" data-testid="picker-contador">
            {selecionados.size === 0
              ? 'Nenhum produto selecionado'
              : `${selecionados.size} produto${selecionados.size === 1 ? '' : 's'} selecionado${
                  selecionados.size === 1 ? '' : 's'
                }`}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            data-testid="picker-adicionar"
            onClick={adicionar}
            disabled={selecionados.size === 0}
            loading={salvando}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Adicionar {selecionados.size > 0 ? selecionados.size : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            data-testid="picker-busca"
            autoFocus
            placeholder="Buscar por nome, SKU ou marca…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            leftIcon={<Search className="h-3.5 w-3.5" />}
            className="min-w-[220px] flex-1"
          />
          {/* Sob encomenda o filtro esconderia TUDO (saldo é zero por definição). */}
          {!sobEncomenda && (
            <Checkbox
              data-testid="picker-so-estoque"
              label="Só com estoque"
              checked={somenteComEstoque}
              onChange={(e) => setSomenteComEstoque(e.target.checked)}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-1">
          <Checkbox
            data-testid="picker-todos"
            label="Selecionar todos desta página"
            checked={todosDaPagina}
            disabled={selecionaveis.length === 0}
            onChange={alternarPagina}
          />
          {selecionados.size > 0 && (
            <button
              type="button"
              onClick={() => setSelecionados(new Map())}
              className="text-xs text-muted hover:text-text"
            >
              Limpar seleção
            </button>
          )}
        </div>

        <div className="max-h-[52vh] overflow-y-auto rounded-md border border-border">
          <StateView loading={loading} error={error} onRetry={refetch}>
            {produtos.length === 0 ? (
              <EmptyState
                icon={<Package />}
                title="Nenhum produto encontrado"
                description={
                  busca.trim()
                    ? 'Tente outro termo — a busca cobre nome, SKU e marca.'
                    : 'O catálogo do ERP ainda não trouxe produtos ativos.'
                }
                className="m-4 border-0"
              />
            ) : (
              <ul className="divide-y divide-border">
                {produtos.map((p) => {
                  const jaTem = jaNoCatalogo.has(p.id);
                  const marcado = jaTem || selecionados.has(p.id);
                  return (
                    <li key={p.id}>
                      <label
                        data-testid="picker-item"
                        className={cn(
                          'flex items-center gap-3 px-3 py-2',
                          jaTem
                            ? 'cursor-default opacity-60'
                            : 'cursor-pointer hover:bg-surface-hover',
                          !jaTem && selecionados.has(p.id) && 'bg-primary/5',
                        )}
                      >
                        <Checkbox
                          checked={marcado}
                          disabled={jaTem}
                          onChange={() => alternar(p)}
                          aria-label={`Selecionar ${p.nome}`}
                        />
                        <Thumb src={p.imagem} alt={p.nome} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-text">{p.nome}</div>
                          <div className="truncate text-xs text-muted">
                            {[p.sku, p.marca].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                        <PrecoDoProduto produto={p} />
                        <EstoqueBadge estoque={p.estoque} sobEncomenda={sobEncomenda} />
                        {jaTem && (
                          <Badge variant="success" className="shrink-0">
                            <Check className="mr-1 h-3 w-3" />
                            no catálogo
                          </Badge>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </StateView>
        </div>

        {data?.pagination && data.pagination.totalPages > 1 && (
          <Pagination pagination={data.pagination} onPageChange={setPage} />
        )}
      </div>
    </Dialog>
  );
}

/** Miniatura do produto — a imagem vem do ERP; sem ela, o ícone neutro. */
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

/**
 * O preço que o usuário PODE ver.
 *
 * Pro representante o backend zera `precoTabela` (ele loca, não vende), então
 * o que sobra é a mensalidade de locação. Sem nenhum dos dois, mostra "—" em
 * vez de cair no outro preço: número errado no catálogo vira proposta errada.
 */
function PrecoDoProduto({ produto }: { produto: ProdutoDoPicker }) {
  const venda = produto.precoTabela;
  const locacao = produto.precoLocacaoMensal;
  const valor = venda != null ? venda : locacao;
  return (
    <div className="hidden w-32 shrink-0 text-right sm:block">
      <div className="text-[10px] uppercase tracking-wider text-muted">
        {venda != null ? 'Venda' : 'Locação / mês'}
      </div>
      <div className="tabular text-sm font-semibold text-text">
        {valor != null ? fmtBRL(valor) : '—'}
      </div>
    </div>
  );
}

function EstoqueBadge({
  estoque,
  sobEncomenda = false,
}: {
  estoque?: number;
  sobEncomenda?: boolean;
}) {
  // Sob encomenda o saldo não decide nada: quem monta é a OP disparada pelo
  // pedido. Mostrar "0 un" em vermelho aqui empurraria o rep pra fora da venda.
  if (sobEncomenda) {
    return (
      <span className="hidden w-16 shrink-0 text-center text-[10px] text-muted sm:inline-block">
        sob encomenda
      </span>
    );
  }
  if (estoque == null) return <span className="w-16 shrink-0" />;
  const variant = estoque <= 0 ? 'danger' : estoque < 10 ? 'warning' : 'success';
  return (
    <Badge variant={variant} className="hidden w-16 shrink-0 justify-center sm:inline-flex">
      {estoque} un
    </Badge>
  );
}
