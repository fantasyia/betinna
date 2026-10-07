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
  existe: boolean;
  custoFaccaoPrevisto: number | null;
  observacoes: string | null;
  itens: Array<{
    insumoId: string;
    consumoPorPeca: number;
    observacao: string | null;
    corFixa: { id: string; nome: string; hex: string } | null;
  }>;
  semCusto: string[];
}

interface Linha {
  insumoId: string;
  consumo: string;
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
      {linhas.map((l) => (
        <FichaDaGrade key={l.id} modeloLinhaId={l.id} nome={l.nome} insumos={insumos.data ?? []} />
      ))}
      <RegrasEncaixe modeloId={modeloId} />
    </div>
  );
}

function FichaDaGrade({ modeloLinhaId, nome, insumos }: { modeloLinhaId: string; nome: string; insumos: Insumo[] }) {
  const toast = useToast();
  const q = useApiQuery<FichaApi>(`/erp/fichas/${modeloLinhaId}`);
  const [itens, setItens] = useState<Linha[]>([]);
  const [faccao, setFaccao] = useState('');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setItens(q.data.itens.map((i) => ({ insumoId: i.insumoId, consumo: paraCampo(i.consumoPorPeca), corFixaId: i.corFixa?.id ?? '' })));
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
  const custoItem = (l: Linha) => (lerNumero(l.consumo) ?? 0) * custoUnit(l);
  const custoInsumos = itens.reduce((s, l) => s + custoItem(l), 0);
  const total = custoInsumos + (lerNumero(faccao) ?? 0);
  const usados = new Set(itens.map((l) => l.insumoId));
  const livres = insumos.filter((i) => i.ativo && !usados.has(i.id));
  const valido = itens.every((l) => l.insumoId && (lerNumero(l.consumo) ?? 0) > 0);

  async function salvar() {
    setSalvando(true);
    try {
      await api.put(`/erp/fichas/${modeloLinhaId}`, {
        custoFaccaoPrevisto: lerNumero(faccao),
        observacoes: obs,
        itens: itens.map((l) => ({ insumoId: l.insumoId, consumoPorPeca: lerNumero(l.consumo), corFixaId: l.corFixaId || null })),
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
                      value={l.consumo}
                      onChange={(e) => setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, consumo: e.target.value } : x)))}
                      inputMode="decimal"
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
          onClick={() => setItens((xs) => [...xs, { insumoId: livres[0].id, consumo: '', corFixaId: '' }])}
          data-testid={`ficha-add-${modeloLinhaId}`}
        >
          Adicionar insumo
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Facção prevista (R$/peça)" hint="Até escolher a facção da OP">
          <Input value={faccao} onChange={(e) => setFaccao(e.target.value)} inputMode="decimal" data-testid={`ficha-faccao-${modeloLinhaId}`} />
        </Field>
        <Field label="Observações">
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={1} maxLength={1000} />
        </Field>
      </div>

      <p className="text-xs text-muted">
        Insumos {formatMoeda(custoInsumos)} + facção {formatMoeda(lerNumero(faccao) ?? 0)}. Consumo médio por peça da grade
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
  tecido: 'TUBULAR' | 'ABERTO';
  larguraUtilMm: number;
  espelhar: boolean;
  giroCorpo: 'FIXO' | 'GIRA_180';
  giroForro: 'LIVRE' | 'GIRA_180' | 'FIXO';
  encavalamentoMm: number;
  espacamentoMm: number;
  observacoes: string | null;
}

/** Ponto de partida = o produto 100 (short tactel), o único já encaixado na GPU. */
const PADRAO: Regras = {
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
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const atual = q.data?.regras ?? PADRAO;
    setR(atual);
    setLargura(String(atual.larguraUtilMm));
    setEnc(paraCampo(atual.encavalamentoMm));
    setEsp(paraCampo(atual.espacamentoMm));
  }, [q.data]);

  const larguraN = Math.round(lerNumero(largura) ?? 0);
  const valido = larguraN >= 100 && larguraN <= 5000;

  async function salvar() {
    setSalvando(true);
    try {
      await api.put(`/erp/modelos/${modeloId}/encaixe`, {
        ...r,
        larguraUtilMm: larguraN,
        encavalamentoMm: lerNumero(enc) ?? 0,
        espacamentoMm: lerNumero(esp) ?? 0,
        observacoes: r.observacoes ?? '',
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
