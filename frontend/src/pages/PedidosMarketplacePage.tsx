import { useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button, Dialog, Drawer, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { formatMoeda, formatPercent } from '@/lib/masks';

/**
 * Pedidos de venda dos marketplaces, 1 por 1, com lucro (Léo, 24/10).
 * Bruto → taxas → frete da loja → líquido → custo do cadastro → lucro.
 * Depois entra a conferência com a expedição do Magis5.
 */
interface Item {
  sku: string | null;
  titulo: string;
  variacao: string | null;
  quantidade: number;
  precoUnit: number;
  taxa?: number | null;
  custoUnit?: number | null;
}
interface Pedido {
  id: string;
  plataforma: string;
  numeroExterno: string;
  comprador: string;
  produtoNome: string;
  quantidade: number;
  valor: number;
  status: string;
  situacao: string | null;
  pedidoEm: string;
  itens: Item[] | null;
  taxas: number | null;
  frete: number | null;
  liquido: number | null;
  custo: number | null;
  custoCompleto: boolean | null;
  lucro: number | null;
  margemPct: number | null;
}
interface Lista {
  data: Pedido[];
  porSituacao: Record<string, number>;
  total: number;
  resumo: { pedidos: number; bruto: number; taxas: number; frete: number; liquido: number; custo: number };
}
interface SemCusto {
  plataforma: string;
  sku: string | null;
  titulo: string;
  variacao: string | null;
  pedidos: number;
}

const CANAL: Record<string, string> = { ML: 'Mercado Livre', SHOPEE: 'Shopee', AMAZON: 'Amazon', TIKTOK: 'TikTok' };
const SITUACOES: Array<[string, string]> = [
  ['A_ENVIAR', 'A enviar'],
  ['ENVIADO', 'Enviado'],
  ['ENTREGUE', 'Entregue'],
  ['CANCELADO', 'Cancelado'],
  ['EM_DEVOLUCAO', 'Em devolução'],
];
const ROTULO_SITUACAO: Record<string, string> = {
  ...Object.fromEntries(SITUACOES),
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
};
const m = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoeda(v));

