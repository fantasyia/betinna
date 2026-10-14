import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage, buscarArquivo, downloadFile } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Select } from '@/components/ui';
import type { GradeRisco } from './gradeRisco';

/**
 * Encaixe automático (risco) na OP: escolhe a grade, quantas peças de cada
 * tamanho vão NO risco e quanto tempo a GPU pode procurar. O agente do PC do
 * Léo pega da fila, manda a imagem a cada melhora e, no fim, o .plt pro plotter.
 */

export interface ItemDaGrade {
  modeloLinhaId: string;
  linha: string;
  linhaOrdem: number;
  tamanho: string;
  tamanhoOrdem: number;
  planejada: number;
}

export interface Grade {
  modeloLinhaId: string;
  linha: string;
  tamanhos: string[];
}

/**
 * Quantidade inicial de cada grade|tamanho no risco. OP montada pela grade do
 * risco: a composição dela na linha dela, as outras zeradas. Sem: 1 de cada
 * tamanho em TODAS as grades (o risco mesclado do dia a dia do Léo). PURO.
 */
export function qtdInicial(
  grades: Grade[],
  risco: { linha: string; composicao: Array<{ tamanho: string; quantidade: number }> } | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  const daOp = risco ? new Map(risco.composicao.map((c) => [c.tamanho, c.quantidade])) : null;
  for (const g of grades) {
    for (const t of g.tamanhos) {
      out[`${g.modeloLinhaId}|${t}`] = daOp ? (g.linha === risco!.linha ? (daOp.get(t) ?? 0) : 0) : 1;
    }
  }
  return out;
}

/** As grades da OP (Regular, Plus…) com os tamanhos que ela tem planejados. PURO. */
export function gradesDaOp(itens: ItemDaGrade[]): Grade[] {
  const por = new Map<string, { linha: string; ordem: number; tam: Map<string, number> }>();
  for (const i of itens) {
    if (i.planejada <= 0) continue;
    const g = por.get(i.modeloLinhaId) ?? { linha: i.linha, ordem: i.linhaOrdem, tam: new Map() };
    g.tam.set(i.tamanho, i.tamanhoOrdem);
    por.set(i.modeloLinhaId, g);
  }
  return [...por.entries()]
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([modeloLinhaId, g]) => ({
      modeloLinhaId,
      linha: g.linha,
      tamanhos: [...g.tam.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t),
    }));
}

type Status = 'PENDENTE' | 'RODANDO' | 'CONCLUIDO' | 'FALHOU' | 'CANCELADO';

type Material = 'TECIDO' | 'RIBANA';

interface Encaixe {
  id: string;
  status: Status;
  /** Antigos (antes de 14/10) vêm sem: tecido. */
  material?: Material;
  tempoMin: number;
  linha: string | null;
  /** No risco mesclado cada item traz a linha (Infantil, Regular, Plus Size). */
  composicao: Array<{ linha?: string; tamanho: string; quantidade: number }>;
  codigoMolde: string | null;
  progresso: { comprimentoM?: number; aproveitamento?: number; em?: string } | null;
  resultado: { comprimentoM: number; aproveitamento: number } | null;
  erro: string | null;
  agente: string | null;
  pegoEm: string | null;
  concluidoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
  arquivos: Array<{ tipo: string; tamanho: number; em: string }>;
}

const NOME_STATUS: Record<Status, string> = {
  PENDENTE: 'na fila',
  RODANDO: 'encaixando na GPU',
  CONCLUIDO: 'pronto',
  FALHOU: 'falhou',
  CANCELADO: 'cancelado',
};
const VARIANTE: Record<Status, 'neutral' | 'warning' | 'success' | 'danger'> = {
  PENDENTE: 'neutral',
  RODANDO: 'warning',
  CONCLUIDO: 'success',
  FALHOU: 'danger',
  CANCELADO: 'neutral',
};
const aberto = (s: Status) => s === 'PENDENTE' || s === 'RODANDO';
const metros = (m: number | undefined) =>
  m === undefined ? '—' : `${formatNumero(Math.round(m * 1000) / 1000)} m`;
const pct = (p: number | undefined) =>
  p === undefined ? '—' : `${formatNumero(Math.round(p * 10) / 10)}%`;

