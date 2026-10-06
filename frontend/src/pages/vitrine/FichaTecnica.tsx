import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Card, Field, IconButton, Input, Select, Textarea } from '@/components/ui';
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
  itens: Array<{ insumoId: string; consumoPorPeca: number; observacao: string | null }>;
  semCusto: string[];
}

interface Linha {
  insumoId: string;
  consumo: string;
}

export function FichaTecnicaAba({ linhas }: { linhas: Array<{ id: string; nome: string }> }) {
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
      <Card variant="outline" padding="md" className="text-sm text-muted">
        <b className="text-text">Regras de encaixe</b> — entram aqui (largura do tecido, sentido do fio, giro das
        peças…) assim que as regras de cada produto vierem do CAD.
      </Card>
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
    setItens(q.data.itens.map((i) => ({ insumoId: i.insumoId, consumo: paraCampo(i.consumoPorPeca) })));
    setFaccao(paraCampo(q.data.custoFaccaoPrevisto));
    setObs(q.data.observacoes ?? '');
  }, [q.data]);

  const porId = new Map(insumos.map((i) => [i.id, i]));
  const custoItem = (l: Linha) => (lerNumero(l.consumo) ?? 0) * (porId.get(l.insumoId)?.custoMedio ?? 0);
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
        itens: itens.map((l) => ({ insumoId: l.insumoId, consumoPorPeca: lerNumero(l.consumo) })),
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
              <div key={`${l.insumoId}-${idx}`} className="grid grid-cols-[minmax(0,1fr)_9rem_7rem_auto] items-end gap-2">
                <Field label={idx === 0 ? 'Insumo' : undefined}>
                  <Select
                    value={l.insumoId}
                    onChange={(e) => setItens((xs) => xs.map((x, i) => (i === idx ? { ...x, insumoId: e.target.value } : x)))}
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
                <div className="pb-2 text-right text-sm tabular-nums">
                  {ins && ins.custoMedio > 0 ? formatMoeda(custoItem(l)) : <span className="text-warning text-xs">sem custo</span>}
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
          onClick={() => setItens((xs) => [...xs, { insumoId: livres[0].id, consumo: '' }])}
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
