import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoeda, formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Badge, Button, Card, Dialog, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import type { SaldoVariacao } from '@/pages/estoque/grade';
import { SIGLA, type Unidade } from '@/pages/insumos/insumo';
import { GradeEditor, inteiro, totalGrade, type CelulaGrade, type ValoresGrade } from './GradeEditor';
import {
  linhasDoModelo,
  pecasPorGrade,
  quantidadesDaGrade,
  registroDaGrade,
} from './gradeRisco';
import { KanbanProducao } from './KanbanProducao';

/** Visão da produção: kanban (etapas) ou lista. Fica lembrada neste aparelho. */
const CHAVE_VISAO = 'producao:visao';
function visaoSalva(): 'kanban' | 'lista' {
  try {
    return localStorage.getItem(CHAVE_VISAO) === 'lista' ? 'lista' : 'kanban';
  } catch {
    return 'kanban';
  }
}

/**
 * Produção (ERP próprio · Fase 2 · entrega 4): ordens de produção.
 * A OP nasce com a grade e a simulação pela ficha técnica; o encaixe
 * automático (GPU) entra depois, em cima da OP gravada.
 */

export const STATUS_OP: Record<string, { texto: string; tom: 'neutral' | 'info' | 'warning' | 'primary' | 'success' | 'danger' }> = {
  RASCUNHO: { texto: 'Rascunho', tom: 'neutral' },
  CORTADA: { texto: 'Cortada', tom: 'info' },
  NA_FACCAO: { texto: 'Na facção', tom: 'warning' },
  RECEBENDO: { texto: 'Recebendo', tom: 'primary' },
  FECHADA: { texto: 'Fechada', tom: 'success' },
  CANCELADA: { texto: 'Cancelada', tom: 'danger' },
};

interface OpResumo {
  id: string;
  numero: string;
  status: string;
  /** Etapa do kanban da produção (14/10). */
  etapa?: string;
  modelo: { id: string; nome: string };
  faccao: { id: string; nome: string } | null;
  prazo: string | null;
  criadoEm: string;
  planejada: number;
  cortada: number;
  enviada: number;
  recebida: number;
  defeito: number;
  aReceber: number;
  atrasada: boolean;
}

