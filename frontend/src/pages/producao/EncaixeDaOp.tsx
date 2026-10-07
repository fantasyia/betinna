import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage, buscarArquivo, downloadFile } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Select } from '@/components/ui';

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

interface Encaixe {
  id: string;
  status: Status;
  tempoMin: number;
  linha: string | null;
  composicao: Array<{ tamanho: string; quantidade: number }>;
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
}: {
  opId: string;
  numero: string;
  modeloId: string;
  itens: ItemDaGrade[];
}) {
  const toast = useToast();
  const q = useApiQuery<Encaixe[]>(`/erp/ops/${opId}/encaixes`);
  const grades = useMemo(() => gradesDaOp(itens), [itens]);
  const [gradeId, setGradeId] = useState(grades[0]?.modeloLinhaId ?? '');
  const grade = grades.find((g) => g.modeloLinhaId === gradeId) ?? grades[0];
  // Padrão: 1 de cada tamanho da grade ("1 de cada tamanho", como os riscos de hoje).
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [tempo, setTempo] = useState(30);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    setQtd(Object.fromEntries((grade?.tamanhos ?? []).map((t) => [t, 1])));
  }, [grade?.modeloLinhaId, grade?.tamanhos]);

  const jobs = q.data ?? [];
  const ativo = jobs.find((j) => aberto(j.status));
  // Enquanto tem risco na fila/rodando, pergunta de novo a cada 5 s.
  useEffect(() => {
    if (!ativo) return;
    const id = window.setInterval(() => q.refetch(), 5000);
    return () => window.clearInterval(id);
  }, [ativo, q]);

  const composicao = (grade?.tamanhos ?? [])
    .map((t) => ({ tamanho: t, quantidade: qtd[t] ?? 0 }))
    .filter((c) => c.quantidade > 0);
  const pecas = composicao.reduce((s, c) => s + c.quantidade, 0);

  async function gerar() {
    if (!grade || !pecas) return;
    setEnviando(true);
    try {
      await api.post(`/erp/ops/${opId}/encaixes`, {
        modeloLinhaId: grade.modeloLinhaId,
        composicao,
        tempoMin: tempo,
      });
      toast.success('Risco na fila — o agente da GPU pega em instantes');
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
          <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_9rem] items-end">
            <Field label="Grade">
              <Select
                value={grade?.modeloLinhaId}
                onChange={(e) => setGradeId(e.target.value)}
                data-testid="encaixe-grade"
              >
                {grades.map((g) => (
                  <option key={g.modeloLinhaId} value={g.modeloLinhaId}>
                    {g.linha}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Peças de cada tamanho NO risco">
              <div className="flex flex-wrap gap-1.5">
                {(grade?.tamanhos ?? []).map((t) => (
                  <label
                    key={t}
                    className="flex items-center gap-1 rounded-[10px] border border-border px-2 h-9 text-sm"
                  >
                    <b>{t}</b>
                    <input
                      type="number"
                      min={0}
                      max={9}
                      value={qtd[t] ?? 0}
                      onChange={(e) =>
                        setQtd((x) => ({
                          ...x,
                          [t]: Math.max(0, Math.min(9, Math.trunc(Number(e.target.value) || 0))),
                        }))
                      }
                      className="w-10 bg-transparent text-center tabular-nums outline-none"
                      aria-label={`Peças do ${t} no risco`}
                      data-testid={`encaixe-qtd-${t}`}
                    />
                  </label>
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
              onClick={() => void gerar()}
              loading={enviando}
              disabled={!pecas || !!ativo}
              data-testid="encaixe-gerar"
            >
              Gerar risco
            </Button>
            <span className="text-xs text-muted">
              {ativo
                ? 'Já tem um risco desta OP na fila — espere terminar ou cancele.'
                : `${pecas} peça(s) no risco · a GPU faz um por vez.`}
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
        <span>
          {j.linha} · {j.composicao.map((c) => `${c.quantidade}×${c.tamanho}`).join(' ')} · molde{' '}
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
                `${numero}-${(j.linha ?? 'risco').replace(/\s+/g, '')}.plt`,
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
