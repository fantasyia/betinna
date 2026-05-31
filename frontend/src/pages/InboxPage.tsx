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
  Square,
  Receipt,
  Paperclip,
  Download,
  Building2,
  Phone,
  Mail,
  MapPin,
  Hash,
  ExternalLink,
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
  Drawer,
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
  // O backend (Prisma) serializa como `peerId` — identificador externo do
  // contato no canal (telefone no WhatsApp). `peer` fica como fallback legado.
  peerId: string;
  peer?: string;
  peerNome?: string | null;
  // Backend usa estes nomes (Prisma schema). Antes o frontend tinha
  // `ultimaMensagem`/`ultimaMensagemEm` errado → tela mostrava sempre
  // "sem mensagens" porque os campos vinham undefined. Fix 2026-05-27.
  ultimaMsgPreview?: string | null;
  ultimaMsgEm?: string | null;
  naoLidas?: number;
  cliente?: { id: string; nome: string } | null;
  atribuido?: { id: string; nome: string } | null;
  // Fase 2 — estado do bot Muller nesta conversa
  botPausadoAte?: string | null;
  precisaHumano?: boolean;
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
  /** Fase 2 — true quando a mensagem foi gerada pelo bot Muller (tag 🤖). */
  enviadaPorBot?: boolean;
  /**
   * Meta JSON da mensagem. Hoje pode conter:
   * - senderName (pushName do membro que mandou — grupos)
   * - jid, ownerKey (debug WhatsApp)
   */
  meta?: { senderName?: string | null } & Record<string, unknown>;
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

// Polling silencioso a cada 4s — equilíbrio entre fluidez (mensagens novas
// aparecem rápido) e carga do servidor. WebSocket/SSE seria ideal pra
// real-time mas adiciona complexidade — fica pra depois.
const POLL_INTERVAL_MS = 4_000;

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

/**
 * Formata o "peer" (identificador do contato) pra exibição como TELEFONE.
 * No WhatsApp o peer vem como JID cru (ex: `5511988887777@s.whatsapp.net`).
 *
 * ⚠️ Atenção aos JIDs que NÃO são telefone:
 *  - `@lid`  → "número oculto" (privacidade do WhatsApp / Baileys). O número
 *    visível é um ID interno gigante, NÃO o telefone real → não exibimos.
 *  - `@g.us` → grupo. Também não tem telefone.
 * Nesses casos (e em IDs com tamanho implausível) retorna '' — quem chama
 * cai pro nome do contato / rótulo do canal em vez de mostrar número errado.
 *
 * Outros canais (marketplaces/redes) têm peer estruturado — retorna como está.
 */
