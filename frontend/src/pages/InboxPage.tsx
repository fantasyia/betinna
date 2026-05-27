import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowLeft,
  Send,
  ChevronDown,
  UserCheck,
  CheckCircle2,
  Inbox as InboxIcon,
  Filter,
  Image as ImageIcon,
  FileText,
  Video,
  Mic,
  Receipt,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { StateView } from '@/components/StateView';
import { useToast } from '@/components/toast';
import { NovoPedidoDialog } from '@/components/NovoPedidoDialog';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ChannelBadge,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Select,
  Tabs,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * InboxPage v2 — design system dark, layout WhatsApp-like.
 *
 * Match com o protótipo HTML/screenshot do usuário:
 *  - Header com título grande + subtítulo de canais
 *  - Search + tabs de canal (Todos/WA/IG/FB/EM/Marketplaces)
 *  - Lista compacta com avatares, channel badges e dot de não-lida
 *  - Chat pane com header sticky e bubble messages
 *  - Mobile: single pane (lista ou thread)
 */

type Canal =
  | 'WHATSAPP'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'EMAIL'
  | 'MARKETPLACE_ML'
  | 'MARKETPLACE_SHOPEE'
  | 'MARKETPLACE_AMAZON'
  | 'MARKETPLACE_TIKTOK';

type ConversationStatus = 'ABERTA' | 'PENDENTE' | 'RESOLVIDA' | 'ARQUIVADA';
type MessageDirection = 'INBOUND' | 'OUTBOUND';
type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'OTHER';

interface Conversation {
  id: string;
  canal: Canal;
  status: ConversationStatus;
  peer: string;
  peerNome?: string | null;
  // Backend usa estes nomes (Prisma schema). Antes o frontend tinha
  // `ultimaMensagem`/`ultimaMensagemEm` errado → tela mostrava sempre
  // "sem mensagens" porque os campos vinham undefined. Fix 2026-05-27.
  ultimaMsgPreview?: string | null;
  ultimaMsgEm?: string | null;
  naoLidas?: number;
  cliente?: { id: string; nome: string } | null;
  atribuido?: { id: string; nome: string } | null;
  /**
   * JSON com metadados canal-específicos. Hoje usado pra avatarUrl
   * (foto de perfil do peer no WhatsApp).
   */
  metadata?: { avatarUrl?: string | null } & Record<string, unknown>;
}

interface Mensagem {
  id: string;
  // Backend usa `conteudo` (Prisma schema). Antes o frontend tinha
  // `texto` errado → bolha aparecia em branco. Fix 2026-05-27.
  conteudo?: string | null;
  direction: MessageDirection;
  tipo: MessageType;
  criadoEm: string;
  autor?: { id: string; nome: string } | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

interface UsuarioMinimo {
  id: string;
  nome: string;
  role: string;
}

const CANAL_LABEL: Record<Canal, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  EMAIL: 'E-mail',
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_AMAZON: 'Amazon',
  MARKETPLACE_TIKTOK: 'TikTok Shop',
};

const STATUS_LABEL: Record<ConversationStatus, string> = {
  ABERTA: 'Aberta',
  PENDENTE: 'Pendente',
  RESOLVIDA: 'Resolvida',
  ARQUIVADA: 'Arquivada',
};

const STATUS_VARIANT: Record<ConversationStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  ABERTA: 'info',
  PENDENTE: 'warning',
  RESOLVIDA: 'success',
  ARQUIVADA: 'neutral',
};

const POLL_INTERVAL_MS = 10_000;

function fmtRelative(d: string | null | undefined): string {
  if (!d) return '';
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return '';
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 60) return 'agora';
  if (secs < 3600) return `${Math.floor(secs / 60)}min`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 172800) return 'ontem';
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function fmtTime(d: string) {
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

function fmtHHMM(d: string) {
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d;
  }
}

// ─── Page principal ─────────────────────────────────────────────────