export default function ProducaoPage() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<OpResumo[]>(gestor ? '/erp/ops' : null);
  const navigate = useNavigate();
  const location = useLocation();
  // Veio da Reposição: abre a Nova OP já com o modelo e a grade do que falta.
  const pre = (location.state as { nova?: NovaInicial } | null)?.nova ?? null;
  const [nova, setNova] = useState(Boolean(pre));
  // Kanban das etapas (Léo, 14/10) é o padrão; a lista segue a um clique.
  const [visao, setVisaoEstado] = useState<'kanban' | 'lista'>(visaoSalva);
  const setVisao = (v: 'kanban' | 'lista') => {
    setVisaoEstado(v);
    try {
      localStorage.setItem(CHAVE_VISAO, v);
    } catch {
      /* sem armazenamento: só não lembra */
    }
  };

  return (
    <PageLayout
      title="Produção"
      description="Ordens de produção: corte, facção, recebimento e o custo real de cada peça."
      actions={
        gestor ? (
          <Button leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNova(true)} data-testid="op-nova">
            Nova OP
          </Button>
        ) : undefined
      }
    >
      <CatalogoTabs />
      {!gestor ? (
        <Card className="p-6 text-sm text-muted">Só a diretoria acessa a produção.</Card>
      ) : (
        <StateView loading={q.loading} error={q.error} onRetry={q.refetch}>
          {(q.data ?? []).length > 0 && (
            <div className="mb-3 flex gap-1" role="group" aria-label="Visão">
              {(['kanban', 'lista'] as const).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={visao === v ? 'primary' : 'secondary'}
                  onClick={() => setVisao(v)}
                  aria-pressed={visao === v}
                  data-testid={`ops-visao-${v}`}
                >
                  {v === 'kanban' ? 'Etapas' : 'Lista'}
                </Button>
              ))}
            </div>
          )}
          {(q.data ?? []).length === 0 ? (
            <Card className="p-6 text-sm text-muted text-center">Nenhuma ordem de produção ainda.</Card>
          ) : visao === 'kanban' ? (
            <KanbanProducao ops={q.data ?? []} onMudou={q.refetch} />
          ) : (
            <Card className="p-0 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm tabular-nums" data-testid="ops-tabela">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    {['OP', 'Modelo', 'Etapa', 'Facção', 'Planej.', 'Cortado', 'Enviado', 'Recebido', 'A receber', 'Prazo'].map((h, i) => (
                      <th key={h} className={cn('px-3 py-2 font-semibold', i >= 4 && i <= 8 ? 'text-right' : 'text-left')}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(q.data ?? []).map((op) => (
                    <tr key={op.id} className="border-t border-border hover:bg-surface-hover cursor-pointer" onClick={() => navigate(`/producao/${op.id}`)}>
                      <td className="px-3 py-2 font-semibold">
                        <Link to={`/producao/${op.id}`} className="hover:underline">
                          {op.numero}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{op.modelo.nome}</td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUS_OP[op.status]?.tom ?? 'neutral'}>{STATUS_OP[op.status]?.texto ?? op.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted">{op.faccao?.nome ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{formatNumero(op.planejada)}</td>
                      <td className="px-3 py-2 text-right">{op.cortada ? formatNumero(op.cortada) : '—'}</td>
                      <td className="px-3 py-2 text-right">{op.enviada ? formatNumero(op.enviada) : '—'}</td>
                      <td className="px-3 py-2 text-right">{op.recebida ? formatNumero(op.recebida) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{op.aReceber ? formatNumero(op.aReceber) : '—'}</td>
                      <td className={cn('px-3 py-2 whitespace-nowrap', op.atrasada ? 'text-danger font-semibold' : 'text-muted')}>
                        {op.prazo ? new Date(op.prazo).toLocaleDateString('pt-BR') : '—'}
                        {op.atrasada && ' · atrasada'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </StateView>
      )}
      {nova && (
        <NovaOpDialog
          inicial={pre}
          onClose={() => {
            setNova(false);
            // Limpa o "veio da reposição" pra não reabrir no voltar.
            if (pre) navigate('/producao', { replace: true, state: null });
          }}
          onCriou={(id) => navigate(`/producao/${id}`)}
        />
      )}
    </PageLayout>
  );
}

interface Simulacao {
  pecas: number;
  insumos: Array<{
    insumoId: string;
    /** Insumo com cores: a necessidade vem POR COR (a cor da peça, ou a fixada na ficha). */
    insumoCorId?: string | null;
    nome: string;
    cor: string | null;
    corHex?: string | null;
    /** O insumo tem cores, mas não a da peça — cadastre a cor no insumo. */
    semCor?: boolean;
    tipo: string;
    unidade: Unidade;
    necessario: number;
    saldo: number;
    falta: number;
    custo: number;
  }>;
  custoInsumos: number;
  custoFaccao: number;
  precoFaccaoTabela: number | null;
  custoPorPeca: number;
  gradesSemFicha: number;
}

/** SaldoVariacao (estoque) → célula da grade da OP. */
export function paraCelula(v: SaldoVariacao): CelulaGrade {
  return {
    produtoId: v.produtoId,
    cor: { nome: v.cor.nome, hex: v.cor.hex },
    corOrdem: v.cor.ordem,
    linha: v.linha.nome,
    linhaOrdem: v.linha.ordem,
    tamanho: v.tamanho.nome,
    tamanhoOrdem: v.tamanho.ordem,
  };
}

export interface NovaInicial {
  modeloId: string;
  grade: ValoresGrade;
}

export function NovaOpDialog({
  inicial,
  onClose,
  onCriou,
}: {
  inicial: NovaInicial | null;
  onClose: () => void;
  onCriou: (id: string) => void;
}) {
  const toast = useToast();
  const variacoes = useApiQuery<SaldoVariacao[]>('/erp/estoque/saldos');
  const faccoes = useApiQuery<Array<{ id: string; nome: string; ativo: boolean }>>('/erp/faccoes');
  const modelos = useMemo(
    () => [...new Map((variacoes.data ?? []).map((v) => [v.modelo.id, v.modelo])).values()].sort((a, b) => a.ordem - b.ordem),
    [variacoes.data],
  );
  const [modeloId, setModeloId] = useState(inicial?.modeloId ?? '');
  const [faccaoId, setFaccaoId] = useState('');
  const [prazo, setPrazo] = useState('');
  const [obs, setObs] = useState('');
  const [gradeManual, setGradeManual] = useState<ValoresGrade>(inicial?.grade ?? {});
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [salvando, setSalvando] = useState(false);
  // OP pela GRADE DO RISCO (Léo, 14/10) é o padrão; peça por peça continua
  // (e é o modo de quem chega com a grade pronta, ex.: reposição do estoque).
  const [modo, setModo] = useState<'grade' | 'peca'>(inicial?.grade ? 'peca' : 'grade');
  const [linha, setLinha] = useState('');
  const [risco, setRisco] = useState<Record<string, string>>({});
  const [coresRisco, setCoresRisco] = useState<Array<{ cor: string; grades: string }>>([]);

  useEffect(() => {
    if (!modeloId && modelos[0]) setModeloId(modelos[0].id);
  }, [modelos, modeloId]);

  const celulas = (variacoes.data ?? []).filter((v) => v.modelo.id === modeloId && v.ativo).map(paraCelula);
  const linhas = linhasDoModelo(celulas);
  const linhaAtual = linhas.find((l) => l.linha === linha) ?? linhas[0];
  const composicao = Object.fromEntries(
    (linhaAtual?.tamanhos ?? []).map((t) => [t, inteiro(risco[t])]),
  );
  const coresNum = coresRisco.map((c) => ({ cor: c.cor, grades: inteiro(c.grades) }));
  const porGrade = pecasPorGrade(composicao);
  const grade: ValoresGrade =
    modo === 'grade' && linhaAtual
      ? quantidadesDaGrade(celulas, linhaAtual.linha, composicao, coresNum)
      : gradeManual;
  const registro =
    modo === 'grade' && linhaAtual
      ? registroDaGrade(linhaAtual.linha, linhaAtual.tamanhos, composicao, coresNum)
      : null;
  const itens = Object.entries(grade)
    .map(([produtoId, t]) => ({ produtoId, quantidade: inteiro(t) }))
    .filter((i) => i.quantidade > 0);
  const corpo = { modeloId, faccaoId: faccaoId || null, itens };
  const chave = JSON.stringify(corpo);

  // Simulação ao vivo (com folga pra não chamar a cada tecla).
  useEffect(() => {
    if (!modeloId || itens.length === 0) {
      setSim(null);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .post<Simulacao>('/erp/ops/simular', JSON.parse(chave))
        .then(setSim)
        .catch(() => setSim(null));
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave já resume o corpo
  }, [chave]);

  async function gerar() {
    setSalvando(true);
    try {
      const op = await api.post<{ id: string; numero: string }>('/erp/ops', {
        ...corpo,
        prazo: prazo || null,
        observacoes: obs,
        ...(registro ? { gradeRisco: registro } : {}),
      });
      toast.success(`${op.numero} gerada`);
      onCriou(op.id);
    } catch (err) {
      toast.error('Não foi possível gerar a OP', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Nova ordem de produção"
      description="Monte a grade. A simulação usa a ficha técnica de cada grade; o encaixe entra depois, na OP gravada."
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="mr-auto text-sm text-muted">{formatNumero(totalGrade(grade))} peças</span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={gerar} loading={salvando} disabled={!modeloId || itens.length === 0} data-testid="op-gerar">
            Gerar OP
          </Button>
        </div>
      }
    >
      <StateView loading={variacoes.loading} error={variacoes.error} onRetry={variacoes.refetch}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Modelo">
              <Select
                value={modeloId}
                onChange={(e) => {
                  setModeloId(e.target.value);
                  setGradeManual({});
                  setLinha('');
                  setRisco({});
                  setCoresRisco([]);
                }}
                data-testid="op-modelo"
              >
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Facção (opcional agora)">
              <Select value={faccaoId} onChange={(e) => setFaccaoId(e.target.value)}>
                <option value="">Escolho no envio</option>
                {(faccoes.data ?? [])
                  .filter((f) => f.ativo)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Prazo da facção">
              <Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </Field>
          </div>
          {celulas.length === 0 ? (
            <p className="text-sm text-muted">Este modelo ainda não tem grade (cores, linhas e tamanhos) no cadastro.</p>
          ) : (
            <>
              <Tabs
                variant="pills"
                value={modo}
                onChange={(v) => setModo(v as 'grade' | 'peca')}
                items={[
                  { value: 'grade', label: 'Pela grade do risco' },
                  { value: 'peca', label: 'Peça por peça' },
                ]}
              />
              {modo === 'peca' ? (
                <GradeEditor celulas={celulas} valores={gradeManual} onChange={setGradeManual} testid="op-grade" />
              ) : (
                linhaAtual && (
                  <div className="flex flex-col gap-3" data-testid="op-pela-grade">
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Linha">
                        <Select
                          value={linhaAtual.linha}
                          onChange={(e) => {
                            setLinha(e.target.value);
                            setRisco({});
                            setCoresRisco([]);
                          }}
                          data-testid="op-risco-linha"
                        >
                          {linhas.map((l) => (
                            <option key={l.linha} value={l.linha}>
                              {l.linha}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {linhaAtual.tamanhos.map((t) => (
                        <Field key={t} label={t}>
                          <Input
                            value={risco[t] ?? ''}
                            onChange={(e) => setRisco((x) => ({ ...x, [t]: e.target.value }))}
                            inputMode="numeric"
                            className="h-9 w-16 text-center"
                            data-testid={`op-risco-${t}`}
                          />
                        </Field>
                      ))}
                      <p className="pb-2 text-sm text-muted">
                        = <strong className="text-text">{porGrade}</strong>{' '}
                        {porGrade === 1 ? 'peça' : 'peças'} por grade
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      {coresRisco.map((c, i) => {
                        const hex = linhaAtual.cores.find((x) => x.nome === c.cor)?.hex ?? '#999999';
                        const pecas = inteiro(c.grades) * porGrade;
                        return (
                          <div key={c.cor} className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex w-36 items-center gap-1.5 text-sm">
                              <span className="h-3 w-3 rounded-full border border-border" style={{ background: hex }} />
                              {c.cor}
                            </span>
                            <Input
                              value={c.grades}
                              onChange={(e) =>
                                setCoresRisco((xs) =>
                                  xs.map((x, j) => (j === i ? { ...x, grades: e.target.value } : x)),
                                )
                              }
                              inputMode="numeric"
                              className="h-9 w-20 text-center"
                              aria-label={`Grades de ${c.cor}`}
                              data-testid={`op-risco-grades-${c.cor}`}
                              autoFocus
                            />
                            <span className="text-sm text-muted">
                              grades = <strong className="text-text">{formatNumero(pecas)}</strong> peças
                            </span>
                            <button
                              type="button"
                              className="text-muted hover:text-danger"
                              aria-label={`Tirar ${c.cor}`}
                              onClick={() => setCoresRisco((xs) => xs.filter((_, j) => j !== i))}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })}
                      {linhaAtual.cores.some((c) => !coresRisco.some((x) => x.cor === c.nome)) && (
                        <Select
                          value=""
                          onChange={(e) => {
                            const cor = e.target.value;
                            if (cor) setCoresRisco((xs) => [...xs, { cor, grades: '' }]);
                          }}
                          className="w-56"
                          data-testid="op-risco-add-cor"
                        >
                          <option value="">+ adicionar cor…</option>
                          {linhaAtual.cores
                            .filter((c) => !coresRisco.some((x) => x.cor === c.nome))
                            .map((c) => (
                              <option key={c.nome} value={c.nome}>
                                {c.nome}
                              </option>
                            ))}
                        </Select>
                      )}
                    </div>

                    {porGrade > 0 && coresNum.some((c) => c.grades > 0) && (
                      <PreviaDaGrade
                        tamanhos={linhaAtual.tamanhos}
                        composicao={composicao}
                        cores={coresNum.filter((c) => c.grades > 0)}
                      />
                    )}
                  </div>
                )
              )}
            </>
          )}
          <Field label="Observações">
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} maxLength={1000} />
          </Field>
          {sim && <SimulacaoCard s={sim} />}
        </div>
      </StateView>
    </Dialog>
  );
}

/** O que a grade vai gerar: peças por cor × tamanho (só leitura), com totais. */
function PreviaDaGrade({
  tamanhos,
  composicao,
  cores,
}: {
  tamanhos: string[];
  composicao: Record<string, number>;
  cores: Array<{ cor: string; grades: number }>;
}) {
  const usados = tamanhos.filter((t) => (composicao[t] ?? 0) > 0);
  const total = (t: string) => cores.reduce((s, c) => s + (composicao[t] ?? 0) * c.grades, 0);
  return (
    <div className="overflow-x-auto" data-testid="op-risco-previa">
      <table className="text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th className="px-2 py-1 text-left font-semibold">Vai gerar</th>
            {usados.map((t) => (
              <th key={t} className="px-2 py-1 text-right font-semibold">
                {t}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {cores.map((c) => (
            <tr key={c.cor} className="border-t border-border">
              <td className="px-2 py-1">
                {c.cor} × {formatNumero(c.grades)}
              </td>
              {usados.map((t) => (
                <td key={t} className="px-2 py-1 text-right">
                  {formatNumero((composicao[t] ?? 0) * c.grades)}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-semibold">
                {formatNumero(usados.reduce((s, t) => s + (composicao[t] ?? 0) * c.grades, 0))}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border font-semibold">
            <td className="px-2 py-1">OP</td>
            {usados.map((t) => (
              <td key={t} className="px-2 py-1 text-right">
                {formatNumero(total(t))}
              </td>
            ))}
            <td className="px-2 py-1 text-right">{formatNumero(usados.reduce((s, t) => s + total(t), 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SimulacaoCard({ s }: { s: Simulacao }) {
  return (
    <Card variant="outline" padding="md" className="flex flex-col gap-2" data-testid="op-simulacao">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold mr-auto">Simulação pela ficha técnica</h3>
        <span className="text-sm">
          Custo previsto: <b className="tabular-nums">{formatMoeda(s.custoPorPeca)}</b>/peça ·{' '}
          <span className="text-muted">{formatMoeda(s.custoInsumos + s.custoFaccao)} no total</span>
        </span>
      </div>
      {s.gradesSemFicha > 0 && (
        <p className="text-xs text-warning">
          {s.gradesSemFicha} grade(s) sem ficha técnica — o tecido e os aviamentos delas não entram na conta.
        </p>
      )}
      {s.insumos.length > 0 && (
        <table className="w-full text-sm tabular-nums">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 text-left font-semibold">Insumo</th>
              <th className="py-1 text-right font-semibold">Precisa</th>
              <th className="py-1 text-right font-semibold">Tem</th>
              <th className="py-1 text-right font-semibold">Falta</th>
              <th className="py-1 text-right font-semibold">Custo</th>
            </tr>
          </thead>
          <tbody>
            {s.insumos.map((i) => (
              <tr key={`${i.insumoId}|${i.insumoCorId ?? i.cor ?? ''}`} className="border-t border-border">
                <td className="py-1">
                  {i.nome}
                  {i.cor ? ` · ${i.cor}` : ''}
                  {i.semCor && <span className="ml-1 text-xs text-warning">(o insumo não tem esta cor)</span>}
                </td>
                <td className="py-1 text-right">
                  {formatNumero(Math.round(i.necessario * 100) / 100)} {SIGLA[i.unidade]}
                </td>
                <td className="py-1 text-right text-muted">{formatNumero(Math.round(i.saldo * 100) / 100)}</td>
                <td className={cn('py-1 text-right', i.falta > 0 ? 'text-danger font-semibold' : 'text-muted')}>
                  {i.falta > 0 ? formatNumero(Math.round(i.falta * 100) / 100) : '—'}
                </td>
                <td className="py-1 text-right">{formatMoeda(i.custo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">
        Facção: {formatMoeda(s.custoFaccao)}
        {s.precoFaccaoTabela !== null ? ` (${formatMoeda(s.precoFaccaoTabela)}/peça na tabela da facção)` : ' (prevista na ficha técnica)'}.
      </p>
    </Card>
  );
}
