import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { KEtiqueta, KUsuarioResumo } from '@/pages/kanban/kanban-types';

/**
 * 📅 Calendário de Marketing — VIEW por DATA sobre o board de conteúdo
 * ("Somatec — Conteúdo"). NÃO cria base paralela: lê os cards do board via o
 * endpoint `/kanban/boards/:id/calendario` (cards por `entrega` + itens de
 * checklist por data = data POR CANAL). Codifica por canal/pilar/status/case e
 * traz um painel de análise (cadência, mix de canais, cobertura de pilares).
 *
 * v1: mês + backlog "sem data" + análise + filtros + clique abre o card.
 * Deferido: semana/agenda, drag-drop, arco/cluster (precisam de campo novo).
 */

// ─── Canais (derivados do TEXTO dos itens de checklist do card) ──────────
interface Canal {
  key: string;
  label: string;
  cor: string;
  re: RegExp;
}
const CANAIS: Canal[] = [
  { key: 'blog', label: 'Blog', cor: '#1565C0', re: /blog|artigo|wordpress|seo/i },
  { key: 'carrossel', label: 'Carrossel', cor: '#bd1fbf', re: /carross?el|carousel/i },
  { key: 'reel', label: 'Reel', cor: '#E4405F', re: /reel|v[ií]deo|short|tiktok/i },
  { key: 'email', label: 'E-mail', cor: '#2bcae5', re: /e-?mail|newsletter|resend/i },
  { key: 'ads', label: 'Ads', cor: '#F59E0B', re: /\bads?\b|an[uú]ncio|tr[aá]fego|impuls/i },
];
function canalDe(texto: string): Canal | null {
  return CANAIS.find((c) => c.re.test(texto)) ?? null;
}