function fmtPeer(canal: Canal, peer: string | null | undefined): string {
  if (!peer) return '';
  if (canal !== 'WHATSAPP') return peer;
  const at = peer.indexOf('@');
  const suffix = at >= 0 ? peer.slice(at + 1).toLowerCase() : '';
  // LID (número oculto) e grupo não têm telefone real pra mostrar.
  if (suffix === 'lid' || suffix === 'g.us') return '';
  const digits = (at >= 0 ? peer.slice(0, at) : peer).replace(/\D/g, '');
  if (!digits) return '';
  // Brasil: 55 (país) + DDD (2) + número (8 ou 9 dígitos)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const num = digits.slice(4);
    return `+55 (${ddd}) ${num.slice(0, -4)}-${num.slice(-4)}`;
  }
  // Telefone internacional plausível (E.164 tem no máx. 15 dígitos).
  // Acima disso é quase certo um ID interno (ex: LID sem sufixo) → não exibe.
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
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
  const name =
    conv.cliente?.nome ??
    conv.peerNome ??
    (fmtPeer(conv.canal, conv.peerId ?? conv.peer) || CANAL_LABEL[conv.canal]);
  const unread = (conv.naoLidas ?? 0) > 0;
  const botPausado = conv.botPausadoAte
    ? new Date(conv.botPausadoAte).getTime() > Date.now()
    : false;

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
          // Fase 2 — conversa que precisa de humano (bot caiu no fallback)
          conv.precisaHumano && 'bg-danger/5',
        )}
      >
        {/* Fase 2 — faixa vermelha quando precisa de humano */}
        {conv.precisaHumano && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-1 bg-danger"
          />
        )}
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

          {(conv.status !== 'ABERTA' ||
            conv.atribuido ||
            (conv.naoLidas ?? 0) > 1 ||
            conv.precisaHumano ||
            botPausado) && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {conv.precisaHumano && (
                <Badge variant="danger" size="sm">
                  🚨 Precisa de humano
                </Badge>
              )}
              {botPausado && (
                <Badge variant="neutral" size="sm">
                  ⏸ Bot pausado
                </Badge>
              )}
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
  const [clienteDrawerOpen, setClienteDrawerOpen] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  // Só rola pra baixo quando a ÚLTIMA mensagem mudou (id diferente do polling
  // anterior). Antes usava `msgs.data` como dep — como o polling cria nova
  // referência de array a cada 4s, scrollIntoView era chamado toda hora,
  // arrastando o usuário pra baixo quando ele rolava pra ler msg antiga.
  const lastMsgIdForScroll =
    msgs.data && msgs.data.length > 0 ? msgs.data[0].id : null;
  useEffect(() => {
    // Scroll imediato + scroll de segurança após 400ms.
    // Necessário porque <audio>/<video> com preload=metadata ainda estão
    // carregando dimensões — quando terminam, expandem altura e empurram
    // layout. Sem o segundo scroll, último item fica cortado.
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    const t = setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 400);
    return () => clearTimeout(t);
  }, [lastMsgIdForScroll]);

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

  // Refs pros 2 inputs file (escondidos — clicados pelos botões de anexar)
  // Áudio NÃO tem mais upload — só gravação via MediaRecorder.
  // Paperclip cobre o caso de ter um áudio já gravado em arquivo.
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  // Gravação de voice note (MediaRecorder API).
  // Estado: 'idle' (sem gravar) | 'recording' (capturando) | 'paused' (pausado).
  type RecordingState = 'idle' | 'recording' | 'paused';
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  // Flag de cancelamento — onstop checa pra descartar o áudio.
  // useRef pra valor SÍNCRONO acessível dentro do callback (state seria stale).
  const isCancellingRef = useRef(false);
  const [recording, setRecording] = useState<RecordingState>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startTimer() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
  }
  function stopTimer() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  async function startRecording() {
    setSendError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // webm/opus é o que browser oferece. Mas pra WhatsApp aceitar como voice
      // note, mandamos com mimetype 'audio/ogg; codecs=opus' na hora do envio
      // (o codec Opus é o mesmo, só o container que muda — WhatsApp tolera).
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      audioChunksRef.current = [];
      isCancellingRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // Sempre solta o mic ao parar (mesmo se cancelado), pra tirar o
        // indicador vermelho de "gravando" do navegador.
        stream.getTracks().forEach((t) => t.stop());
        // Cancelado: descarta sem enviar nada
        if (isCancellingRef.current) {
          audioChunksRef.current = [];
          isCancellingRef.current = false;
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) return;
        // Voice note: força mime 'audio/ogg; codecs=opus' pra WhatsApp aceitar
        // como voice note (push-to-talk). O conteúdo Opus interno é compatível.
        const file = new File([blob], `voice-${Date.now()}.ogg`, {
          type: 'audio/ogg; codecs=opus',
        });
        await enviarMidia(file, 'AUDIO');
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording('recording');
      setRecordSeconds(0);
      startTimer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSendError(`Não consegui acessar o microfone: ${msg}`);
    }
  }

  function pauseRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;
    mediaRecorderRef.current.pause();
    setRecording('paused');
    stopTimer();
  }

  function resumeRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'paused') return;
    mediaRecorderRef.current.resume();
    setRecording('recording');
    startTimer();
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;
    isCancellingRef.current = false;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setRecording('idle');
    stopTimer();
  }

  function cancelRecording() {
    if (!mediaRecorderRef.current) return;
    // Marca cancelamento ANTES do stop pra onstop saber que tem que descartar.
    isCancellingRef.current = true;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setRecording('idle');
    stopTimer();
  }

  /** Converte File → base64 puro (sem prefixo data:...). */
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // result = "data:<mime>;base64,<base64>" — pega só a parte depois da vírgula
        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function enviarMidia(file: File, tipo: 'IMAGE' | 'AUDIO' | 'DOCUMENT') {
    // Limite ~12MB raw (base64 fica ~16MB no JSON, dentro do body limit de 20MB)
    const MAX_MB = 12;
    if (file.size > MAX_MB * 1024 * 1024) {
      setSendError(
        `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite ${MAX_MB}MB.`,
      );
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const dataBase64 = await fileToBase64(file);
      await api.post(`/inbox/${id}/responder-midia`, {
        tipo,
        mimetype: file.type || undefined,
        fileName: tipo === 'DOCUMENT' ? file.name : undefined,
        // Pra áudio, marca como PTT (voice note) — fica com player no WhatsApp
        ptt: tipo === 'AUDIO' || undefined,
        dataBase64,
      });
      msgs.refetch();
      conv.refetch();
      onChanged();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Falha ao enviar mídia');
    } finally {
      setSending(false);
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>, tipo: 'IMAGE' | 'AUDIO' | 'DOCUMENT') {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    void enviarMidia(file, tipo);
  }

  /** Anexar: deduz tipo do mime do arquivo (imagem/áudio/vídeo/documento) */
  function onAttachSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const mime = file.type || '';
    let tipo: 'IMAGE' | 'AUDIO' | 'DOCUMENT';
    if (mime.startsWith('image/')) tipo = 'IMAGE';
    else if (mime.startsWith('audio/')) tipo = 'AUDIO';
    else tipo = 'DOCUMENT';
    void enviarMidia(file, tipo);
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

  // Fase 2 — pausar/religar o bot Muller nesta conversa específica
  async function alternarBot(acao: 'pausar' | 'religar') {
    try {
      await api.post(`/inbox/${id}/bot/${acao}`, {});
      toast.success(acao === 'pausar' ? 'Bot pausado nesta conversa' : 'Bot religado nesta conversa');
      conv.refetch();
      onChanged();
    } catch (err) {
      toast.error('Falha ao alterar o bot', err instanceof ApiError ? err.message : undefined);
    }
  }

  const c = conv.data;
  const botPausadoConv = c?.botPausadoAte
    ? new Date(c.botPausadoAte).getTime() > Date.now()
    : false;
  // Telefone formatado do contato — '' quando não é telefone (LID/grupo/ID interno).
  const numeroContato = c ? fmtPeer(c.canal, c.peerId ?? c.peer) : '';
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
              name={c.cliente?.nome ?? c.peerNome ?? (numeroContato || CANAL_LABEL[c.canal])}
              src={c.metadata?.avatarUrl ?? undefined}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <strong className="text-sm tracking-tight truncate text-text">
                  {c.cliente?.nome ?? c.peerNome ?? (numeroContato || CANAL_LABEL[c.canal])}
                </strong>
                <ChannelBadge canal={c.canal} size="sm" />
              </div>
              {/* Telefone do contato (selecionável pra copiar). Quando não há telefone
                  real — LID/grupo/ID interno — ou o título já é o número, mostra só o
                  canal pra não repetir nem exibir número errado. */}
              <div
                className="text-[11px] text-muted truncate select-text"
                data-testid="inbox-thread-peer"
              >
                {numeroContato && (c.cliente?.nome || c.peerNome)
                  ? numeroContato
                  : CANAL_LABEL[c.canal]}
              </div>
            </div>
            {c.cliente?.id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="inbox-cliente-btn"
                onClick={() => setClienteDrawerOpen(true)}
                leftIcon={<Building2 className="h-3.5 w-3.5" />}
                title="Ver dados do cliente"
              >
                Cliente
              </Button>
            )}
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
            {/* Fase 2 — pausar/religar o bot Muller nesta conversa (só WhatsApp da empresa) */}
            {c.canal === 'WHATSAPP' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="inbox-bot-btn"
                onClick={() => alternarBot(botPausadoConv ? 'religar' : 'pausar')}
                title={
                  botPausadoConv
                    ? 'Religar o bot Muller nesta conversa'
                    : 'Pausar o bot Muller nesta conversa (atendimento humano)'
                }
              >
                {botPausadoConv ? '▶ Religar bot' : '⏸ Pausar bot'}
              </Button>
            )}
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
          {/* Inputs file escondidos (só clicados pelos botões abaixo).
              Áudio NÃO tem input próprio — usa MediaRecorder (gravação).
              Paperclip aceita qualquer arquivo (inclui áudio gravado externamente). */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onFileSelected(e, 'IMAGE')}
            data-testid="inbox-file-image"
          />
          <input
            ref={attachInputRef}
            type="file"
            accept="*/*"
            hidden
            onChange={onAttachSelected}
            data-testid="inbox-file-attach"
          />

          {/* Estado de gravação ativa: timer + pausar/continuar + cancelar + enviar */}
          {recording !== 'idle' && (
            <div
              className={cn(
                'mb-2 px-3 py-2 rounded-md border flex items-center gap-3',
                recording === 'recording'
                  ? 'bg-danger/10 border-danger/30'
                  : 'bg-warning/10 border-warning/30',
              )}
              data-testid="recording-active"
            >
              {recording === 'recording' ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger" />
                </span>
              ) : (
                <span className="inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
              )}
              <span
                className={cn(
                  'text-sm tabular font-medium',
                  recording === 'recording' ? 'text-danger' : 'text-warning',
                )}
              >
                {recording === 'recording' ? 'Gravando' : 'Pausado'} —{' '}
                {Math.floor(recordSeconds / 60)}:
                {String(recordSeconds % 60).padStart(2, '0')}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={cancelRecording}
                className="text-xs px-2 py-1 rounded text-muted hover:text-text hover:bg-surface-hover"
                data-testid="inbox-record-cancel"
              >
                Cancelar
              </button>
              {recording === 'recording' ? (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="text-xs px-2.5 py-1 rounded border border-border bg-surface hover:bg-surface-hover text-text font-medium"
                  data-testid="inbox-record-pause"
                  title="Pausar gravação"
                >
                  Pausar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="text-xs px-2.5 py-1 rounded border border-border bg-surface hover:bg-surface-hover text-text font-medium"
                  data-testid="inbox-record-resume"
                  title="Continuar gravação"
                >
                  Continuar
                </button>
              )}
              <button
                type="button"
                onClick={stopRecording}
                className="text-xs px-2.5 py-1 rounded bg-primary text-primary-contrast font-medium hover:bg-primary-hover flex items-center gap-1.5"
                data-testid="inbox-record-stop"
              >
                <Square className="h-3 w-3 fill-current" />
                Enviar
              </button>
            </div>
          )}

          <div className="flex items-end gap-1.5">
            {/* Botões de anexar — só pra canal WhatsApp por enquanto */}
            {c.canal === 'WHATSAPP' && (
              <div className="flex items-center gap-1 pb-1">
                <button
                  type="button"
                  data-testid="inbox-attach-image"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={sending || recording !== 'idle'}
                  className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Enviar imagem"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="inbox-record-mic"
                  // Mic só inicia gravação. Pausar/Continuar/Cancelar/Enviar
                  // ficam nos botões do banner de gravação (sem ambiguidade).
                  onClick={() => recording === 'idle' && void startRecording()}
                  disabled={sending || recording !== 'idle'}
                  className={cn(
                    'p-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                    recording !== 'idle'
                      ? 'text-danger bg-danger/10'
                      : 'text-muted hover:text-text hover:bg-surface-hover',
                  )}
                  title={
                    recording === 'idle'
                      ? 'Gravar voice note'
                      : 'Gravação em andamento (use o banner acima)'
                  }
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="inbox-attach-file"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={sending || recording !== 'idle'}
                  className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Anexar arquivo (documento, áudio, vídeo)"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
            )}
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
                <span className="text-danger">
                  {sendError}
                  {/* Sugere reconectar quando o erro indica desconexão (estado
                      ou pós-tentativa). Connection Closed = socket caiu durante
                      envio; pareado/conectado = check inicial falhou. */}
                  {sendError.includes('pareado') ||
                  sendError.includes('conectado') ||
                  sendError.toLowerCase().includes('connection closed') ||
                  sendError.toLowerCase().includes('socket') ? (
                    <>
                      {' — '}
                      <a
                        href="/whatsapp"
                        className="underline font-medium hover:text-danger-hover"
                      >
                        reconectar agora
                      </a>
                    </>
                  ) : null}
                </span>
              ) : (
                <>⌘/Ctrl + Enter — anexar até 12MB</>
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
      {clienteDrawerOpen && c?.cliente?.id && (
        <ClienteContextDrawer
          clienteId={c.cliente.id}
          onClose={() => setClienteDrawerOpen(false)}
          onCriarPedido={() => {
            setClienteDrawerOpen(false);
            setCriarPedido(true);
          }}
        />
      )}
    </>
  );
}