export default function PedidosMarketplacePage() {
  const [plataforma, setPlataforma] = useState('');
  const [situacao, setSituacao] = useState('');
  const [aba, setAba] = useState<'pedidos' | 'sem-custo'>('pedidos');
  const [aberto, setAberto] = useState<Pedido | null>(null);
  const lista = useApiQuery<Lista>(
    `/marketplace/pedidos?limit=100${plataforma ? `&plataforma=${plataforma}` : ''}${
      situacao ? `&situacao=${situacao}` : ''
    }`,
  );
  const semCusto = useApiQuery<SemCusto[]>(aba === 'sem-custo' ? '/marketplace/pedidos/skus-sem-custo' : null);
  const r = lista.data?.resumo;

  return (
    <PageLayout
      title="Pedidos dos marketplaces"
      description="Cada venda do Mercado Livre e da Shopee com taxas, frete, valor líquido, custo e lucro."
    >
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <Button variant={aba === 'pedidos' ? 'primary' : 'ghost'} onClick={() => setAba('pedidos')}>
          Pedidos
        </Button>
        <Button
          variant={aba === 'sem-custo' ? 'primary' : 'ghost'}
          onClick={() => setAba('sem-custo')}
          data-testid="aba-sem-custo"
        >
          SKUs sem custo
        </Button>
        {aba === 'pedidos' && (
          <Select
            className="max-w-[200px] ml-auto"
            value={plataforma}
            onChange={(e) => setPlataforma(e.target.value)}
            data-testid="filtro-canal"
          >
            <option value="">Todos os canais</option>
            <option value="ML">Mercado Livre</option>
            <option value="SHOPEE">Shopee</option>
          </Select>
        )}
      </div>

      {aba === 'pedidos' ? (
        <StateView loading={lista.loading && !lista.data} error={lista.error} onRetry={lista.refetch}>
          {r && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4" data-testid="pedidos-resumo">
              {[
                ['Bruto', r.bruto],
                ['Taxas', r.taxas],
                ['Frete da loja', r.frete],
                ['Líquido', r.liquido],
                ['Custo', r.custo],
              ].map(([rot, v]) => (
                <div key={rot as string} className="bg-surface border border-border rounded-[10px] p-3">
                  <div className="text-[11px] text-muted">{rot}</div>
                  <div className="text-base font-semibold tabular-nums">{m(v as number)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mb-3" data-testid="abas-situacao">
            <Button size="sm" variant={situacao === '' ? 'primary' : 'ghost'} onClick={() => setSituacao('')}>
              Todos
            </Button>
            {SITUACOES.map(([k, rot]) => (
              <Button
                key={k}
                size="sm"
                variant={situacao === k ? 'primary' : 'ghost'}
                onClick={() => setSituacao(k)}
                data-testid={`situacao-${k}`}
              >
                {rot} ({lista.data?.porSituacao?.[k] ?? 0})
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto bg-surface border border-border rounded-[10px]">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] text-muted">
                <tr>
                  {['Data', 'Canal', 'Pedido', 'Produto', 'Situação', 'Bruto', 'Líquido', 'Custo', 'Lucro'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(lista.data?.data ?? []).map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-border hover:bg-surface-2 cursor-pointer"
                    onClick={() => setAberto(p)}
                    data-testid={`pedido-${p.id}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(p.pedidoEm).toLocaleDateString('pt-BR')}</td>
                    <td className="px-3 py-2">{CANAL[p.plataforma] ?? p.plataforma}</td>
                    <td className="px-3 py-2 tabular-nums">{p.numeroExterno}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate">{p.produtoNome}</td>
                    <td className="px-3 py-2">{ROTULO_SITUACAO[p.situacao ?? ''] ?? p.status}</td>
                    <td className="px-3 py-2 tabular-nums">{m(p.valor)}</td>
                    <td className="px-3 py-2 tabular-nums">{m(p.liquido)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.custoCompleto === false ? <span className="text-warning">sem custo</span> : m(p.custo)}
                    </td>
                    <td className={`px-3 py-2 tabular-nums font-semibold ${p.lucro !== null && p.lucro < 0 ? 'text-danger' : ''}`}>
                      {p.lucro === null ? '—' : `${m(p.lucro)} (${formatPercent(p.margemPct ?? 0, 1)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lista.data && lista.data.data.length === 0 && (
              <p className="text-sm text-muted p-4">Nenhum pedido ainda.</p>
            )}
          </div>
        </StateView>
      ) : (
        <SkusSemCusto lista={semCusto.data ?? []} carregando={semCusto.loading} onVinculado={() => {
          semCusto.refetch();
          lista.refetch();
        }} />
      )}

      <Drawer open={!!aberto} onClose={() => setAberto(null)} title={aberto ? `Pedido ${aberto.numeroExterno}` : ''} width="lg">
        {aberto && <DetalhePedido p={aberto} />}
      </Drawer>
    </PageLayout>
  );
}

function DetalhePedido({ p }: { p: Pedido }) {
  const linhas: Array<[string, number | null, boolean?]> = [
    ['Valor bruto (pago pelo comprador)', p.valor],
    ['Taxas do marketplace', p.taxas === null ? null : -p.taxas],
    ['Frete pago pela loja', p.frete === null ? null : -p.frete],
    ['Líquido (repassado)', p.liquido, true],
    ['Custo das peças', p.custo === null ? null : -p.custo],
    ['Lucro', p.lucro, true],
  ];
  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="pedido-detalhe">
      <div className="text-muted">
        {CANAL[p.plataforma] ?? p.plataforma} · {new Date(p.pedidoEm).toLocaleString('pt-BR')} · {p.comprador} ·{' '}
        {ROTULO_SITUACAO[p.situacao ?? ''] ?? p.status}
      </div>
      <table className="w-full">
        <thead className="text-left text-[11px] text-muted">
          <tr>
            <th className="py-1">Item</th>
            <th className="py-1">Qtd</th>
            <th className="py-1">Preço</th>
            <th className="py-1">Custo un.</th>
          </tr>
        </thead>
        <tbody>
          {(p.itens ?? []).map((i, k) => (
            <tr key={k} className="border-t border-border align-top">
              <td className="py-1.5 pr-2">
                {i.titulo}
                <div className="text-[11px] text-muted">
                  {[i.variacao, i.sku && `SKU ${i.sku}`].filter(Boolean).join(' · ')}
                </div>
              </td>
              <td className="py-1.5">{i.quantidade}</td>
              <td className="py-1.5 tabular-nums">{m(i.precoUnit)}</td>
              <td className="py-1.5 tabular-nums">
                {i.custoUnit === null || i.custoUnit === undefined ? <span className="text-warning">sem custo</span> : m(i.custoUnit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-1">
        {linhas.map(([rot, v, forte]) => (
          <div key={rot} className={`flex justify-between ${forte ? 'font-semibold border-t border-border pt-1' : ''}`}>
            <span>{rot}</span>
            <span className="tabular-nums">{m(v)}</span>
          </div>
        ))}
        {p.margemPct !== null && <div className="text-right text-muted">margem {formatPercent(p.margemPct, 1)}</div>}
        {p.liquido === null && (
          <p className="text-xs text-muted">O marketplace ainda não liberou o extrato deste pedido (sai depois do pagamento/envio).</p>
        )}
      </div>
      <p className="text-xs text-muted">Conferência com a expedição do Magis5: entra quando o Magis5 for conectado.</p>
    </div>
  );
}

function SkusSemCusto({
  lista,
  carregando,
  onVinculado,
}: {
  lista: SemCusto[];
  carregando: boolean;
  onVinculado: () => void;
}) {
  const [alvo, setAlvo] = useState<SemCusto | null>(null);
  if (carregando && !lista.length) return <p className="text-sm text-muted">Carregando…</p>;
  if (!lista.length) return <p className="text-sm text-muted">Todo SKU vendido tem custo. ✅</p>;
  return (
    <>
      <p className="text-sm text-muted mb-3">
        SKUs vendidos que não batem com o cadastro (kits, SKU diferente). Ligue cada um à peça do cadastro e à quantidade
        (ex.: kit de 2 bermudas = 2).
      </p>
      <ul className="flex flex-col gap-2">
        {lista.map((s) => (
          <li
            key={`${s.plataforma}|${s.sku ?? s.titulo}`}
            className="bg-surface border border-border rounded-[10px] px-4 py-3 flex flex-wrap gap-3 items-center"
          >
            <span className="text-[11px] font-semibold text-primary">{CANAL[s.plataforma] ?? s.plataforma}</span>
            <span className="text-sm">{s.titulo}</span>
            <span className="text-xs text-muted">{[s.variacao, s.sku ? `SKU ${s.sku}` : 'sem SKU'].filter(Boolean).join(' · ')}</span>
            <span className="text-xs text-muted ml-auto">{s.pedidos} pedido(s)</span>
            {s.sku && (
              <Button size="sm" onClick={() => setAlvo(s)} data-testid={`vincular-${s.sku}`}>
                Ligar ao cadastro
              </Button>
            )}
          </li>
        ))}
      </ul>
      {alvo && <VincularDialog alvo={alvo} onClose={() => setAlvo(null)} onFeito={onVinculado} />}
    </>
  );
}

function VincularDialog({ alvo, onClose, onFeito }: { alvo: SemCusto; onClose: () => void; onFeito: () => void }) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [variacaoId, setVariacaoId] = useState('');
  const [qtd, setQtd] = useState('1');
  const [busy, setBusy] = useState(false);
  const opcoes = useApiQuery<Array<{ id: string; rotulo: string; sku: string | null; custoPorPeca: number | null }>>(
    `/marketplace/pedidos/variacoes${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ''}`,
  );
  async function salvar() {
    setBusy(true);
    try {
      await api.post('/marketplace/pedidos/vincular', {
        plataforma: alvo.plataforma,
        sku: alvo.sku,
        variacaoId,
        quantidade: Math.max(1, Number.parseInt(qtd, 10) || 1),
      });
      toast.success('SKU ligado — custos recalculados');
      onFeito();
      onClose();
    } catch (err) {
      toast.error('Não deu pra ligar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Ligar SKU ${alvo.sku}`}
      description={alvo.titulo}
      footer={
        <Button onClick={() => void salvar()} loading={busy} disabled={!variacaoId}>
          Ligar
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Buscar peça do cadastro">
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do produto ou SKU" />
        </Field>
        <Field label="Peça">
          <Select value={variacaoId} onChange={(e) => setVariacaoId(e.target.value)} data-testid="vincular-variacao">
            <option value="">Escolha…</option>
            {(opcoes.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.rotulo}
                {o.custoPorPeca !== null ? ` — custo ${formatMoeda(o.custoPorPeca)}` : ' — sem custo no cadastro'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantas dessa peça o SKU representa" hint="Kit de 2 = 2">
          <Input value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </Field>
      </div>
    </Dialog>
  );
}
