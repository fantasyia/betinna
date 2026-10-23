import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Card, Field, IconButton, Input, Select, Switch, Textarea } from '@/components/ui';
import { lerNumero, paraCampo } from '@/pages/precificacao/calculo';
import { SIGLA, type Insumo } from '@/pages/insumos/insumo';

/**
 * Ficha técnica (ERP próprio · entrega 3) — aba do cadastro do modelo.
 * Uma ficha POR GRADE (linha do modelo): insumos com consumo médio por peça
 * e o custo de facção previsto. O custo previsto vira o "previsto pela ficha"
 * da calculadora e a base da simulação da OP.
 */

interface FichaApi {
  modeloLinhaId: string;
  linha: string;
  /** Tamanhos da grade, na ordem (14/10: quantidade por tamanho). */
  tamanhos?: string[];
  existe: boolean;
  /** Serviços de acabamento marcados na grade + a lista da empresa (14/10). */
  acabamento?: string[];
  /** Tamanhos onde cada serviço vale (23/10); serviço ausente = todos. */
  acabamentoTamanhos?: Record<string, string[]>;
  servicosAcabamento?: ServicoAcabamento[];
  /** Custo de corte por peça da empresa (20/10) — entra no previsto. */
  custoCortePorPeca?: number;
  custoFaccaoPrevisto: number | null;
  observacoes: string | null;
  itens: Array<{
    insumoId: string;
    consumoPorPeca: number;
    porTamanho?: Record<string, number> | null;
    etapa?: Etapa;
    observacao: string | null;
    corFixa: { id: string; nome: string; hex: string } | null;
  }>;
  semCusto: string[];
}

interface ServicoAcabamento {
  id: string;
  nome: string;
  preco: number;
}

/** Onde o item é usado (ficha da OP impressa, 14/10): sai na via da facção ou na do acabamento. */
type Etapa = 'FACCAO' | 'ACABAMENTO';

interface Linha {
  insumoId: string;
  consumo: string;
  etapa: Etapa;
  /** Quantidade POR TAMANHO (14/10: o elástico muda em cada um). null = um consumo só. */
  porTamanho: Record<string, string> | null;
  /** Vai e volta intacta (antes a tela apagava a observação ao salvar). */
  observacao: string | null;
  /** Insumo com cores: '' = a cor da própria peça; senão a cor fixa (corId da lista). */
  corFixaId: string;
}

export function FichaTecnicaAba({
  modeloId,
  linhas,
}: {
  modeloId: string;
  linhas: Array<{ id: string; nome: string }>;
}) {
  const insumos = useApiQuery<Insumo[]>('/erp/insumos');
  if (linhas.length === 0) {
    return <p className="text-sm text-muted">Salve o modelo com pelo menos uma grade (aba 3) pra montar a ficha técnica.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {(insumos.data ?? []).length === 0 && !insumos.loading && (
        <p className="text-sm text-muted">
          Nenhum insumo cadastrado ainda — cadastre tecido e aviamentos em Catálogo → Insumos.
        </p>
      )}
      <ServicosAcabamento />
      {linhas.map((l) => (
        <FichaDaGrade key={l.id} modeloLinhaId={l.id} nome={l.nome} insumos={insumos.data ?? []} />
      ))}
      <RegrasEncaixe modeloId={modeloId} />
    </div>
  );
}

/**
 * Serviços de ACABAMENTO da empresa (Léo, 14/10): a Isabela cobra por tarefa —
 * passar cordão, dobrar e embalar, ilhós. Lista única; cada grade marca os seus.
 */