const STORAGE_KEY = 'calendario-marketing-board';
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function diaUTC(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function chaveDia(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ─── Tipos das respostas reusadas do kanban ──────────────────────────────
interface BoardResumo {
  id: string;
  nome: string;
}
interface CalCard {
  id: string;
  titulo: string;
  dataEntrega: string;
  concluido: boolean;
  corCapa: string | null;
  lista: { id: string; nome: string };
  etiquetas: Array<{ etiqueta: KEtiqueta }>;
}
interface CalItem {
  id: string;
  texto: string;
  concluido: boolean;
  dataEntrega: string;
  responsavel: KUsuarioResumo | null;
  checklist: { card: { id: string; titulo: string } };
}
interface TabelaCard {
  id: string;
  titulo: string;
  dataEntrega: string | null;
  concluido: boolean;
  lista: { id: string; nome: string; posicao: number };
  etiquetas: Array<{ etiqueta: KEtiqueta }>;
}

export default function CalendarioMarketingPage() {
  const navigate = useNavigate();
  const { data: boards, loading: loadingBoards } = useApiQuery<BoardResumo[]>('/kanban/boards');

  const [boardId, setBoardId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // Default: o board cujo nome tem "conteúdo" (ou o 1º), quando ainda não escolhido.
  useEffect(() => {
    if (boardId || !boards?.length) return;
    const conteudo = boards.find((b) => /conte[uú]do/i.test(b.nome)) ?? boards[0];
    setBoardId(conteudo.id);
  }, [boards, boardId]);

  useEffect(() => {
    if (boardId) localStorage.setItem(STORAGE_KEY, boardId);
  }, [boardId]);

  return (
    <PageLayout
      title="Calendário de Marketing"
      description="Visão por data do plano de conteúdo — cadência, mix de canais e agenda."
    >
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <label className="text-xs text-muted">Plano de conteúdo:</label>
        <Select
          size="sm"
          value={boardId ?? ''}
          onChange={(e) => setBoardId(e.target.value || null)}
          className="max-w-xs"
        >
          {(boards ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </Select>
      </div>
      {boardId ? (
        <CalendarioConteudo key={boardId} boardId={boardId} navigate={navigate} />
      ) : (
        <StateView loading={loadingBoards} error={null} onRetry={() => undefined}>
          <p className="text-sm text-muted">Selecione um plano de conteúdo.</p>
        </StateView>
      )}
    </PageLayout>
  );
}

function CalendarioConteudo({
  boardId,
  navigate,
}: {
  boardId: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const hoje = new Date();
  const [mes, setMes] = useState(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`,
  );
  // Filtros
  const [fCanal, setFCanal] = useState<string>('');
  const [fPilar, setFPilar] = useState<string>('');

  const cal = useApiQuery<{ cards: CalCard[]; itensChecklist: CalItem[] }>(
    `/kanban/boards/${boardId}/calendario?mes=${mes}`,
  );
  const tabela = useApiQuery<TabelaCard[]>(`/kanban/boards/${boardId}/tabela`);
  useEffect(() => {
    cal.refetch();
    tabela.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, boardId]);

  const [ano, mesNum] = mes.split('-').map(Number);
  const semanas = useMemo(() => {
    const primeiro = new Date(Date.UTC(ano, mesNum - 1, 1));
    const inicio = new Date(primeiro);
    inicio.setUTCDate(1 - primeiro.getUTCDay());
    const linhas: Date[][] = [];
    for (let i = 0; i < 6; i++) {
      const linha: Date[] = [];
      for (let j = 0; j < 7; j++) {
        const d = new Date(inicio);
        d.setUTCDate(inicio.getUTCDate() + i * 7 + j);
        linha.push(d);
      }
      if (i >= 4 && linha.every((d) => d.getUTCMonth() !== mesNum - 1)) break;
      linhas.push(linha);
    }
    return linhas;
  }, [ano, mesNum]);

  // Pilares (etiquetas) presentes — pro filtro
  const pilares = useMemo(() => {
    const mapa = new Map<string, KEtiqueta>();
    for (const c of tabela.data ?? [])
      for (const { etiqueta } of c.etiquetas) mapa.set(etiqueta.id, etiqueta);
    return [...mapa.values()];
  }, [tabela.data]);

  const passaFiltroCard = (c: CalCard) =>
    (!fPilar || c.etiquetas.some((e) => e.etiqueta.id === fPilar));
  const passaFiltroItem = (i: CalItem) => !fCanal || canalDe(i.texto)?.key === fCanal;

  const porDia = useMemo(() => {
    const mapa = new Map<string, { cards: CalCard[]; itens: CalItem[] }>();
    for (const c of (cal.data?.cards ?? []).filter(passaFiltroCard)) {
      const k = diaUTC(c.dataEntrega);
      const v = mapa.get(k) ?? { cards: [], itens: [] };
      v.cards.push(c);
      mapa.set(k, v);
    }
    for (const i of (cal.data?.itensChecklist ?? []).filter(passaFiltroItem)) {
      if (fCanal && canalDe(i.texto)?.key !== fCanal) continue;
      const k = diaUTC(i.dataEntrega);
      const v = mapa.get(k) ?? { cards: [], itens: [] };
      v.itens.push(i);
      mapa.set(k, v);
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal.data, fCanal, fPilar]);

  function mudarMes(delta: number) {
    const d = new Date(ano, mesNum - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const abrir = (cardId: string) => navigate(`/kanban/${boardId}?card=${cardId}`);
  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const semData = (tabela.data ?? []).filter((c) => !c.dataEntrega && !c.concluido);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div>
        {/* Barra: navegação de mês + filtros + legenda de canais */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => mudarMes(-1)}
            className="p-1 rounded-[6px] hover:bg-surface-elevated"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-text capitalize min-w-40 text-center">
            {nomeMes}
          </span>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => mudarMes(1)}
            className="p-1 rounded-[6px] hover:bg-surface-elevated"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="w-px h-5 bg-border mx-1" />
          <Select size="sm" value={fCanal} onChange={(e) => setFCanal(e.target.value)}>
            <option value="">Todos os canais</option>
            {CANAIS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select size="sm" value={fPilar} onChange={(e) => setFPilar(e.target.value)}>
            <option value="">Todos os pilares</option>
            {pilares.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome ?? p.cor}
              </option>
            ))}
          </Select>
        </div>

        {/* Legenda de canais */}
        <div className="flex items-center gap-3 mb-2 flex-wrap text-[11px] text-muted">
          {CANAIS.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.cor }} />
              {c.label}
            </span>
          ))}
        </div>

        <StateView loading={cal.loading && !cal.data} error={cal.error} onRetry={cal.refetch}>
          <div className="grid grid-cols-7 gap-px bg-border rounded-[10px] overflow-hidden border border-border">
            {DIAS_SEMANA.map((d) => (
              <div
                key={d}
                className="bg-surface-elevated px-2 py-1 text-[10px] uppercase tracking-wider text-muted font-semibold"
              >
                {d}
              </div>
            ))}
            {semanas.flat().map((dia) => {
              const chave = chaveDia(dia);
              const doMes = dia.getUTCMonth() === mesNum - 1;
              const conteudo = porDia.get(chave);
              return (
                <div
                  key={chave}
                  className={cn(
                    'bg-surface min-h-24 p-1 flex flex-col gap-0.5',
                    !doMes && 'opacity-40',
                  )}
                >
                  <span className="text-[10px] text-muted">{dia.getUTCDate()}</span>
                  {conteudo?.cards.map((c) => {
                    const cor = c.corCapa ?? c.etiquetas[0]?.etiqueta.cor ?? '#5C88DA';
                    const ehCase = c.etiquetas.some((e) => /case/i.test(e.etiqueta.nome ?? ''));
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => abrir(c.id)}
                        title={`${c.titulo} · ${c.lista.nome}`}
                        style={{ borderLeft: `3px solid ${cor}` }}
                        className={cn(
                          'w-full text-left text-[10px] px-1.5 py-0.5 rounded-[5px] bg-surface-elevated truncate',
                          c.concluido && 'line-through text-muted',
                        )}
                      >
                        {ehCase && '⭐ '}
                        {c.titulo}
                      </button>
                    );
                  })}
                  {conteudo?.itens.map((i) => {
                    const canal = canalDe(i.texto);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => abrir(i.checklist.card.id)}
                        title={`${canal?.label ?? 'Canal'} · ${i.checklist.card.titulo}`}
                        style={{ background: (canal?.cor ?? '#838C91') + '22', color: canal?.cor }}
                        className={cn(
                          'w-full text-left text-[10px] px-1.5 py-0.5 rounded-[5px] truncate',
                          i.concluido && 'line-through opacity-60',
                        )}
                      >
                        {canal?.label ?? i.texto} · {i.checklist.card.titulo}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </StateView>
        <p className="text-[11px] text-muted mt-2">
          Chips coloridos = canais (data por canal via checklist do card). Cards = peça inteira na
          data de publicação. Clique abre o card no board.
        </p>
      </div>

      {/* Painel lateral: backlog sem data + análise */}
      <div className="flex flex-col gap-4">
        <PainelAnalise cal={cal.data} tabela={tabela.data} />
        <div className="rounded-[10px] border border-border bg-surface p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Sem data ainda ({semData.length})
          </h4>
          {semData.length === 0 ? (
            <p className="text-xs text-muted m-0">Tudo agendado. 🎉</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {semData.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => abrir(c.id)}
                    className="w-full text-left text-[11px] px-2 py-1 rounded-[6px] border border-border hover:bg-surface-elevated truncate"
                    title={c.titulo}
                    style={{ borderLeftColor: c.etiquetas[0]?.etiqueta.cor, borderLeftWidth: 3 }}
                  >
                    {c.titulo}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted mt-2">
            Clique pra abrir e definir a data de publicação no card.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Painel de análise (o "análise visual") ──────────────────────────────
function PainelAnalise({
  cal,
  tabela,
}: {
  cal?: { cards: CalCard[]; itensChecklist: CalItem[] } | null;
  tabela?: TabelaCard[] | null;
}) {
  const analise = useMemo(() => {
    const cards = cal?.cards ?? [];
    const itens = cal?.itensChecklist ?? [];
    // Mix de canais no mês (por item de checklist datado)
    const mix = new Map<string, number>();
    for (const i of itens) {
      const c = canalDe(i.texto);
      if (c) mix.set(c.key, (mix.get(c.key) ?? 0) + 1);
    }
    // Cobertura de pilares (etiquetas dos cards datados no mês)
    const pil = new Map<string, { nome: string; cor: string; n: number }>();
    for (const c of cards)
      for (const { etiqueta } of c.etiquetas) {
        const p = pil.get(etiqueta.id) ?? { nome: etiqueta.nome ?? '—', cor: etiqueta.cor, n: 0 };
        p.n += 1;
        pil.set(etiqueta.id, p);
      }
    // Cadência: peças (cards datados) por semana do mês
    const porSemana = new Map<number, number>();
    for (const c of cards) {
      const d = new Date(c.dataEntrega);
      const semana = Math.ceil(d.getUTCDate() / 7);
      porSemana.set(semana, (porSemana.get(semana) ?? 0) + 1);
    }
    // Cases datados no mês + alerta de espaçamento (< 4 semanas entre dois cases)
    const casesDatas = cards
      .filter((c) => c.etiquetas.some((e) => /case/i.test(e.etiqueta.nome ?? '')))
      .map((c) => new Date(c.dataEntrega).getTime())
      .sort((a, b) => a - b);
    let caseApertado = false;
    for (let i = 1; i < casesDatas.length; i++) {
      if (casesDatas[i] - casesDatas[i - 1] < 28 * 86_400_000) caseApertado = true;
    }
    // Status geral (do board inteiro, não só o mês)
    const status = new Map<string, number>();
    for (const c of tabela ?? []) status.set(c.lista.nome, (status.get(c.lista.nome) ?? 0) + 1);

    return { mix, pil: [...pil.values()], porSemana, cases: casesDatas.length, caseApertado, status };
  }, [cal, tabela]);

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3 flex flex-col gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Análise do mês</h4>

      {/* Cadência por semana */}
      <div>
        <p className="text-[11px] text-muted mb-1">Cadência (peças/semana)</p>
        <div className="flex items-end gap-1 h-12">
          {[1, 2, 3, 4, 5].map((s) => {
            const n = analise.porSemana.get(s) ?? 0;
            const max = Math.max(1, ...[...analise.porSemana.values()]);
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className={cn(
                    'w-full rounded-t-[3px]',
                    n === 0 ? 'bg-danger/30' : 'bg-secondary',
                  )}
                  style={{ height: `${(n / max) * 100}%`, minHeight: n === 0 ? 2 : 4 }}
                  title={n === 0 ? `Semana ${s}: buraco (sem peça)` : `Semana ${s}: ${n}`}
                />
                <span className="text-[9px] text-muted">S{s}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mix de canais */}
      <div>
        <p className="text-[11px] text-muted mb-1">Mix de canais</p>
        <div className="flex flex-col gap-1">
          {CANAIS.map((c) => {
            const n = analise.mix.get(c.key) ?? 0;
            return (
              <div key={c.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0" style={{ color: c.cor }}>
                  {c.label}
                </span>
                <div className="flex-1 h-2 rounded-full bg-surface-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, n * 20)}%`, background: c.cor }}
                  />
                </div>
                <span className={cn('w-4 text-right', n === 0 && 'text-danger')}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pilares cobertos */}
      <div>
        <p className="text-[11px] text-muted mb-1">Pilares no mês</p>
        <div className="flex flex-wrap gap-1">
          {analise.pil.length === 0 ? (
            <span className="text-[11px] text-muted">—</span>
          ) : (
            analise.pil.map((p) => (
              <span
                key={p.nome}
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: p.cor + '22', color: p.cor }}
              >
                {p.nome} · {p.n}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Cases + alerta */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted">Cases no mês:</span>
        <span className="font-semibold text-text">{analise.cases}</span>
        {analise.caseApertado && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" /> 2 cases em &lt; 4 semanas
          </span>
        )}
      </div>

      {/* Status geral */}
      <div>
        <p className="text-[11px] text-muted mb-1">Status (board inteiro)</p>
        <div className="flex flex-wrap gap-1">
          {[...analise.status.entries()].map(([nome, n]) => (
            <span
              key={nome}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-muted"
            >
              {nome}: {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
