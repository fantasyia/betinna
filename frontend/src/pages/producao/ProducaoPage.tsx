import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoeda, formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { CatalogoTabs } from '@/components/CatalogoTabs';
import { Badge, Button, Card, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import type { SaldoVariacao } from '@/pages/estoque/grade';
import { SIGLA, type Unidade } from '@/pages/insumos/insumo';
import { GradeEditor, inteiro, totalGrade, type CelulaGrade, type ValoresGrade } from './GradeEditor';

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
          {(q.data ?? []).length === 0 ? (
            <Card className="p-6 text-sm text-muted text-center">Nenhuma ordem de produção ainda.</Card>
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
  insumos: Array<{ insumoId: string; nome: string; cor: string | null; tipo: string; unidade: Unidade; necessario: number; saldo: number; falta: number; custo: number }>;
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

function NovaOpDialog({
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
  const [grade, setGrade] = useState<ValoresGrade>(inicial?.grade ?? {});
  const [sim, setSim] = useState<Simulacao | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!modeloId && modelos[0]) setModeloId(modelos[0].id);
  }, [modelos, modeloId]);

  const celulas = (variacoes.data ?? []).filter((v) => v.modelo.id === modeloId && v.ativo).map(paraCelula);
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
                  setGrade({});
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
            <GradeEditor celulas={celulas} valores={grade} onChange={setGrade} testid="op-grade" />
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
              <tr key={i.insumoId} className="border-t border-border">
                <td className="py-1">
                  {i.nome}
                  {i.cor ? ` · ${i.cor}` : ''}
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