export function ServicosAcabamento() {
  const toast = useToast();
  const q = useApiQuery<{ servicos: ServicoAcabamento[]; custoCortePorPeca?: number; fretePorPeca?: number }>('/erp/acabamento');
  const [lista, setLista] = useState<Array<{ id?: string; nome: string; preco: string }>>([]);
  const [corte, setCorte] = useState('');
  const [frete, setFrete] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setLista(q.data.servicos.map((s) => ({ id: s.id, nome: s.nome, preco: paraCampo(s.preco) })));
    setCorte(paraCampo(q.data.custoCortePorPeca ?? 0));
    setFrete(paraCampo(q.data.fretePorPeca ?? 0));
  }, [q.data]);
  const valido =
    lista.every((s) => s.nome.trim().length >= 2 && (lerNumero(s.preco) ?? -1) >= 0) &&
    (lerNumero(corte) ?? 0) >= 0;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/erp/acabamento', {
        servicos: lista.map((s) => ({ ...(s.id ? { id: s.id } : {}), nome: s.nome.trim(), preco: lerNumero(s.preco) ?? 0 })),
        custoCortePorPeca: lerNumero(corte) ?? 0,
        fretePorPeca: lerNumero(frete) ?? 0,
      });
      toast.success('Regras de produção salvas');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card variant="outline" padding="md" className="flex flex-col gap-2" data-testid="servicos-acabamento">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold mr-auto">Serviços de acabamento (R$ por peça)</h3>
        <span className="text-xs text-muted">Valem pra todos os produtos; cada grade marca os seus abaixo.</span>
      </div>
      <label className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-sm">
        <span>
          Custo de corte por peça cortada
          <span className="block text-xs text-muted">Entra no previsto de toda grade e no custo real da OP, no corte.</span>
        </span>
        <Input
          value={corte}
          onChange={(e) => setCorte(e.target.value)}
          inputMode="decimal"
          data-testid="custo-corte"
        />
      </label>
      <label className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-sm">
        <span>
          Frete de produção por peça
          <span className="block text-xs text-muted">Entra no previsto de toda grade e no custo real da OP, no corte.</span>
        </span>
        <Input value={frete} onChange={(e) => setFrete(e.target.value)} inputMode="decimal" data-testid="frete-peca" />
      </label>
      {lista.map((s, idx) => (
        <div key={s.id ?? `novo-${idx}`} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-2">
          <Input
            value={s.nome}
            onChange={(e) => setLista((xs) => xs.map((x, i) => (i === idx ? { ...x, nome: e.target.value } : x)))}
            placeholder="Ex.: Passar cordão"
            data-testid={`acab-nome-${idx}`}
          />
          <Input
            value={s.preco}
            onChange={(e) => setLista((xs) => xs.map((x, i) => (i === idx ? { ...x, preco: e.target.value } : x)))}
            inputMode="decimal"
            data-testid={`acab-preco-${idx}`}
          />
          <IconButton
            aria-label="Tirar serviço"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => setLista((xs) => xs.filter((_, i) => i !== idx))}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setLista((xs) => [...xs, { nome: '', preco: '0,25' }])}
          data-testid="acab-add"
        >
          Adicionar serviço
        </Button>
        <Button size="sm" onClick={salvar} loading={salvando} disabled={!valido} data-testid="acab-salvar">
          Salvar serviços
        </Button>
      </div>
    </Card>
  );
}

