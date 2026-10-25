import { useEffect, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { StateView } from '@/components/StateView';
import { Badge, Button, Drawer, Input, Select } from '@/components/ui';

/**
 * Kits dos marketplaces (Léo, 25/10; card cmvnyodx7). Ficam no ERP com SKU e
 * código secundário próprios, mas NUNCA na vitrine (tabela separada). Cada
 * tamanho mostra as peças que consome; "sem composição" = falta par no site
 * (produto, cor ou tamanho) ou Cores Aleatórias, que o Léo ainda define.
 */
interface Item {
  id: string;
  tamanho: string;
  sku: string;
  skuSecundario: string | null;
  situacaoMagis: string | null;
  composicaoOk: boolean;
}
interface Kit {
  id: string;
  produto: string;
  modelo: string;
  combinacao: string;
  pecas: number;
  aleatorio: boolean;
  modelosBase: string[];
  itens: Item[];
}
interface Lista {
  data: Kit[];
  total: number;
  page: number;
  limit: number;
  produtos: Array<{ produto: string; kits: number }>;
  resumo: { skus: number; semComposicao: number };
}
interface Detalhe {
  id: string;
  tamanho: string;
  sku: string;
  skuSecundario: string | null;
  kit: Kit;
  componentes: Array<{ quantidade: number; sku: string | null; rotulo: string }>;
}

const SITUACAO: Record<string, string> = {
  AJUSTADO_MAGIS: 'Ajustado no Magis5',
  FALTA_CRIAR_MAGIS: 'Falta criar no Magis5',
  SEM_SKU_MAGIS: 'Sem SKU no Magis5',
  FALTA_AJUSTAR_VARIACAO: 'Falta ajustar variação',
  REVISAR: 'Revisar',
};

export default function KitsPage() {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [produto, setProduto] = useState('');
  const [semComposicao, setSemComposicao] = useState(false);
  const [page, setPage] = useState(1);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaAplicada(busca.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  const qs = new URLSearchParams({ page: String(page) });
  if (buscaAplicada) qs.set('busca', buscaAplicada);
  if (produto) qs.set('produto', produto);
  if (semComposicao) qs.set('semComposicao', 'true');
  const { data, loading, error, refetch } = useApiQuery<Lista>(`/kits?${qs.toString()}`);
  const detalhe = useApiQuery<Detalhe>(aberto ? `/kits/itens/${aberto}` : null);
  const paginas = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <PageLayout
      title="Kits dos marketplaces"
      description="Kits anunciados no Mercado Livre e na Shopee, com SKU e as peças que cada um consome. Não aparecem na vitrine."
    >
      <CatalogoTabs />
      {data && (
        <p className="text-sm text-muted mb-3" data-testid="kits-resumo">
          {data.resumo.skus} SKUs de kit · {data.resumo.semComposicao} ainda sem composição
        </p>
      )}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <Input
          className="min-w-[220px] flex-1"
          placeholder="Buscar SKU, secundário, cor ou produto…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          data-testid="kits-busca"
        />
        <Select
          className="max-w-[260px]"
          value={produto}
          onChange={(e) => {
            setProduto(e.target.value);
            setPage(1);
          }}
          data-testid="kits-produto"
        >
          <option value="">Todos os produtos</option>
          {(data?.produtos ?? []).map((p) => (
            <option key={p.produto} value={p.produto}>
              {p.produto} ({p.kits})
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant={semComposicao ? 'primary' : 'ghost'}
          onClick={() => {
            setSemComposicao((v) => !v);
            setPage(1);
          }}
          data-testid="kits-sem-composicao"
        >
          Só sem composição
        </Button>
      </div>

      <StateView loading={loading && !data} error={error} onRetry={refetch}>
        {(data?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nenhum kit com esses filtros.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="kits-lista">
            {data!.data.map((k) => (
              <li key={k.id} className="bg-surface border border-border rounded-[10px] px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-text">
                    {k.produto} · {k.modelo}
                  </span>
                  <span className="text-sm text-text">{k.combinacao}</span>
                  <span className="text-xs text-muted">{k.pecas} peças</span>
                  {k.aleatorio && <Badge variant="info">Cores Aleatórias</Badge>}
                  {!k.modelosBase.length && !k.aleatorio && <Badge variant="warning">sem par no site</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {k.itens.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => setAberto(i.id)}
                      title={[i.skuSecundario && `secundário ${i.skuSecundario}`, i.situacaoMagis && SITUACAO[i.situacaoMagis]]
                        .filter(Boolean)
                        .join(' · ')}
                      className={`text-xs rounded-[10px] border px-2 py-1 tabular-nums ${
                        i.composicaoOk ? 'border-border text-text' : 'border-warning text-warning'
                      }`}
                      data-testid={`kit-item-${i.sku}`}
                    >
                      <b>{i.tamanho}</b> · {i.sku}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && paginas > 1 && (
          <div className="flex items-center gap-3 mt-4 text-sm">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹ Anterior
            </Button>
            <span className="text-muted">
              {page} de {paginas}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>
              Próxima ›
            </Button>
          </div>
        )}
      </StateView>

      <Drawer open={!!aberto} onClose={() => setAberto(null)} title={detalhe.data ? `SKU ${detalhe.data.sku}` : 'Kit'}>
        {detalhe.data && (
          <div className="flex flex-col gap-3 text-sm" data-testid="kit-detalhe">
            <div>
              <div className="font-semibold text-text">
                {detalhe.data.kit.produto} · {detalhe.data.kit.modelo}
              </div>
              <div className="text-text">
                {detalhe.data.kit.combinacao} · tamanho {detalhe.data.tamanho}
              </div>
              {detalhe.data.skuSecundario && (
                <div className="text-muted text-xs">Secundário {detalhe.data.skuSecundario}</div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Peças que o kit consome</div>
              {detalhe.data.componentes.length ? (
                <ul className="flex flex-col gap-1">
                  {detalhe.data.componentes.map((c, n) => (
                    <li key={n} className="flex justify-between gap-3">
                      <span>{c.rotulo}</span>
                      <span className="tabular-nums text-muted">
                        {c.quantidade}× {c.sku ? `· SKU ${c.sku}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-warning">
                  {detalhe.data.kit.aleatorio
                    ? 'Cores Aleatórias: a composição entra quando for definida.'
                    : 'Sem composição: falta no site o produto, a cor ou o tamanho deste kit.'}
                </p>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </PageLayout>
  );
}
