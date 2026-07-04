import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CalendarCheck, CalendarPlus, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';

type AgendaTipo = 'VISITA' | 'LIGACAO' | 'REUNIAO' | 'ENTREGA' | 'TAREFA';

interface AgendaItem {
  id: string;
  titulo: string;
  data: string;
  duracao: number;
  tipo: AgendaTipo;
  observacao?: string | null;
  cliente?: { id: string; nome: string } | null;
  googleEventId?: string | null;
  // v1.5.0 — recorrência
  recorrencia?: 'NENHUMA' | 'DIARIA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'ANUAL';
  parentId?: string | null;
}

interface ClienteOpt {
  id: string;
  nome: string;
}

const TIPOS: AgendaTipo[] = ['VISITA', 'LIGACAO', 'REUNIAO', 'ENTREGA', 'TAREFA'];

const TIPO_COLOR: Record<AgendaTipo, string> = {
  VISITA: 'var(--blue)',
  LIGACAO: 'var(--info)',
  REUNIAO: 'var(--magenta)',
  ENTREGA: 'var(--warning)',
  TAREFA: 'var(--muted)',
};
const TIPO_ICON: Record<AgendaTipo, string> = {
  VISITA: '🚗',
  LIGACAO: '📞',
  REUNIAO: '🤝',
  ENTREGA: '📦',
  TAREFA: '✓',
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0 = dom
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDay(d: Date) {
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function fmtTime(s: string) {
  try {
    return new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
}
function toLocalIso(d: Date) {
  // YYYY-MM-DDTHH:mm pra <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
/**
 * Horário sugerido pra um novo evento num dado dia: se for HOJE, a próxima hora
 * cheia depois de agora (ex.: 13h42 → 14h00); senão, 09:00 (início do expediente).
 * Depois das 23h de hoje, cai pro 09:00 pra não virar o dia.
 */
function sugestaoHorario(day: Date): Date {
  const at = new Date(day);
  const now = new Date();
  if (sameDay(day, now) && now.getHours() < 23) {
    at.setHours(now.getHours() + 1, 0, 0, 0);
  } else {
    at.setHours(9, 0, 0, 0);
  }
  return at;
}
/** Rótulo "HH:00" do horário sugerido (pro botão de novo evento). */
function labelHorario(day: Date): string {
  return `${String(sugestaoHorario(day).getHours()).padStart(2, '0')}:00`;
}

/**
 * Chip/botão de conexão do Google Calendar no header da Agenda. Conectado →
 * mostra o estado; não conectado → abre o MESMO popup OAuth de Minhas Integrações
 * (um clique). Se o app Google não estiver configurado no ambiente, desabilita
 * com dica em vez de erro cru.
 */
function GoogleConexaoBotao() {
  const toast = useToast();
  const { data: conexoes, refetch } = useApiQuery<
    Array<{ servico: string; ativo: boolean }>
  >('/usuario/integracoes');
  const { data: cfg } = useApiQuery<{ configurado: boolean }>(
    '/integracoes/google/oauth/status',
  );
  const [busy, setBusy] = useState(false);
  const conectado = (conexoes ?? []).some((c) => c.servico === 'google_calendar' && c.ativo);

  // Popup OAuth avisa o opener via postMessage (type terminando em '-oauth').
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      const t = (e.data as { type?: string }).type;
      if (t && t.endsWith('-oauth')) {
        setBusy(false);
        refetch();
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [refetch]);

  async function conectar() {
    setBusy(true);
    try {
      const r = await api.get<{ url: string }>('/integracoes/google/oauth/start');
      if (!r.url) throw new Error('Backend não retornou URL OAuth');
      const w = 600;
      const h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        r.url,
        'google_calendar-oauth',
        `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!popup) throw new Error('Popup bloqueado — habilite no navegador');
      const t = setInterval(() => {
        if (popup.closed) {
          clearInterval(t);
          setBusy(false);
          refetch();
        }
      }, 1000);
    } catch (err) {
      setBusy(false);
      toast.error(
        'Falha ao conectar o Google',
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined,
      );
    }
  }

  async function sincronizar() {
    setBusy(true);
    try {
      const r = await api.post<{ sincronizados: number; total: number }>(
        '/agenda/sincronizar-google',
      );
      if (r.total === 0) {
        toast.success('Tudo sincronizado', 'Nenhum compromisso futuro pendente de envio.');
      } else {
        toast.success(
          `${r.sincronizados} de ${r.total} enviados pro Google`,
          r.sincronizados < r.total ? 'Alguns falharam — tente de novo em instantes.' : undefined,
        );
      }
    } catch (err) {
      toast.error(
        'Falha ao sincronizar',
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  if (conectado) {
    return (
      <div className="inline-flex items-center gap-2">
        <span
          data-testid="agenda-google-conectado"
          title="Seu Google Calendar está conectado — compromissos com 'espelhar' vão pra lá."
          className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[13px] font-medium text-success"
        >
          <CalendarCheck className="h-4 w-4" />
          Google conectado
        </span>
        <button
          type="button"
          data-testid="agenda-google-sincronizar"
          onClick={() => void sincronizar()}
          disabled={busy}
          title="Enviar pro Google os compromissos futuros que ainda não estão lá (ex.: criados antes de conectar)"
          className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 text-[13px] font-medium text-text cursor-pointer tracking-[-0.1px]"
          style={{ opacity: busy ? 0.6 : 1 }}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </div>
    );
  }

  const naoConfigurado = cfg?.configurado === false;
  return (
    <button
      type="button"
      data-testid="agenda-google-conectar"
      onClick={() => void conectar()}
      disabled={busy || naoConfigurado}
      title={
        naoConfigurado
          ? 'Google Calendar ainda não foi configurado no ambiente (admin)'
          : 'Conectar seu Google Calendar num clique'
      }
      className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-2 text-[13px] font-medium text-text cursor-pointer tracking-[-0.1px]"
      style={{ opacity: busy || naoConfigurado ? 0.6 : 1 }}
    >
      <CalendarPlus className="h-4 w-4" style={{ color: '#4285f4' }} />
      {busy ? 'Conectando…' : naoConfigurado ? 'Google indisponível' : 'Conectar Google'}
    </button>
  );
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
/** Chave LOCAL yyyy-mm-dd — NÃO usar toISOString (UTC desloca o dia). */
function keyDia(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Células do grid mensal: do domingo anterior ao dia 1, linhas conforme o mês. */
function gridDoMes(ref: Date): Date[] {
  const inicioMes = startOfMonth(ref);
  const gridInicio = startOfWeek(inicioMes);
  const diasNoMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  const semanas = Math.ceil((inicioMes.getDay() + diasNoMes) / 7);
  return Array.from({ length: semanas * 7 }, (_, i) => addDays(gridInicio, i));
}
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtMesAno(d: Date): string {
  return capitalizar(d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
}
function fmtDiaCompleto(d: Date): string {
  return capitalizar(
    d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
  );
}

// ─── Visões (dia | semana | mês) ─────────────────────────────────────

type AgendaVisao = 'dia' | 'semana' | 'mes';

const VISAO_STORAGE_KEY = 'agenda:visao';
const VISOES: { valor: AgendaVisao; label: string }[] = [
  { valor: 'dia', label: 'Dia' },
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
];

function lerVisaoSalva(): AgendaVisao {
  try {
    const v = localStorage.getItem(VISAO_STORAGE_KEY);
    if (v === 'dia' || v === 'semana' || v === 'mes') return v;
  } catch {
    // localStorage indisponível — usa default
  }
  return 'semana';
}

export default function AgendaPage() {
  const toast = useToast();
  // Visão ativa (dia | semana | mês) — persiste em localStorage
  const [visao, setVisaoState] = useState<AgendaVisao>(lerVisaoSalva);
  // Data de referência compartilhada entre as visões (dia exibido / semana / mês)
  const [dataRef, setDataRef] = useState(() => new Date());
  const [filtroTipo, setFiltroTipo] = useState('');
  const [creating, setCreating] = useState<Date | null>(null);
  const [editing, setEditing] = useState<AgendaItem | null>(null);

  function mudarVisao(v: AgendaVisao) {
    setVisaoState(v);
    try {
      localStorage.setItem(VISAO_STORAGE_KEY, v);
    } catch {
      // best-effort
    }
  }

  // Sensor: começa drag só após 8px de movimento (evita conflito com click pra editar)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const weekStart = startOfWeek(dataRef);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Range da busca por visão — mesmo endpoint /agenda, só muda inicio/fim
  const listPath = useMemo(() => {
    let inicio: Date;
    let fim: Date;
    if (visao === 'dia') {
      inicio = startOfDay(dataRef);
      fim = addDays(inicio, 1);
    } else if (visao === 'mes') {
      const cels = gridDoMes(dataRef);
      inicio = cels[0];
      fim = addDays(cels[cels.length - 1], 1);
    } else {
      inicio = startOfWeek(dataRef);
      fim = addDays(inicio, 7);
    }
    const qs = new URLSearchParams({ inicio: inicio.toISOString(), fim: fim.toISOString() });
    if (filtroTipo) qs.set('tipo', filtroTipo);
    return `/agenda?${qs.toString()}`;
  }, [visao, dataRef, filtroTipo]);

  const { data: items, loading, error, refetch } = useApiQuery<AgendaItem[]>(listPath);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    if (items) {
      for (const it of items) {
        const key = keyDia(new Date(it.data));
        const arr = map.get(key) ?? [];
        arr.push(it);
        map.set(key, arr);
      }
      // Ordena cada dia por hora
      for (const arr of map.values()) {
        arr.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
      }
    }
    return map;
  }, [items]);

  const today = new Date();

  // Navegação ‹ › por visão
  function navegar(delta: number) {
    if (visao === 'dia') setDataRef(addDays(startOfDay(dataRef), delta));
    else if (visao === 'mes') setDataRef(addMonths(dataRef, delta));
    else setDataRef(addDays(weekStart, delta * 7));
  }

  // Clicar num dia do mês abre a visão diária daquele dia
  function abrirDia(d: Date) {
    setDataRef(new Date(d));
    mudarVisao('dia');
  }

  /**
   * Drag de um AgendaItem entre colunas (dias da semana).
   * - active.id = id do AgendaItem
   * - over.id = ISO string do dia destino (gerado em useDroppable)
   * Mantém hora original, troca só o dia. PATCH /agenda/:id no backend.
   */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !items) return;
    const itemId = String(active.id);
    const novoDiaIso = String(over.id);
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const dataAtual = new Date(item.data);
    const novoDia = new Date(novoDiaIso);
    // Se já está no mesmo dia, no-op (evita request desnecessário)
    if (sameDay(dataAtual, novoDia)) return;

    // Mantém hora/minuto/segundo, troca dia/mes/ano
    novoDia.setHours(
      dataAtual.getHours(),
      dataAtual.getMinutes(),
      dataAtual.getSeconds(),
      0,
    );
    try {
      await api.patch(`/agenda/${itemId}`, { data: novoDia.toISOString() });
      toast.success(
        'Compromisso movido',
        `${item.titulo} → ${novoDia.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}`,
      );
      refetch();
    } catch (err) {
      toast.error(
        'Não consegui mover o compromisso',
        err instanceof ApiError ? err.message : 'Erro desconhecido',
      );
    }
  }

  return (
    <PageLayout
      title="Agenda"
      actions={
        <div className="flex items-center gap-2">
          <GoogleConexaoBotao />
          <button
            type="button"
            data-testid="agenda-new-btn"
            onClick={() => setCreating(new Date())}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            + Novo compromisso
          </button>
        </div>
      }
    >
      <div className="bg-surface border border-border rounded-[10px] p-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          {/* Switcher de visão: Dia | Semana | Mês */}
          <div
            role="group"
            aria-label="Visão da agenda"
            className="inline-flex rounded-md border border-border-strong overflow-hidden"
          >
            {VISOES.map((v) => (
              <button
                key={v.valor}
                type="button"
                data-testid={`agenda-visao-${v.valor}`}
                aria-pressed={visao === v.valor}
                onClick={() => mudarVisao(v.valor)}
                className={`px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px] ${
                  visao === v.valor
                    ? 'bg-primary text-primary-contrast font-semibold'
                    : 'bg-surface text-text'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              data-testid={visao === 'semana' ? 'agenda-prev-week' : `agenda-${visao}-prev`}
              onClick={() => navegar(-1)}
              className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
            >
              {visao === 'dia' ? '‹ Dia anterior' : visao === 'mes' ? '‹ Mês anterior' : '‹ Semana anterior'}
            </button>
            <button
              type="button"
              data-testid="agenda-today"
              onClick={() => setDataRef(new Date())}
              className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
            >
              Hoje
            </button>
            <button
              type="button"
              data-testid={visao === 'semana' ? 'agenda-next-week' : `agenda-${visao}-next`}
              onClick={() => navegar(1)}
              className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
            >
              {visao === 'dia' ? 'Próximo dia ›' : visao === 'mes' ? 'Próximo mês ›' : 'Próxima semana ›'}
            </button>
          </div>
          <div className="text-[13px] text-muted" data-testid="agenda-range-label">
            {visao === 'dia' && fmtDiaCompleto(dataRef)}
            {visao === 'semana' && (
              <>
                Semana de {weekStart.toLocaleDateString('pt-BR')} a{' '}
                {addDays(weekStart, 6).toLocaleDateString('pt-BR')}
              </>
            )}
            {visao === 'mes' && fmtMesAno(dataRef)}
          </div>
          <Select
            data-testid="agenda-filter-tipo"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            style={{ maxWidth: 180 }}
          >
            <option value="">Todos os tipos</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPO_ICON[t]} {t}
              </option>
            ))}
          </Select>
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          {visao === 'semana' && (
            <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
              {/* Mobile: dias empilhados (1 coluna, lista vertical) — a grade de 7×140px
                  não cabe em 360px. Desktop (md:): grade semanal com scroll horizontal. */}
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[repeat(7,minmax(140px,1fr))] md:overflow-x-auto">
                {days.map((d) => (
                  <DayColumn
                    key={keyDia(d)}
                    day={d}
                    isToday={sameDay(d, today)}
                    items={itemsByDay.get(keyDia(d)) ?? []}
                    onNew={() => setCreating(sugestaoHorario(d))}
                    onItemClick={setEditing}
                  />
                ))}
              </div>
            </DndContext>
          )}
          {visao === 'dia' && (
            <VisaoDiaria
              day={dataRef}
              isToday={sameDay(dataRef, today)}
              items={itemsByDay.get(keyDia(dataRef)) ?? []}
              onNew={() => setCreating(sugestaoHorario(dataRef))}
              onItemClick={setEditing}
            />
          )}
          {visao === 'mes' && (
            <VisaoMensal
              refDate={dataRef}
              today={today}
              itemsByDay={itemsByDay}
              onDayClick={abrirDia}
            />
          )}
        </StateView>
      </div>

      {creating !== null && (
        <AgendaFormModal
          initialDate={creating}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            refetch();
          }}
        />
      )}
      {editing && (
        <AgendaFormModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Drag & drop helpers ─────────────────────────────────────────────

/**
 * DayColumn — droppable target. Aceita AgendaItem sendo arrastado de outro
 * dia. `id` é a data ISO desse dia (key estável + interpretável no handleDragEnd).
 */
function DayColumn({
  day,
  isToday,
  items,
  onNew,
  onItemClick,
}: {
  day: Date;
  isToday: boolean;
  items: AgendaItem[];
  onNew: () => void;
  onItemClick: (it: AgendaItem) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: day.toISOString() });

  return (
    <div
      ref={setNodeRef}
      data-testid={`agenda-day-${day.getDate()}`}
      className="border rounded-md p-2 min-h-[200px]"
      style={{
        background: isOver
          ? 'color-mix(in srgb, var(--primary) 9%, transparent)'
          : isToday
            ? 'color-mix(in srgb, var(--primary) 3%, transparent)'
            : 'var(--bg-alt)',
        borderColor: isOver ? 'var(--primary)' : isToday ? 'var(--primary)' : 'var(--border)',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <header
        className="flex justify-between items-center mb-2 text-[12px] font-semibold"
        style={{ color: isToday ? 'var(--primary)' : 'var(--text)' }}
      >
        <span>{fmtDay(day)}</span>
        <button
          type="button"
          onClick={onNew}
          className="bg-transparent border-none text-muted cursor-pointer text-base leading-none p-0"
          aria-label="Adicionar compromisso"
          title="Adicionar compromisso"
        >
          +
        </button>
      </header>
      {items.length === 0 && (
        <p className="text-[11px] text-muted m-0 text-center py-2">
          Livre
        </p>
      )}
      <ul className="list-none p-0 m-0 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.id}>
            <DraggableItem item={it} onClick={() => onItemClick(it)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * DraggableItem — botão (mantém click=edit) que também é draggable.
 * PointerSensor com distance:8 garante que click-curto edita, drag-longo
 * move pra outro dia.
 */
function DraggableItem({
  item,
  onClick,
}: {
  item: AgendaItem;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    borderLeft: `3px solid ${TIPO_COLOR[item.tipo]}`,
    cursor: isDragging ? 'grabbing' : 'grab',
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
    transition: isDragging ? 'none' : 'opacity 120ms',
  };
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={`agenda-item-${item.id}`}
      onClick={onClick}
      className="block w-full text-left py-1.5 px-2 bg-surface border border-border rounded-[4px] font-[inherit] text-text text-[12px] relative"
      style={style}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-center gap-1">
        <strong>{fmtTime(item.data)}</strong>
        <span className="text-muted">· {item.duracao}min</span>
        {item.googleEventId && (
          <span title="Espelhado no Google Calendar" className="ml-auto text-[10px]">
            📅
          </span>
        )}
      </div>
      <div className="font-medium mt-0.5">{item.titulo}</div>
      {item.cliente?.nome && (
        <div className="text-[11px] text-muted mt-0.5">{item.cliente.nome}</div>
      )}
    </button>
  );
}

// ─── Visão diária ─────────────────────────────────────────────────────

/**
 * VisaoDiaria — lista/timeline vertical dos itens de UM dia, ordenados por
 * hora. Rica o bastante pra operar o dia: horário + duração, tipo (ícone +
 * cor), título, cliente vinculado e observação. Click no item = editar.
 */
function VisaoDiaria({
  day,
  isToday,
  items,
  onNew,
  onItemClick,
}: {
  day: Date;
  isToday: boolean;
  items: AgendaItem[];
  onNew: () => void;
  onItemClick: (it: AgendaItem) => void;
}) {
  return (
    <div
      data-testid="agenda-visao-dia-lista"
      className="border rounded-md p-3 max-w-[720px]"
      style={{
        background: isToday
          ? 'color-mix(in srgb, var(--primary) 3%, transparent)'
          : 'var(--bg-alt)',
        borderColor: isToday ? 'var(--primary)' : 'var(--border)',
      }}
    >
      <header
        className="flex justify-between items-center mb-3 text-[13px] font-semibold"
        style={{ color: isToday ? 'var(--primary)' : 'var(--text)' }}
      >
        <span>{fmtDiaCompleto(day)}</span>
        <button
          type="button"
          data-testid="agenda-dia-add"
          onClick={onNew}
          className="bg-transparent border-none text-muted cursor-pointer text-lg leading-none p-0"
          aria-label="Adicionar compromisso"
          title="Adicionar compromisso"
        >
          +
        </button>
      </header>
      {items.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[13px] text-muted m-0 mb-3">Nenhum compromisso neste dia.</p>
          <button
            type="button"
            onClick={onNew}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            + Agendar às {labelHorario(day)}
          </button>
        </div>
      )}
      <ul className="list-none p-0 m-0 flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              data-testid={`agenda-item-${it.id}`}
              onClick={() => onItemClick(it)}
              className="w-full text-left flex gap-3 items-start bg-surface border border-border rounded-md py-2.5 px-3 font-[inherit] text-text cursor-pointer"
              style={{ borderLeft: `3px solid ${TIPO_COLOR[it.tipo]}` }}
            >
              {/* Coluna de horário */}
              <div className="w-[52px] shrink-0">
                <div className="text-[13px] font-semibold">{fmtTime(it.data)}</div>
                <div className="text-[11px] text-muted">{it.duracao}min</div>
              </div>
              {/* Ícone do tipo */}
              <span className="text-base leading-none pt-0.5" title={it.tipo} aria-label={it.tipo}>
                {TIPO_ICON[it.tipo]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium flex items-center gap-1">
                  <span className="truncate">{it.titulo}</span>
                  {it.googleEventId && (
                    <span title="Espelhado no Google Calendar" className="text-[10px] shrink-0">
                      📅
                    </span>
                  )}
                </div>
                {it.cliente?.nome && (
                  <div className="text-[12px] text-muted mt-0.5">{it.cliente.nome}</div>
                )}
                {it.observacao && (
                  <div className="text-[12px] text-muted mt-0.5 line-clamp-2">{it.observacao}</div>
                )}
              </div>
              <span className="text-[11px] text-muted shrink-0 pt-0.5">{it.tipo}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Visão mensal ─────────────────────────────────────────────────────

/**
 * VisaoMensal — grid calendário do mês (7 colunas dom–sáb, linhas conforme
 * o mês). Cada célula: número do dia + até 3 ícones dos tipos + "+N".
 * Dias fora do mês esmaecidos; hoje com destaque primary. Click = visão diária.
 */
function VisaoMensal({
  refDate,
  today,
  itemsByDay,
  onDayClick,
}: {
  refDate: Date;
  today: Date;
  itemsByDay: Map<string, AgendaItem[]>;
  onDayClick: (d: Date) => void;
}) {
  const cels = useMemo(() => gridDoMes(refDate), [refDate]);
  const mes = refDate.getMonth();
  // Cabeçalho dom–sáb derivado da primeira linha do grid (sempre começa no domingo)
  const cabecalho = cels
    .slice(0, 7)
    .map((d) => d.toLocaleDateString('pt-BR', { weekday: 'short' }));

  return (
    <div data-testid="agenda-visao-mes-grid">
      {/* Cabeçalho dos dias da semana — fim de semana em ciano (marca) */}
      <div className="grid grid-cols-7 gap-1.5 mb-2">
        {cabecalho.map((nome, i) => {
          const fds = i === 0 || i === 6;
          return (
            <div
              key={nome}
              className="text-center text-[11px] font-bold uppercase tracking-[0.08em] py-1"
              style={{ color: fds ? 'var(--secondary-hover)' : 'var(--muted)' }}
            >
              {nome.replace('.', '')}
            </div>
          );
        })}
      </div>
      {/* Grade dos dias */}
      <div className="grid grid-cols-7 gap-1.5">
        {cels.map((d) => {
          const foraDoMes = d.getMonth() !== mes;
          const isToday = sameDay(d, today);
          const fds = d.getDay() === 0 || d.getDay() === 6;
          const doDia = itemsByDay.get(keyDia(d)) ?? [];
          const temEvento = doDia.length > 0;
          return (
            <button
              key={keyDia(d)}
              type="button"
              data-testid={`agenda-mes-dia-${keyDia(d)}`}
              onClick={() => onDayClick(d)}
              title={
                temEvento
                  ? `${doDia.length} ${doDia.length === 1 ? 'compromisso' : 'compromissos'}`
                  : undefined
              }
              className="group min-h-[84px] rounded-xl border p-2 text-left flex flex-col gap-1 cursor-pointer font-[inherit] transition-all hover:shadow-md hover:-translate-y-px"
              style={{
                background: isToday
                  ? 'color-mix(in srgb, var(--primary) 12%, var(--surface))'
                  : foraDoMes
                    ? 'transparent'
                    : fds
                      ? 'color-mix(in srgb, var(--secondary) 7%, var(--surface))'
                      : 'var(--surface)',
                borderColor: isToday
                  ? 'var(--primary)'
                  : temEvento
                    ? 'color-mix(in srgb, var(--secondary) 35%, var(--border))'
                    : 'var(--border)',
                opacity: foraDoMes ? 0.4 : 1,
              }}
            >
              <div className="flex items-center justify-between">
                {isToday ? (
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold shadow-sm"
                    style={{ background: 'var(--primary)', color: 'var(--primary-contrast)' }}
                  >
                    {d.getDate()}
                  </span>
                ) : (
                  <span
                    className="text-[13px] font-semibold px-0.5"
                    style={{
                      color: fds && !foraDoMes ? 'var(--secondary-hover)' : 'var(--text)',
                    }}
                  >
                    {d.getDate()}
                  </span>
                )}
                {temEvento && (
                  <span
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
                    style={{
                      background: 'color-mix(in srgb, var(--secondary) 22%, transparent)',
                      color: 'var(--secondary-hover)',
                    }}
                  >
                    {doDia.length}
                  </span>
                )}
              </div>
              {temEvento && (
                <span className="flex items-center gap-0.5 flex-wrap text-[13px] leading-none mt-0.5">
                  {doDia.slice(0, 3).map((it) => (
                    <span
                      key={it.id}
                      title={`${fmtTime(it.data)} · ${it.titulo}`}
                      aria-label={it.tipo}
                    >
                      {TIPO_ICON[it.tipo]}
                    </span>
                  ))}
                  {doDia.length > 3 && (
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                      +{doDia.length - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────

function AgendaFormModal({
  item,
  initialDate,
  onClose,
  onSaved,
}: {
  item?: AgendaItem;
  initialDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(item);
  const [titulo, setTitulo] = useState(item?.titulo ?? '');
  const [data, setData] = useState(toLocalIso(item ? new Date(item.data) : initialDate ?? new Date()));
  const [duracao, setDuracao] = useState(item?.duracao ?? 60);
  const [tipo, setTipo] = useState<AgendaTipo>(item?.tipo ?? 'VISITA');
  const [observacao, setObservacao] = useState(item?.observacao ?? '');
  const [cliente, setCliente] = useState<ClienteOpt | null>(
    item?.cliente ? { id: item.cliente.id, nome: item.cliente.nome } : null,
  );
  const [espelharGoogle, setEspelharGoogle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  // v1.5.0 — Recorrência
  type Recorrencia = 'NENHUMA' | 'DIARIA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'ANUAL';
  const [recorrencia, setRecorrencia] = useState<Recorrencia>('NENHUMA');
  const [recorrenciaOcorrencias, setRecorrenciaOcorrencias] = useState(12);
  const [deleteScope, setDeleteScope] = useState<'this' | 'this_and_future' | 'series'>('this');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (titulo.trim().length === 0) {
      setError('Informe um título pra o compromisso.');
      return;
    }
    if (!data) {
      setError('Informe data e hora.');
      return;
    }
    if (duracao <= 0) {
      setError('Duração precisa ser maior que zero.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      titulo: titulo.trim(),
      data: new Date(data).toISOString(),
      duracao,
      tipo,
      espelharGoogle,
    };
    if (observacao.trim()) payload.observacao = observacao.trim();
    if (cliente) payload.clienteId = cliente.id;
    // v1.5.0 — recorrência só faz sentido em create
    if (!isEdit && recorrencia !== 'NENHUMA') {
      payload.recorrencia = recorrencia;
      payload.recorrenciaOcorrencias = recorrenciaOcorrencias;
    }
    try {
      if (isEdit && item) {
        await api.patch(`/agenda/${item.id}`, payload);
      } else {
        await api.post('/agenda', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ scope: deleteScope }).toString();
      await api.delete(`/agenda/${item.id}?${qs}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao excluir');
    } finally {
      setBusy(false);
    }
  }

  // v1.5.0 — Detecta se este item é parte de série recorrente (parent ou filho)
  const isRecorrente =
    item != null && (item.recorrencia ? item.recorrencia !== 'NENHUMA' : false);

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? 'Editar compromisso' : 'Novo compromisso'}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          {isEdit && !confirmDel && (
            <button
              type="button"
              data-testid="agenda-delete"
              onClick={() => setConfirmDel(true)}
              className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              Excluir
            </button>
          )}
          {isEdit && confirmDel && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
              >
                Voltar
              </button>
              <button
                type="button"
                data-testid="agenda-delete-confirm"
                disabled={busy}
                onClick={doDelete}
                className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
              >
                {busy ? '…' : 'Confirmar'}
              </button>
            </>
          )}
          {!confirmDel && (
            <button
              type="submit"
              form="agenda-form"
              data-testid="agenda-save-btn"
              disabled={busy}
              className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </>
      }
    >
      <form id="agenda-form" onSubmit={submit}>
        <FormField label="Título" htmlFor="ag-tit" required>
          <Input
            id="ag-tit"
            data-testid="agenda-titulo-input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            minLength={1}
            maxLength={200}
            required
            autoFocus
          />
        </FormField>
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
          <FormField label="Quando" htmlFor="ag-data" required>
            <Input
              id="ag-data"
              type="datetime-local"
              data-testid="agenda-data-input"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Duração (min)" htmlFor="ag-dur">
            <Input
              id="ag-dur"
              type="number"
              min={1}
              max={1440}
              value={duracao}
              onChange={(e) => setDuracao(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Tipo" htmlFor="ag-tipo">
            <Select id="ag-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as AgendaTipo)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_ICON[t]} {t}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField label="Cliente (opcional)">
          <AsyncCombobox<ClienteOpt>
            testId="cliente-picker"
            endpoint="/clientes"
            placeholder="Buscar cliente…"
            getLabel={(c) => c.nome}
            getId={(c) => c.id}
            value={cliente}
            onChange={setCliente}
          />
        </FormField>
        <FormField label="Observação" htmlFor="ag-obs">
          <Textarea
            id="ag-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={2000}
            placeholder="Pauta da visita, contexto, lembretes…"
          />
        </FormField>

        {/* v1.5.0 — Recorrência (apenas criar) */}
        {!isEdit && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="🔁 Repetir" htmlFor="ag-rec">
              <Select
                id="ag-rec"
                data-testid="agenda-recorrencia"
                value={recorrencia}
                onChange={(e) => setRecorrencia(e.target.value as Recorrencia)}
              >
                <option value="NENHUMA">Não repetir</option>
                <option value="DIARIA">Diariamente</option>
                <option value="SEMANAL">Semanalmente</option>
                <option value="QUINZENAL">A cada 2 semanas</option>
                <option value="MENSAL">Mensalmente</option>
                <option value="ANUAL">Anualmente</option>
              </Select>
            </FormField>
            {recorrencia !== 'NENHUMA' && (
              <FormField label="Quantas ocorrências" htmlFor="ag-ocor">
                <Input
                  id="ag-ocor"
                  type="number"
                  min={2}
                  max={52}
                  value={recorrenciaOcorrencias}
                  onChange={(e) =>
                    setRecorrenciaOcorrencias(Math.max(2, Math.min(52, Number(e.target.value))))
                  }
                />
              </FormField>
            )}
          </div>
        )}

        {/* v1.5.0 — Escopo de delete em série */}
        {isEdit && isRecorrente && confirmDel && (
          <FormField label="Apagar qual?" htmlFor="ag-del-scope">
            <Select
              id="ag-del-scope"
              data-testid="agenda-delete-scope"
              value={deleteScope}
              onChange={(e) =>
                setDeleteScope(e.target.value as 'this' | 'this_and_future' | 'series')
              }
            >
              <option value="this">Apenas este</option>
              <option value="this_and_future">Este e os próximos</option>
              <option value="series">Toda a série</option>
            </Select>
          </FormField>
        )}
        <label className="flex items-center gap-2 text-[13px] text-muted mt-2">
          <input
            type="checkbox"
            data-testid="agenda-google-checkbox"
            checked={espelharGoogle}
            onChange={(e) => setEspelharGoogle(e.target.checked)}
          />
          Espelhar no Google Calendar (se conectado)
        </label>
        {item?.googleEventId && (
          <p className="text-[12px] text-muted mt-1">
            <span className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] bg-success/12 text-success border border-success/19">
              📅 Já espelhado
            </span>
          </p>
        )}
        {error && (
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