export default function InboxPage() {
  const [canalTab, setCanalTab] = useState<string>('todos');
  const [status, setStatus] = useState<string>('');
  const [filterMeu, setFilterMeu] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pollBump, setPollBump] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setPollBump((b) => b + 1), POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, []);

  const canal = useMemo(() => {
    const map: Record<string, Canal | ''> = {
      todos: '',
      wa: 'WHATSAPP',
      ig: 'INSTAGRAM',
      fb: 'FACEBOOK',
      em: 'EMAIL',
      ml: 'MARKETPLACE_ML',
      shp: 'MARKETPLACE_SHOPEE',
      amz: 'MARKETPLACE_AMAZON',
      tt: 'MARKETPLACE_TIKTOK',
    };
    return map[canalTab] ?? '';
  }, [canalTab]);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ limit: '40', _t: String(pollBump) });
    if (canal) qs.set('canal', canal);
    if (status) qs.set('status', status);
    if (filterMeu === 'meu') qs.set('meu', 'true');
    if (filterMeu === 'nao_atribuidas') qs.set('naoAtribuidas', 'true');
    if (search.trim()) qs.set('search', search.trim());
    return `/inbox?${qs.toString()}`;
  }, [canal, status, filterMeu, search, pollBump]);

  const {
    data: pageResp,
    loading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse<Conversation>>(listPath);

  const isMobile = useIsMobile();

  useEffect(() => {
    if (!selectedId && pageResp && pageResp.data.length > 0 && !isMobile) {
      setSelectedId(pageResp.data[0]!.id);
    }
  }, [pageResp, selectedId, isMobile]);

  const showList = !isMobile || selectedId === null;
  const showThread = !isMobile || selectedId !== null;

  return (
    <PageLayout
      title="Inbox unificada"
      description="WhatsApp · Instagram · Facebook · E-mail · Marketplaces"
    >
      <AtendimentoTabs />
      <div
        className={cn(
          'grid gap-3',
          isMobile ? 'grid-cols-1' : 'grid-cols-[minmax(320px,380px)_1fr]',
        )}
        style={{
          height: isMobile ? 'calc(100vh - 130px)' : 'calc(100vh - 170px)',
          minHeight: 500,
        }}
      >
        {/* ── Lista de conversas ───────────────────────────── */}
        {showList && (
          <Card
            padding="none"
            className="flex flex-col overflow-hidden"
          >
            {/* Search + tabs */}
            <div className="p-3 border-b border-border flex flex-col gap-2.5">
              <Input
                leftIcon={<Search />}
                placeholder="Buscar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Tabs
                items={[
                  { value: 'todos', label: 'Todos' },
                  { value: 'wa', label: 'WA' },
                  { value: 'ig', label: 'IG' },
                  { value: 'fb', label: 'FB' },
                  { value: 'em', label: 'EM' },
                ]}
                value={canalTab}
                onChange={setCanalTab}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  data-testid="inbox-status"
                  size="sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Todos status</option>
                  {(Object.keys(STATUS_LABEL) as ConversationStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
                <Select
                  data-testid="inbox-meu"
                  size="sm"
                  value={filterMeu}
                  onChange={(e) => setFilterMeu(e.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="meu">Minhas</option>
                  <option value="nao_atribuidas">Não atribuídas</option>
                </Select>
              </div>
            </div>

            {/* Lista scrollable. Polling roda silenciosamente em background
                (a cada POLL_INTERVAL_MS) — sem indicador visual pra não distrair. */}
            <div className="flex-1 overflow-y-auto">
              <StateView
                loading={loading && !pageResp}
                error={error}
                empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
                emptyMessage="Nenhuma conversa nesse filtro."
                onRetry={refetch}
              >
                {pageResp && (
                  <ul className="flex flex-col">
                    {pageResp.data.map((c) => (
                      <ConversationItem
                        key={c.id}
                        conv={c}
                        active={c.id === selectedId}
                        onClick={() => setSelectedId(c.id)}
                      />
                    ))}
                  </ul>
                )}
              </StateView>
            </div>
          </Card>
        )}

        {/* ── Thread ────────────────────────────────────── */}
        {showThread && (
          <Card padding="none" className="flex flex-col overflow-hidden">
            {selectedId ? (
              <ConversationThread
                key={selectedId}
                id={selectedId}
                pollBump={pollBump}
                onChanged={refetch}
                onBack={isMobile ? () => setSelectedId(null) : undefined}
              />
            ) : (
              <EmptyState
                size="lg"
                icon={<InboxIcon />}
                title="Selecione uma conversa"
                description="Escolha uma conversa na lista pra ver o histórico e responder."
                className="flex-1 border-0 bg-transparent"
              />
            )}
          </Card>
        )}
      </div>
    </PageLayout>
  );
}

// ─── Conversation item (linha da lista) ─────────────────────────────

function ConversationItem({
  conv,
  active,
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const name = conv.cliente?.nome ?? conv.peerNome ?? conv.peer;
  const unread = (conv.naoLidas ?? 0) > 0;

  return (
    <li>
      <button
        type="button"
        data-testid={`conv-card-${conv.id}`}
        onClick={onClick}
        className={cn(
          'w-full text-left px-3 py-3 flex items-start gap-3',
          'border-b border-border last:border-b-0',
          'transition-colors duration-100',
          active
            ? 'bg-surface-hover'
            : 'bg-transparent hover:bg-surface-hover/60',
          'relative',
        )}
      >
        {/* Indicador lateral âmbar quando ativo */}
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-r bg-primary"
          />
        )}

        <Avatar name={name} src={conv.metadata?.avatarUrl ?? undefined} size="md" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {unread && (
                <span
                  aria-label="Não lida"
                  className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                />
              )}
              <strong
                className={cn(
                  'truncate text-sm tracking-tight',
                  unread ? 'text-text font-semibold' : 'text-text font-medium',
                )}
              >
                {name}
              </strong>
              <ChannelBadge canal={conv.canal} size="sm" />
            </div>
            <span
              className={cn(
                'text-[11px] shrink-0 tabular',
                unread ? 'text-primary font-semibold' : 'text-muted',
              )}
            >
              {fmtRelative(conv.ultimaMsgEm)}
            </span>
          </div>

          <div
            className={cn(
              'text-xs truncate',
              unread ? 'text-text-subtle' : 'text-muted',
            )}
          >
            {conv.ultimaMsgPreview ?? <em className="text-muted-light">sem mensagens</em>}
          </div>

          {(conv.status !== 'ABERTA' || conv.atribuido || (conv.naoLidas ?? 0) > 1) && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {conv.status !== 'ABERTA' && (
                <Badge variant={STATUS_VARIANT[conv.status]} size="sm">
                  {STATUS_LABEL[conv.status]}
                </Badge>
              )}
              {conv.atribuido && (
                <span className="text-[10px] text-muted truncate">
                  · {conv.atribuido.nome}
                </span>
              )}
              {(conv.naoLidas ?? 0) > 1 && (
                <span
                  data-testid={`conv-unread-${conv.id}`}
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-primary-contrast text-[10px] font-bold tabular"
                >
                  {conv.naoLidas}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

// ─── Thread (chat pane) ────────────────────────────────────────────

function ConversationThread({
  id,
  pollBump,
  onChanged,
  onBack,
}: {
  id: string;
  pollBump: number;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const detailPath = useMemo(() => `/inbox/${id}?_t=${pollBump}`, [id, pollBump]);
  const msgsPath = useMemo(
    () => `/inbox/${id}/mensagens?limit=80&_t=${pollBump}`,
    [id, pollBump],
  );

  const conv = useApiQuery<Conversation>(detailPath);
  // Backend retorna Message[] direto (não { data: [] }) — fix 2026-05-27.
  const msgs = useApiQuery<Mensagem[]>(msgsPath);

  const [resposta, setResposta] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [atribuirOpen, setAtribuirOpen] = useState(false);
  const [criarPedido, setCriarPedido] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs.data]);

  const lastMarkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conv.data) return;
    if (lastMarkRef.current === id && (conv.data.naoLidas ?? 0) === 0) return;
    lastMarkRef.current = id;
    void api.post(`/inbox/${id}/marcar-lida`).catch(() => {});
  }, [conv.data, id]);

  async function enviar() {
    const texto = resposta.trim();
    if (!texto) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/inbox/${id}/responder`, { texto });
      setResposta('');
      msgs.refetch();
      conv.refetch();
      onChanged();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Falha ao enviar');
    } finally {
      setSending(false);
    }
  }

  async function mudarStatus(novo: ConversationStatus) {
    try {
      await api.patch(`/inbox/${id}/status`, { status: novo });
      toast.success('Status atualizado');
      conv.refetch();
      onChanged();
      setStatusOpen(false);
    } catch (err) {
      toast.error('Falha ao mudar status', err instanceof ApiError ? err.message : undefined);
    }
  }

  const c = conv.data;
  const messages = msgs.data ?? [];
  const lockedCompose = c && (c.status === 'RESOLVIDA' || c.status === 'ARQUIVADA');

  return (
    <>
      {/* Thread header */}
      <header className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-alt">
        {c ? (
          <>
            {onBack && (
              <IconButton
                aria-label="Voltar para lista"
                variant="ghost"
                size="md"
                icon={<ArrowLeft />}
                onClick={onBack}
                data-testid="inbox-back-btn"
              />
            )}
            <Avatar
              name={c.cliente?.nome ?? c.peerNome ?? c.peer}
              src={c.metadata?.avatarUrl ?? undefined}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <strong className="text-sm tracking-tight truncate text-text">
                  {c.cliente?.nome ?? c.peerNome ?? c.peer}
                </strong>
                <ChannelBadge canal={c.canal} size="sm" />
              </div>
              <div className="text-[11px] text-muted truncate">
                {c.peer && (c.cliente?.nome || c.peerNome) ? c.peer : CANAL_LABEL[c.canal]}
              </div>
            </div>
            {c.cliente?.id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="inbox-criar-pedido-btn"
                onClick={() => setCriarPedido(true)}
                leftIcon={<Receipt className="h-3.5 w-3.5" />}
                title="Criar pedido pra este cliente"
              >
                Pedido
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="inbox-status-btn"
              onClick={() => setStatusOpen(true)}
              rightIcon={<ChevronDown className="h-3 w-3" />}
            >
              <Badge variant={STATUS_VARIANT[c.status]} size="sm">
                {STATUS_LABEL[c.status]}
              </Badge>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="inbox-atribuir-btn"
              onClick={() => setAtribuirOpen(true)}
              leftIcon={<UserCheck className="h-3.5 w-3.5" />}
            >
              {c.atribuido ? c.atribuido.nome : 'Atribuir'}
            </Button>
          </>
        ) : (
          <span className="text-muted text-sm">Carregando…</span>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-bg flex flex-col gap-2">
        <StateView
          loading={msgs.loading && messages.length === 0}
          error={msgs.error}
          empty={!msgs.loading && !msgs.error && messages.length === 0}
          emptyMessage="Sem mensagens nesta conversa ainda."
          onRetry={msgs.refetch}
        >
          {/* Backend retorna 'desc' (novas primeiro) por causa do cursor de
              paginação (`antesDe`). UI inverte pra ordem cronológica clássica
              de chat: antigas em cima, novas embaixo. */}
          {[...messages].reverse().map((m, i, arr) => {
            const prev = i > 0 ? arr[i - 1] : null;
            const showAuthor =
              !prev || prev.direction !== m.direction || prev.autor?.id !== m.autor?.id;
            return <MessageBubble key={m.id} msg={m} showAuthor={!!showAuthor} />;
          })}
          <div ref={endRef} />
        </StateView>
      </div>

      {/* Compose */}
      {c && !lockedCompose && (
        <div className="px-4 py-3 border-t border-border bg-bg-alt">
          <div className="flex items-end gap-2">
            <Textarea
              data-testid="inbox-compose"
              placeholder="Digite sua resposta…"
              value={resposta}
              onChange={(e) => setResposta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              className="min-h-[44px] max-h-32 resize-none"
              maxLength={4096}
            />
            <Button
              type="button"
              data-testid="inbox-send-btn"
              disabled={sending || resposta.trim().length === 0}
              loading={sending}
              onClick={enviar}
              size="md"
              leftIcon={!sending ? <Send className="h-3.5 w-3.5" /> : undefined}
            >
              Enviar
            </Button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-muted">
              {sendError ? (
                <span className="text-danger">{sendError}</span>
              ) : (
                <>⌘/Ctrl + Enter</>
              )}
            </span>
            <span className="text-[11px] text-muted tabular">
              {resposta.length}/4096
            </span>
          </div>
        </div>
      )}

      {c && lockedCompose && (
        <div className="px-4 py-3 border-t border-border bg-bg-alt text-center">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
            <CheckCircle2 className="h-4 w-4" />
            Conversa {STATUS_LABEL[c.status].toLowerCase()}. Reabra pra responder.
          </span>
        </div>
      )}

      {statusOpen && c && (
        <StatusModal current={c.status} onClose={() => setStatusOpen(false)} onPick={mudarStatus} />
      )}
      {atribuirOpen && c && (
        <AtribuirModal
          conversaId={id}
          atribuidoAtual={c.atribuido ?? null}
          onClose={() => setAtribuirOpen(false)}
          onDone={() => {
            setAtribuirOpen(false);
            conv.refetch();
            onChanged();
          }}
        />
      )}
      {criarPedido && c?.cliente?.id && (
        <NovoPedidoDialog
          open
          clientePreSelecionado={{
            id: c.cliente.id,
            nome: c.cliente.nome,
          }}
          onClose={() => setCriarPedido(false)}
          onCreated={(pedidoId) => {
            setCriarPedido(false);
            toast.success('Pedido criado a partir da conversa');
            navigate(`/pedidos/${pedidoId}`);
          }}
        />
      )}
    </>
  );
}

// ─── Message bubble ──────────────────────────────────────────────

/**
 * Renderiza imagem de uma mensagem buscando a URL temporária do backend
 * (signed URL Supabase com TTL ~7 dias). Endpoint: GET /inbox/messages/:id/media
 */
function MessageMediaImage({ msgId }: { msgId: string }) {
  const { data, loading, error } = useApiQuery<{ url: string; mime: string | null }>(
    `/inbox/messages/${msgId}/media`,
  );
  if (loading) {
    return (
      <div
        data-testid={`msg-img-loading-${msgId}`}
        className="h-32 w-48 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="text-xs text-muted italic flex items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5" />
        Imagem indisponível
      </div>
    );
  }
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer">
      <img
        src={data.url}
        alt="Imagem da mensagem"
        data-testid={`msg-img-${msgId}`}
        className="max-w-[300px] max-h-[300px] rounded border border-border object-contain block"
        loading="lazy"
      />
    </a>
  );
}

function MessageBubble({ msg, showAuthor }: { msg: Mensagem; showAuthor: boolean }) {
  const outbound = msg.direction === 'OUTBOUND';
  const MediaIcon = msg.tipo === 'IMAGE'
    ? ImageIcon
    : msg.tipo === 'VIDEO'
      ? Video
      : msg.tipo === 'AUDIO'
        ? Mic
        : msg.tipo === 'DOCUMENT'
          ? FileText
          : null;

  return (
    <div
      data-testid={`msg-${msg.id}`}
      className={cn('flex', outbound ? 'justify-end' : 'justify-start')}
    >
      <div className="flex flex-col gap-0.5 max-w-[78%]">
        {showAuthor && msg.autor?.nome && (
          <span
            className={cn(
              'text-[10px] text-muted px-1',
              outbound ? 'text-right' : 'text-left',
            )}
          >
            {msg.autor.nome}
          </span>
        )}
        <div
          className={cn(
            'px-3 py-2 text-sm leading-relaxed',
            'border',
            outbound
              ? 'bg-primary/10 text-text border-primary/20 rounded-2xl rounded-br-sm'
              : 'bg-surface text-text border-border rounded-2xl rounded-bl-sm',
          )}
        >
          {msg.tipo !== 'TEXT' && MediaIcon && !(msg.tipo === 'IMAGE' && msg.mediaUrl) && (
            <div className="flex items-center gap-1.5 mb-1 text-xs text-muted">
              <MediaIcon className="h-3.5 w-3.5" />
              <span className="lowercase">{msg.tipo}</span>
              {msg.mediaMime && <span className="text-muted-light">· {msg.mediaMime}</span>}
            </div>
          )}
          {msg.tipo === 'IMAGE' && msg.mediaUrl && <MessageMediaImage msgId={msg.id} />}
          {/* Esconde placeholder "[imagem]" quando a imagem real está renderizada acima */}
          {msg.conteudo && !(msg.tipo === 'IMAGE' && msg.mediaUrl && msg.conteudo === '[imagem]') && (
            <p className="m-0 whitespace-pre-wrap">{msg.conteudo}</p>
          )}
        </div>
        <span
          className={cn(
            'text-[10px] text-muted px-1 tabular',
            outbound ? 'text-right' : 'text-left',
          )}
          title={fmtTime(msg.criadoEm)}
        >
          {fmtHHMM(msg.criadoEm)}
        </span>
      </div>
    </div>
  );
}

// ─── Modals ──────────────────────────────────────────────────

function StatusModal({
  current,
  onClose,
  onPick,
}: {
  current: ConversationStatus;
  onClose: () => void;
  onPick: (s: ConversationStatus) => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Mudar status da conversa" size="sm">
      <div className="flex flex-col gap-2">
        {(Object.keys(STATUS_LABEL) as ConversationStatus[])
          .filter((s) => s !== current)
          .map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`status-${s}`}
              onClick={() => onPick(s)}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-md',
                'bg-surface border border-border hover:bg-surface-hover hover:border-border-strong',
                'transition-colors flex items-center gap-3',
              )}
            >
              <Badge variant={STATUS_VARIANT[s]}>{STATUS_LABEL[s]}</Badge>
            </button>
          ))}
      </div>
    </Dialog>
  );
}

function AtribuirModal({
  conversaId,
  atribuidoAtual,
  onClose,
  onDone,
}: {
  conversaId: string;
  atribuidoAtual: { id: string; nome: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: usersResp } = useApiQuery<PaginatedResponse<UsuarioMinimo>>(
    '/users?limit=100&status=ATIVO',
  );
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  async function atribuir(userId: string | null) {
    setBusy(true);
    try {
      await api.patch(`/inbox/${conversaId}/atribuir`, { atribuidoId: userId });
      toast.success(userId ? 'Conversa atribuída' : 'Atribuição removida');
      onDone();
    } catch (err) {
      toast.error('Falha ao atribuir', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  const users = (usersResp?.data ?? []).filter((u) =>
    u.nome.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open onClose={onClose} title="Atribuir conversa" size="sm">
      <div className="flex flex-col gap-3">
        <Input
          leftIcon={<Search />}
          placeholder="Buscar usuário…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
          {atribuidoAtual && (
            <button
              type="button"
              data-testid="atribuir-ninguem"
              disabled={busy}
              onClick={() => atribuir(null)}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-left',
                'bg-surface border border-border text-danger',
                'hover:bg-danger/10 hover:border-danger/30 transition-colors',
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              Remover atribuição
            </button>
          )}
          {users.map((u) => {
            const isCurrent = u.id === atribuidoAtual?.id;
            return (
              <button
                key={u.id}
                type="button"
                data-testid={`atribuir-user-${u.id}`}
                disabled={busy || isCurrent}
                onClick={() => atribuir(u.id)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-left',
                  'bg-surface border border-border',
                  'hover:bg-surface-hover hover:border-border-strong transition-colors',
                  isCurrent && 'opacity-60 cursor-not-allowed',
                )}
              >
                <Avatar name={u.nome} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text truncate">{u.nome}</div>
                  <div className="text-[11px] text-muted">{u.role}</div>
                </div>
                {isCurrent && <Badge variant="success" size="sm">Atual</Badge>}
              </button>
            );
          })}
          {users.length === 0 && (
            <p className="text-muted text-sm m-0 py-4 text-center">
              {usersResp ? 'Nenhum usuário encontrado.' : 'Carregando usuários…'}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