// ─── F4 — Painel de contexto do cliente ─────────────────────────────

interface ClienteCtx {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status?: string | null;
  representante?: { nome: string } | null;
  _count?: { pedidos?: number; propostas?: number; amostras?: number };
}

function ClienteContextDrawer({
  clienteId,
  onClose,
  onCriarPedido,
}: {
  clienteId: string;
  onClose: () => void;
  onCriarPedido: () => void;
}) {
  const navigate = useNavigate();
  const { data, loading } = useApiQuery<ClienteCtx>(`/clientes/${clienteId}`);

  return (
    <Drawer open onClose={onClose} title="Cliente" width="sm">
      {loading || !data ? (
        <div className="flex flex-col gap-3">
          <div className="h-16 rounded-md bg-surface-hover animate-pulse" />
          <div className="h-32 rounded-md bg-surface-hover animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar name={data.nome} size="xl" />
            <div className="min-w-0">
              <h3 className="text-md font-semibold text-text truncate">{data.nome}</h3>
              {data.segmento && <p className="text-xs text-muted m-0">{data.segmento}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <CtxRow icon={<Hash />} value={data.cnpj} mono />
            <CtxRow icon={<Phone />} value={data.telefone} />
            <CtxRow icon={<Mail />} value={data.email} />
            <CtxRow
              icon={<MapPin />}
              value={data.cidade ? `${data.cidade}${data.uf ? '/' + data.uf : ''}` : null}
            />
            <CtxRow icon={<Building2 />} value={data.representante?.nome ?? null} label="Rep" />
          </div>

          {data._count && (
            <div className="grid grid-cols-3 gap-2">
              <CtxStat label="Pedidos" value={data._count.pedidos ?? 0} />
              <CtxStat label="Propostas" value={data._count.propostas ?? 0} />
              <CtxStat label="Amostras" value={data._count.amostras ?? 0} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              data-testid="inbox-cliente-pedido"
              onClick={onCriarPedido}
              leftIcon={<Receipt className="h-3.5 w-3.5" />}
            >
              Criar pedido
            </Button>
            <Button
              variant="secondary"
              data-testid="inbox-cliente-abrir"
              onClick={() => navigate(`/clientes/${clienteId}`)}
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Abrir ficha completa
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function CtxRow({
  icon,
  value,
  label,
  mono,
}: {
  icon: React.ReactNode;
  value?: string | null;
  label?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 w-4 h-4 text-muted [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      {label && <span className="text-muted text-xs">{label}:</span>}
      <span className={cn('text-text truncate', mono && 'tabular')}>{value}</span>
    </div>
  );
}

function CtxStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-bg-alt px-2 py-2 text-center">
      <div className="text-lg font-semibold text-text tabular">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────

/**
 * Renderiza imagem de uma mensagem buscando a URL temporária do backend
 * (signed URL Supabase com TTL ~7 dias). Endpoint: GET /inbox/messages/:id/media
 */
function MessageMediaImage({ msgId }: { msgId: string }) {
  const { data, loading, error, refetch } = useApiQuery<{ url: string; mime: string | null }>(
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
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>Imagem indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
          data-testid={`msg-img-retry-${msgId}`}
        >
          tentar de novo
        </button>
      </div>
    );
  }
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer">
      <img
        src={data.url}
        alt="Imagem da mensagem"
        data-testid={`msg-img-${msgId}`}
        className="rounded border border-border block"
        style={{ maxWidth: '320px', maxHeight: '360px', objectFit: 'contain' }}
        loading="lazy"
      />
    </a>
  );
}

/** Player de vídeo inline — controls nativos do browser. */
function MessageMediaVideo({ msgId }: { msgId: string }) {
  const { data, loading, error, refetch } = useApiQuery<{ url: string; mime: string | null }>(
    `/inbox/messages/${msgId}/media`,
  );
  const [playError, setPlayError] = useState(false);
  if (loading) {
    return (
      <div
        data-testid={`msg-video-loading-${msgId}`}
        className="h-40 w-64 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <Video className="h-3.5 w-3.5" />
        <span>Vídeo indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
        >
          tentar de novo
        </button>
      </div>
    );
  }
  const mime = data.mime ?? undefined;
  if (playError) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        download={`video-${msgId}.mp4`}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-alt hover:bg-surface-hover transition-colors no-underline text-sm"
      >
        <Video className="h-4 w-4 text-primary shrink-0" />
        <span>Baixar vídeo</span>
        <Download className="h-3.5 w-3.5 text-muted" />
      </a>
    );
  }
  return (
    <video
      controls
      preload="metadata"
      data-testid={`msg-video-${msgId}`}
      className="rounded border border-border block bg-black"
      // style inline garante que vídeos verticais (formato celular) não
      // ocupem a tela inteira. classes Tailwind arbitrárias `max-h-[Xpx]`
      // às vezes sumiam no purge — inline é à prova de bala.
      style={{ maxWidth: '320px', maxHeight: '360px', objectFit: 'contain' }}
      onError={() => setPlayError(true)}
    >
      {mime ? <source src={data.url} type={mime} /> : null}
      <source src={data.url} />
      Seu navegador não suporta reprodução de vídeo.
    </video>
  );
}

/** Player de áudio inline — controls nativos do browser. */
function MessageMediaAudio({ msgId }: { msgId: string }) {
  const { data, loading, error, refetch } = useApiQuery<{ url: string; mime: string | null }>(
    `/inbox/messages/${msgId}/media`,
  );
  const [playError, setPlayError] = useState(false);
  if (loading) {
    return (
      <div
        data-testid={`msg-audio-loading-${msgId}`}
        className="h-10 w-56 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <Mic className="h-3.5 w-3.5" />
        <span>Áudio indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
        >
          tentar de novo
        </button>
      </div>
    );
  }
  // WhatsApp manda áudio em audio/ogg; codecs=opus (voice note) — alguns
  // browsers velhos não tocam. Usamos <source type=...> pra dar dica e
  // mostramos fallback de download quando onError dispara.
  const mime = data.mime ?? undefined;
  if (playError) {
    return (
      <a
        href={data.url}
        target="_blank"
        rel="noopener noreferrer"
        download={`audio-${msgId}.ogg`}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-alt hover:bg-surface-hover transition-colors no-underline text-sm"
      >
        <Mic className="h-4 w-4 text-primary shrink-0" />
        <span>Baixar áudio</span>
        <Download className="h-3.5 w-3.5 text-muted" />
      </a>
    );
  }
  return (
    <audio
      controls
      preload="metadata"
      data-testid={`msg-audio-${msgId}`}
      className="max-w-[280px] block"
      onError={() => setPlayError(true)}
    >
      {mime ? <source src={data.url} type={mime} /> : null}
      <source src={data.url} />
      Seu navegador não suporta reprodução de áudio.
    </audio>
  );
}

/** Documento — link de download com nome + tamanho/mime. */
function MessageMediaDocument({ msgId, fileName }: { msgId: string; fileName?: string }) {
  const { data, loading, error, refetch } = useApiQuery<{ url: string; mime: string | null }>(
    `/inbox/messages/${msgId}/media`,
  );
  if (loading) {
    return (
      <div
        data-testid={`msg-doc-loading-${msgId}`}
        className="h-12 w-48 bg-bg-alt animate-pulse rounded"
      />
    );
  }
  if (error || !data?.url) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted italic">
        <FileText className="h-3.5 w-3.5" />
        <span>Documento indisponível</span>
        <button
          type="button"
          onClick={refetch}
          className="not-italic text-primary hover:underline font-medium"
        >
          tentar de novo
        </button>
      </div>
    );
  }
  const displayName = fileName ?? 'Documento';
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      download={displayName}
      data-testid={`msg-doc-${msgId}`}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-bg-alt hover:bg-surface-hover transition-colors no-underline"
    >
      <FileText className="h-5 w-5 text-primary shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-text truncate max-w-[200px]">
          {displayName}
        </span>
        {data.mime && (
          <span className="text-[10px] text-muted">{data.mime}</span>
        )}
      </div>
      <Download className="h-3.5 w-3.5 text-muted ml-1" />
    </a>
  );
}

function MessageBubble({ msg, showAuthor }: { msg: Mensagem; showAuthor: boolean }) {
  const outbound = msg.direction === 'OUTBOUND';
  // Em mensagens INBOUND vindas de GRUPO, meta.senderName tem o nome do
  // membro que mandou (ex: "João Silva"). Mostra acima da bolha pra dar
  // contexto de quem é o autor.
  const groupSender = !outbound ? msg.meta?.senderName : undefined;
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
        {/* Grupo: nome do membro acima da bolha (estilo WhatsApp) */}
        {groupSender && (
          <span
            className="text-[11px] font-semibold text-primary px-1"
            data-testid={`msg-group-sender-${msg.id}`}
          >
            {groupSender}
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
          {/* Mídia renderizada inline quando temos mediaUrl pra IMAGE/VIDEO/AUDIO/DOCUMENT.
              Sem mediaUrl, mostra só o ícone + tipo (fallback). */}
          {(() => {
            const hasMedia = !!msg.mediaUrl;
            const isMediaType =
              msg.tipo === 'IMAGE' ||
              msg.tipo === 'VIDEO' ||
              msg.tipo === 'AUDIO' ||
              msg.tipo === 'DOCUMENT';
            // Cabeçalho com ícone + tipo só quando NÃO temos o player real
            // (pra IMAGE/VIDEO/AUDIO/DOCUMENT) — pra outros tipos (LOCATION,
            // CONTACT, STICKER) sempre mostra cabeçalho.
            const showHeader = msg.tipo !== 'TEXT' && MediaIcon && !(isMediaType && hasMedia);
            return (
              <>
                {showHeader && (
                  <div className="flex items-center gap-1.5 mb-1 text-xs text-muted">
                    <MediaIcon className="h-3.5 w-3.5" />
                    <span className="lowercase">{msg.tipo}</span>
                    {msg.mediaMime && (
                      <span className="text-muted-light">· {msg.mediaMime}</span>
                    )}
                  </div>
                )}
                {hasMedia && msg.tipo === 'IMAGE' && <MessageMediaImage msgId={msg.id} />}
                {hasMedia && msg.tipo === 'VIDEO' && <MessageMediaVideo msgId={msg.id} />}
                {hasMedia && msg.tipo === 'AUDIO' && <MessageMediaAudio msgId={msg.id} />}
                {hasMedia && msg.tipo === 'DOCUMENT' && (
                  <MessageMediaDocument msgId={msg.id} fileName={msg.conteudo ?? undefined} />
                )}
              </>
            );
          })()}
          {/* Esconde placeholders "[imagem]"/"[vídeo]"/"[áudio]"/"[documento]" e
              também o fileName cru de DOCUMENT (já mostrado pelo player) quando
              o player real está renderizado acima. */}
          {msg.conteudo &&
            !(
              msg.mediaUrl &&
              (msg.conteudo === '[imagem]' ||
                msg.conteudo === '[vídeo]' ||
                msg.conteudo === '[áudio]' ||
                msg.tipo === 'DOCUMENT')
            ) && <p className="m-0 whitespace-pre-wrap">{msg.conteudo}</p>}
        </div>
        <span
          className={cn(
            'text-[10px] text-muted px-1 tabular flex items-center gap-1',
            outbound ? 'justify-end' : 'justify-start',
          )}
          title={fmtTime(msg.criadoEm)}
        >
          {/* Fase 2 — marca mensagens respondidas automaticamente pelo bot Muller */}
          {msg.enviadaPorBot && (
            <span
              className="text-[10px] font-semibold text-primary"
              data-testid={`msg-bot-tag-${msg.id}`}
              title="Resposta automática do bot Muller"
            >
              🤖 Muller ·
            </span>
          )}
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
