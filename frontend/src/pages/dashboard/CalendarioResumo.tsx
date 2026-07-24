import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Button, Card, CardHeader, CardTitle, CardDescription, EmptyState } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { canalDe, CANAIS_CONTEUDO, PONTOS_M7 } from '@/lib/canais-conteudo';

/**
 * M7 — Calendário de marketing (RESUMO da aba lateral que JÁ existe — não é
 * reimplementação; mesma fonte e mesmos endpoints). Fonte: quadro
 * "Somatec — Conteúdo", onde cada card = 1 unidade (slug = utm_campaign) e o
 * checklist são os canais. Cada unidade mostra os 5 PONTOS (Blog · Visual ·
 * Vídeo · E-mail · Ads) — o progresso do pacote legível de relance, sem abrir
 * nada. Arrastar reagenda (mesmo PATCH da aba); clicar abre o card no quadro.
 */

interface BoardResumo {
  id: string;
  nome: string;
}
interface CalCard {
  id: string;
  titulo: string;
  dataEntrega: string;
  concluido: boolean;
  lista: { id: string; nome: string };
}
interface CalItem {
  id: string;
  texto: string;
  concluido: boolean;
  checklist: { card: { id: string; titulo: string } };
}

type Vista = 'semana' | 'mes';
type FiltroStatus = 'todos' | 'planejado' | 'publicado';

function chaveDiaUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function diaDeIso(iso: string): string {
  return chaveDiaUTC(new Date(iso));
}

