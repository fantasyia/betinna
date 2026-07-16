import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { KEtiqueta, KUsuarioResumo } from '@/pages/kanban/kanban-types';

/**
 * 📅 Calendário de Marketing — VIEW por DATA sobre o board de conteúdo.
 * NÃO cria base paralela: lê os cards via `/kanban/boards/:id/calendario`
 * (cards por `entrega` + itens de checklist por data = data POR CANAL) e a
 * `tabela` (status/pilar/arco/case + backlog sem data). Codifica por
 * canal/pilar/status/arco/case, com painel de análise, 3 views (mês/semana/
 * agenda), drag-drop pra reagendar e filtros.
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

// ─── Arcos narrativos (lidos do campo personalizado "Arco" do card) ──────
const ARCOS: Array<{ re: RegExp; label: string; icon: string }> = [
  { re: /pergunta/i, label: 'Pergunta', icon: '❓' },
  { re: /mito/i, label: 'Mito', icon: '🚫' },
  { re: /hist[óo]ria/i, label: 'História', icon: '📖' },
  { re: /resultado|n[úu]mero/i, label: 'Resultado', icon: '📊' },
];
function arcoDe(valor: unknown): { label: string; icon: string } | null {
  const s = String(valor ?? '').trim();
  if (!s) return null;
  return ARCOS.find((a) => a.re.test(s)) ?? { label: s, icon: '•' };
}

// ─── Status (a partir do nome da lista) → opacidade/estilo ───────────────
function estiloStatus(lista: string): { pub: boolean; planejado: boolean; opacidade: string } {
  const pub = /publicad/i.test(lista);
  const planejado = /planejad/i.test(lista);
  return { pub, planejado, opacidade: pub ? 'opacity-100' : planejado ? 'opacity-60' : 'opacity-85' };
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
/** Número compacto pro badge (1234 → 1,2k). */
function compacto(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(',0', '')}k`;
  return String(n);
}

// ─── Tipos das respostas do kanban ───────────────────────────────────────
interface BoardResumo {
  id: string;
  nome: string;
}
interface BoardCampos {
  campos: Array<{ id: string; nome: string; tipo: string; opcoes: string[] | null }>;
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
  campoValores: Array<{ campoId: string; valor: unknown }>;
}

type Vista = 'mes' | 'semana' | 'agenda' | 'tema';

export default function CalendarioMarketingPage() {
  const navigate = useNavigate();
  const { data: boards, loading: loadingBoards } = useApiQuery<BoardResumo[]>('/kanban/boards');
  const [boardId, setBoardId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    if (boardId || !boards?.length) return;
    setBoardId((boards.find((b) => /conte[uú]do/i.test(b.nome)) ?? boards[0]).id);
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
  const toast = useToast();
  const hoje = new Date();
  const [vista, setVista] = useState<Vista>('mes');
  const [mes, setMes] = useState(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`,
  );
  const [semanaBase, setSemanaBase] = useState<Date>(() => inicioSemanaUTC(new Date()));

  // Filtros
  const [fCanal, setFCanal] = useState('');
  const [fPilar, setFPilar] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSoCase, setFSoCase] = useState(false);
  const [fSoPlanejado, setFSoPlanejado] = useState(false);
  const [fSoPublicado, setFSoPublicado] = useState(false);

  const board = useApiQuery<BoardCampos>(`/kanban/boards/${boardId}`);
  const cal = useApiQuery<{ cards: CalCard[]; itensChecklist: CalItem[] }>(
    `/kanban/boards/${boardId}/calendario?mes=${mes}`,
  );
  const tabela = useApiQuery<TabelaCard[]>(`/kanban/boards/${boardId}/tabela`);
  // Semana pode CRUZAR o mês (o fetch é mensal): busca também o mês vizinho do
  // fim da semana visível e funde — senão os dias do mês seguinte ficavam vazios.
  const fimSemanaVisivel = addDiasUTC(semanaBase, 6);
  const mesFimSemana = `${fimSemanaVisivel.getUTCFullYear()}-${String(fimSemanaVisivel.getUTCMonth() + 1).padStart(2, '0')}`;
  const mesVizinho = vista === 'semana' && mesFimSemana !== mes ? mesFimSemana : null;
  const calViz = useApiQuery<{ cards: CalCard[]; itensChecklist: CalItem[] }>(
    mesVizinho ? `/kanban/boards/${boardId}/calendario?mes=${mesVizinho}` : null,
  );
  const calCards = useMemo(() => {
    const vistos = new Set<string>();
    const out: CalCard[] = [];
    for (const c of [...(cal.data?.cards ?? []), ...(calViz.data?.cards ?? [])]) {
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      out.push(c);
    }
    return out;
  }, [cal.data, calViz.data]);
  const calItens = useMemo(() => {
    const vistos = new Set<string>();
    const out: CalItem[] = [];
    for (const i of [...(cal.data?.itensChecklist ?? []), ...(calViz.data?.itensChecklist ?? [])]) {
      if (vistos.has(i.id)) continue;
      vistos.add(i.id);
      out.push(i);
    }
    return out;
  }, [cal.data, calViz.data]);
  useEffect(() => {
    cal.refetch();
    tabela.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, boardId]);

  // Campo "Arco" do board (se existir) — pra ícone + rotação
  const campoArco = board.data?.campos.find((c) => /arco/i.test(c.nome));
  const arcoDoCard = useMemo(() => {
    const m = new Map<string, { label: string; icon: string } | null>();
    if (!campoArco) return m;
    for (const c of tabela.data ?? []) {
      const v = c.campoValores.find((cv) => cv.campoId === campoArco.id)?.valor;
      m.set(c.id, arcoDe(v));
    }
    return m;
  }, [tabela.data, campoArco]);

  const statusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of tabela.data ?? []) m.set(c.id, c.lista.nome);
    return m;
  }, [tabela.data]);

  // Campo "Impulsionado" (checkbox) — marca peças que foram impulsionadas (ads).
  const campoImpuls = board.data?.campos.find((c) => /impulsion/i.test(c.nome));
  const impulsDoCard = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!campoImpuls) return m;
    for (const c of tabela.data ?? []) {
      const v = c.campoValores.find((cv) => cv.campoId === campoImpuls.id)?.valor;
      if (v === true || v === 'true') m.set(c.id, true);
    }
    return m;
  }, [tabela.data, campoImpuls]);

  // Fase 2 — métricas por peça publicada + links (via campos personalizados).
  const campos = board.data?.campos ?? [];
  const cAlcance = campos.find((c) => /alcance/i.test(c.nome));
  const cEngaj = campos.find((c) => /engaj/i.test(c.nome));
  const cSalv = campos.find((c) => /salvam/i.test(c.nome));
  const cLinkArt = campos.find((c) => /artigo|link\s*public/i.test(c.nome));
  const cLinkPost = campos.find((c) => /\bpost\b|social|blotato/i.test(c.nome));
  const temMetricas = !!(cAlcance || cEngaj || cSalv);
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const metricasDoCard = useMemo(() => {
    const m = new Map<string, { alcance: number | null; engaj: number | null; salv: number | null }>();
    for (const c of tabela.data ?? []) {
      const val = (id?: string) => (id ? num(c.campoValores.find((cv) => cv.campoId === id)?.valor) : null);
      m.set(c.id, { alcance: val(cAlcance?.id), engaj: val(cEngaj?.id), salv: val(cSalv?.id) });
    }
    return m;
  }, [tabela.data, cAlcance, cEngaj, cSalv]);
  const linksDoCard = useMemo(() => {
    const m = new Map<string, { artigo?: string; post?: string }>();
    const str = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined);
    for (const c of tabela.data ?? []) {
      const artigo = str(cLinkArt ? c.campoValores.find((cv) => cv.campoId === cLinkArt.id)?.valor : null);
      const post = str(cLinkPost ? c.campoValores.find((cv) => cv.campoId === cLinkPost.id)?.valor : null);
      if (artigo || post) m.set(c.id, { artigo, post });
    }
    return m;
  }, [tabela.data, cLinkArt, cLinkPost]);

  // Opções de filtro
  const pilares = useMemo(() => {
    const m = new Map<string, KEtiqueta>();
    for (const c of tabela.data ?? []) for (const { etiqueta } of c.etiquetas) m.set(etiqueta.id, etiqueta);
    return [...m.values()];
  }, [tabela.data]);
  const statusOpcoes = useMemo(() => {
    const s = new Set<string>();
    for (const c of tabela.data ?? []) s.add(c.lista.nome);
    return [...s];
  }, [tabela.data]);

  const cardPassa = (etiquetas: Array<{ etiqueta: KEtiqueta }>, listaNome: string) => {
    if (fPilar && !etiquetas.some((e) => e.etiqueta.id === fPilar)) return false;
    if (fStatus && listaNome !== fStatus) return false;
    if (fSoCase && !etiquetas.some((e) => /case/i.test(e.etiqueta.nome ?? ''))) return false;
    if (fSoPlanejado && !/planejad/i.test(listaNome)) return false;
    if (fSoPublicado && !/publicad/i.test(listaNome)) return false;
    return true;
  };

  // Cards + itens (canais) por dia, aplicando filtros
  const porDia = useMemo(() => {
    const mapa = new Map<string, { cards: CalCard[]; itens: CalItem[] }>();
    for (const c of calCards) {
      if (!cardPassa(c.etiquetas, c.lista.nome)) continue;
      const k = diaUTC(c.dataEntrega);
      const v = mapa.get(k) ?? { cards: [], itens: [] };
      v.cards.push(c);
      mapa.set(k, v);
    }
    for (const i of calItens) {
      if (fCanal && canalDe(i.texto)?.key !== fCanal) continue;
      const st = statusById.get(i.checklist.card.id) ?? '';
      if (fStatus && st !== fStatus) continue;
      if (fSoPlanejado && !/planejad/i.test(st)) continue;
      if (fSoPublicado && !/publicad/i.test(st)) continue;
      const k = diaUTC(i.dataEntrega);
      const v = mapa.get(k) ?? { cards: [], itens: [] };
      v.itens.push(i);
      mapa.set(k, v);
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calCards, calItens, statusById, fCanal, fPilar, fStatus, fSoCase, fSoPlanejado, fSoPublicado]);

  const semData = (tabela.data ?? []).filter(
    (c) => !c.dataEntrega && !c.concluido && cardPassa(c.etiquetas, c.lista.nome),
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  function onDragEnd(ev: DragEndEvent) {
    const cardId = String(ev.active.id).replace('mkcard:', '');
    const diaDestino = ev.over ? String(ev.over.id).replace('mkdia:', '') : null;
    if (!diaDestino || !cardId) return;
    void api
      .patch(`/kanban/cards/${cardId}`, { dataEntrega: `${diaDestino}T12:00:00.000Z` })
      .then(() => {
        cal.refetch();
        tabela.refetch();
        toast.success('Data atualizada');
      })
      .catch((err) => toast.error(apiErrorMessage(err)));
  }

  const abrir = (cardId: string) => navigate(`/kanban/${boardId}?card=${cardId}`);
  const [ano, mesNum] = mes.split('-').map(Number);
  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  function navPrev() {
    if (vista === 'semana') irParaSemana(addDiasUTC(semanaBase, -7));
    else mudarMes(-1);
  }
  function navNext() {
    if (vista === 'semana') irParaSemana(addDiasUTC(semanaBase, 7));
    else mudarMes(1);
  }
  // Navegação semanal mantém o fetch mensal SINCRONIZADO com a semana visível
  // (antes: 2-3 cliques em "próxima" e a grade ficava vazia — mês não seguia).
  function irParaSemana(base: Date) {
    setSemanaBase(base);
    const m = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
    if (m !== mes) setMes(m);
  }
  // Entrar na vista Semana vindo de OUTRO mês navegado: re-ancora a semana no
  // 1º dia do mês visível (senão mostrava a semana de hoje com dados de lá).
  function trocarVista(v: Vista) {
    if (v === 'semana') {
      const mesDaSemana = `${semanaBase.getUTCFullYear()}-${String(semanaBase.getUTCMonth() + 1).padStart(2, '0')}`;
      if (mesDaSemana !== mes) setSemanaBase(inicioSemanaUTC(new Date(Date.UTC(ano, mesNum - 1, 1))));
    }
    setVista(v);
  }
  function mudarMes(delta: number) {
    const d = new Date(ano, mesNum - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const rotuloNav =
    vista === 'semana'
      ? `Semana de ${semanaBase.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })}`
      : nomeMes;

  const chipCard = (c: CalCard | TabelaCard, dataStr?: string) => {
    const cor = ('corCapa' in c ? c.corCapa : null) ?? c.etiquetas[0]?.etiqueta.cor ?? '#5C88DA';
    const ehCase = c.etiquetas.some((e) => /case/i.test(e.etiqueta.nome ?? ''));
    const arco = arcoDoCard.get(c.id);
    const impuls = impulsDoCard.get(c.id);
    const links = linksDoCard.get(c.id);
    const met = metricasDoCard.get(c.id);
    const st = 'lista' in c ? c.lista.nome : '';
    const est = estiloStatus(st);
    return (
      <div key={c.id + (dataStr ?? '')} className="flex items-center gap-0.5">
        <MkDraggableCard id={c.id} onAbrir={() => abrir(c.id)}>
          <span
            style={{ borderLeft: `3px solid ${cor}` }}
            className={cn(
              'w-full flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[5px] bg-surface-elevated truncate',
              est.opacidade,
              (c.concluido || est.pub) && 'line-through',
            )}
          >
            {ehCase && <span>⭐</span>}
            {arco && <span title={arco.label}>{arco.icon}</span>}
            {impuls && <span title="Impulsionada (ads)">🚀</span>}
            <span className="truncate">{c.titulo}</span>
            {est.pub && met?.engaj != null && (
              <span className="ml-auto shrink-0 text-[9px] text-muted no-underline" title="Engajamento">
                ❤ {compacto(met.engaj)}
              </span>
            )}
          </span>
        </MkDraggableCard>
        {links?.artigo && (
          <a
            href={links.artigo}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Artigo publicado"
            className="shrink-0 text-[11px] no-underline"
          >
            🔗
          </a>
        )}
        {links?.post && (
          <a
            href={links.post}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Post social"
            className="shrink-0 text-[11px] no-underline"
          >
            📱
          </a>
        )}
      </div>
    );
  };
  const chipCanal = (i: CalItem) => {
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
  };

  return (
    // DndContext envolve as DUAS colunas: o backlog "Sem data" (painel lateral)
    // também tem cards arrastáveis — fora do contexto, os listeners viravam no-op.
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div>
        {/* Barra: view + navegação + filtros */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="inline-flex rounded-[8px] border border-border overflow-hidden">
            {(['mes', 'semana', 'agenda', 'tema'] as Vista[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => trocarVista(v)}
                className={cn(
                  'px-2.5 py-1 text-xs capitalize',
                  vista === v ? 'bg-primary text-primary-contrast' : 'hover:bg-surface-elevated',
                )}
              >
                {v === 'mes' ? 'Mês' : v}
              </button>
            ))}
          </div>
          {vista !== 'agenda' && (
            <>
              <button
                type="button"
                aria-label="Anterior"
                onClick={navPrev}
                className="p-1 rounded-[6px] hover:bg-surface-elevated"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-text capitalize min-w-40 text-center">
                {rotuloNav}
              </span>
              <button
                type="button"
                aria-label="Próximo"
                onClick={navNext}
                className="p-1 rounded-[6px] hover:bg-surface-elevated"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
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
          <Select size="sm" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Todos os status</option>
            {statusOpcoes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <ToggleChip ativo={fSoCase} onClick={() => setFSoCase((v) => !v)}>
            ⭐ Só cases
          </ToggleChip>
          <ToggleChip
            ativo={fSoPlanejado}
            onClick={() => {
              setFSoPlanejado((v) => !v);
              setFSoPublicado(false);
            }}
          >
            Só planejado
          </ToggleChip>
          <ToggleChip
            ativo={fSoPublicado}
            onClick={() => {
              setFSoPublicado((v) => !v);
              setFSoPlanejado(false);
            }}
          >
            Só publicado
          </ToggleChip>
        </div>

        {/* Legenda de canais */}
        <div className="flex items-center gap-3 mb-2 flex-wrap text-[11px] text-muted">
          {CANAIS.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.cor }} />
              {c.label}
            </span>
          ))}
          {campoArco && (
            <span className="ml-2">
              {ARCOS.map((a) => (
                <span key={a.label} className="mr-2" title={a.label}>
                  {a.icon} {a.label}
                </span>
              ))}
            </span>
          )}
        </div>

        <StateView loading={cal.loading && !cal.data} error={cal.error} onRetry={cal.refetch}>
            {vista === 'mes' && (
              <GridMes
                ano={ano}
                mesNum={mesNum}
                porDia={porDia}
                chipCard={chipCard}
                chipCanal={chipCanal}
              />
            )}
            {vista === 'semana' && (
              <GridSemana base={semanaBase} porDia={porDia} chipCard={chipCard} chipCanal={chipCanal} />
            )}
            {vista === 'agenda' && (
              <Agenda porDia={porDia} chipCard={chipCard} chipCanal={chipCanal} />
            )}
            {vista === 'tema' && (
              <TimelineTema
                cards={calCards}
                itens={calItens}
                statusById={statusById}
                fCanal={fCanal}
                fStatus={fStatus}
                chipCard={chipCard}
                onAbrir={abrir}
              />
            )}
        </StateView>
        <p className="text-[11px] text-muted mt-2">
          Chips = canais (data por canal) e a peça inteira na data de publicação. Arraste um card pra
          outro dia (ou do backlog "Sem data") pra agendar. Clique abre o card.
        </p>
      </div>

      {/* Painel lateral */}
      <div className="flex flex-col gap-4">
        <PainelAnalise
          cal={cal.data}
          tabela={tabela.data}
          arcoDoCard={arcoDoCard}
          temArco={!!campoArco}
          impulsDoCard={impulsDoCard}
          temImpuls={!!campoImpuls}
          metricasDoCard={metricasDoCard}
          temMetricas={temMetricas}
        />
        <div className="rounded-[10px] border border-border bg-surface p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Sem data ainda ({semData.length})
          </h4>
          {semData.length === 0 ? (
            <p className="text-xs text-muted m-0">Tudo agendado. 🎉</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {semData.map((c) => (
                <li key={c.id}>{chipCard(c)}</li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted mt-2">Arraste pra um dia, ou clique pra abrir o card.</p>
        </div>
      </div>
    </div>
    </DndContext>
  );
}

// ─── Helpers de data ─────────────────────────────────────────────────────
function inicioSemanaUTC(d: Date): Date {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() - u.getUTCDay());
  return u;
}
function addDiasUTC(d: Date, n: number): Date {
  const u = new Date(d);
  u.setUTCDate(u.getUTCDate() + n);
  return u;
}

// ─── Drag helpers ────────────────────────────────────────────────────────
function MkDraggableCard({
  id,
  onAbrir,
  children,
}: {
  id: string;
  onAbrir: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `mkcard:${id}`,
  });
  const arrastou = useRef(false);
  useEffect(() => {
    if (isDragging) arrastou.current = true;
  }, [isDragging]);
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => {
        if (arrastou.current) {
          arrastou.current = false;
          return;
        }
        onAbrir();
      }}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      className={cn('w-full text-left cursor-grab', isDragging && 'opacity-50 z-10 relative')}
    >
      {children}
    </button>
  );
}
function DiaDroppable({
  chave,
  className,
  children,
}: {
  chave: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `mkdia:${chave}` });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && 'bg-primary/10')} data-testid={`mk-dia-${chave}`}>
      {children}
    </div>
  );
}

