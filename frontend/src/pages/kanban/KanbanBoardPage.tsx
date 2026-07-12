import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Clock,
  Copy,
  CreditCard,
  GripVertical,
  ImageIcon,
  Link2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Tag,
  User,
  X,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Avatar, Button, Dialog, Field, IconButton, Input, Select, Textarea } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import { AtividadeDrawer } from './AtividadeDrawer';
import { CardContextMenu, type CardMenuAcao } from './CardContextMenu';
import { CardModal } from './CardModal';
import { FundoDialog } from './FundoDialog';
import { CalendarioView, DashboardView, TabelaView } from './KanbanViews';
import {
  posicaoEntre,
  progressoChecklist,
  statusPrazo,
  type KBoardCompleto,
  type KCardResumo,
  type KLista,
} from './kanban-types';

/**
 * O quadro (estilo Trello): listas em colunas horizontais, cards arrastáveis
 * entre listas e listas arrastáveis entre si (@dnd-kit), criação inline,
 * atualização OTIMISTA com rollback se a API falhar.
 *
 * IDs de drag: `card:<id>` e `lista:<id>` (um DndContext só pros dois tipos).
 */
export default function KanbanBoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const {
    data: board,
    loading,
    error,
    refetch,
  } = useApiQuery<KBoardCompleto>(boardId ? `/kanban/boards/${boardId}` : null);

  // Snapshot pra rollback quando a API recusar o movimento
  const snapshotRef = useRef<KLista[] | null>(null);
  const [ativo, setAtivo] = useState<{ tipo: 'card' | 'lista'; id: string } | null>(null);
  // Card aberto no modal (clique sem arrastar)
  const [cardAberto, setCardAberto] = useState<string | null>(null);
  // Seção pra abrir expandida no modal (via menu de contexto: etiquetas, capa...)
  const [secaoInicial, setSecaoInicial] = useState<string | null>(null);
  // Menu de contexto (botão direito) sobre um card
  const [menuCard, setMenuCard] = useState<{ card: KCardResumo; x: number; y: number } | null>(
    null,
  );
  const [atividadeAberta, setAtividadeAberta] = useState(false);
  const [fundoAberto, setFundoAberto] = useState(false);
  const [renomearAberto, setRenomearAberto] = useState(false);
  const [nomeEdit, setNomeEdit] = useState('');
  const [descricaoEdit, setDescricaoEdit] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);

  function abrirRenomear() {
    setNomeEdit(board?.nome ?? '');
    setDescricaoEdit(board?.descricao ?? '');
    setRenomearAberto(true);
  }

  async function salvarRenomearBoard() {
    const nome = nomeEdit.trim();
    if (!nome) {
      toast.error('Dê um nome ao quadro');
      return;
    }
    setSalvandoNome(true);
    try {
      await api.patch(`/kanban/boards/${boardId}`, {
        nome,
        descricao: descricaoEdit.trim() || null,
      });
      setRenomearAberto(false);
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSalvandoNome(false);
    }
  }

  // Abre o card no modal. `secao` (opcional) expande direto uma seção — usado
  // pelo menu de contexto (Editar etiquetas/datas/capa/membros/mover).
  function abrirCard(id: string, secao: string | null = null) {
    setSecaoInicial(secao);
    setCardAberto(id);
  }

  // ─── Ações do menu de contexto do card ──────────────────────────────
  async function duplicarCard(card: KCardResumo) {
    try {
      await api.post(`/kanban/cards/${card.id}/duplicar`);
      toast.success('Card duplicado');
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function arquivarCard(card: KCardResumo) {
    try {
      await api.patch(`/kanban/cards/${card.id}`, { arquivado: true });
      toast.success('Card arquivado');
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function copiarLinkCard(card: KCardResumo) {
    const url = `${window.location.origin}/kanban/${boardId}?card=${card.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado');
    } catch {
      toast.error('Não foi possível copiar. Link: ' + url);
    }
  }

  function itensMenuCard(card: KCardResumo): CardMenuAcao[] {
    return [
      { id: 'abrir', label: 'Abrir cartão', icon: <CreditCard />, onClick: () => abrirCard(card.id) },
      { id: 'etiquetas', label: 'Editar etiquetas', icon: <Tag />, onClick: () => abrirCard(card.id, 'etiquetas') },
      { id: 'membros', label: 'Alterar membros', icon: <User />, onClick: () => abrirCard(card.id, 'membros') },
      { id: 'capa', label: 'Alterar capa', icon: <ImageIcon />, onClick: () => abrirCard(card.id, 'capa') },
      { id: 'datas', label: 'Editar datas', icon: <Clock />, onClick: () => abrirCard(card.id, 'datas') },
      { id: 'mover', label: 'Mover', icon: <ArrowRight />, separador: true, onClick: () => abrirCard(card.id, 'mover') },
      { id: 'duplicar', label: 'Copiar cartão', icon: <Copy />, onClick: () => void duplicarCard(card) },
      { id: 'link', label: 'Copiar link', icon: <Link2 />, onClick: () => void copiarLinkCard(card) },
      { id: 'arquivar', label: 'Arquivar', icon: <Archive />, separador: true, danger: true, onClick: () => void arquivarCard(card) },
    ];
  }

  // ★ Alternador de visualização (persistido na URL) + deep-link ?card=
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') ?? 'quadro';
  useEffect(() => {
    const cardParam = searchParams.get('card');
    if (cardParam) {
      setSecaoInicial(null);
      setCardAberto(cardParam);
      const next = new URLSearchParams(searchParams);
      next.delete('card');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Estado local das listas (fonte do drag otimista); re-sincroniza a cada
  // fetch — MAS nunca no meio de um drag (senão o polling "puxa" o card da mão)
  const [listas, setListas] = useState<KLista[]>([]);
  const arrastandoRef = useRef(false);
  arrastandoRef.current = ativo !== null;
  useEffect(() => {
    if (board && !arrastandoRef.current) setListas(board.listas);
  }, [board]);

  // Polling 15s do board (aba visível, sem drag em andamento) — é o que faz
  // os cards "andarem sozinhos" quando o Claude move via MCP. Padrão do
  // projeto: refetch() do TanStack, nunca cache-buster na URL.
  useEffect(() => {
    if (!boardId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !arrastandoRef.current) refetch();
    }, 15_000);
    return () => clearInterval(timer);
  }, [boardId, refetch]);

  // ─── Filtros (client-side, estilo Trello: esconde quem não bate) ────
  const [fTexto, setFTexto] = useState('');
  const [fEtiqueta, setFEtiqueta] = useState('');
  const [fMembro, setFMembro] = useState('');
  const [fVencimento, setFVencimento] = useState('');
  const textoDebounced = useDebouncedValue(fTexto, 250);
  const temFiltro = !!(textoDebounced || fEtiqueta || fMembro || fVencimento);

  const listasVisiveis = useMemo(() => {
    if (!temFiltro) return listas;
    const agora = Date.now();
    const em7dias = agora + 7 * 24 * 60 * 60 * 1000;
    const q = textoDebounced.toLowerCase();
    return listas.map((l) => ({
      ...l,
      cards: l.cards.filter((c) => {
        if (q && !c.titulo.toLowerCase().includes(q) && !(c.descricao ?? '').toLowerCase().includes(q))
          return false;
        if (fEtiqueta && !c.etiquetas.some((e) => e.etiqueta.id === fEtiqueta)) return false;
        if (fMembro && !c.membros.some((m) => m.usuario.id === fMembro)) return false;
        if (fVencimento) {
          const prazo = c.dataEntrega ? new Date(c.dataEntrega).getTime() : null;
          if (fVencimento === 'sem_data' && prazo !== null) return false;
          if (fVencimento === 'vencidos' && (c.concluido || prazo === null || prazo >= agora))
            return false;
          if (
            fVencimento === 'proximos7dias' &&
            (c.concluido || prazo === null || prazo < agora || prazo > em7dias)
          )
            return false;
        }
        return true;
      }),
    }));
  }, [listas, temFiltro, textoDebounced, fEtiqueta, fMembro, fVencimento]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Mobile: segurar 200ms pra arrastar; swipe rápido continua rolando as colunas
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const cardAtivo = useMemo(() => {
    if (ativo?.tipo !== 'card') return null;
    for (const l of listas) {
      const c = l.cards.find((x) => x.id === ativo.id);
      if (c) return c;
    }
    return null;
  }, [ativo, listas]);

  // A signed URL do fundo troca o token a cada poll (re-baixa a imagem à toa).
  // Fixamos a URL enquanto o path estável (imagemFundo) não muda.
  const fundoUrl = useMemo(
    () => board?.imagemFundoUrl ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board?.imagemFundo],
  );

  function parseId(raw: string): { tipo: 'card' | 'lista'; id: string } | null {
    if (raw.startsWith('card:')) return { tipo: 'card', id: raw.slice(5) };
    if (raw.startsWith('lista:')) return { tipo: 'lista', id: raw.slice(6) };
    return null;
  }

  function acharLista(cardId: string, fonte: KLista[]): KLista | undefined {
    return fonte.find((l) => l.cards.some((c) => c.id === cardId));
  }

  function onDragStart(ev: DragStartEvent) {
    const info = parseId(String(ev.active.id));
    if (!info) return;
    snapshotRef.current = listas.map((l) => ({ ...l, cards: [...l.cards] }));
    setAtivo(info);
  }

  /** Preview ao vivo: transfere o card entre listas enquanto arrasta. */
  function onDragOver(ev: DragOverEvent) {
    const a = parseId(String(ev.active.id));
    const o = ev.over ? parseId(String(ev.over.id)) : null;
    if (!a || a.tipo !== 'card' || !o) return;

    setListas((prev) => {
      const deLista = acharLista(a.id, prev);
      const paraLista = o.tipo === 'lista' ? prev.find((l) => l.id === o.id) : acharLista(o.id, prev);
      if (!deLista || !paraLista || deLista.id === paraLista.id) return prev;

      const card = deLista.cards.find((c) => c.id === a.id);
      if (!card) return prev;
      const idxDestino =
        o.tipo === 'card'
          ? paraLista.cards.findIndex((c) => c.id === o.id)
          : paraLista.cards.length;

      return prev.map((l) => {
        if (l.id === deLista.id) return { ...l, cards: l.cards.filter((c) => c.id !== a.id) };
        if (l.id === paraLista.id) {
          const cards = [...l.cards];
          cards.splice(idxDestino, 0, { ...card, listaId: l.id });
          return { ...l, cards };
        }
        return l;
      });
    });
  }

  function onDragEnd(ev: DragEndEvent) {
    const a = parseId(String(ev.active.id));
    const o = ev.over ? parseId(String(ev.over.id)) : null;
    setAtivo(null);
    if (!a) return;

    if (a.tipo === 'lista') {
      moverListaFim(a.id, o);
      return;
    }
    // Soltou o card fora de qualquer droppable: desfaz o preview do onDragOver
    // (senão a transferência entre listas seria comitada sem PATCH).
    if (!o) {
      if (snapshotRef.current) setListas(snapshotRef.current);
      return;
    }
    moverCardFim(a.id, o);
  }

  /** Card: calcula posição final pelo estado local e persiste. */
  function moverCardFim(cardId: string, over: { tipo: string; id: string } | null) {
    const lista = acharLista(cardId, listas);
    if (!lista) return;

    let cards = lista.cards;
    let idx = cards.findIndex((c) => c.id === cardId);

    // Reordenação dentro da mesma lista (onDragOver não mexe nesse caso)
    if (over && over.tipo === 'card' && over.id !== cardId) {
      const idxOver = cards.findIndex((c) => c.id === over.id);
      if (idxOver >= 0 && idx >= 0 && idxOver !== idx) {
        cards = [...cards];
        const [movido] = cards.splice(idx, 1);
        cards.splice(idxOver, 0, movido);
        idx = idxOver;
      }
    }

    const antes = idx > 0 ? cards[idx - 1].posicao : null;
    const depois = idx < cards.length - 1 ? cards[idx + 1].posicao : null;
    const novaPosicao = posicaoEntre(antes, depois);

    const atualizadas = listas.map((l) =>
      l.id === lista.id
        ? {
            ...l,
            cards: cards.map((c) => (c.id === cardId ? { ...c, posicao: novaPosicao } : c)),
          }
        : l,
    );
    setListas(atualizadas);

    // Side-effect FORA do updater (função pura não pode disparar PATCH — duplica em StrictMode).
    void api
      .patch(`/kanban/cards/${cardId}/mover`, { listaId: lista.id, posicao: novaPosicao })
      .then(() => refetch()) // absorve rebalanceamento do servidor
      .catch((err) => {
        if (snapshotRef.current) setListas(snapshotRef.current);
        refetch(); // reconcilia com o servidor (o snapshot pode estar defasado)
        toast.error(`Não foi possível mover o card: ${apiErrorMessage(err)}`);
      });
  }

  /** Lista: reordena horizontalmente e persiste. */
  function moverListaFim(listaId: string, over: { tipo: string; id: string } | null) {
    if (!over || over.id === listaId) return;
    // Soltar a lista sobre um card: destino = a lista dona desse card.
    const destinoId = over.tipo === 'lista' ? over.id : acharLista(over.id, listas)?.id;
    if (!destinoId || destinoId === listaId) return;

    const idxDe = listas.findIndex((l) => l.id === listaId);
    const idxPara = listas.findIndex((l) => l.id === destinoId);
    if (idxDe < 0 || idxPara < 0) return;

    const novas = [...listas];
    const [movida] = novas.splice(idxDe, 1);
    novas.splice(idxPara, 0, movida);

    const idx = novas.findIndex((l) => l.id === listaId);
    const antes = idx > 0 ? novas[idx - 1].posicao : null;
    const depois = idx < novas.length - 1 ? novas[idx + 1].posicao : null;
    const novaPosicao = posicaoEntre(antes, depois);
    novas[idx] = { ...novas[idx], posicao: novaPosicao };
    setListas(novas);

    // Side-effect FORA do updater (função pura não pode disparar PATCH — duplica em StrictMode).
    void api
      .patch(`/kanban/listas/${listaId}/mover`, { posicao: novaPosicao })
      .then(() => refetch())
      .catch((err) => {
        if (snapshotRef.current) setListas(snapshotRef.current);
        refetch(); // reconcilia com o servidor (o snapshot pode estar defasado)
        toast.error(`Não foi possível mover a lista: ${apiErrorMessage(err)}`);
      });
  }

  async function criarLista(nome: string) {
    try {
      await api.post(`/kanban/boards/${boardId}/listas`, { nome });
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function renomearLista(listaId: string, nome: string) {
    const limpo = nome.trim();
    if (!limpo) return;
    // otimista: atualiza o nome na hora
    setListas((prev) => prev.map((l) => (l.id === listaId ? { ...l, nome: limpo } : l)));
    try {
      await api.patch(`/kanban/listas/${listaId}`, { nome: limpo });
      refetch();
    } catch (err) {
      refetch();
      toast.error(apiErrorMessage(err));
    }
  }

  async function criarCard(listaId: string, titulo: string) {
    try {
      await api.post(`/kanban/listas/${listaId}/cards`, { titulo });
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <PageLayout
      title={board?.nome ?? 'Quadro'}
      description={board?.descricao ?? undefined}
      actions={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/kanban')}
          >
            Quadros
          </Button>
          <Button
            variant="ghost"
            leftIcon={<Pencil className="h-4 w-4" />}
            onClick={abrirRenomear}
            data-testid="kanban-renomear-quadro"
          >
            Renomear
          </Button>
          <Button
            variant="ghost"
            leftIcon={<ImageIcon className="h-4 w-4" />}
            onClick={() => setFundoAberto(true)}
            data-testid="kanban-abrir-fundo"
          >
            Fundo
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Activity className="h-4 w-4" />}
            onClick={() => setAtividadeAberta(true)}
            data-testid="kanban-abrir-atividade"
          >
            Atividade
          </Button>
        </div>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {/* faixa com a cor do quadro */}
        <div
          className="h-1.5 rounded-full mb-3"
          style={{ background: board?.corFundo ?? '#0079BF' }}
          aria-hidden
        />

        {/* ★ Alternador de visualização (igual Trello Premium) */}
        <div className="flex items-center gap-1 mb-3 rounded-[10px] border border-border bg-surface-elevated p-1 w-fit">
          {(
            [
              ['quadro', 'Quadro'],
              ['calendario', 'Calendário'],
              ['tabela', 'Tabela'],
              ['dashboard', 'Dashboard'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`kanban-view-${id}`}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                if (id === 'quadro') next.delete('view');
                else next.set('view', id);
                setSearchParams(next, { replace: true });
              }}
              className={cn(
                'px-3 py-1 rounded-[8px] text-xs font-medium transition-colors',
                view === id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'calendario' && board && (
          <CalendarioView board={board} onAbrirCard={abrirCard} onMudou={refetch} />
        )}
        {view === 'tabela' && board && <TabelaView board={board} onAbrirCard={abrirCard} />}
        {view === 'dashboard' && board && <DashboardView board={board} />}

        {view === 'quadro' && (
          <>
        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={fTexto}
              onChange={(e) => setFTexto(e.target.value)}
              placeholder="Filtrar cards…"
              className="pl-8 w-48"
              data-testid="kanban-filtro-texto"
            />
          </div>
          <Select
            value={fEtiqueta}
            onChange={(e) => setFEtiqueta(e.target.value)}
            className="w-36"
            data-testid="kanban-filtro-etiqueta"
          >
            <option value="">Etiqueta: todas</option>
            {(board?.etiquetas ?? []).map((et) => (
              <option key={et.id} value={et.id}>
                {et.nome || et.cor}
              </option>
            ))}
          </Select>
          <Select
            value={fMembro}
            onChange={(e) => setFMembro(e.target.value)}
            className="w-40"
            data-testid="kanban-filtro-membro"
          >
            <option value="">Membro: todos</option>
            {(board?.membros ?? []).map(({ usuario }) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.nome}
              </option>
            ))}
          </Select>
          <Select
            value={fVencimento}
            onChange={(e) => setFVencimento(e.target.value)}
            className="w-44"
            data-testid="kanban-filtro-vencimento"
          >
            <option value="">Vencimento: todos</option>
            <option value="vencidos">Vencidos</option>
            <option value="proximos7dias">Próximos 7 dias</option>
            <option value="sem_data">Sem data</option>
          </Select>
          {temFiltro && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFTexto('');
                setFEtiqueta('');
                setFMembro('');
                setFVencimento('');
              }}
            >
              Limpar
            </Button>
          )}
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setAtivo(null);
            if (snapshotRef.current) setListas(snapshotRef.current);
          }}
        >
          <div
            className={cn(
              'flex gap-3 items-start overflow-x-auto pb-4 min-h-[60vh]',
              (fundoUrl || board?.corFundo) && 'rounded-[10px] p-3',
              fundoUrl && 'bg-cover bg-center',
            )}
            style={{
              backgroundColor: board?.corFundo,
              ...(fundoUrl ? { backgroundImage: `url(${fundoUrl})` } : {}),
            }}
          >
            <SortableContext
              items={listasVisiveis.map((l) => `lista:${l.id}`)}
              strategy={horizontalListSortingStrategy}
            >
              {listasVisiveis.map((lista) => (
                <ListaColuna
                  key={lista.id}
                  lista={lista}
                  onCriarCard={(titulo) => void criarCard(lista.id, titulo)}
                  onAbrirCard={(id) => abrirCard(id)}
                  onContextCard={(e, card) => {
                    e.preventDefault();
                    setMenuCard({ card, x: e.clientX, y: e.clientY });
                  }}
                  onRenomear={(nome) => void renomearLista(lista.id, nome)}
                />
              ))}
            </SortableContext>
            <AdicionarLista onCriar={(nome) => void criarLista(nome)} />
          </div>
          <DragOverlay>
            {cardAtivo ? <CardVisual card={cardAtivo} arrastando /> : null}
          </DragOverlay>
        </DndContext>
          </>
        )}

        {cardAberto && board && (
          <CardModal
            key={`${cardAberto}:${secaoInicial ?? ''}`}
            cardId={cardAberto}
            board={board}
            secaoInicial={secaoInicial}
            onClose={() => {
              setCardAberto(null);
              setSecaoInicial(null);
            }}
            onMudou={refetch}
          />
        )}

        {menuCard && (
          <CardContextMenu
            x={menuCard.x}
            y={menuCard.y}
            itens={itensMenuCard(menuCard.card)}
            onFechar={() => setMenuCard(null)}
          />
        )}

        {boardId && (
          <AtividadeDrawer
            boardId={boardId}
            open={atividadeAberta}
            onClose={() => setAtividadeAberta(false)}
          />
        )}

        {board && (
          <FundoDialog
            board={board}
            open={fundoAberto}
            onClose={() => setFundoAberto(false)}
            onMudou={refetch}
          />
        )}

        <Dialog
          open={renomearAberto}
          onClose={() => setRenomearAberto(false)}
          title="Renomear quadro"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenomearAberto(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void salvarRenomearBoard()}
                loading={salvandoNome}
                data-testid="kanban-renomear-salvar"
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Nome" required>
              <Input
                value={nomeEdit}
                onChange={(e) => setNomeEdit(e.target.value)}
                autoFocus
                data-testid="kanban-renomear-nome"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void salvarRenomearBoard();
                }}
              />
            </Field>
            <Field label="Descrição">
              <Textarea
                value={descricaoEdit}
                onChange={(e) => setDescricaoEdit(e.target.value)}
                rows={2}
                placeholder="Opcional"
              />
            </Field>
          </div>
        </Dialog>
      </StateView>
    </PageLayout>
  );
}

// ─── Coluna (lista) ─────────────────────────────────────────────────────

function ListaColuna({
  lista,
  onCriarCard,
  onAbrirCard,
  onContextCard,
  onRenomear,
}: {
  lista: KLista;
  onCriarCard: (titulo: string) => void;
  onAbrirCard: (cardId: string) => void;
  onContextCard: (e: ReactMouseEvent, card: KCardResumo) => void;
  onRenomear: (nome: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `lista:${lista.id}`,
  });
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(lista.nome);

  function salvar() {
    const limpo = nome.trim();
    if (limpo && limpo !== lista.nome) onRenomear(limpo);
    else setNome(lista.nome);
    setEditando(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'w-[272px] shrink-0 rounded-[10px] bg-surface-elevated border border-border flex flex-col max-h-[calc(100vh-220px)]',
        isDragging && 'opacity-60',
      )}
      data-testid={`kanban-lista-${lista.id}`}
    >
      {/* header: alça de arrasto (grip) + nome editável (clique) + contador */}
      <div className="px-2 py-2 flex items-center justify-between gap-1">
        {editando ? (
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoFocus
            className="h-7 text-sm font-semibold"
            data-testid={`kanban-lista-nome-input-${lista.id}`}
            onBlur={salvar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') salvar();
              if (e.key === 'Escape') {
                setNome(lista.nome);
                setEditando(false);
              }
            }}
          />
        ) : (
          <>
            <span
              className="cursor-grab active:cursor-grabbing text-muted shrink-0"
              {...attributes}
              {...listeners}
              aria-label="Arrastar lista"
            >
              <GripVertical className="h-4 w-4" />
            </span>
            <button
              type="button"
              onClick={() => {
                setNome(lista.nome);
                setEditando(true);
              }}
              className="flex-1 min-w-0 text-left text-sm font-semibold text-text truncate hover:text-primary transition-colors"
              data-testid={`kanban-lista-nome-${lista.id}`}
              title="Clique para renomear"
            >
              {lista.nome}
            </button>
            <span className="text-[11px] text-muted shrink-0">{lista.cards.length}</span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 flex flex-col gap-2 pb-1">
        <SortableContext
          items={lista.cards.map((c) => `card:${c.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {lista.cards.map((card) => (
            <CardSortable
              key={card.id}
              card={card}
              onAbrir={() => onAbrirCard(card.id)}
              onContext={(e) => onContextCard(e, card)}
            />
          ))}
        </SortableContext>
      </div>

      <AdicionarCard onCriar={onCriarCard} />
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────

function CardSortable({
  card,
  onAbrir,
  onContext,
}: {
  card: KCardResumo;
  onAbrir: () => void;
  onContext: (e: ReactMouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card:${card.id}`,
  });
  // dnd-kit não suprime o click sintético que segue o pointerup de um drag.
  // Marcamos que houve arrasto e engolimos o clique seguinte (senão abre o modal).
  const arrastouRef = useRef(false);
  useEffect(() => {
    if (isDragging) arrastouRef.current = true;
  }, [isDragging]);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(isDragging && 'opacity-40')}
      onClick={() => {
        if (arrastouRef.current) {
          arrastouRef.current = false;
          return;
        }
        onAbrir();
      }}
      onContextMenu={onContext}
    >
      <CardVisual card={card} />
    </div>
  );
}

function CardVisual({ card, arrastando }: { card: KCardResumo; arrastando?: boolean }) {
  const prazo = statusPrazo(card.dataEntrega, card.concluido);
  const checklist = progressoChecklist(card);

  return (
    <div
      className={cn(
        'rounded-[10px] bg-surface border border-border p-2.5 cursor-grab active:cursor-grabbing',
        'hover:border-primary/40 transition-colors',
        arrastando && 'shadow-lg rotate-2',
      )}
      data-testid={`kanban-card-${card.id}`}
    >
      {card.corCapa && (
        <div className="h-1.5 rounded-full mb-2 -mt-0.5" style={{ background: card.corCapa }} />
      )}
      {card.etiquetas.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {card.etiquetas.map(({ etiqueta }) => (
            <span
              key={etiqueta.id}
              title={etiqueta.nome ?? undefined}
              className="h-2 w-8 rounded-full inline-block"
              style={{ background: etiqueta.cor }}
            />
          ))}
        </div>
      )}
      <div className="text-sm text-text leading-snug">{card.titulo}</div>

      {(prazo || checklist || card._count.comentarios > 0 || card._count.anexos > 0 || card.membros.length > 0) && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {prazo && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[6px] font-medium',
                prazo === 'concluido' && 'bg-emerald-500/15 text-emerald-500',
                prazo === 'vencido' && 'bg-red-500/15 text-red-500',
                prazo === 'proximo' && 'bg-amber-500/15 text-amber-500',
                prazo === 'normal' && 'bg-surface-elevated text-muted',
              )}
            >
              <Clock className="h-3 w-3" />
              {new Date(card.dataEntrega as string).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
              })}
            </span>
          )}
          {checklist && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[10px] text-muted',
                checklist.feito === checklist.total && 'text-emerald-500',
              )}
            >
              <CheckSquare className="h-3 w-3" />
              {checklist.feito}/{checklist.total}
            </span>
          )}
          {card._count.comentarios > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <MessageSquare className="h-3 w-3" />
              {card._count.comentarios}
            </span>
          )}
          {card._count.anexos > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted">
              <Paperclip className="h-3 w-3" />
              {card._count.anexos}
            </span>
          )}
          {card.membros.length > 0 && (
            <span className="ml-auto flex -space-x-1.5">
              {card.membros.slice(0, 3).map(({ usuario }) => (
                <Avatar key={usuario.id} name={usuario.nome} src={usuario.avatar} size="xs" />
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Criação inline ─────────────────────────────────────────────────────

function AdicionarCard({ onCriar }: { onCriar: (titulo: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState('');

  function salvar() {
    const v = titulo.trim();
    if (!v) return;
    onCriar(v);
    setTitulo('');
    // permanece em edição pra adicionar vários em sequência (padrão Trello)
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        data-testid="kanban-add-card"
        className="m-2 mt-1 px-2 py-1.5 rounded-[8px] text-left text-xs text-muted hover:bg-surface hover:text-text transition-colors inline-flex items-center gap-1"
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar card
      </button>
    );
  }
  return (
    <div className="m-2 mt-1 flex items-center gap-1">
      <Input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Título do card"
        autoFocus
        data-testid="kanban-add-card-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar();
          if (e.key === 'Escape') setEditando(false);
        }}
      />
      <IconButton aria-label="Fechar" icon={<X className="h-4 w-4" />} onClick={() => setEditando(false)} />
    </div>
  );
}

function AdicionarLista({ onCriar }: { onCriar: (nome: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState('');

  function salvar() {
    const v = nome.trim();
    if (!v) return;
    onCriar(v);
    setNome('');
    setEditando(false);
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        data-testid="kanban-add-lista"
        className="w-[272px] shrink-0 rounded-[10px] border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted hover:text-text hover:bg-surface-elevated transition-colors inline-flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" /> Adicionar lista
      </button>
    );
  }
  return (
    <div className="w-[272px] shrink-0 rounded-[10px] bg-surface-elevated border border-border p-2 flex items-center gap-1">
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome da lista"
        autoFocus
        data-testid="kanban-add-lista-input"
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar();
          if (e.key === 'Escape') setEditando(false);
        }}
      />
      <IconButton aria-label="Fechar" icon={<X className="h-4 w-4" />} onClick={() => setEditando(false)} />
    </div>
  );
}
