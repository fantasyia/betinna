import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda, formatNumero, formatPercent } from '@/lib/masks';
import { cn } from '@/lib/cn';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import {
  NOME_FAIXA,
  conta,
  lerNumero,
  paraCampo,
  precoParaLucro,
  quantidades,
  faixaDe,
  type Simulacao,
} from './calculo';

/**
 * Calculadora de precificação (Ribelt Distribuidora, card cmuwz849800e1ph5i3ynsbmcd).
 *
 * Custo e preço por faixa de cada Linha do modelo → quanto sobra no pedido
 * mínimo, no início de cada faixa e numa quantidade qualquer. Só ADMIN/DIRECTOR
 * e só em empresa com a calculadora ligada (o backend recusa nos dois casos).
 * Mexer nos números simula; nada é gravado até clicar em salvar.
 */

interface LinhaPrec {
  id: string;
  nome: string;
  precoEntrada: number | null;
  precoVolume: number | null;
  precoAtacadao: number | null;
  precoSugerido: number | null;
  custo: { manual: number | null; atualizadoEm: string | null };
}
interface Dados {
  taxas: {
    impostoPct: number | null;
    pixPct: number | null;
    cartaoPct: number | null;
    anuncioPorPedido: number | null;
    embalagemPorPedido: number | null;
  };
  faixas: { minimoVolume: number | null; minimoAtacadao: number | null };
  pedidoMinimo: { valorMin: number | null; quantidadeMin: number | null; modo: 'E' | 'OU' } | null;
  modelos: Array<{ id: string; nome: string; ativo: boolean; linhas: LinhaPrec[] }>;
}

export default function PrecificacaoPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const dados = useApiQuery<Dados>(gestor ? '/precificacao' : null);

  return (
    <PageLayout
      title="Precificação"
      description="Custo, preço por faixa e quanto sobra em cada pedido. Mexer nos números só simula."
    >
      <CatalogoTabs />
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa a precificação.</Card>
      ) : (
        <StateView loading={dados.loading} error={dados.error} onRetry={dados.refetch}>
          {dados.data && <Calculadora d={dados.data} onSalvou={dados.refetch} />}
        </StateView>
      )}
    </PageLayout>
  );
}

const AVULSO = '';