// ─── View: MÊS ───────────────────────────────────────────────────────────
type ChipCard = (c: CalCard | TabelaCard, dataStr?: string) => React.ReactNode;
type ChipCanal = (i: CalItem) => React.ReactNode;
type PorDia = Map<string, { cards: CalCard[]; itens: CalItem[] }>;

function GridMes({
  ano,
  mesNum,
  porDia,
  chipCard,
  chipCanal,
}: {
  ano: number;
  mesNum: number;
  porDia: PorDia;
  chipCard: ChipCard;
  chipCanal: ChipCanal;
}) {
  const semanas = useMemo(() => {
    const primeiro = new Date(Date.UTC(ano, mesNum - 1, 1));
    const inicio = new Date(primeiro);
    inicio.setUTCDate(1 - primeiro.getUTCDay());
    const linhas: Date[][] = [];
    for (let i = 0; i < 6; i++) {
      const linha: Date[] = [];
      for (let j = 0; j < 7; j++) linha.push(addDiasUTC(inicio, i * 7 + j));
      if (i >= 4 && linha.every((d) => d.getUTCMonth() !== mesNum - 1)) break;
      linhas.push(linha);
    }
    return linhas;
  }, [ano, mesNum]);

  return (
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
          <DiaDroppable
            key={chave}
            chave={chave}
            className={cn('bg-surface min-h-24 p-1 flex flex-col gap-0.5', !doMes && 'opacity-40')}
          >
            <span className="text-[10px] text-muted">{dia.getUTCDate()}</span>
            {conteudo?.cards.map((c) => chipCard(c, chave))}
            {conteudo?.itens.map((i) => chipCanal(i))}
          </DiaDroppable>
        );
      })}
    </div>
  );
}

