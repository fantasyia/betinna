import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
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
import { StateView } from '@/components/StateView';
import { Avatar, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { statusPrazo, type KBoardCompleto, type KEtiqueta, type KUsuarioResumo } from './kanban-types';

// ─── ★ Calendário ───────────────────────────────────────────────────────

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

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Dia local (YYYY-MM-DD) de um ISO — agrupa os itens por célula. */
function diaLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarioView({
  board,
  onAbrirCard,
  onMudou,
}: {
  board: KBoardCompleto;
  onAbrirCard: (id: string) => void;
  onMudou: () => void;
}) {
  const toast = useToast();
  const hoje = new Date();
  const [mes, setMes] = useState(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`,
  );
  const { data, loading, error, refetch } = useApiQuery<{
    cards: CalCard[];
    itensChecklist: CalItem[];
  }>(`/kanban/boards/${board.id}/calendario?mes=${mes}`);

  // staleTime global = 60s; a view precisa refletir mudanças feitas no quadro
  // segundos atrás → revalida ao montar
  useEffect(() => {
    refetch();
  }, [refetch]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [ano, mesNum] = mes.split('-').map(Number);
  const semanas = useMemo(() => {
    const primeiro = new Date(ano, mesNum - 1, 1);
    const dias: Date[] = [];
    // começa no domingo da semana do dia 1
    const inicio = new Date(primeiro);
    inicio.setDate(1 - primeiro.getDay());
    for (let i = 0; i < 42; i++) {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      dias.push(d);
    }
    // corta a última linha se for toda de outro mês
    const linhas: Date[][] = [];
    for (let i = 0; i < 6; i++) {
      const linha = dias.slice(i * 7, i * 7 + 7);
      if (i >= 4 && linha.every((d) => d.getMonth() !== mesNum - 1)) break;
      linhas.push(linha);
    }
    return linhas;
  }, [ano, mesNum]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, { cards: CalCard[]; itens: CalItem[] }>();
    for (const c of data?.cards ?? []) {
      const k = diaLocal(c.dataEntrega);
      const v = mapa.get(k) ?? { cards: [], itens: [] };
      v.cards.push(c);
      mapa.set(k, v);
    }
    for (const i of data?.itensChecklist ?? []) {
      const k = diaLocal(i.dataEntrega);
      const v = mapa.get(k) ?? { cards: [], itens: [] };
      v.itens.push(i);
      mapa.set(k, v);
    }
    return mapa;
  }, [data]);

  function mudarMes(delta: number) {
    const d = new Date(ano, mesNum - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  /** Soltar card em outro dia = mudar dataEntrega (meio-dia local do novo dia). */
  function onDragEnd(ev: DragEndEvent) {
    const cardId = String(ev.active.id).replace('calcard:', '');
    const diaDestino = ev.over ? String(ev.over.id).replace('caldia:', '') : null;
    if (!diaDestino || !cardId) return;
    const card = data?.cards.find((c) => c.id === cardId);
    if (!card || diaLocal(card.dataEntrega) === diaDestino) return;
    void api
      .patch(`/kanban/cards/${cardId}`, { dataEntrega: `${diaDestino}T12:00:00.000Z` })
      .then(() => {
        refetch();
        onMudou();
      })
      .catch((err) => toast.error(apiErrorMessage(err)));
  }

  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <StateView loading={loading && !data} error={error} onRetry={refetch}>
      <div className="flex items-center gap-3 mb-3">
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
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
            const chave = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
            const doMes = dia.getMonth() === mesNum - 1;
            const conteudo = porDia.get(chave);
            return (
              <DiaCelula key={chave} chave={chave} numero={dia.getDate()} apagado={!doMes}>
                {conteudo?.cards.map((c) => (
                  <CardCalendario key={c.id} card={c} onAbrir={() => onAbrirCard(c.id)} />
                ))}
                {conteudo?.itens.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => onAbrirCard(i.checklist.card.id)}
                    title={`Item de "${i.checklist.card.titulo}"`}
                    className={cn(
                      'w-full text-left text-[10px] px-1.5 py-0.5 rounded-[5px] border border-dashed border-border truncate',
                      i.concluido ? 'line-through text-muted' : 'text-text',
                    )}
                  >
                    ☑ {i.texto}
                  </button>
                ))}
              </DiaCelula>
            );
          })}
        </div>
      </DndContext>
      <p className="text-[11px] text-muted mt-2">
        Arraste um card pra outro dia pra mudar a entrega. Itens ☑ são de checklist (clique abre o
        card).
      </p>
    </StateView>
  );
}

function DiaCelula({
  chave,
  numero,
  apagado,
  children,
}: {
  chave: string;
  numero: number;
  apagado: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `caldia:${chave}` });
  return (
    <div
      ref={setNodeRef}
      data-testid={`cal-dia-${chave}`}
      className={cn(
        'bg-surface min-h-20 p-1 flex flex-col gap-0.5',
        apagado && 'opacity-40',
        isOver && 'bg-primary/10',
      )}
    >
      <span className="text-[10px] text-muted">{numero}</span>
      {children}
    </div>
  );
}

function CardCalendario({ card, onAbrir }: { card: CalCard; onAbrir: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `calcard:${card.id}`,
  });
  const cor = card.corCapa ?? card.etiquetas[0]?.etiqueta.cor ?? '#5C88DA';
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      onClick={onAbrir}
      data-testid={`cal-card-${card.id}`}
      style={{
        borderLeft: `3px solid ${cor}`,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
      }}
      className={cn(
        'w-full text-left text-[10px] px-1.5 py-0.5 rounded-[5px] bg-surface-elevated truncate cursor-grab',
        card.concluido && 'line-through text-muted',
        isDragging && 'opacity-50 z-10 relative',
      )}
    >
      {card.titulo}
    </button>
  );
}

// ─── ★ Tabela ───────────────────────────────────────────────────────────

interface TabelaCard {
  id: string;
  titulo: string;
  dataEntrega: string | null;
  concluido: boolean;
  lista: { id: string; nome: string; posicao: number };
  etiquetas: Array<{ etiqueta: KEtiqueta }>;
  membros: Array<{ usuario: KUsuarioResumo }>;
  campoValores: Array<{ campoId: string; valor: unknown }>;
}

type SortDir = 'asc' | 'desc';

export function TabelaView({
  board,
  onAbrirCard,
}: {
  board: KBoardCompleto;
  onAbrirCard: (id: string) => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<TabelaCard[]>(
    `/kanban/boards/${board.id}/tabela`,
  );
  // Revalida ao montar (staleTime global 60s seguraria dados velhos)
  useEffect(() => {
    refetch();
  }, [refetch]);
  const [filtro, setFiltro] = useState('');
  const [sortCol, setSortCol] = useState<string>('lista');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function alternarSort(col: string) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const linhas = useMemo(() => {
    let rows = data ?? [];
    if (filtro) {
      const q = filtro.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.titulo.toLowerCase().includes(q) ||
          r.lista.nome.toLowerCase().includes(q) ||
          r.membros.some((m) => m.usuario.nome.toLowerCase().includes(q)) ||
          r.etiquetas.some((e) => (e.etiqueta.nome ?? '').toLowerCase().includes(q)),
      );
    }
    const valorDe = (r: TabelaCard): string | number => {
      if (sortCol === 'titulo') return r.titulo.toLowerCase();
      if (sortCol === 'lista') return r.lista.posicao;
      if (sortCol === 'prazo') return r.dataEntrega ? new Date(r.dataEntrega).getTime() : Infinity;
      if (sortCol.startsWith('campo:')) {
        const v = r.campoValores.find((c) => c.campoId === sortCol.slice(6))?.valor;
        if (v === null || v === undefined) return '';
        return typeof v === 'number' ? v : String(v).toLowerCase();
      }
      return 0;
    };
    return [...rows].sort((a, b) => {
      const va = valorDe(a);
      const vb = valorDe(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, filtro, sortCol, sortDir]);

  const Th = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <th
      className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-semibold cursor-pointer select-none whitespace-nowrap"
      onClick={() => alternarSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortCol === col &&
          (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  return (
    <StateView
      loading={loading && !data}
      error={error}
      onRetry={refetch}
      empty={(data ?? []).length === 0}
      emptyMessage="Nenhum card no quadro"
    >
      <div className="relative mb-3 w-64">
        <Search className="h-3.5 w-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar tabela…"
          className="pl-8"
          data-testid="tabela-filtro"
        />
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm" data-testid="kanban-tabela">
          <thead className="bg-surface-elevated border-b border-border">
            <tr>
              <Th col="titulo">Título</Th>
              <Th col="lista">Lista</Th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-semibold">
                Membros
              </th>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-semibold">
                Etiquetas
              </th>
              <Th col="prazo">Prazo</Th>
              {board.campos.map((campo) => (
                <Th key={campo.id} col={`campo:${campo.id}`}>
                  {campo.nome}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((r) => {
              const prazo = statusPrazo(r.dataEntrega, r.concluido);
              return (
                <tr
                  key={r.id}
                  className="hover:bg-surface-elevated cursor-pointer"
                  onClick={() => onAbrirCard(r.id)}
                >
                  <td className="px-3 py-2 text-text max-w-64 truncate">{r.titulo}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{r.lista.nome}</td>
                  <td className="px-3 py-2">
                    <span className="flex -space-x-1.5">
                      {r.membros.slice(0, 4).map(({ usuario }) => (
                        <Avatar key={usuario.id} name={usuario.nome} src={usuario.avatar} size="xs" />
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex gap-1">
                      {r.etiquetas.map(({ etiqueta }) => (
                        <span
                          key={etiqueta.id}
                          title={etiqueta.nome ?? undefined}
                          className="h-2.5 w-6 rounded-full inline-block"
                          style={{ background: etiqueta.cor }}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.dataEntrega ? (
                      <span
                        className={cn(
                          'text-xs',
                          prazo === 'vencido' && 'text-red-500',
                          prazo === 'proximo' && 'text-amber-500',
                          prazo === 'concluido' && 'text-emerald-500',
                          prazo === 'normal' && 'text-muted',
                        )}
                      >
                        {new Date(r.dataEntrega).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  {board.campos.map((campo) => {
                    const v = r.campoValores.find((c) => c.campoId === campo.id)?.valor;
                    return (
                      <td key={campo.id} className="px-3 py-2 text-xs text-muted whitespace-nowrap">
                        {v === null || v === undefined
                          ? '—'
                          : campo.tipo === 'checkbox'
                            ? v
                              ? '✓'
                              : '—'
                            : campo.tipo === 'data'
                              ? new Date(String(v)).toLocaleDateString('pt-BR')
                              : String(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </StateView>
  );
}

// ─── ★ Dashboard ────────────────────────────────────────────────────────

interface DashboardData {
  totalCards: number;
  porLista: Array<{ nome: string; total: number }>;
  porMembro: Array<{ id: string; nome: string; total: number }>;
  semMembro: number;
  porEtiqueta: Array<{ id: string; nome: string | null; cor: string; total: number }>;
  vencimento: {
    vencidos: number;
    proximos7dias: number;
    semData: number;
    concluidos: number;
    noPrazo: number;
  };
}

export function DashboardView({ board }: { board: KBoardCompleto }) {
  const { data, loading, error, refetch } = useApiQuery<DashboardData>(
    `/kanban/boards/${board.id}/dashboard`,
  );
  // Revalida ao montar (staleTime global 60s seguraria dados velhos)
  useEffect(() => {
    refetch();
  }, [refetch]);
  if (!data) {
    return <StateView loading={loading} error={error} onRetry={refetch}>{null}</StateView>;
  }

  const venc = [
    { nome: 'Vencidos', total: data.vencimento.vencidos, cor: '#ef4444' },
    { nome: 'Próximos 7 dias', total: data.vencimento.proximos7dias, cor: '#f59e0b' },
    { nome: 'No prazo', total: data.vencimento.noPrazo, cor: '#5C88DA' },
    { nome: 'Sem data', total: data.vencimento.semData, cor: '#838C91' },
    { nome: 'Concluídos', total: data.vencimento.concluidos, cor: '#10b981' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="kanban-dashboard">
      <GraficoBarras
        titulo={`Cards por lista (${data.totalCards} no total)`}
        dados={data.porLista.map((l) => ({ nome: l.nome, total: l.total, cor: board.corFundo }))}
      />
      <GraficoBarras
        titulo="Cards por membro"
        dados={[
          ...data.porMembro.map((m) => ({ nome: m.nome, total: m.total, cor: '#2bcae5' })),
          ...(data.semMembro > 0 ? [{ nome: 'Sem membro', total: data.semMembro, cor: '#838C91' }] : []),
        ]}
      />
      <GraficoBarras
        titulo="Cards por etiqueta"
        dados={data.porEtiqueta.map((e) => ({ nome: e.nome || e.cor, total: e.total, cor: e.cor }))}
        vazio="Nenhuma etiqueta aplicada"
      />
      <GraficoBarras titulo="Cards por vencimento" dados={venc.filter((v) => v.total > 0)} />
    </div>
  );
}

function GraficoBarras({
  titulo,
  dados,
  vazio = 'Sem dados',
}: {
  titulo: string;
  dados: Array<{ nome: string; total: number; cor: string }>;
  vazio?: string;
}) {
  const max = Math.max(...dados.map((d) => d.total), 1);
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">{titulo}</h4>
      {dados.length === 0 ? (
        <p className="text-xs text-muted m-0">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dados.map((d) => (
            <li key={d.nome} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-muted shrink-0" title={d.nome}>
                {d.nome}
              </span>
              <div className="flex-1 h-4 rounded-[4px] bg-surface-elevated overflow-hidden">
                <div
                  className="h-full rounded-[4px] transition-all"
                  style={{ width: `${(d.total / max) * 100}%`, background: d.cor }}
                />
              </div>
              <span className="w-6 text-right font-medium text-text">{d.total}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