function Calculadora({ d, onSalvou }: { d: Dados; onSalvou: () => void }) {
  const toast = useToast();
  const [params] = useSearchParams();
  const linhas = useMemo(
    () =>
      d.modelos.flatMap((m) =>
        m.linhas.map((l) => ({ ...l, rotulo: `${m.nome} · ${l.nome}${m.ativo ? '' : ' (inativo)'}` })),
      ),
    [d.modelos],
  );
  const [sel, setSel] = useState<string>(() => {
    const pedida = params.get('linha');
    return linhas.find((l) => l.id === pedida)?.id ?? linhas[0]?.id ?? AVULSO;
  });
  const linha = linhas.find((l) => l.id === sel) ?? null;

  // Números da linha (simuláveis). Trocar de linha recarrega do cadastro.
  const [custo, setCusto] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [p3, setP3] = useState('');
  const [sug, setSug] = useState('');
  useEffect(() => {
    setCusto(paraCampo(linha?.custo.manual));
    setP1(paraCampo(linha?.precoEntrada));
    setP2(paraCampo(linha?.precoVolume));
    setP3(paraCampo(linha?.precoAtacadao));
    setSug(paraCampo(linha?.precoSugerido));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao trocar de linha
  }, [sel]);

  // Custos da empresa (valem pra todos os produtos).
  const [imposto, setImposto] = useState(paraCampo(d.taxas.impostoPct));
  const [pix, setPix] = useState(paraCampo(d.taxas.pixPct));
  const [cartao, setCartao] = useState(paraCampo(d.taxas.cartaoPct));
  const [anuncio, setAnuncio] = useState(paraCampo(d.taxas.anuncioPorPedido));
  const [emb, setEmb] = useState(paraCampo(d.taxas.embalagemPorPedido));
  const [pag, setPag] = useState<'pix' | 'cartao'>('pix');

  const [qtd, setQtd] = useState('');
  const [alvo, setAlvo] = useState('');
  const [alvoQ, setAlvoQ] = useState('500');
  const [salvando, setSalvando] = useState<'linha' | 'taxas' | null>(null);

  const n = (t: string) => lerNumero(t) ?? 0;
  const s: Simulacao = {
    custo: n(custo),
    impostoPct: n(imposto),
    taxaPct: n(pag === 'pix' ? pix : cartao),
    anuncioPorPedido: n(anuncio),
    embalagemPorPedido: n(emb),
    precos: { entrada: lerNumero(p1), volume: lerNumero(p2), atacadao: lerNumero(p3) },
    sugerido: lerNumero(sug),
    faixas: d.faixas,
    minimo: d.pedidoMinimo,
  };
  const qs = quantidades(s, lerNumero(qtd));
  const temPreco = [s.precos.entrada, s.precos.volume, s.precos.atacadao].some((p) => p && p > 0);
  const vol = d.faixas.minimoVolume;
  const ata = d.faixas.minimoAtacadao;
  const rotuloQ = (q: number) =>
    q === qs.minimo ? 'Pedido mínimo' : q === vol ? `Início do ${NOME_FAIXA.volume}` : q === ata ? `Início do ${NOME_FAIXA.atacadao}` : `Pedido de ${formatNumero(q)}`;

  async function salvarLinha() {
    if (!linha) return;
    setSalvando('linha');
    try {
      await api.put(`/precificacao/linhas/${linha.id}`, {
        custoPorPeca: lerNumero(custo),
        precoEntrada: lerNumero(p1),
        precoVolume: lerNumero(p2),
        precoAtacadao: lerNumero(p3),
        precoSugerido: lerNumero(sug),
      });
      toast.success('Preços salvos no modelo', 'A vitrine já mostra os preços novos. O custo não aparece pra ninguém de fora.');
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(null);
    }
  }

  async function salvarTaxas() {
    setSalvando('taxas');
    try {
      await api.put('/precificacao/taxas', {
        impostoPct: lerNumero(imposto),
        pixPct: lerNumero(pix),
        cartaoPct: lerNumero(cartao),
        anuncioPorPedido: lerNumero(anuncio),
        embalagemPorPedido: lerNumero(emb),
      });
      toast.success('Custos da empresa salvos');
      onSalvou();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(null);
    }
  }

  const textoMinimo = (() => {
    const m = d.pedidoMinimo;
    if (!m) return 'Sem pedido mínimo configurado (Configurações → Pedido mínimo).';
    const partes = [
      m.quantidadeMin ? `${formatNumero(m.quantidadeMin)} peças` : null,
      m.valorMin ? formatMoeda(m.valorMin) : null,
    ].filter(Boolean);
    return `Pedido mínimo: ${partes.join(m.modo === 'OU' ? ' ou ' : ' e ')}${m.modo === 'OU' && partes.length > 1 ? ', o que vier primeiro' : ''}.`;
  })();
  const textoFaixas = `Entrada${vol ? ` até ${formatNumero(vol - 1)}` : ''} · Volume${vol ? ` a partir de ${formatNumero(vol)}` : ' (sem limite)'} · Atacadão${ata ? ` a partir de ${formatNumero(ata)}` : ' (sem limite)'}`;

  const alvoN = lerNumero(alvo);
  const alvoQN = Math.max(1, Math.round(lerNumero(alvoQ) ?? 0) || 1);
  const precoAlvo = alvoN ? precoParaLucro(alvoN, alvoQN, s) : null;

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)] 2xl:items-start">
      <Card className="p-4 grid gap-4 min-w-0 md:grid-cols-2 2xl:grid-cols-1" aria-label="Dados do produto">
        <Field label="Produto">
          <Select value={sel} onChange={(e) => setSel(e.target.value)} data-testid="prec-linha">
            {linhas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.rotulo}
              </option>
            ))}
            <option value={AVULSO}>Produto avulso (só simular)</option>
          </Select>
        </Field>

        <Secao titulo="Seu custo">
          <Field
            label={
              <span className="flex items-center gap-2">
                Custo por peça (R$)
                {linha?.custo.manual != null && (
                  <Badge variant="outline" size="sm">
                    manual
                    {linha.custo.atualizadoEm
                      ? ` · ${new Date(linha.custo.atualizadoEm).toLocaleDateString('pt-BR')}`
                      : ''}
                  </Badge>
                )}
              </span>
            }
            hint="Peça pronta, sem imposto. Quando o ERP fechar ordens de produção, o custo vem de lá."
          >
            <Input value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" data-testid="prec-custo" />
          </Field>
        </Secao>

        <Secao titulo="Seu preço por faixa (R$ por peça)">
          <div className="grid grid-cols-3 gap-2">
            <Field label={`Entrada`}>
              <Input value={p1} onChange={(e) => setP1(e.target.value)} inputMode="decimal" data-testid="prec-p1" />
            </Field>
            <Field label={`Volume`}>
              <Input value={p2} onChange={(e) => setP2(e.target.value)} inputMode="decimal" data-testid="prec-p2" />
            </Field>
            <Field label={`Atacadão`}>
              <Input value={p3} onChange={(e) => setP3(e.target.value)} inputMode="decimal" data-testid="prec-p3" />
            </Field>
          </div>
          <Field label="Revenda sugerida pro lojista (R$)" hint="O preço que ele cobra do consumidor final">
            <Input value={sug} onChange={(e) => setSug(e.target.value)} inputMode="decimal" data-testid="prec-sug" />
          </Field>
          <p className="text-xs text-muted">
            {textoFaixas}. {textoMinimo}
          </p>
          <Button
            onClick={salvarLinha}
            loading={salvando === 'linha'}
            disabled={!linha || salvando !== null}
            data-testid="prec-salvar-linha"
          >
            Salvar preços no modelo
          </Button>
        </Secao>

        <Secao titulo="Custos da empresa (todos os produtos)">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Imposto sobre a venda (%)" hint="Alíquota do Simples (confirme com o contador)">
              <Input value={imposto} onChange={(e) => setImposto(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Embalagem por pedido (R$)" hint="Caixa, saco, etiqueta">
              <Input value={emb} onChange={(e) => setEmb(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Taxa do Pix (%)">
              <Input value={pix} onChange={(e) => setPix(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Taxa do cartão (%)">
              <Input value={cartao} onChange={(e) => setCartao(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <Field
            label="Anúncio gasto pra conseguir 1 pedido (R$)"
            hint="Ex.: gastou R$ 500 em anúncio e fechou 10 pedidos → 50. Sem anúncio, deixe 0."
          >
            <Input value={anuncio} onChange={(e) => setAnuncio(e.target.value)} inputMode="decimal" data-testid="prec-anuncio" />
          </Field>
          <Button variant="secondary" onClick={salvarTaxas} loading={salvando === 'taxas'} disabled={salvando !== null}>
            Salvar custos da empresa
          </Button>
        </Secao>
      </Card>

      <Card className="p-4 flex flex-col gap-4 min-w-0" aria-label="Resultado">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="text-lg font-semibold mr-auto">{linha ? linha.rotulo : 'Produto avulso'}</h2>
          <Field label="Pagamento" className="w-44">
            <Select value={pag} onChange={(e) => setPag(e.target.value as 'pix' | 'cartao')} data-testid="prec-pag">
              <option value="pix">Pix</option>
              <option value="cartao">Cartão de crédito</option>
            </Select>
          </Field>
          <Field label="Outra quantidade (peças)" className="w-40">
            <Input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="numeric" data-testid="prec-qtd" />
          </Field>
        </div>

        <div className="grid gap-2 sm:grid-cols-3" data-testid="prec-kpis">
          {qs.fixas.map((q) => {
            const c = conta(q, s);
            return (
              <div key={q} className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">
                  {rotuloQ(q)} · {formatNumero(q)} peças · {NOME_FAIXA[c.faixa]}
                </span>
                <b className={cn('text-xl font-semibold tabular-nums', temPreco && (c.lucro >= 0 ? 'text-success' : 'text-danger'))}>
                  {temPreco && c.preco !== null ? formatMoeda(c.lucro) : '—'}
                </b>
                <span className="text-xs text-muted">
                  {temPreco && c.preco !== null
                    ? `${formatMoeda(c.lucroPorPeca)} por peça · lojista lucra ${c.lojista ? formatMoeda(c.lojista.porPeca) : '—'}`
                    : 'preencha o preço'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-xs tabular-nums" data-testid="prec-tabela">
            <thead className="bg-surface text-[11px] uppercase tracking-wide text-muted">
              <tr>
                {['Pedido', 'Faixa', 'Preço/peça', 'Você recebe', 'Custos', 'Seu lucro', 'Lucro/peça', 'Margem', 'Lojista lucra/peça'].map(
                  (h, i) => (
                    <th key={h} className={cn('px-2.5 py-2 font-semibold', i === 0 ? 'text-left' : 'text-right')}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {qs.todas.map((q) => {
                const c = conta(q, s);
                const ok = temPreco && c.preco !== null;
                const tom = ok ? (c.lucro >= 0 ? 'text-success font-semibold' : 'text-danger font-semibold') : '';
                return (
                  <tr key={q} className="border-t border-border">
                    <td className="px-2.5 py-2 text-left whitespace-nowrap">
                      <b>{formatNumero(q)} peças</b>
                      {!c.fecha ? (
                        <Badge variant="danger" size="sm" className="ml-2">
                          abaixo do mínimo
                        </Badge>
                      ) : q === qs.minimo ? (
                        <Badge variant="neutral" size="sm" className="ml-2">
                          mínimo
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-2 text-right">{NOME_FAIXA[faixaDe(q, s.faixas)]}</td>
                    <td className="px-2.5 py-2 text-right">{ok ? formatMoeda(c.preco!) : '—'}</td>
                    <td className="px-2.5 py-2 text-right">{ok ? formatMoeda(c.receita) : '—'}</td>
                    <td className="px-2.5 py-2 text-right">{formatMoeda(c.custos)}</td>
                    <td className={cn('px-2.5 py-2 text-right', tom)}>{ok ? formatMoeda(c.lucro) : '—'}</td>
                    <td className={cn('px-2.5 py-2 text-right', tom)}>{ok ? formatMoeda(c.lucroPorPeca) : '—'}</td>
                    <td className="px-2.5 py-2 text-right">{ok ? formatPercent(c.margem * 100, 1) : '—'}</td>
                    <td className="px-2.5 py-2 text-right">
                      {ok && c.lojista ? `${formatMoeda(c.lojista.porPeca)} (+${c.lojista.pct}%)` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Custos = peças × custo + imposto + taxa do pagamento + anúncio pra conseguir o pedido + embalagem. Margem =
          lucro ÷ o que você recebe. O preço de cada quantidade segue a faixa da vitrine; faixa sem preço usa a de
          baixo.
        </p>

        <div className="rounded-lg border border-dashed border-border-strong p-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Quanto cobrar pra lucrar o que eu quero</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Lucro que eu quero por peça (R$)">
              <Input value={alvo} onChange={(e) => setAlvo(e.target.value)} inputMode="decimal" data-testid="prec-alvo" />
            </Field>
            <Field label="Num pedido de (peças)">
              <Input value={alvoQ} onChange={(e) => setAlvoQ(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <p className="text-sm" data-testid="prec-alvo-res">
            {!alvoN
              ? 'Digite o lucro por peça que você quer e eu calculo o preço mínimo.'
              : precoAlvo === null
                ? 'Imposto + taxa passam de 100%: confira os percentuais.'
                : `Pra lucrar ${formatMoeda(alvoN)} por peça num pedido de ${formatNumero(alvoQN)} (faixa ${NOME_FAIXA[faixaDe(alvoQN, s.faixas)]}), cobre pelo menos ${formatMoeda(precoAlvo)} por peça. Lucro do pedido: ${formatMoeda(alvoN * alvoQN)}.`}
          </p>
        </div>
      </Card>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[11px] uppercase tracking-wide text-muted font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}