export function CalendarioResumo() {
  const navigate = useNavigate();
  const toast = useToast();
  const [vista, setVista] = useState<Vista>('semana');
  const [offset, setOffset] = useState(0); // deslocamento em semanas/meses
  const [filtroCanal, setFiltroCanal] = useState<string | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');

  // Fonte = o quadro de CONTEÚDO (mesmo do calendário pleno).
  const { data: boards } = useApiQuery<BoardResumo[]>('/kanban/boards');
  const board = boards?.find((b) => /conte[uú]do/i.test(b.nome)) ?? null;

  // Janela visível (UTC — as datas dos cards são meio-dia UTC).
  const { de, ate, dias } = useMemo(() => {
    const hoje = new Date();
    const base = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
    if (vista === 'semana') {
      const ini = new Date(base);
      ini.setUTCDate(ini.getUTCDate() - ini.getUTCDay() + offset * 7);
      const ds: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(ini);
        d.setUTCDate(ini.getUTCDate() + i);
        ds.push(d);
      }
      const fim = new Date(ini);
      fim.setUTCDate(ini.getUTCDate() + 7);
      return { de: ini, ate: fim, dias: ds };
    }
    const ini = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
    const fim = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset + 1, 1));
    const ds: Date[] = [];
    for (let d = new Date(ini); d < fim; d.setUTCDate(d.getUTCDate() + 1)) ds.push(new Date(d));
    return { de: ini, ate: fim, dias: ds };
  }, [vista, offset]);

  const cal = useApiQuery<{ cards: CalCard[]; itensChecklist: CalItem[] }>(
    board
      ? `/kanban/boards/${board.id}/calendario?de=${de.toISOString()}&ate=${ate.toISOString()}`
      : null,
  );

  // Checklist por card → estado dos 5 pontos (feito/pendente/ausente por canal).
  const pontosPorCard = useMemo(() => {
    const mapa = new Map<string, Map<string, { total: number; feitos: number }>>();
    for (const item of cal.data?.itensChecklist ?? []) {
      const canal = canalDe(item.texto);
      if (!canal) continue;
      const cardId = item.checklist.card.id;
      const porCanal = mapa.get(cardId) ?? new Map();
      const atual = porCanal.get(canal.key) ?? { total: 0, feitos: 0 };
      atual.total += 1;
      if (item.concluido) atual.feitos += 1;
      porCanal.set(canal.key, atual);
      mapa.set(cardId, porCanal);
    }
    return mapa;
  }, [cal.data]);

  // Filtros: canal (a unidade tem item daquele canal) + status (nome da lista).
  const cardsFiltrados = useMemo(() => {
    return (cal.data?.cards ?? []).filter((c) => {
      if (filtroStatus === 'publicado' && !/publicad/i.test(c.lista.nome)) return false;
      if (filtroStatus === 'planejado' && !/planejad/i.test(c.lista.nome)) return false;
      if (filtroCanal && !pontosPorCard.get(c.id)?.has(filtroCanal)) return false;
      return true;
    });
  }, [cal.data, filtroCanal, filtroStatus, pontosPorCard]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, CalCard[]>();
    for (const c of cardsFiltrados) {
      const k = diaDeIso(c.dataEntrega);
      mapa.set(k, [...(mapa.get(k) ?? []), c]);
    }
    return mapa;
  }, [cardsFiltrados]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Reagendar = MESMO patch da aba plena (não duplica lógica de escrita).
  function onDragEnd(ev: DragEndEvent) {
    const cardId = String(ev.active.id).replace('m7card:', '');
    const diaDestino = ev.over ? String(ev.over.id).replace('m7dia:', '') : null;
    if (!diaDestino || !cardId) return;
    void api
      .patch(`/kanban/cards/${cardId}`, { dataEntrega: `${diaDestino}T12:00:00.000Z` })
      .then(() => {
        cal.refetch();
        toast.success('Unidade reagendada');
      })
      .catch((err) => toast.error('Falha ao reagendar', apiErrorMessage(err)));
  }

  const titulo =
    vista === 'semana'
      ? `Semana de ${dias[0].getUTCDate()}/${dias[0].getUTCMonth() + 1}`
      : de.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <Card padding="md" id="mod-calendario" data-testid="calendario-resumo">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle>Calendário de marketing</CardTitle>
            <CardDescription>
              {board ? `Resumo do quadro "${board.nome}"` : 'Resumo do plano de conteúdo'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={vista === 'semana' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setVista('semana');
                setOffset(0);
              }}
              data-testid="m7-vista-semana"
            >
              Semana
            </Button>
            <Button
              variant={vista === 'mes' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setVista('mes');
                setOffset(0);
              }}
              data-testid="m7-vista-mes"
            >
              Mês
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Período anterior"
              onClick={() => setOffset((o) => o - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-text-subtle tabular min-w-[90px] text-center capitalize">
              {titulo}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Próximo período"
              onClick={() => setOffset((o) => o + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Filtros: canal + status numa linha só. */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {CANAIS_CONTEUDO.map((c) => (
            <button
              key={c.key}
              type="button"
              data-testid={`m7-filtro-${c.key}`}
              onClick={() => setFiltroCanal(filtroCanal === c.key ? null : c.key)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                filtroCanal === c.key
                  ? 'border-transparent text-white'
                  : 'border-border text-text-subtle hover:border-border-strong',
              )}
              style={filtroCanal === c.key ? { backgroundColor: c.cor } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.cor }} aria-hidden />
              {c.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          {(['todos', 'planejado', 'publicado'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltroStatus(s)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize transition-colors',
                filtroStatus === s
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-text-subtle hover:border-border-strong',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </CardHeader>

      {!board ? (
        <EmptyState
          size="sm"
          icon={<CalendarRange />}
          title="Quadro de conteúdo não encontrado"
          description='Crie um quadro com "Conteúdo" no nome pra alimentar o calendário.'
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div
            className={cn(
              'grid gap-1.5',
              vista === 'semana' ? 'grid-cols-7' : 'grid-cols-7 auto-rows-min',
            )}
          >
            {vista === 'mes' &&
              // pad até o dia da semana do 1º dia do mês
              Array.from({ length: dias[0].getUTCDay() }).map((_, i) => <div key={`pad-${i}`} />)}
            {dias.map((d) => (
              <DiaCelula
                key={chaveDiaUTC(d)}
                dia={d}
                compacto={vista === 'mes'}
                cards={porDia.get(chaveDiaUTC(d)) ?? []}
                pontosPorCard={pontosPorCard}
                onAbrir={(cardId) => navigate(`/kanban/${board.id}?card=${cardId}`)}
              />
            ))}
          </div>
        </DndContext>
      )}

      <div className="mt-3">
        <Link to="/calendario-marketing">
          <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="h-3 w-3" />}>
            Abrir o calendário completo
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function DiaCelula({
  dia,
  compacto,
  cards,
  pontosPorCard,
  onAbrir,
}: {
  dia: Date;
  compacto: boolean;
  cards: CalCard[];
  pontosPorCard: Map<string, Map<string, { total: number; feitos: number }>>;
  onAbrir: (cardId: string) => void;
}) {
  const chave = chaveDiaUTC(dia);
  const { setNodeRef, isOver } = useDroppable({ id: `m7dia:${chave}` });
  const hoje = chaveDiaUTC(new Date()) === chave;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md border p-1 flex flex-col gap-1',
        compacto ? 'min-h-[48px]' : 'min-h-[68px]',
        isOver ? 'border-primary bg-primary/5' : 'border-border',
        hoje && 'bg-surface-hover/50',
      )}
    >
      <span className={cn('text-[10px] tabular', hoje ? 'text-primary font-bold' : 'text-muted')}>
        {dia.getUTCDate()}
      </span>
      {cards.map((c) => (
        <UnidadeChip key={c.id} card={c} pontos={pontosPorCard.get(c.id)} onAbrir={onAbrir} />
      ))}
    </div>
  );
}

function UnidadeChip({
  card,
  pontos,
  onAbrir,
}: {
  card: CalCard;
  pontos: Map<string, { total: number; feitos: number }> | undefined;
  onAbrir: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `m7card:${card.id}`,
  });
  const publicado = /publicad/i.test(card.lista.nome);
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid="m7-unidade"
      {...attributes}
      {...listeners}
      onClick={() => onAbrir(card.id)}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined
      }
      className={cn(
        'w-full text-left rounded border border-border bg-surface px-1.5 py-1',
        'hover:border-border-strong transition-colors cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-60 z-10 relative',
        !publicado && 'opacity-80',
      )}
      title={card.titulo}
    >
      <span className="block text-[10px] leading-tight text-text truncate">{card.titulo}</span>
      {/* Os 5 PONTOS em ordem FIXA: cheio = canal concluído · vazado = pendente ·
          apagado = o pacote não tem esse canal. Progresso legível de relance. */}
      <span className="mt-0.5 flex items-center gap-0.5" aria-label="Progresso por canal">
        {PONTOS_M7.map((p) => {
          const st = pontos?.get(p.key);
          const feito = st && st.total > 0 && st.feitos >= st.total;
          const pendente = st && st.total > 0 && !feito;
          return (
            <span
              key={p.key}
              title={`${p.label}${feito ? ' ✓' : pendente ? ' pendente' : ' — sem item'}`}
              className={cn('h-1.5 w-1.5 rounded-full border', !st && 'opacity-25')}
              style={{
                borderColor: p.cor,
                backgroundColor: feito ? p.cor : 'transparent',
              }}
            />
          );
        })}
      </span>
    </button>
  );
}