// ─── View: SEMANA ────────────────────────────────────────────────────────
function GridSemana({
  base,
  porDia,
  chipCard,
  chipCanal,
}: {
  base: Date;
  porDia: PorDia;
  chipCard: ChipCard;
  chipCanal: ChipCanal;
}) {
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => addDiasUTC(base, i)), [base]);
  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-[10px] overflow-hidden border border-border">
      {dias.map((dia) => {
        const chave = chaveDia(dia);
        const conteudo = porDia.get(chave);
        return (
          <DiaDroppable key={chave} chave={chave} className="bg-surface min-h-64 p-1.5 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-text">
              {DIAS_SEMANA[dia.getUTCDay()]} {dia.getUTCDate()}
            </span>
            {conteudo?.cards.map((c) => chipCard(c, chave))}
            {conteudo?.itens.map((i) => chipCanal(i))}
          </DiaDroppable>
        );
      })}
    </div>
  );
}

// ─── View: AGENDA (cronológica) ──────────────────────────────────────────
function Agenda({
  porDia,
  chipCard,
  chipCanal,
}: {
  porDia: PorDia;
  chipCard: ChipCard;
  chipCanal: ChipCanal;
}) {
  const dias = [...porDia.entries()]
    .filter(([, v]) => v.cards.length > 0 || v.itens.length > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (dias.length === 0)
    return <p className="text-sm text-muted">Nada agendado neste mês (veja o backlog "Sem data").</p>;
  return (
    <div className="flex flex-col gap-2">
      {dias.map(([chave, v]) => {
        const d = new Date(chave + 'T12:00:00Z');
        return (
          <div key={chave} className="rounded-[10px] border border-border bg-surface p-3">
            <p className="text-xs font-semibold text-text mb-1.5">
              {d.toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                timeZone: 'UTC',
              })}
            </p>
            <div className="flex flex-col gap-1">
              {v.cards.map((c) => chipCard(c, chave))}
              {v.itens.map((i) => chipCanal(i))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── View: TIMELINE POR TEMA (card = slug/âncora + derivados) ────────────
function TimelineTema({
  cards,
  itens,
  statusById,
  fCanal,
  fStatus,
  chipCard,
  onAbrir,
}: {
  cards: CalCard[];
  itens: CalItem[];
  statusById: Map<string, string>;
  fCanal: string;
  fStatus: string;
  chipCard: ChipCard;
  onAbrir: (id: string) => void;
}) {
  const temas = useMemo(() => {
    const m = new Map<string, { cardId: string; titulo: string; card?: CalCard; itens: CalItem[] }>();
    for (const c of cards) {
      if (fStatus && c.lista.nome !== fStatus) continue;
      m.set(c.id, { cardId: c.id, titulo: c.titulo, card: c, itens: [] });
    }
    for (const i of itens) {
      const cid = i.checklist.card.id;
      if (fCanal && canalDe(i.texto)?.key !== fCanal) continue;
      if (fStatus && (statusById.get(cid) ?? '') !== fStatus) continue;
      const t = m.get(cid) ?? { cardId: cid, titulo: i.checklist.card.titulo, itens: [] };
      t.itens.push(i);
      m.set(cid, t);
    }
    const menor = (t: { card?: CalCard; itens: CalItem[] }) =>
      Math.min(
        ...(t.card ? [new Date(t.card.dataEntrega).getTime()] : []),
        ...t.itens.map((i) => new Date(i.dataEntrega).getTime()),
        Infinity,
      );
    return [...m.values()]
      .map((t) => ({
        ...t,
        itens: [...t.itens].sort(
          (a, b) => new Date(a.dataEntrega).getTime() - new Date(b.dataEntrega).getTime(),
        ),
      }))
      .sort((a, b) => menor(a) - menor(b));
  }, [cards, itens, statusById, fCanal, fStatus]);

  if (!temas.length)
    return (
      <p className="text-sm text-muted">
        Sem peças datadas neste mês — defina data no card ou nos canais (checklist).
      </p>
    );
  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });

  return (
    <div className="flex flex-col gap-2">
      {temas.map((t) => (
        <div
          key={t.cardId}
          className="rounded-[10px] border border-border bg-surface p-2 flex items-center gap-3"
        >
          <div className="w-56 shrink-0">
            {t.card ? (
              chipCard(t.card, 'tema')
            ) : (
              <button
                type="button"
                onClick={() => onAbrir(t.cardId)}
                className="text-[11px] text-text hover:underline truncate text-left w-full"
              >
                {t.titulo}
              </button>
            )}
          </div>
          <div className="flex-1 flex items-center gap-1 flex-wrap">
            {t.itens.length === 0 ? (
              <span className="text-[10px] text-muted">só data de publicação</span>
            ) : (
              t.itens.map((i) => {
                const c = canalDe(i.texto);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => onAbrir(t.cardId)}
                    title={i.texto}
                    style={{ background: (c?.cor ?? '#838C91') + '22', color: c?.cor }}
                    className="text-[10px] px-1.5 py-0.5 rounded-[5px] whitespace-nowrap"
                  >
                    {c?.label ?? i.texto} · {dia(i.dataEntrega)}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToggleChip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-[11px] px-2 py-1 rounded-full border',
        ativo
          ? 'bg-primary/15 border-primary text-primary'
          : 'border-border text-muted hover:bg-surface-elevated',
      )}
    >
      {children}
    </button>
  );
}

// ─── Painel de análise ───────────────────────────────────────────────────
function PainelAnalise({
  cal,
  tabela,
  arcoDoCard,
  temArco,
  impulsDoCard,
  temImpuls,
  metricasDoCard,
  temMetricas,
}: {
  cal?: { cards: CalCard[]; itensChecklist: CalItem[] } | null;
  tabela?: TabelaCard[] | null;
  arcoDoCard: Map<string, { label: string; icon: string } | null>;
  temArco: boolean;
  impulsDoCard: Map<string, boolean>;
  temImpuls: boolean;
  metricasDoCard: Map<string, { alcance: number | null; engaj: number | null; salv: number | null }>;
  temMetricas: boolean;
}) {
  const a = useMemo(() => {
    const cards = cal?.cards ?? [];
    const itens = cal?.itensChecklist ?? [];
    const mix = new Map<string, number>();
    for (const i of itens) {
      const c = canalDe(i.texto);
      if (c) mix.set(c.key, (mix.get(c.key) ?? 0) + 1);
    }
    const pil = new Map<string, { nome: string; cor: string; n: number }>();
    for (const c of cards)
      for (const { etiqueta } of c.etiquetas) {
        const p = pil.get(etiqueta.id) ?? { nome: etiqueta.nome ?? '—', cor: etiqueta.cor, n: 0 };
        p.n += 1;
        pil.set(etiqueta.id, p);
      }
    const porSemana = new Map<number, number>();
    for (const c of cards) {
      const s = Math.ceil(new Date(c.dataEntrega).getUTCDate() / 7);
      porSemana.set(s, (porSemana.get(s) ?? 0) + 1);
    }
    const casesDatas = cards
      .filter((c) => c.etiquetas.some((e) => /case/i.test(e.etiqueta.nome ?? '')))
      .map((c) => new Date(c.dataEntrega).getTime())
      .sort((x, y) => x - y);
    let caseApertado = false;
    for (let i = 1; i < casesDatas.length; i++)
      if (casesDatas[i] - casesDatas[i - 1] < 28 * 86_400_000) caseApertado = true;
    // Rotação de arcos (dos cards datados)
    const arcos = new Map<string, { icon: string; n: number }>();
    for (const c of cards) {
      const arc = arcoDoCard.get(c.id);
      if (arc) {
        const e = arcos.get(arc.label) ?? { icon: arc.icon, n: 0 };
        e.n += 1;
        arcos.set(arc.label, e);
      }
    }
    let impuls = 0;
    for (const c of cards) if (impulsDoCard.get(c.id)) impuls += 1;
    // Fase 2 — top por engajamento + alcance total (peças com métrica)
    let alcanceTotal = 0;
    for (const c of cards) alcanceTotal += metricasDoCard.get(c.id)?.alcance ?? 0;
    const topEngaj = cards
      .map((c) => ({ titulo: c.titulo, engaj: metricasDoCard.get(c.id)?.engaj ?? null }))
      .filter((x): x is { titulo: string; engaj: number } => x.engaj != null)
      .sort((a, b) => b.engaj - a.engaj)
      .slice(0, 3);
    const status = new Map<string, number>();
    for (const c of tabela ?? []) status.set(c.lista.nome, (status.get(c.lista.nome) ?? 0) + 1);
    return {
      mix,
      pil: [...pil.values()],
      porSemana,
      cases: casesDatas.length,
      caseApertado,
      arcos: [...arcos.entries()],
      impuls,
      alcanceTotal,
      topEngaj,
      status,
    };
  }, [cal, tabela, arcoDoCard, impulsDoCard, metricasDoCard]);

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3 flex flex-col gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Análise do mês</h4>

      <div>
        <p className="text-[11px] text-muted mb-1">Cadência (peças/semana)</p>
        <div className="flex items-end gap-1 h-12">
          {[1, 2, 3, 4, 5].map((s) => {
            const n = a.porSemana.get(s) ?? 0;
            const max = Math.max(1, ...[...a.porSemana.values()]);
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className={cn('w-full rounded-t-[3px]', n === 0 ? 'bg-danger/30' : 'bg-secondary')}
                  style={{ height: `${(n / max) * 100}%`, minHeight: n === 0 ? 2 : 4 }}
                  title={n === 0 ? `Semana ${s}: buraco (sem peça)` : `Semana ${s}: ${n}`}
                />
                <span className="text-[9px] text-muted">S{s}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] text-muted mb-1">Mix de canais</p>
        <div className="flex flex-col gap-1">
          {CANAIS.map((c) => {
            const n = a.mix.get(c.key) ?? 0;
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

      <div>
        <p className="text-[11px] text-muted mb-1">Pilares no mês</p>
        <div className="flex flex-wrap gap-1">
          {a.pil.length === 0 ? (
            <span className="text-[11px] text-muted">—</span>
          ) : (
            a.pil.map((p) => (
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

      {temArco && (
        <div>
          <p className="text-[11px] text-muted mb-1">Rotação de arcos</p>
          <div className="flex flex-wrap gap-1">
            {a.arcos.length === 0 ? (
              <span className="text-[11px] text-muted">— (defina o campo "Arco" nos cards)</span>
            ) : (
              a.arcos.map(([label, e]) => (
                <span
                  key={label}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-elevated text-text"
                >
                  {e.icon} {label} · {e.n}
                </span>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-muted">Cases no mês:</span>
        <span className="font-semibold text-text">{a.cases}</span>
        {a.caseApertado && (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" /> 2 cases em &lt; 4 semanas
          </span>
        )}
        {temImpuls && (
          <span className="ml-2 text-muted">
            🚀 Impulsionadas: <span className="font-semibold text-text">{a.impuls}</span>
          </span>
        )}
      </div>

      {temMetricas && (
        <div>
          <p className="text-[11px] text-muted mb-1">Performance (peças publicadas)</p>
          {a.alcanceTotal > 0 && (
            <p className="text-[11px] text-text mb-1">
              👁 Alcance no mês: <span className="font-semibold">{compacto(a.alcanceTotal)}</span>
            </p>
          )}
          {a.topEngaj.length === 0 ? (
            <span className="text-[11px] text-muted">
              — (preencha alcance/engajamento nos cards publicados)
            </span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {a.topEngaj.map((t, i) => (
                <li key={t.titulo} className="flex items-center gap-1 text-[11px]">
                  <span className="text-muted">{i + 1}º</span>
                  <span className="truncate flex-1 text-text" title={t.titulo}>
                    {t.titulo}
                  </span>
                  <span className="shrink-0 text-muted">❤ {compacto(t.engaj)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <p className="text-[11px] text-muted mb-1">Status (board inteiro)</p>
        <div className="flex flex-wrap gap-1">
          {[...a.status.entries()].map(([nome, n]) => (
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
