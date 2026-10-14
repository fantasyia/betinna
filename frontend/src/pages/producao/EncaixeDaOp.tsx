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
  /** Cor da variação (a OP manda; o viés é por cor — cada cor é um tecido). */
  cor?: { nome: string };
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

/**
 * Tecido do VIÉS por cor (Léo + #03, 14/10): cada cor é um tecido cortado à
 * parte. folhas da cor = peças da cor (nas grades do risco) ÷ peças do risco;
 * metros = área por folha × folhas ÷ largura aberta, arredondado pra CIMA no
 * centímetro só no fim (o viesTecidoM do agente já vem arredondado — não
 * serve pra multiplicar). Sem área/largura do agente: []. PURO.
 */
export function viesPorCor(
  itens: ItemDaGrade[],
  composicao: Array<{ linha?: string; quantidade: number }>,
  linhaDoRisco: string | null,
  detalhes: { viesAreaM2PorFolha?: number; viesLarguraAbertaM?: number } | null | undefined,
): Array<{ cor: string; folhas: number; metros: number }> {
  const area = detalhes?.viesAreaM2PorFolha;
  const largura = detalhes?.viesLarguraAbertaM;
  if (!area || !largura || area <= 0 || largura <= 0) return [];
  const pecasFolha = composicao.reduce((s, c) => s + c.quantidade, 0);
  if (pecasFolha <= 0) return [];
  // Grades que estão no risco: a linha de cada item (mesclado) ou a do risco.
  const linhas = new Set(composicao.map((c) => c.linha ?? linhaDoRisco ?? ''));
  const porCor = new Map<string, number>();
  for (const i of itens) {
    if (!i.cor || i.planejada <= 0 || !linhas.has(i.linha)) continue;
    porCor.set(i.cor.nome, (porCor.get(i.cor.nome) ?? 0) + i.planejada);
  }
  return [...porCor.entries()].map(([cor, pecas]) => {
    const folhas = pecas / pecasFolha;
    // 1e-9: 0,1 + 0,2 não vira 0,31 no arredondamento pra cima.
    const metros = Math.ceil((area * folhas) / largura * 100 - 1e-9) / 100;
    return { cor, folhas, metros };
  });
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
  resultado: {
    comprimentoM: number;
    aproveitamento: number;
    /**
     * Viés das camisetas (14/10): quanto tecido separar pra ele. É À PARTE —
     * o comprimento do risco é só das peças (Léo); total = comprimento + viés.
     */
    detalhes?: {
      viesTecidoM?: number;
      viesTiraM?: number;
      viesPecas?: number;
      /** Por FOLHA (1× a grade do risco), já com os 10% de sobra. */
      viesAreaM2PorFolha?: number;
      /** Largura aberta pro corte a 45° (no tubular, 2× a do tubo). */
      viesLarguraAbertaM?: number;
      /** O agente marca quando o risco passa do ideal (6 m). */
      sugerirDividir?: boolean;
      aviso_comprimento?: string;
    } | null;
  } | null;
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
/** A mesa de corte da Ribelt (Léo, 14/10): acima disso não dá pra cortar. */
export const MESA_M = 10.8;
/** Risco IDEAL (Léo, 14/10): até ~6 m; acima, sugere dividir em 2 riscos. */
export const RISCO_IDEAL_M = 6;
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
                  : `${pecas} peça(s) no risco${nGrades > 1 ? ` · ${nGrades} grades juntas` : ''} · ideal até ${formatNumero(RISCO_IDEAL_M)} m (mesa: ${formatNumero(MESA_M)} m) · a GPU faz um por vez.`}
            </span>
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.slice(0, 5).map((j) => (
            <ItemEncaixe
              key={j.id}
              j={j}
              numero={numero}
              itens={itens}
              onCancelar={() => void cancelar(j.id)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemEncaixe({
  j,
  numero,
  itens,
  onCancelar,
}: {
  j: Encaixe;
  numero: string;
  itens: ItemDaGrade[];
  onCancelar: () => void;
}) {
  const vies =
    j.status === 'CONCLUIDO'
      ? viesPorCor(itens, j.composicao, j.linha, j.resultado?.detalhes)
      : [];
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
      {j.status === 'CONCLUIDO' && typeof j.resultado?.detalhes?.viesTecidoM === 'number' && (
        <p className="text-sm rounded-[10px] bg-info/10 px-3 py-2" data-testid={`encaixe-vies-${j.id}`}>
          Separar <b>{metros(j.resultado.detalhes.viesTecidoM)}</b> de tecido pro viés
          {typeof j.resultado.detalhes.viesTiraM === 'number' &&
            ` (${metros(j.resultado.detalhes.viesTiraM)} de tira`}
          {typeof j.resultado.detalhes.viesPecas === 'number' &&
            `${typeof j.resultado.detalhes.viesTiraM === 'number' ? ', ' : ' ('}${j.resultado.detalhes.viesPecas} peças`}
          {(typeof j.resultado.detalhes.viesTiraM === 'number' ||
            typeof j.resultado.detalhes.viesPecas === 'number') &&
            ')'}
          {' '}por folha, além do risco.
        </p>
      )}
      {vies.length > 0 && (
        <ul className="text-sm flex flex-col gap-0.5" data-testid={`encaixe-vies-cores-${j.id}`}>
          {vies.map((v) => (
            <li key={v.cor}>
              <b>{v.cor}</b>: separar <b>{metros(v.metros)}</b> de tecido pro viés
              <span className="text-muted">
                {' '}
                ({formatNumero(Math.round(v.folhas * 10) / 10)} folha
                {Math.abs(v.folhas - 1) < 1e-9 ? '' : 's'})
              </span>
            </li>
          ))}
        </ul>
      )}
      {typeof numeros?.comprimentoM === 'number' && numeros.comprimentoM > MESA_M ? (
        <p className="text-sm text-danger font-semibold" data-testid={`encaixe-mesa-${j.id}`}>
          Passa da mesa de {formatNumero(MESA_M)} m ({metros(numeros.comprimentoM)}): não dá pra
          cortar — divida em 2 riscos (menos peças em cada).
        </p>
      ) : (
        ((typeof numeros?.comprimentoM === 'number' && numeros.comprimentoM > RISCO_IDEAL_M) ||
          j.resultado?.detalhes?.sugerirDividir) && (
          <p className="text-sm text-warning font-semibold" data-testid={`encaixe-ideal-${j.id}`}>
            Risco acima do ideal de {formatNumero(RISCO_IDEAL_M)} m
            {typeof numeros?.comprimentoM === 'number' ? ` (${metros(numeros.comprimentoM)})` : ''}:
            sugestão, dividir em 2 riscos.
            {j.resultado?.detalhes?.aviso_comprimento
              ? ` ${j.resultado.detalhes.aviso_comprimento}`
              : ''}
          </p>
        )
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