function FichaDaGrade({ modeloLinhaId, nome, insumos }: { modeloLinhaId: string; nome: string; insumos: Insumo[] }) {
  const toast = useToast();
  const q = useApiQuery<FichaApi>(`/erp/fichas/${modeloLinhaId}`);
  const [itens, setItens] = useState<Linha[]>([]);
  const [faccao, setFaccao] = useState('');
  const [obs, setObs] = useState('');
  const [acab, setAcab] = useState<string[]>([]);
  const [acabTam, setAcabTam] = useState<Record<string, string[]>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setAcab(q.data.acabamento ?? []);
    setAcabTam(q.data.acabamentoTamanhos ?? {});
    setItens(
      q.data.itens.map((i) => ({
        insumoId: i.insumoId,
        consumo: paraCampo(i.consumoPorPeca),
        etapa: i.etapa ?? 'FACCAO',
        porTamanho: i.porTamanho
          ? Object.fromEntries(Object.entries(i.porTamanho).map(([t, v]) => [t, paraCampo(v)]))
          : null,
        observacao: i.observacao ?? null,
        corFixaId: i.corFixa?.id ?? '',
      })),
    );
    setFaccao(paraCampo(q.data.custoFaccaoPrevisto));
    setObs(q.data.observacoes ?? '');
  }, [q.data]);

  const porId = new Map(insumos.map((i) => [i.id, i]));
  // Cor fixa: custo DAQUELA cor; senão o do insumo (com cores, a média delas).
  const custoUnit = (l: Linha) => {
    const ins = porId.get(l.insumoId);
    const fixa = l.corFixaId ? ins?.cores.find((c) => c.corId === l.corFixaId) : undefined;
    return fixa ? fixa.custoMedio : (ins?.custoMedio ?? 0);
  };
  const tamanhos = q.data?.tamanhos ?? [];
  // Por tamanho: o consumo da grade é a média dos tamanhos preenchidos (o servidor confere).
  const consumoDe = (l: Linha) => {
    if (!l.porTamanho) return lerNumero(l.consumo) ?? 0;
    // Campo vazio não conta; "0" conta (tamanho que NÃO leva o insumo, 22/10).
    const vs = Object.values(l.porTamanho)
      .filter((v) => v.trim() !== '')
      .map((v) => lerNumero(v) ?? 0)
      .filter((v) => v >= 0);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0;
  };
  const custoItem = (l: Linha) => consumoDe(l) * custoUnit(l);
  const custoInsumos = itens.reduce((s, l) => s + custoItem(l), 0);
  const servicos = q.data?.servicosAcabamento ?? [];
  // Serviço restrito a alguns tamanhos (23/10) entra na proporção deles (média por tamanho).
  const custoAcab = servicos
    .filter((s) => acab.includes(s.id))
    .reduce((t, s) => {
      const so = acabTam[s.id];
      const fracao = so && tamanhos.length ? tamanhos.filter((x) => so.includes(x)).length / tamanhos.length : 1;
      return t + s.preco * fracao;
    }, 0);
  const custoCorte = q.data?.custoCortePorPeca ?? 0;
  const total = custoInsumos + (lerNumero(faccao) ?? 0) + custoAcab + custoCorte;
  const usados = new Set(itens.map((l) => l.insumoId));
  const livres = insumos.filter((i) => i.ativo && !usados.has(i.id));
  const valido = itens.every((l) => l.insumoId && consumoDe(l) > 0);

  async function salvar() {
    setSalvando(true);
    try {
      await api.put(`/erp/fichas/${modeloLinhaId}`, {
        custoFaccaoPrevisto: lerNumero(faccao),
        observacoes: obs,
        acabamento: acab,
        // Só dos serviços marcados; "todos os tamanhos" não precisa ir.
        acabamentoTamanhos: Object.fromEntries(
          Object.entries(acabTam).filter(([id, xs]) => acab.includes(id) && xs.length < tamanhos.length),
        ),
        itens: itens.map((l) => {
          const porTamanho = l.porTamanho
            ? Object.fromEntries(
                Object.entries(l.porTamanho)
                  .filter(([, v]) => v.trim() !== '')
                  .map(([t, v]) => [t, lerNumero(v) ?? 0] as const)
                  .filter(([, v]) => v >= 0),
              )
            : null;
          return {
            insumoId: l.insumoId,
            consumoPorPeca: consumoDe(l),
            porTamanho: porTamanho && Object.keys(porTamanho).length ? porTamanho : null,
            observacao: l.observacao,
            etapa: l.etapa,
            corFixaId: l.corFixaId || null,
          };
        }),
      });
      toast.success(`Ficha da grade ${nome} salva`);
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card variant="outline" padding="md" className="flex flex-col gap-3" data-testid={`ficha-${modeloLinhaId}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold mr-auto">Grade {nome}</h3>
        <span className="text-sm text-muted">
          Custo previsto por peça: <b className="text-text tabular-nums" data-testid={`ficha-total-${modeloLinhaId}`}>{formatMoeda(total)}</b>
        </span>
      </div>

      {itens.length === 0 ? (
        <p className="text-sm text-muted">Nenhum insumo nesta grade ainda.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {itens.map((l, idx) => {
            const ins = porId.get(l.insumoId);
            return (
              <div key={`${l.insumoId}-${idx}`} className="grid grid-cols-[minmax(0,1fr)_9rem_9rem_7rem_auto] items-end gap-2">
                <Field label={idx === 0 ? 'Insumo' : undefined}>
                  <Select
                    value={l.insumoId}
                    onChange={(e) => setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, insumoId: e.target.value, corFixaId: '' } : x)))}
                  >
                    {ins && (
                      <option value={ins.id}>
                        {ins.nome}
                        {ins.cor ? ` · ${ins.cor}` : ''}
                      </option>
                    )}
                    {livres.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nome}
                        {i.cor ? ` · ${i.cor}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={idx === 0 ? 'Consumo por peça' : undefined}>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={l.porTamanho ? paraCampo(Math.round(consumoDe(l) * 10000) / 10000) : l.consumo}
                      onChange={(e) => setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, consumo: e.target.value } : x)))}
                      inputMode="decimal"
                      disabled={!!l.porTamanho}
                      title={l.porTamanho ? 'Média dos tamanhos' : undefined}
                      data-testid={`ficha-consumo-${idx}`}
                    />
                    <span className="text-xs text-muted w-6">{ins ? SIGLA[ins.unidade] : ''}</span>
                  </div>
                </Field>
                {/* Insumo com cores: a OP baixa a cor da peça, ou a cor fixada aqui (cordão sempre Branco). */}
                {ins?.temCores ? (
                  <Field label={idx === 0 ? 'Cor' : undefined}>
                    <Select
                      value={l.corFixaId}
                      onChange={(e) => setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, corFixaId: e.target.value } : x)))}
                      data-testid={`ficha-cor-${idx}`}
                    >
                      <option value="">Cor da peça</option>
                      {ins.cores
                        .filter((c) => c.ativo || c.corId === l.corFixaId)
                        .map((c) => (
                          <option key={c.corId} value={c.corId}>
                            Sempre {c.nome}
                          </option>
                        ))}
                    </Select>
                  </Field>
                ) : (
                  <div />
                )}
                <div className="pb-2 text-right text-sm tabular-nums">
                  {ins && custoUnit(l) > 0 ? formatMoeda(custoItem(l)) : <span className="text-warning text-xs">sem custo</span>}
                </div>
                <IconButton
                  aria-label="Tirar da ficha"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setItens((xs) => xs.filter((_, i) => i !== idx))}
                />
                {/* Aviamento: em qual via da ficha impressa ele sai (facção ou acabamento da Isabela). */}
                {ins?.tipo === 'AVIAMENTO' && (
                  <label className="col-span-full -mt-1 flex items-center gap-2 text-xs text-muted">
                    Vai pra
                    <select
                      className="rounded-[10px] border border-border bg-surface px-2 py-0.5 text-xs text-text"
                      value={l.etapa}
                      onChange={(e) =>
                        setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, etapa: e.target.value as Etapa } : x)))
                      }
                      data-testid={`ficha-etapa-${idx}`}
                    >
                      <option value="FACCAO">Facção</option>
                      <option value="ACABAMENTO">Acabamento</option>
                    </select>
                  </label>
                )}
                {/* Quantidade POR TAMANHO (Léo, 14/10): o elástico muda em cada um. */}
                {tamanhos.length > 0 && (
                  <div className="col-span-full flex flex-wrap items-center gap-1.5 -mt-1">
                    <button
                      type="button"
                      className="text-xs text-primary underline"
                      onClick={() =>
                        setItens((xs) =>
                          xs.map((x, i) =>
                            i !== idx
                              ? x
                              : x.porTamanho
                                ? { ...x, consumo: paraCampo(Math.round(consumoDe(x) * 10000) / 10000), porTamanho: null }
                                : { ...x, porTamanho: Object.fromEntries(tamanhos.map((t) => [t, x.consumo])) },
                          ),
                        )
                      }
                      data-testid={`ficha-por-tamanho-${idx}`}
                    >
                      {l.porTamanho ? 'Usar um consumo só' : 'Por tamanho'}
                    </button>
                    {l.porTamanho &&
                      tamanhos.map((t) => (
                        <label key={t} className="flex items-center gap-1 rounded-[10px] border border-border px-2 h-8 text-xs">
                          <b>{t}</b>
                          <input
                            value={l.porTamanho?.[t] ?? ''}
                            onChange={(e) =>
                              setItens((xs) =>
                                xs.map((x, i) =>
                                  i === idx ? { ...x, porTamanho: { ...(x.porTamanho ?? {}), [t]: e.target.value } } : x,
                                ),
                              )
                            }
                            inputMode="decimal"
                            className="w-14 bg-transparent text-right tabular-nums outline-none"
                            aria-label={`Consumo do ${t}`}
                            data-testid={`ficha-tam-${idx}-${t}`}
                          />
                          <span className="text-muted">{ins ? SIGLA[ins.unidade] : ''}</span>
                        </label>
                      ))}
                  </div>
                )}
                {l.observacao && <p className="col-span-full -mt-1 text-xs text-muted">{l.observacao}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          disabled={livres.length === 0}
          onClick={() => setItens((xs) => [...xs, { insumoId: livres[0].id, consumo: '', etapa: 'FACCAO', porTamanho: null, observacao: null, corFixaId: '' }])}
          data-testid={`ficha-add-${modeloLinhaId}`}
        >
          Adicionar insumo
        </Button>
      </div>

      {/* Acabamento da Isabela (Léo, 14/10): cada serviço é cobrado por peça. */}
      {servicos.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid={`ficha-acabamento-${modeloLinhaId}`}>
          <span className="text-xs font-semibold text-muted">Acabamento:</span>
          {servicos.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={acab.includes(s.id)}
                onChange={(e) =>
                  setAcab((xs) => (e.target.checked ? [...xs, s.id] : xs.filter((x) => x !== s.id)))
                }
                data-testid={`ficha-acab-${modeloLinhaId}-${s.id}`}
              />
              {s.nome} <span className="text-muted tabular-nums">{formatMoeda(s.preco)}</span>
            </label>
          ))}
        </div>
      )}
      {/* Tamanhos de cada serviço marcado (23/10): ex. capuz infantil 2/4/6 sem cordão nem ilhós. */}
      {tamanhos.length > 1 &&
        servicos
          .filter((s) => acab.includes(s.id))
          .map((s) => {
            const so = acabTam[s.id] ?? tamanhos;
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-1.5 text-xs" data-testid={`ficha-acab-tam-${modeloLinhaId}-${s.id}`}>
                <span className="text-muted">{s.nome} nos tamanhos:</span>
                {tamanhos.map((t) => {
                  const on = so.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setAcabTam((m) => {
                          const atual = m[s.id] ?? tamanhos;
                          const novo = on ? atual.filter((x) => x !== t) : [...atual, t];
                          return { ...m, [s.id]: tamanhos.filter((x) => novo.includes(x)) };
                        })
                      }
                      className={`rounded-[10px] border px-2 py-0.5 tabular-nums ${on ? 'border-primary bg-primary text-white' : 'border-border text-muted line-through'}`}
                      data-testid={`ficha-acab-tam-${modeloLinhaId}-${s.id}-${t}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            );
          })}

      <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Facção prevista (R$/peça)" hint="Até escolher a facção da OP">
          <Input value={faccao} onChange={(e) => setFaccao(e.target.value)} inputMode="decimal" data-testid={`ficha-faccao-${modeloLinhaId}`} />
        </Field>
        <Field label="Observações">
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={1} maxLength={1000} />
        </Field>
      </div>

      <p className="text-xs text-muted">
        Insumos {formatMoeda(custoInsumos)} + facção {formatMoeda(lerNumero(faccao) ?? 0)}
        {custoAcab > 0 ? ` + acabamento ${formatMoeda(custoAcab)}` : ''}. Consumo médio por peça da grade
        inteira, na unidade do insumo. A OP mede o consumo real e você decide se atualiza aqui.
      </p>
      <div>
        <Button onClick={salvar} loading={salvando} disabled={!valido} data-testid={`ficha-salvar-${modeloLinhaId}`}>
          Salvar ficha da grade {nome}
        </Button>
      </div>
    </Card>
  );
}

interface Regras {
  /** A pasta do produto em "Moldes Computadorizados" (ex.: 100). */
  codigoMolde: string | null;
  tecido: 'TUBULAR' | 'ABERTO';
  larguraUtilMm: number;
  espelhar: boolean;
  giroCorpo: 'FIXO' | 'GIRA_180';
  giroForro: 'LIVRE' | 'GIRA_180' | 'FIXO';
  encavalamentoMm: number;
  espacamentoMm: number;
  observacoes: string | null;
  /** Ribana (gola, punho, barra): risco próprio. null = o produto não tem. */
  ribana?: { tecido: 'TUBULAR' | 'ABERTO'; larguraUtilMm: number } | null;
}

/** Ribana da Ribelt (Léo, 14/10): tubular, 58 cm úteis. */
const RIBANA_PADRAO = { tecido: 'TUBULAR' as const, larguraUtilMm: 580 };

/** Ponto de partida = o molde 100 (bermuda moletinho, tubular 1,03 m), o 1º encaixado na GPU. */
const PADRAO: Regras = {
  codigoMolde: null,
  tecido: 'TUBULAR',
  larguraUtilMm: 1030,
  espelhar: true,
  giroCorpo: 'GIRA_180',
  giroForro: 'LIVRE',
  encavalamentoMm: 0,
  espacamentoMm: 0,
  observacoes: null,
};

/**
 * Regras de ENCAIXE do produto — o que o encaixe automático (GPU) respeita.
 * Forro de bolso sempre entra no mesmo risco e não há listra/estampa por
 * enquanto (Léo, 07/10): por isso não são campos.
 */
function RegrasEncaixe({ modeloId }: { modeloId: string }) {
  const toast = useToast();
  const q = useApiQuery<{ regras: Regras | null }>(`/erp/modelos/${modeloId}/encaixe`);
  const [r, setR] = useState<Regras>(PADRAO);
  const [largura, setLargura] = useState(String(PADRAO.larguraUtilMm));
  const [enc, setEnc] = useState('0');
  const [esp, setEsp] = useState('0');
  const [comRibana, setComRibana] = useState(false);
  const [ribTecido, setRibTecido] = useState<'TUBULAR' | 'ABERTO'>(RIBANA_PADRAO.tecido);
  const [ribLargura, setRibLargura] = useState(String(RIBANA_PADRAO.larguraUtilMm));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const atual = q.data?.regras ?? PADRAO;
    setR(atual);
    setLargura(String(atual.larguraUtilMm));
    setEnc(paraCampo(atual.encavalamentoMm));
    setEsp(paraCampo(atual.espacamentoMm));
    setComRibana(!!atual.ribana);
    setRibTecido(atual.ribana?.tecido ?? RIBANA_PADRAO.tecido);
    setRibLargura(String(atual.ribana?.larguraUtilMm ?? RIBANA_PADRAO.larguraUtilMm));
  }, [q.data]);

  const larguraN = Math.round(lerNumero(largura) ?? 0);
  const ribLarguraN = Math.round(lerNumero(ribLargura) ?? 0);
  const valido =
    larguraN >= 100 &&
    larguraN <= 5000 &&
    (!comRibana || (ribLarguraN >= 100 && ribLarguraN <= 5000));

  async function salvar() {
    setSalvando(true);
    try {
      await api.put(`/erp/modelos/${modeloId}/encaixe`, {
        ...r,
        codigoMolde: r.codigoMolde?.trim() || null,
        larguraUtilMm: larguraN,
        encavalamentoMm: lerNumero(enc) ?? 0,
        espacamentoMm: lerNumero(esp) ?? 0,
        observacoes: r.observacoes ?? '',
        ribana: comRibana ? { tecido: ribTecido, larguraUtilMm: ribLarguraN } : null,
      });
      toast.success('Regras de encaixe salvas');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card variant="outline" padding="md" className="flex flex-col gap-3" data-testid="regras-encaixe">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold mr-auto">Regras de encaixe do produto</h3>
        {q.data && !q.data.regras && (
          <span className="text-xs text-warning">Ainda não salvas — sugestão do produto 100 preenchida</span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Código do molde" hint="A pasta do produto em Moldes Computadorizados (ex.: 100)">
          <Input
            value={r.codigoMolde ?? ''}
            onChange={(e) => setR({ ...r, codigoMolde: e.target.value })}
            maxLength={60}
            data-testid="regra-codigo-molde"
          />
        </Field>
        <Field label="Tecido" hint={r.tecido === 'TUBULAR' ? 'O par sai do tubo: o risco leva 1 de cada peça' : 'O par vem do molde ("1,1")'}>
          <Select value={r.tecido} onChange={(e) => setR({ ...r, tecido: e.target.value as Regras['tecido'] })} data-testid="regra-tecido">
            <option value="TUBULAR">Tubular</option>
            <option value="ABERTO">Aberto (folha simples)</option>
          </Select>
        </Field>
        <Field label="Largura útil (mm)" hint="Já sem a ourela">
          <Input value={largura} onChange={(e) => setLargura(e.target.value)} inputMode="numeric" data-testid="regra-largura" />
        </Field>
        <div className="flex items-end pb-2">
          <Switch label="Espelhar as peças" checked={r.espelhar} onChange={(e) => setR({ ...r, espelhar: e.target.checked })} />
        </div>
        <Field label="Giro das peças do corpo" hint="90° nunca">
          <Select value={r.giroCorpo} onChange={(e) => setR({ ...r, giroCorpo: e.target.value as Regras['giroCorpo'] })}>
            <option value="GIRA_180">0° ou 180°</option>
            <option value="FIXO">Fixo (só 0°)</option>
          </Select>
        </Field>
        <Field label="Giro do forro de bolso" hint="Sempre no mesmo risco do tecido">
          <Select value={r.giroForro} onChange={(e) => setR({ ...r, giroForro: e.target.value as Regras['giroForro'] })}>
            <option value="LIVRE">Livre (360°)</option>
            <option value="GIRA_180">0° ou 180°</option>
            <option value="FIXO">Fixo (só 0°)</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Encavalamento (mm)">
            <Input value={enc} onChange={(e) => setEnc(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Folga (mm)">
            <Input value={esp} onChange={(e) => setEsp(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
      </div>
      {/* Ribana (Léo + #03, 14/10): gola, punho e barra têm risco próprio, em
          outro tecido. Espelhar, giro, encavalamento e folga: os de cima. */}
      <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3" data-testid="regras-ribana">
        <Switch
          label="Tem ribana (gola, punho ou barra)"
          checked={comRibana}
          onChange={(e) => setComRibana(e.target.checked)}
          data-testid="regra-tem-ribana"
        />
        {comRibana && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tecido da ribana">
              <Select
                value={ribTecido}
                onChange={(e) => setRibTecido(e.target.value as 'TUBULAR' | 'ABERTO')}
                data-testid="regra-ribana-tecido"
              >
                <option value="TUBULAR">Tubular</option>
                <option value="ABERTO">Aberto (folha simples)</option>
              </Select>
            </Field>
            <Field label="Largura útil da ribana (mm)" hint="Já sem a ourela">
              <Input
                value={ribLargura}
                onChange={(e) => setRibLargura(e.target.value)}
                inputMode="numeric"
                data-testid="regra-ribana-largura"
              />
            </Field>
            <p className="text-xs text-muted self-end pb-2">
              Espelhar, giro e folga seguem as regras do tecido acima.
            </p>
          </div>
        )}
      </div>
      <Field label="Observações do modelista">
        <Textarea
          value={r.observacoes ?? ''}
          onChange={(e) => setR({ ...r, observacoes: e.target.value })}
          rows={2}
          maxLength={1000}
        />
      </Field>
      <div>
        <Button onClick={salvar} loading={salvando} disabled={!valido} data-testid="regras-salvar">
          Salvar regras de encaixe
        </Button>
      </div>
    </Card>
  );
}
