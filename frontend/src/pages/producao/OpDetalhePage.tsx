import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoeda, formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Dialog, Field, IconButton, Input, Select } from '@/components/ui';
import { lerNumero, paraCampo } from '@/pages/precificacao/calculo';
import { SIGLA, type Insumo, type Unidade } from '@/pages/insumos/insumo';
import { GradeEditor, inteiro, totalGrade, type CelulaGrade, type ValoresGrade } from './GradeEditor';
import { STATUS_OP } from './ProducaoPage';
import { PagamentosDaFaccao } from '@/pages/financeiro/Atalhos';

/**
 * Uma ordem de produção (ERP próprio · entrega 4): a grade em cada etapa, o
 * que gastou, o que a facção entregou e — fechada — o custo real por peça.
 */

interface ItemOp extends CelulaGrade {
  modeloLinhaId: string;
  planejada: number;
  cortada: number | null;
  enviada: number | null;
  recebida: number;
  defeito: number;
}
interface Sugestao {
  insumoId: string;
  nome: string;
  cor: string | null;
  unidade: Unidade;
  quantidade: number;
}
interface Op {
  id: string;
  numero: string;
  status: string;
  modelo: { id: string; nome: string };
  faccao: { id: string; nome: string } | null;
  prazo: string | null;
  observacoes: string | null;
  precoFaccaoPorPeca: number | null;
  custoTecido: number;
  custoAviamentos: number;
  custoFaccao: number;
  cortadaEm: string | null;
  enviadaEm: string | null;
  fechadaEm: string | null;
  criadoEm: string;
  itens: ItemOp[];
  consumos: Array<{ insumoId: string; insumo: { nome: string; cor: string | null; unidade: Unidade }; etapa: string; quantidade: number; custoUnitario: number }>;
  entregas: Array<{ produtoId: string; quantidade: number; defeito: number; criadoEm: string }>;
  custos: Array<{ modeloLinhaId: string; linha: string; pecas: number; custoTotal: number; custoPorPeca: number }>;
  consumoRealPorPeca: number | null;
  sugestoes: { tecidos: Sugestao[]; aviamentos: Sugestao[] };
}

type Etapa = 'corte' | 'envio' | 'entrega' | 'fechar' | 'cancelar';

const data = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
const qtd = (v: number, u: Unidade) => `${formatNumero(Math.round(v * 1000) / 1000)} ${SIGLA[u]}`;