/** Imagem de rota autenticada (o `<img src>` não manda o token). `chave` muda → busca de novo. */
function useImagem(path: string | null, chave: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let vivo = true;
    let criada: string | null = null;
    buscarArquivo(path)
      .then((b) => {
        if (!vivo) return;
        criada = URL.createObjectURL(b);
        setUrl(criada);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [path, chave]);
  return path ? url : null;
}

export function EncaixeDaOp({
  opId,
  numero,
  modeloId,
  itens,
  risco,
}: {
  opId: string;
  numero: string;
  modeloId: string;
  itens: ItemDaGrade[];
  /** Grade do risco com que a OP foi montada (Léo, 14/10): já vem preenchida. */
  risco?: GradeRisco | null;
}) {
  const toast = useToast();
  const q = useApiQuery<Encaixe[]>(`/erp/ops/${opId}/encaixes`);
  // Produto com ribana na ficha ganha o "Gerar risco da ribana" (14/10).
  const regras = useApiQuery<{ regras: { ribana?: unknown } | null }>(
    `/erp/modelos/${modeloId}/encaixe`,
  );
  const temRibana = !!regras.data?.regras?.ribana;
  const grades = useMemo(() => gradesDaOp(itens), [itens]);
  // Risco MESCLADO (Léo, 14/10): todas as grades da OP de uma vez — Infantil +
  // Regular + Plus num risco só, como ele encaixa no dia a dia. Chave: grade|tamanho.
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [tempo, setTempo] = useState(30);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    setQtd(qtdInicial(grades, risco ?? null));
  }, [grades, risco]);

  const jobs = q.data ?? [];
  const ativo = jobs.find((j) => aberto(j.status));
  // Um aberto por material: tecido e ribana podem estar na fila juntos.
  const ativoDe = (m: Material) =>
    jobs.some((j) => aberto(j.status) && (j.material ?? 'TECIDO') === m);
  // Enquanto tem risco na fila/rodando, pergunta de novo a cada 5 s.
  useEffect(() => {
    if (!ativo) return;
    const id = window.setInterval(() => q.refetch(), 5000);
    return () => window.clearInterval(id);
  }, [ativo, q]);

  const composicao = grades.flatMap((g) =>
    g.tamanhos
      .map((t) => ({
        modeloLinhaId: g.modeloLinhaId,
        tamanho: t,
        quantidade: qtd[`${g.modeloLinhaId}|${t}`] ?? 0,
      }))
      .filter((c) => c.quantidade > 0),
  );
  const pecas = composicao.reduce((s, c) => s + c.quantidade, 0);
  const nGrades = new Set(composicao.map((c) => c.modeloLinhaId)).size;

  async function gerar(material: Material) {
    if (!pecas) return;
    setEnviando(true);
    try {
      await api.post(`/erp/ops/${opId}/encaixes`, {
        modeloLinhaId: composicao[0].modeloLinhaId,
        material,
        composicao,
        tempoMin: tempo,
      });
      toast.success(
        material === 'RIBANA'
          ? 'Risco da ribana na fila — o agente da GPU pega em instantes'
          : 'Risco na fila — o agente da GPU pega em instantes',
      );
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível pedir o risco', apiErrorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(id: string) {
    try {
      await api.post(`/erp/encaixes/${id}/cancelar`, {});
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível cancelar', apiErrorMessage(err));
    }
  }

  return (
    <Card variant="outline" padding="md" className="flex flex-col gap-3" data-testid="encaixe-op">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold mr-auto">Encaixe (risco)</h3>
        <span className="text-xs text-muted">
          Regras e código do molde na{' '}
          <Link to={`/vitrine?modelo=${encodeURIComponent(modeloId)}`} className="underline">
            ficha técnica
          </Link>
        </span>
      </div>

      {grades.length === 0 ? (
        <p className="text-sm text-muted">A OP não tem peças planejadas.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem] items-end">
            <Field label="Peças de cada tamanho NO risco (zere a grade que não entra)">
              <div className="flex flex-col gap-1.5">
                {grades.map((g) => (
                  <div key={g.modeloLinhaId} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 text-xs font-semibold text-muted">{g.linha}</span>
                    {g.tamanhos.map((t) => {
                      const k = `${g.modeloLinhaId}|${t}`;
                      return (
                        <label
                          key={k}
                          className="flex items-center gap-1 rounded-[10px] border border-border px-2 h-9 text-sm"
                        >
                          <b>{t}</b>
                          <input
                            type="number"
                            min={0}
                            max={9}
                            value={qtd[k] ?? 0}
                            onChange={(e) =>
                              setQtd((x) => ({
                                ...x,
                                [k]: Math.max(0, Math.min(9, Math.trunc(Number(e.target.value) || 0))),
                              }))
                            }
                            className="w-10 bg-transparent text-center tabular-nums outline-none"
                            aria-label={`Peças do ${t} ${g.linha} no risco`}
                            data-testid={`encaixe-qtd-${g.linha}-${t}`}
                          />
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </Field>
            <Field label="Tempo da GPU">
              <Select value={String(tempo)} onChange={(e) => setTempo(Number(e.target.value))}>
                <option value="10">10 min</option>
                <option value="30">30 min</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void gerar('TECIDO')}
              loading={enviando}
              disabled={!pecas || ativoDe('TECIDO')}
              data-testid="encaixe-gerar"
            >
              Gerar risco
            </Button>
            {temRibana && (
              <Button
                variant="secondary"
                onClick={() => void gerar('RIBANA')}
                loading={enviando}
                disabled={!pecas || ativoDe('RIBANA')}
                data-testid="encaixe-gerar-ribana"
              >
                Gerar risco da ribana
              </Button>
            )}
            <span className="text-xs text-muted">
              {ativoDe('TECIDO') && ativoDe('RIBANA')
                ? 'Os riscos do tecido e da ribana estão na fila — a GPU faz um depois do outro.'
                : ativoDe('TECIDO') || ativoDe('RIBANA')
                  ? `Já tem um risco ${ativoDe('RIBANA') ? 'da ribana' : 'do tecido'} desta OP na fila.`
                  : `${pecas} peça(s) no risco${nGrades > 1 ? ` · ${nGrades} grades juntas` : ''} · a GPU faz um por vez.`}
            </span>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.slice(0, 5).map((j) => (
            <ItemEncaixe key={j.id} j={j} numero={numero} onCancelar={() => void cancelar(j.id)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemEncaixe({
  j,
  numero,
  onCancelar,
}: {
  j: Encaixe;
  numero: string;
  onCancelar: () => void;
}) {
  const tem = (t: string) => j.arquivos.some((a) => a.tipo === t);
  const tipoImagem =
    j.status === 'CONCLUIDO' && tem('PNG') ? 'PNG' : tem('PREVIEW') ? 'PREVIEW' : null;
  const marca = j.arquivos.find((a) => a.tipo === tipoImagem)?.em ?? j.atualizadoEm;
  const img = useImagem(tipoImagem ? `/erp/encaixes/${j.id}/arquivos/${tipoImagem}` : null, marca);
  const numeros = j.resultado ?? j.progresso;
  return (
    <li
      className="rounded-[10px] border border-border p-3 flex flex-col gap-2"
      data-testid={`encaixe-${j.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={VARIANTE[j.status]} size="sm">
          {NOME_STATUS[j.status]}
        </Badge>
        {j.material === 'RIBANA' && (
          <Badge variant="info" size="sm" data-testid={`encaixe-ribana-${j.id}`}>
            Ribana
          </Badge>
        )}
        <span>
          {j.linha} ·{' '}
          {j.composicao
            .map((c) => `${c.quantidade}×${c.tamanho}${c.linha && j.linha?.includes('+') ? ` ${c.linha}` : ''}`)
            .join(' ')}{' '}
          · molde{' '}
          {j.codigoMolde}
        </span>
        <span className="text-muted">· {j.tempoMin} min</span>
        {aberto(j.status) && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
      {numeros && (
        <div className="text-sm tabular-nums">
          {j.status === 'CONCLUIDO' ? 'Comprimento' : 'Melhor até agora'}:{' '}
          <b>{metros(numeros.comprimentoM)}</b> · aproveitamento{' '}
          <b>{pct(numeros.aproveitamento)}</b>
        </div>
      )}
      {j.status === 'PENDENTE' && (
        <p className="text-xs text-muted">
          Esperando o agente da GPU (o programa no PC precisa estar aberto).
        </p>
      )}
      {j.erro && <p className="text-sm text-danger">{j.erro}</p>}
      {img && (
        <img
          src={img}
          alt={`Risco ${j.linha ?? ''}`}
          className="w-full max-h-[360px] rounded-[10px] border border-border bg-white object-contain"
        />
      )}
      {j.status === 'CONCLUIDO' && tem('PLT') && (
        <div>
          <Button
            size="sm"
            onClick={() =>
              void downloadFile(
                `/erp/encaixes/${j.id}/arquivos/PLT`,
                `${numero}-${(j.linha ?? 'risco').replace(/\s+/g, '')}${j.material === 'RIBANA' ? '-ribana' : ''}.plt`,
              )
            }
            data-testid={`encaixe-plt-${j.id}`}
          >
            Baixar .plt (plotter)
          </Button>
        </div>
      )}
    </li>
  );
}
