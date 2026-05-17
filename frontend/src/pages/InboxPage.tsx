import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Select, Textarea } from '@/components/FormField';
import { SearchInput } from '@/components/FilterBar';
import { useToast } from '@/components/toast';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

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
  ultimaMensagem?: string | null;
  ultimaMensagemEm?: string | null;
  naoLidas?: number;
  cliente?: { id: string; nome: string } | null;
  atribuido?: { id: string; nome: string } | null;
}

interface Mensagem {
  id: string;
  texto?: string | null;
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

const CANAL_COLOR: Record<Canal, string> = {
  WHATSAPP: '#22c55e',
  INSTAGRAM: '#e1306c',
  FACEBOOK: '#1877f2',
  EMAIL: '#0891b2',
  MARKETPLACE_ML: '#facc15',
  MARKETPLACE_SHOPEE: '#ee4d2d',
  MARKETPLACE_AMAZON: '#ff9900',
  MARKETPLACE_TIKTOK: '#000',
};

const CANAL_ICON: Record<Canal, string> = {
  WHATSAPP: '💬',
  INSTAGRAM: '📷',
  FACEBOOK: 'f',
  EMAIL: '✉',
  MARKETPLACE_ML: 'ML',
  MARKETPLACE_SHOPEE: 'SP',
  MARKETPLACE_AMAZON: 'AZ',
  MARKETPLACE_TIKTOK: 'TT',
};

const STATUS_COLOR: Record<ConversationStatus, string> = {
  ABERTA: '#0891b2',
  PENDENTE: colors.warning,
  RESOLVIDA: colors.success,
  ARQUIVADA: colors.muted,
};
const STATUS_LABEL: Record<ConversationStatus, string> = {
  ABERTA: 'Aberta',
  PENDENTE: 'Pendente',
  RESOLVIDA: 'Resolvida',
  ARQUIVADA: 'Arquivada',
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
  if (secs < 2592000) return `${Math.floor(secs / 86400)}d`;
  return new Date(d).toLocaleDateString('pt-BR');
}
function fmtTime(d: string) {
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export default function InboxPage() {
  const [canal, setCanal] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [filterMeu, setFilterMeu] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Bump aumenta a cada poll pra forçar refetch dos hooks
  const [pollBump, setPollBump] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setPollBump((b) => b + 1), POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, []);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ limit: '40', _t: String(pollBump) });
    if (canal) qs.set('canal', canal);
    if (status) qs.set('status', status);
    if (filterMeu === 'meu') qs.set('meu', 'true');
    if (filterMeu === 'nao_atribuidas') qs.set('naoAtribuidas', 'true');
    if (search.trim()) qs.set('search', search.trim());
    return `/inbox?${qs.toString()}`;
  }, [canal, status, filterMeu, search, pollBump]);

  const { data: pageResp, loading, error, refetch } =
    useApiQuery<PaginatedResponse<Conversation>>(listPath);

  const isMobile = useIsMobile();

  // Em desktop: auto-seleciona 1ª conversa pra preencher a coluna direita.
  // Em mobile: deixa a lista visível inicialmente (user escolhe o que abrir).
  useEffect(() => {
    if (!selectedId && pageResp && pageResp.data.length > 0 && !isMobile) {
      setSelectedId(pageResp.data[0].id);
    }
  }, [pageResp, selectedId, isMobile]);

  // Em mobile: mostra OU lista OU thread (não ambos).
  // showList: lista visível. showThread: thread visível.
  const showList = !isMobile || selectedId === null;
  const showThread = !isMobile || selectedId !== null;

  return (
    <PageLayout title="Inbox">
      <div
        style={{
          display: 'grid',
          // Mobile: 1 coluna (apenas o painel ativo). Desktop: lista + thread.
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(320px, 380px) 1fr',
          gap: '1rem',
          alignItems: 'stretch',
          height: isMobile ? 'calc(100vh - 140px)' : 'calc(100vh - 200px)',
          minHeight: 500,
        }}
      >
        {/* Lista de conversas — em mobile, só visível quando nenhuma conversa selecionada */}
        {showList && (
        <div
          style={{
            ...card,
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <SearchInput
              value={search}
              onChange={(v) => setSearch(v)}
              placeholder="Buscar conversa…"
            />
            <Select
              data-testid="inbox-canal"
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
            >
              <option value="">Todos os canais</option>
              {(Object.keys(CANAL_LABEL) as Canal[]).map((c) => (
                <option key={c} value={c}>
                  {CANAL_LABEL[c]}
                </option>
              ))}
            </Select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <Select
                data-testid="inbox-status"
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
                value={filterMeu}
                onChange={(e) => setFilterMeu(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="meu">Minhas</option>
                <option value="nao_atribuidas">Não atribuídas</option>
              </Select>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', margin: '0 -0.75rem', padding: '0 0.75rem' }}>
            {/* Refetch silencioso (já tem dados): indicação fininha pro user
                saber que tá atualizando, sem flash de skeleton. */}
            {loading && pageResp && (
              <div
                style={{
                  fontSize: 11,
                  color: colors.muted,
                  padding: '0.25rem 0.5rem',
                  textAlign: 'center',
                  fontStyle: 'italic',
                }}
                data-testid="inbox-refreshing"
              >
                Atualizando…
              </div>
            )}
            <StateView
              loading={loading && !pageResp}
              error={error}
              empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
              emptyMessage="Nenhuma conversa nesse filtro."
              onRetry={refetch}
            >
              {pageResp && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {pageResp.data.map((c) => (
                    <li key={c.id}>
                      <ConversationCard
                        conv={c}
                        active={c.id === selectedId}
                        onClick={() => setSelectedId(c.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </StateView>
          </div>
        </div>
        )}

        {/* Thread — em mobile, só visível quando uma conversa está selecionada */}
        {showThread && (
        <div
          style={{
            ...card,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {selectedId ? (
            <ConversationThread
              key={selectedId}
              id={selectedId}
              pollBump={pollBump}
              onChanged={refetch}
              onBack={isMobile ? () => setSelectedId(null) : undefined}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.muted,
                fontSize: 14,
              }}
            >
              Selecione uma conversa pra começar.
            </div>
          )}
        </div>
        )}
      </div>
    </PageLayout>
  );
}

// ─── Lista item ──────────────────────────────────────────────────────

function ConversationCard({
  conv,
  active,
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`conv-card-${conv.id}`}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '0.75rem 0.5rem',
        background: active ? colors.primary + '10' : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${colors.border}`,
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: colors.text,
        borderLeft: `3px solid ${active ? colors.primary : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span
            title={CANAL_LABEL[conv.canal]}
            style={{
              ...badge(CANAL_COLOR[conv.canal]),
              padding: '1px 6px',
              fontSize: 9,
            }}
          >
            {CANAL_ICON[conv.canal]}
          </span>
          <strong style={{ fontSize: 13 }}>
            {conv.cliente?.nome ?? conv.peerNome ?? conv.peer}
          </strong>
        </span>
        <span style={{ fontSize: 11, color: colors.muted }}>
          {fmtRelative(conv.ultimaMensagemEm)}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 12,
          color: colors.muted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {conv.ultimaMensagem ?? <em>(sem mensagens)</em>}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
        <span style={{ ...badge(STATUS_COLOR[conv.status]), fontSize: 9 }}>
          {STATUS_LABEL[conv.status]}
        </span>
        {conv.atribuido && (
          <span style={{ fontSize: 10, color: colors.muted }}>· {conv.atribuido.nome}</span>
        )}
        {conv.naoLidas !== undefined && conv.naoLidas > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              background: colors.primary,
              color: '#fff',
              borderRadius: 999,
              padding: '1px 7px',
              fontSize: 11,
              fontWeight: 700,
            }}
            data-testid={`conv-unread-${conv.id}`}
          >
            {conv.naoLidas}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Thread ──────────────────────────────────────────────────────────

function ConversationThread({
  id,
  pollBump,
  onChanged,
  onBack,
}: {
  id: string;
  pollBump: number;
  onChanged: () => void;
  /** Em mobile, volta pra lista de conversas. Undefined em desktop. */
  onBack?: () => void;
}) {
  const toast = useToast();
  const detailPath = useMemo(() => `/inbox/${id}?_t=${pollBump}`, [id, pollBump]);
  const msgsPath = useMemo(() => `/inbox/${id}/mensagens?limit=80&_t=${pollBump}`, [id, pollBump]);

  const conv = useApiQuery<Conversation>(detailPath);
  const msgs = useApiQuery<{ data: Mensagem[] }>(msgsPath);

  const [resposta, setResposta] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [atribuirOpen, setAtribuirOpen] = useState(false);

  // Auto-scroll pro fim quando msgs chegam
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.data]);

  // Marcar como lida quando abre / poll detecta nova mensagem inbound
  const lastMarkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conv.data) return;
    if (lastMarkRef.current === id && (conv.data.naoLidas ?? 0) === 0) return;
    lastMarkRef.current = id;
    void api.post(`/inbox/${id}/marcar-lida`).catch(() => {
      /* não-crítico */
    });
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
  const messages = msgs.data?.data ?? [];

  return (
    <>
      <header
        style={{
          padding: '0.75rem 1rem',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        {c ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
              {onBack && (
                <button
                  type="button"
                  data-testid="inbox-back-btn"
                  onClick={onBack}
                  aria-label="Voltar para lista"
                  style={{
                    minWidth: 36,
                    minHeight: 36,
                    padding: 0,
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    fontSize: 16,
                    cursor: 'pointer',
                    color: colors.text,
                  }}
                >
                  ←
                </button>
              )}
              <span style={{ ...badge(CANAL_COLOR[c.canal]) }}>
                {CANAL_LABEL[c.canal]}
              </span>
              <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                <strong
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.cliente?.nome ?? c.peerNome ?? c.peer}
                </strong>
                {c.peer && (c.cliente?.nome || c.peerNome) && (
                  <div style={{ fontSize: 11, color: colors.muted }}>{c.peer}</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                data-testid="inbox-status-btn"
                onClick={() => setStatusOpen(true)}
                style={{ ...badge(STATUS_COLOR[c.status]), cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
              >
                {STATUS_LABEL[c.status]}
              </button>
              <button
                type="button"
                data-testid="inbox-atribuir-btn"
                onClick={() => setAtribuirOpen(true)}
                style={{ ...btnSecondary, padding: '2px 10px', fontSize: 11 }}
              >
                {c.atribuido ? `→ ${c.atribuido.nome}` : 'Atribuir'}
              </button>
            </div>
          </>
        ) : (
          <span style={{ color: colors.muted }}>Carregando…</span>
        )}
      </header>

      {/* Mensagens */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          background: '#fafbfc',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <StateView
          loading={msgs.loading && messages.length === 0}
          error={msgs.error}
          empty={!msgs.loading && !msgs.error && messages.length === 0}
          emptyMessage="Sem mensagens nesta conversa ainda."
          onRetry={msgs.refetch}
        >
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          <div ref={endRef} />
        </StateView>
      </div>

      {/* Compose */}
      {c && !['RESOLVIDA', 'ARQUIVADA'].includes(c.status) && (
        <div style={{ padding: '0.75rem 1rem', borderTop: `1px solid ${colors.border}` }}>
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
            style={{ minHeight: 60 }}
            maxLength={4096}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '0.5rem',
            }}
          >
            <span style={{ fontSize: 11, color: colors.muted }}>
              {sendError ? (
                <span style={{ color: colors.danger }}>{sendError}</span>
              ) : (
                <>⌘/Ctrl + Enter pra enviar · {resposta.length}/4096</>
              )}
            </span>
            <button
              type="button"
              data-testid="inbox-send-btn"
              disabled={sending || resposta.trim().length === 0}
              onClick={enviar}
              style={{
                ...btn,
                opacity: sending || resposta.trim().length === 0 ? 0.6 : 1,
                cursor:
                  sending || resposta.trim().length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {sending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      )}
      {c && ['RESOLVIDA', 'ARQUIVADA'].includes(c.status) && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderTop: `1px solid ${colors.border}`,
            textAlign: 'center',
            color: colors.muted,
            fontSize: 13,
          }}
        >
          Conversa {STATUS_LABEL[c.status].toLowerCase()}. Reabra pra responder.
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
          onDone={() => { setAtribuirOpen(false); conv.refetch(); onChanged(); }}
        />
      )}
    </>
  );
}

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
    <Modal open onClose={onClose} title="Mudar status da conversa">
      <FormField label="Selecione o novo status">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(Object.keys(STATUS_LABEL) as ConversationStatus[])
            .filter((s) => s !== current)
            .map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`status-${s}`}
                onClick={() => onPick(s)}
                style={{
                  ...btnSecondary,
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span style={badge(STATUS_COLOR[s])}>{STATUS_LABEL[s]}</span>
              </button>
            ))}
        </div>
      </FormField>
    </Modal>
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
  const { data: usersResp } = useApiQuery<PaginatedResponse<UsuarioMinimo>>('/users?limit=100&status=ATIVO');
  const [busy, setBusy] = useState(false);

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

  const users = usersResp?.data ?? [];

  return (
    <Modal open onClose={onClose} title="Atribuir conversa">
      <FormField label="Selecione o responsável">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {atribuidoAtual && (
            <button
              type="button"
              data-testid="atribuir-ninguem"
              disabled={busy}
              onClick={() => atribuir(null)}
              style={{ ...btnSecondary, textAlign: 'left', fontSize: 13 }}
            >
              ✕ Remover atribuição
            </button>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              data-testid={`atribuir-user-${u.id}`}
              disabled={busy || u.id === atribuidoAtual?.id}
              onClick={() => atribuir(u.id)}
              style={{
                ...btnSecondary,
                textAlign: 'left',
                fontSize: 13,
                opacity: u.id === atribuidoAtual?.id ? 0.5 : 1,
              }}
            >
              <strong>{u.nome}</strong>
              <span style={{ marginLeft: '0.375rem', color: colors.muted, fontSize: 11 }}>
                ({u.role})
              </span>
              {u.id === atribuidoAtual?.id && (
                <span style={{ marginLeft: 4, color: colors.success, fontSize: 11 }}>✓ atual</span>
              )}
            </button>
          ))}
          {users.length === 0 && (
            <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>Carregando usuários…</p>
          )}
        </div>
      </FormField>
    </Modal>
  );
}

function MessageBubble({ msg }: { msg: Mensagem }) {
  const outbound = msg.direction === 'OUTBOUND';
  return (
    <div
      data-testid={`msg-${msg.id}`}
      style={{
        display: 'flex',
        justifyContent: outbound ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '0.5rem 0.75rem',
          borderRadius: 12,
          background: outbound ? colors.primary : colors.surface,
          color: outbound ? '#fff' : colors.text,
          border: outbound ? 'none' : `1px solid ${colors.border}`,
          fontSize: 14,
          lineHeight: 1.4,
        }}
      >
        {msg.texto && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.texto}</p>}
        {msg.tipo !== 'TEXT' && (
          <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.8 }}>
            [{msg.tipo.toLowerCase()}{msg.mediaMime ? ` · ${msg.mediaMime}` : ''}]
          </p>
        )}
        <div
          style={{
            fontSize: 10,
            opacity: 0.7,
            marginTop: 4,
            textAlign: outbound ? 'right' : 'left',
          }}
        >
          {msg.autor?.nome ? `${msg.autor.nome} · ` : ''}
          {fmtTime(msg.criadoEm)}
        </div>
      </div>
    </div>
  );
}