export default function OpDetalhePage() {
  const { id = '' } = useParams<{ id: string }>();
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<Op>(gestor && id ? `/erp/ops/${id}` : null);
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const op = q.data;
  const pronto = () => {
    setEtapa(null);
    q.refetch();
  };

  return (
    <PageLayout
      title={op ? `${op.numero} · ${op.modelo.nome}` : 'Ordem de produção'}
      description={op ? `Criada em ${data(op.criadoEm)}${op.faccao ? ` · facção ${op.faccao.nome}` : ''}` : undefined}
      actions={
        <Link to="/producao" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> Produção
        </Link>
      }
    >
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa a produção.</Card>
      ) : (
        <StateView loading={q.loading && !op} error={q.error} onRetry={q.refetch}>
          {op && (
            <div className="flex flex-col gap-4">
              <Card className="p-4 flex flex-wrap items-center gap-3">
                <Badge variant={STATUS_OP[op.status]?.tom ?? 'neutral'} size="lg">
                  {STATUS_OP[op.status]?.texto ?? op.status}
                </Badge>
                <span className="text-sm text-muted">
                  Corte {data(op.cortadaEm)} · Envio {data(op.enviadaEm)} · Prazo {data(op.prazo)} · Fechada {data(op.fechadaEm)}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  {op.status === 'RASCUNHO' && (
                    <Button onClick={() => setEtapa('corte')} data-testid="op-acao-corte">
                      Registrar corte
                    </Button>
                  )}
                  {op.status === 'CORTADA' && (
                    <Button onClick={() => setEtapa('envio')} data-testid="op-acao-envio">
                      Enviar pra facção
                    </Button>
                  )}
                  {(op.status === 'NA_FACCAO' || op.status === 'RECEBENDO') && (
                    <Button onClick={() => setEtapa('entrega')} data-testid="op-acao-entrega">
                      Registrar entrega da facção
                    </Button>
                  )}
                  {op.status === 'RECEBENDO' && (
                    <Button variant="secondary" onClick={() => setEtapa('fechar')} data-testid="op-acao-fechar">
                      Fechar OP
                    </Button>
                  )}
                  {(op.status === 'RASCUNHO' || op.status === 'CORTADA') && (
                    <Button variant="ghost" className="text-danger" onClick={() => setEtapa('cancelar')}>
                      Cancelar OP
                    </Button>
                  )}
                </div>
              </Card>

              <PagamentosDaFaccao key={`${op.status}:${op.entregas.length}`} opId={op.id} numero={op.numero} />

              <Card className="p-4 flex flex-col gap-3">
                <h2 className="text-base font-semibold">Grade</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm tabular-nums" data-testid="op-grade-tabela">
                    <thead className="text-[11px] uppercase tracking-wide text-muted">
                      <tr>
                        {['Variação', 'Planejado', 'Cortado', 'Enviado', 'Recebido', 'Defeito'].map((h, i) => (
                          <th key={h} className={cn('px-2 py-1 font-semibold', i ? 'text-right' : 'text-left')}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {op.itens.map((i) => (
                        <tr key={i.produtoId} className="border-t border-border">
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              <i className="inline-block h-3 w-3 shrink-0 rounded-full border border-border" style={{ background: i.cor.hex }} />
                              {i.cor.nome} · {i.linha} {i.tamanho}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right">{i.planejada}</td>
                          <td className="px-2 py-1.5 text-right">{i.cortada ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right">{i.enviada ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{i.recebida || '—'}</td>
                          <td className={cn('px-2 py-1.5 text-right', i.defeito ? 'text-danger' : 'text-muted')}>{i.defeito || '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-border font-semibold">
                        <td className="px-2 py-1.5">Total</td>
                        {(['planejada', 'cortada', 'enviada', 'recebida', 'defeito'] as const).map((k) => (
                          <td key={k} className="px-2 py-1.5 text-right">
                            {formatNumero(op.itens.reduce((s, i) => s + (i[k] ?? 0), 0))}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-4 flex flex-col gap-2" data-testid="op-custos">
                <h2 className="text-base font-semibold">Custos reais</h2>
                <div className="grid gap-2 sm:grid-cols-4 text-sm">
                  <Valor rotulo="Tecido (corte)" v={formatMoeda(op.custoTecido)} />
                  <Valor rotulo="Aviamentos" v={formatMoeda(op.custoAviamentos)} />
                  <Valor
                    rotulo="Facção"
                    v={formatMoeda(op.custoFaccao)}
                    dica={op.precoFaccaoPorPeca !== null ? `${formatMoeda(op.precoFaccaoPorPeca)}/peça enviada` : undefined}
                  />
                  <Valor rotulo="Total" v={formatMoeda(op.custoTecido + op.custoAviamentos + op.custoFaccao)} />
                </div>
                {op.consumoRealPorPeca !== null && (
                  <p className="text-sm text-muted">
                    Consumo real de tecido:{' '}
                    <b className="text-text">
                      {formatNumero(Math.round(op.consumoRealPorPeca * 1000) / 1000)}{' '}
                      {SIGLA[op.consumos.find((c) => c.etapa === 'CORTE')?.insumo.unidade ?? 'KG']}
                    </b>{' '}
                    por peça cortada — compare com a ficha técnica e atualize lá se quiser.
                  </p>
                )}
                {op.custos.length > 0 && (
                  <div className="flex flex-wrap gap-3 text-sm" data-testid="op-custo-real">
                    {op.custos.map((c) => (
                      <span key={c.modeloLinhaId} className="rounded-[10px] bg-success/10 px-3 py-1.5">
                        Grade {c.linha}: <b>{formatMoeda(c.custoPorPeca)}</b>/peça ({c.pecas} recebidas)
                      </span>
                    ))}
                  </div>
                )}
                {op.consumos.length > 0 && (
                  <ul className="text-xs text-muted">
                    {op.consumos.map((c, i) => (
                      <li key={`${c.insumoId}-${i}`}>
                        {c.etapa === 'CORTE' ? 'Corte' : 'Envio'}: {c.insumo.nome}
                        {c.insumo.cor ? ` · ${c.insumo.cor}` : ''} — {qtd(c.quantidade, c.insumo.unidade)} ×{' '}
                        {formatMoeda(c.custoUnitario)}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card variant="outline" padding="md" className="text-sm text-muted">
                <b className="text-text">Encaixe</b> — o risco automático (RTX 5090) entra aqui, em cima desta OP, quando o card do
                encaixe ficar pronto. As regras vêm da ficha técnica do modelo.
              </Card>
            </div>
          )}
        </StateView>
      )}

      {op && etapa === 'corte' && <CorteDialog op={op} onClose={() => setEtapa(null)} onPronto={pronto} />}
      {op && etapa === 'envio' && <EnvioDialog op={op} onClose={() => setEtapa(null)} onPronto={pronto} />}
      {op && etapa === 'entrega' && <EntregaDialog op={op} onClose={() => setEtapa(null)} onPronto={pronto} />}
      {op && (etapa === 'fechar' || etapa === 'cancelar') && (
        <ConfirmaDialog op={op} tipo={etapa} onClose={() => setEtapa(null)} onPronto={pronto} />
      )}
    </PageLayout>
  );
}

function Valor({ rotulo, v, dica }: { rotulo: string; v: string; dica?: string }) {
  return (
    <div className="rounded-[10px] border border-border p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{rotulo}</div>
      <b className="tabular-nums">{v}</b>
      {dica && <div className="text-xs text-muted">{dica}</div>}
    </div>
  );
}

function useEtapa(onPronto: () => void, ok: string) {
  const toast = useToast();
  const [salvando, setSalvando] = useState(false);
  async function enviar(fn: () => Promise<unknown>) {
    setSalvando(true);
    try {
      await fn();
      toast.success(ok);
      onPronto();
    } catch (err) {
      toast.error('Não foi possível', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }
  return { salvando, enviar };
}

/** Lista editável de insumos (tecido no corte, aviamento no envio). */
function ListaInsumos({
  linhas,
  onChange,
  opcoes,
  rotulo,
}: {
  linhas: Array<{ insumoId: string; qtd: string }>;
  onChange: (l: Array<{ insumoId: string; qtd: string }>) => void;
  opcoes: Insumo[];
  rotulo: string;
}) {
  const porId = new Map(opcoes.map((i) => [i.id, i]));
  const livres = opcoes.filter((i) => i.ativo && !linhas.some((l) => l.insumoId === i.id));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{rotulo}</span>
      {linhas.map((l, idx) => {
        const ins = porId.get(l.insumoId);
        return (
          <div key={l.insumoId} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-center gap-2">
            <span className="text-sm">
              {ins?.nome ?? '?'}
              {ins?.cor ? ` · ${ins.cor}` : ''}
              {ins && <span className="text-muted"> (tem {qtd(ins.saldo, ins.unidade)})</span>}
            </span>
            <div className="flex items-center gap-1">
              <Input
                value={l.qtd}
                onChange={(e) => onChange(linhas.map((x, i) => (i === idx ? { ...x, qtd: e.target.value } : x)))}
                inputMode="decimal"
              />
              <span className="w-6 text-xs text-muted">{ins ? SIGLA[ins.unidade] : ''}</span>
            </div>
            <IconButton aria-label="Tirar" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(linhas.filter((_, i) => i !== idx))} />
          </div>
        );
      })}
      {livres.length > 0 && (
        <Select value="" onChange={(e) => e.target.value && onChange([...linhas, { insumoId: e.target.value, qtd: '' }])} className="w-64">
          <option value="">+ adicionar…</option>
          {livres.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome}
              {i.cor ? ` · ${i.cor}` : ''}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

const deSugestao = (s: Sugestao[]) => s.map((x) => ({ insumoId: x.insumoId, qtd: paraCampo(x.quantidade) }));
const paraEnvio = (l: Array<{ insumoId: string; qtd: string }>) =>
  l.map((x) => ({ insumoId: x.insumoId, quantidade: lerNumero(x.qtd) ?? 0 })).filter((x) => x.quantidade > 0);
const gradeDe = (op: Op, k: 'planejada' | 'cortada') =>
  Object.fromEntries(op.itens.map((i) => [i.produtoId, String(i[k] ?? 0)]));

function CorteDialog({ op, onClose, onPronto }: { op: Op; onClose: () => void; onPronto: () => void }) {
  const insumos = useApiQuery<Insumo[]>('/erp/insumos');
  const [tecidos, setTecidos] = useState(() => deSugestao(op.sugestoes.tecidos));
  const [grade, setGrade] = useState<ValoresGrade>(() => gradeDe(op, 'planejada'));
  const { salvando, enviar } = useEtapa(onPronto, 'Corte registrado — tecido baixado do estoque');
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Corte · ${op.numero}`}
      description="O tecido realmente gasto sai do estoque; as peças cortadas são o que pode ir pra facção."
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="mr-auto text-sm text-muted">{formatNumero(totalGrade(grade))} peças cortadas</span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={totalGrade(grade) === 0}
            data-testid="corte-salvar"
            onClick={() =>
              enviar(() =>
                api.post(`/erp/ops/${op.id}/corte`, {
                  tecidos: paraEnvio(tecidos),
                  itens: op.itens.map((i) => ({ produtoId: i.produtoId, cortada: inteiro(grade[i.produtoId]) })),
                }),
              )
            }
          >
            Registrar corte
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ListaInsumos
          rotulo="Tecido gasto (sugestão = ficha técnica × planejado)"
          linhas={tecidos}
          onChange={setTecidos}
          opcoes={(insumos.data ?? []).filter((i) => i.tipo === 'TECIDO')}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Peças cortadas</span>
          <GradeEditor celulas={op.itens} valores={grade} onChange={setGrade} testid="corte-grade" />
        </div>
      </div>
    </Dialog>
  );
}

function EnvioDialog({ op, onClose, onPronto }: { op: Op; onClose: () => void; onPronto: () => void }) {
  const insumos = useApiQuery<Insumo[]>('/erp/insumos');
  const faccoes = useApiQuery<Array<{ id: string; nome: string; ativo: boolean; precos: Array<{ modeloId: string; precoPorPeca: number }> }>>('/erp/faccoes');
  const [faccaoId, setFaccaoId] = useState(op.faccao?.id ?? '');
  const [preco, setPreco] = useState('');
  const [prazo, setPrazo] = useState(op.prazo ? op.prazo.slice(0, 10) : '');
  const [aviamentos, setAviamentos] = useState(() => deSugestao(op.sugestoes.aviamentos));
  const [grade, setGrade] = useState<ValoresGrade>(() => gradeDe(op, 'cortada'));
  const maximos = Object.fromEntries(op.itens.map((i) => [i.produtoId, i.cortada ?? 0]));
  const tabela = (faccoes.data ?? []).find((f) => f.id === faccaoId)?.precos.find((p) => p.modeloId === op.modelo.id)?.precoPorPeca ?? null;
  const enviadas = totalGrade(grade);
  const precoUsado = lerNumero(preco) ?? tabela;
  const passou = op.itens.some((i) => inteiro(grade[i.produtoId]) > (i.cortada ?? 0));
  const { salvando, enviar } = useEtapa(onPronto, 'Enviado pra facção');

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Envio pra facção · ${op.numero}`}
      description="A facção cobra por peça ENVIADA. Os aviamentos que saem são baixados do estoque."
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="mr-auto text-sm text-muted">
            {formatNumero(enviadas)} peças{precoUsado !== null ? ` · facção ${formatMoeda(enviadas * precoUsado)}` : ''}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={!faccaoId || enviadas === 0 || passou || precoUsado === null}
            data-testid="envio-salvar"
            onClick={() =>
              enviar(() =>
                api.post(`/erp/ops/${op.id}/envio`, {
                  faccaoId,
                  precoPorPeca: lerNumero(preco),
                  prazo: prazo || null,
                  aviamentos: paraEnvio(aviamentos),
                  itens: op.itens.map((i) => ({ produtoId: i.produtoId, enviada: inteiro(grade[i.produtoId]) })),
                }),
              )
            }
          >
            Enviar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Facção">
            <Select value={faccaoId} onChange={(e) => setFaccaoId(e.target.value)} data-testid="envio-faccao">
              <option value="">Escolha…</option>
              {(faccoes.data ?? [])
                .filter((f) => f.ativo)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Preço por peça (R$)" hint={tabela !== null ? `Tabela da facção: ${formatMoeda(tabela)}` : 'Sem preço na tabela — informe'}>
            <Input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder={tabela !== null ? paraCampo(tabela) : ''} />
          </Field>
          <Field label="Prazo de entrega">
            <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </Field>
        </div>
        <ListaInsumos
          rotulo="Aviamentos que vão junto (sugestão = ficha × cortado)"
          linhas={aviamentos}
          onChange={setAviamentos}
          opcoes={(insumos.data ?? []).filter((i) => i.tipo === 'AVIAMENTO')}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Peças enviadas</span>
          <GradeEditor celulas={op.itens} valores={grade} onChange={setGrade} maximos={maximos} testid="envio-grade" />
        </div>
      </div>
    </Dialog>
  );
}

function EntregaDialog({ op, onClose, onPronto }: { op: Op; onClose: () => void; onPronto: () => void }) {
  const falta = Object.fromEntries(op.itens.map((i) => [i.produtoId, Math.max(0, (i.enviada ?? 0) - i.recebida - i.defeito)]));
  const [grade, setGrade] = useState<ValoresGrade>(() => Object.fromEntries(Object.entries(falta).map(([k, v]) => [k, String(v)])));
  const [defeito, setDefeito] = useState<ValoresGrade>({});
  const [comDefeito, setComDefeito] = useState(false);
  const passou = op.itens.some((i) => inteiro(grade[i.produtoId]) + inteiro(defeito[i.produtoId]) > falta[i.produtoId]);
  const { salvando, enviar } = useEtapa(onPronto, 'Entrega registrada — peças no estoque');
  const total = totalGrade(grade) + totalGrade(defeito);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Entrega da facção · ${op.numero}`}
      description="Peça boa entra no estoque na hora. A facção pode entregar em várias vezes."
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="mr-auto text-sm text-muted">{formatNumero(totalGrade(grade))} peças boas</span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvando}
            disabled={total === 0 || passou}
            data-testid="entrega-salvar"
            onClick={() =>
              enviar(() =>
                api.post(`/erp/ops/${op.id}/recebimentos`, {
                  itens: op.itens
                    .map((i) => ({ produtoId: i.produtoId, quantidade: inteiro(grade[i.produtoId]), defeito: inteiro(defeito[i.produtoId]) }))
                    .filter((i) => i.quantidade + i.defeito > 0),
                }),
              )
            }
          >
            Registrar entrega
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Peças boas que chegaram</span>
          <GradeEditor celulas={op.itens} valores={grade} onChange={setGrade} maximos={falta} testid="entrega-grade" />
        </div>
        {comDefeito ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Com defeito (não entram no estoque)</span>
            <GradeEditor celulas={op.itens} valores={defeito} onChange={setDefeito} />
          </div>
        ) : (
          <button type="button" className="self-start text-sm text-primary underline" onClick={() => setComDefeito(true)}>
            Veio peça com defeito?
          </button>
        )}
      </div>
    </Dialog>
  );
}

function ConfirmaDialog({ op, tipo, onClose, onPronto }: { op: Op; tipo: 'fechar' | 'cancelar'; onClose: () => void; onPronto: () => void }) {
  const { salvando, enviar } = useEtapa(onPronto, tipo === 'fechar' ? 'OP fechada — custo real gravado' : 'OP cancelada');
  const enviadas = op.itens.reduce((s, i) => s + (i.enviada ?? 0), 0);
  const recebidas = op.itens.reduce((s, i) => s + i.recebida, 0);
  const defeitos = op.itens.reduce((s, i) => s + i.defeito, 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title={tipo === 'fechar' ? `Fechar ${op.numero}` : `Cancelar ${op.numero}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant={tipo === 'cancelar' ? 'danger' : 'primary'}
            loading={salvando}
            data-testid={`op-confirmar-${tipo}`}
            onClick={() => enviar(() => api.post(`/erp/ops/${op.id}/${tipo}`))}
          >
            {tipo === 'fechar' ? 'Fechar OP' : 'Cancelar OP'}
          </Button>
        </div>
      }
    >
      {tipo === 'fechar' ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Enviadas <b>{enviadas}</b> · recebidas <b>{recebidas}</b> · defeito <b>{defeitos}</b>
            {enviadas - recebidas - defeitos > 0 && (
              <span className="text-warning"> · {enviadas - recebidas - defeitos} não voltaram</span>
            )}
          </p>
          <p className="text-muted">
            O custo real por peça = (tecido + aviamentos + facção) ÷ peças recebidas, por grade. Ele vai pra calculadora de
            precificação. Depois de fechada, a OP não recebe mais entregas.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {op.status === 'CORTADA'
            ? 'O tecido já cortado continua baixado do estoque (ele foi gasto).'
            : 'A OP some da produção em andamento.'}
        </p>
      )}
    </Dialog>
  );
}
