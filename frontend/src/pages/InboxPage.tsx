import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowLeft,
  Send,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Clock,
  Users,
  MessageSquare,
  Timer,
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
  Reply,
  Smile,
  Download,
  Building2,
  Phone,
  Mail,
  MapPin,
  Hash,
  ExternalLink,
  AlertTriangle,
  Bell,
  BellOff,
  Tag,
  Plus,
  StickyNote,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/auth-store';
import { useRole } from '@/hooks/usePermission';
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
  Stat,
  Tabs,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { colors, alpha, radius } from '@/components/styles';

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

type ConversationCategoria =
  | 'GERAL'
  | 'PRE_VENDA'
  | 'POS_VENDA'
  | 'RECLAMACAO'
  | 'MEDIACAO'
  | 'DEVOLUCAO'
  | 'DISPUTA';

/**
 * Sprint 2.3 — canais que NÃO aceitam resposta de texto livre.
 * Amazon e TikTok nunca; Shopee só em contexto de devolução/disputa.
 */
function canalSemTextoLivre(
  canal: Canal,
  categoria?: ConversationCategoria | null,
): { bloqueado: boolean; motivo?: string } {
  if (canal === 'MARKETPLACE_AMAZON') {
    return { bloqueado: true, motivo: 'A Amazon não tem chat livre — a resposta ao comprador sai pelo Seller Central.' };
  }
  if (canal === 'MARKETPLACE_TIKTOK') {
    return { bloqueado: true, motivo: 'O TikTok Shop não expõe chat livre — responda pelo Seller Center.' };
  }
  if (canal === 'MARKETPLACE_SHOPEE' && (categoria === 'DEVOLUCAO' || categoria === 'DISPUTA')) {
    return { bloqueado: true, motivo: 'Em devolução/disputa a Shopee não aceita texto livre — use as ações da devolução.' };
  }
  return { bloqueado: false };
}

interface RespostaRapida {
  id: string;
  titulo: string;
  atalho: string;
  conteudo: string;
  global: boolean;
}

/**
 * Item #25 — nota interna de uma conversa (anotação da equipe; o cliente NÃO
 * vê). Backend devolve as mais recentes primeiro. Só o autor (ou ADMIN) pode
 * editar/excluir a própria — fora isso volta 403.
 */
interface NotaInterna {
  id: string;
  conversationId: string;
  usuarioId: string;
  texto: string;
  criadoEm: string;
  atualizadoEm: string;
  usuario?: { id: string; nome: string } | null;
}

interface Conversation {
  id: string;
  canal: Canal;
  categoria?: ConversationCategoria | null;
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
  // Override do bot por conversa: null = segue o global da empresa;
  // true = ligado aqui mesmo com o global off; false = desligado só aqui.
  botLigado?: boolean | null;
  // #25 fatia 2 — quando o cliente mandou a última msg SEM resposta (conversa
  // aberta). `null` = nada pendente (última foi nossa, ou já resolvida).
  aguardandoDesde?: string | null;
  // Item #25 — etiquetas livres de triagem (só a equipe vê). Backend retorna
  // sempre como array (default []).
  tagsInternas?: string[];
  /**
   * JSON com metadados canal-específicos:
   *  - telefone: telefone REAL do contato (resolvido no backend quando o peerId
   *    é um LID/número oculto). Quando presente, é a fonte preferida do número.
   */
  metadata?: { telefone?: string | null } & Record<string, unknown>;
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

/**
 * #25 fatia 3 — métricas gerenciais do SAC (`GET /inbox/metricas`).
 * Endpoint restrito a ADMIN/DIRECTOR/GERENTE/SAC — REP recebe 403, então
 * nem buscamos nem renderizamos o painel pra esse papel.
 */
interface Metricas {
  conversas: {
    abertas: number;
    pendentes: number;
    resolvidas: number;
    arquivadas: number;
    total: number;
  };
  aguardando: {
    total: number;
    dentroDoPrazo: number;
    estourado: number;
    slaMinutos: number;
  };
  tempoMedioPrimeiraRespostaSegundos: number | null;
  porAtendente: Array<{
    atendenteId: string | null;
    atendenteNome: string;
    abertas: number;
    aguardando: number;
  }>;
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

// Polling silencioso a cada 2s — mensagens novas aparecem mais rápido (o
// gargalo de segundos era o fetch de avatar no backend, agora assíncrono).
// WebSocket/SSE seria o ideal pra real-time instantâneo — fica como próximo
// passo se 2s ainda parecer lento.
const POLL_INTERVAL_MS = 2_000;

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

/**
 * #25 fatia 2 — selo de SLA da lista: há quanto tempo o cliente espera.
 * Recebe a data ISO de `aguardandoDesde` e devolve texto curto + cor semântica
 * (verde até 30min, amarelo até 2h, vermelho acima). `null` quando não há nada
 * pendente (a chamadora não renderiza o selo nesse caso).
 */
function slaBadge(
  aguardandoDesde: string | null | undefined,
): { texto: string; cor: string } | null {
  if (!aguardandoDesde) return null;
  const t = new Date(aguardandoDesde).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.floor((Date.now() - t) / 60000);
  const texto =
    min < 60
      ? `aguardando há ${Math.max(min, 0)}min`
      : min < 1440
        ? `aguardando há ${Math.floor(min / 60)}h`
        : `aguardando há ${Math.floor(min / 1440)}d`;
  const cor = min <= 30 ? colors.success : min <= 120 ? colors.warning : colors.danger;
  return { texto, cor };
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
 * #25 fatia 3 — formata segundos de "tempo médio de 1ª resposta" pra exibição
 * no painel de métricas. `null` → "—" (sem dado); senão escolhe a unidade mais
 * legível (segundos < 1min, minutos < 1h, horas+minutos acima).
 */
function formatTempoResposta(s: number | null): string {
  if (s === null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}min`;
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

/** Bip curto e discreto via Web Audio (sem precisar de arquivo .mp3). */
function tocarBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
    osc.onended = () => void ctx.close();
  } catch {
    /* áudio bloqueado pelo navegador — ignora */
  }
}

export default function InboxPage() {
  // #25 fatia 3 — papel do usuário (reativo). REP não vê o painel gerencial
  // de métricas (o endpoint /inbox/metricas devolve 403 pra REP de qualquer jeito).
  const role = useRole();
  const isRep = role === 'REP';

  const [canalTab, setCanalTab] = useState<string>('todos');
  const [status, setStatus] = useState<string>('');
  const [filterMeu, setFilterMeu] = useState<string>('');
  const [situacao, setSituacao] = useState<string>(''); // precisa_humano | nao_lidas
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
    if (situacao === 'precisa_humano') qs.set('precisaHumano', 'true');
    if (situacao === 'nao_lidas') qs.set('naoLidas', 'true');
    if (search.trim()) qs.set('search', search.trim());
    return `/inbox?${qs.toString()}`;
  }, [canal, status, filterMeu, situacao, search, pollBump]);

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

  // ── Sprint 2.3 — aviso ativo de mensagem nova (som + notificação + título) ──
  const totalNaoLidas = useMemo(
    () => (pageResp?.data ?? []).reduce((s, c) => s + (c.naoLidas ?? 0), 0),
    [pageResp],
  );
  const [somLigado, setSomLigado] = useState(() => localStorage.getItem('inbox.som') !== 'off');
  const prevNaoLidasRef = useRef(0);

  // Pede permissão de notificação 1x.
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  // Quando o total de não-lidas SOBE → toca som + (se a aba está em 2º plano) notifica.
  useEffect(() => {
    const prev = prevNaoLidasRef.current;
    if (pageResp && totalNaoLidas > prev) {
      if (somLigado) tocarBeep();
      if (
        document.hidden &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          const n = new Notification('Nova mensagem · betinna.ai', {
            body: 'Você tem novas mensagens no Inbox.',
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          /* ignore */
        }
      }
    }
    prevNaoLidasRef.current = totalNaoLidas;
  }, [totalNaoLidas, somLigado, pageResp]);

  // Badge no título da aba: (N) quando há não-lidas e a aba não está focada.
  useEffect(() => {
    const aplicar = () => {
      document.title =
        totalNaoLidas > 0 && document.hidden ? `(${totalNaoLidas}) betinna.ai` : 'betinna.ai';
    };
    aplicar();
    document.addEventListener('visibilitychange', aplicar);
    return () => {
      document.removeEventListener('visibilitychange', aplicar);
      document.title = 'betinna.ai';
    };
  }, [totalNaoLidas]);

  function alternarSom() {
    setSomLigado((s) => {
      const novo = !s;
      localStorage.setItem('inbox.som', novo ? 'on' : 'off');
      if (novo) tocarBeep();
      return novo;
    });
  }

  return (
    <PageLayout
      title="Inbox unificada"
      description="WhatsApp · Instagram · Facebook · E-mail · Marketplaces"
    >
      <AtendimentoTabs />
      {/* #25 fatia 3 — painel gerencial de métricas do SAC (escondido pra REP). */}
      {!isRep && <MetricasPanel />}
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
              <div className="flex items-center gap-2">
                <Input
                  leftIcon={<Search />}
                  placeholder="Buscar…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1"
                />
                <button
                  type="button"
                  data-testid="inbox-som-toggle"
                  onClick={alternarSom}
                  title={somLigado ? 'Som de mensagem nova: ligado' : 'Som de mensagem nova: desligado'}
                  className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover shrink-0"
                >
                  {somLigado ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                </button>
              </div>
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
                  {/* Vazio = ativas (não mostra Resolvida/Arquivada). Escolha
                      explícita pra ver as resolvidas/arquivadas. */}
                  <option value="">Ativas (abertas/pendentes)</option>
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
                <Select
                  data-testid="inbox-situacao"
                  size="sm"
                  value={situacao}
                  onChange={(e) => setSituacao(e.target.value)}
                  className="col-span-2"
                >
                  <option value="">Qualquer situação</option>
                  <option value="precisa_humano">🧑 Precisa de humano</option>
                  <option value="nao_lidas">🔵 Não lidas (cliente esperando)</option>
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

// ─── #25 fatia 3 — Painel gerencial de métricas do SAC ──────────────

/**
 * MetricasPanel — KPIs de atendimento (só gerência; nunca REP, que nem chega a
 * montar este componente). Cabeçalho colapsável; o fetch de `/inbox/metricas`
 * só dispara quando o painel está aberto (evita chamada inútil quando fechado).
 * Começa aberto — é informação de relance que a gerência quer ver ao entrar.
 */
function MetricasPanel() {
  const [aberto, setAberto] = useState(true);
  // Só busca quando aberto (path null = useApiQuery não dispara).
  const { data, loading, error } = useApiQuery<Metricas>(aberto ? '/inbox/metricas' : null);

  return (
    <Card padding="none" data-testid="inbox-metricas" className="overflow-hidden">
      <button
        type="button"
        data-testid="inbox-metricas-toggle"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
      >
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <strong className="text-sm tracking-tight text-text flex-1">
          Métricas de atendimento
        </strong>
        {aberto ? (
          <ChevronUp className="h-4 w-4 text-muted shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted shrink-0" />
        )}
      </button>

      {aberto && (
        <div className="px-4 pb-4 border-t border-border pt-4">
          {loading && !data && (
            <div className="text-sm text-muted py-2">Carregando métricas…</div>
          )}
          {error && !data && (
            <div className="text-sm text-muted py-2">
              Não foi possível carregar as métricas.
            </div>
          )}
          {data && <MetricasConteudo m={data} />}
        </div>
      )}
    </Card>
  );
}

/** Conteúdo do painel quando os dados chegaram — cards + lista por atendente. */
function MetricasConteudo({ m }: { m: Metricas }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div data-testid="inbox-metricas-abertas">
          <Stat
            label="Abertas"
            value={m.conversas.abertas}
            icon={<MessageSquare />}
            iconTone="info"
            hint={`${m.conversas.pendentes} pendentes · ${m.conversas.resolvidas} resolvidas`}
          />
        </div>
        <div data-testid="inbox-metricas-aguardando">
          <Stat
            label="Aguardando resposta"
            value={m.aguardando.total}
            icon={<Clock />}
            iconTone={m.aguardando.estourado > 0 ? 'danger' : 'success'}
            hint={
              <span>
                no prazo{' '}
                <strong className="text-success tabular">{m.aguardando.dentroDoPrazo}</strong>
                {' · '}fora{' '}
                <strong className="text-danger tabular">{m.aguardando.estourado}</strong>
              </span>
            }
          />
        </div>
        <div data-testid="inbox-metricas-tmr">
          <Stat
            label="Tempo médio 1ª resposta"
            value={formatTempoResposta(m.tempoMedioPrimeiraRespostaSegundos)}
            icon={<Timer />}
            iconTone="secondary"
            hint={`SLA ${m.aguardando.slaMinutos}min`}
          />
        </div>
        <div data-testid="inbox-metricas-total">
          <Stat
            label="Total de conversas"
            value={m.conversas.total}
            icon={<Users />}
            iconTone="primary"
            hint={`${m.conversas.arquivadas} arquivadas`}
          />
        </div>
      </div>

      {/* Por atendente — vem ordenado por aguardando desc; limita visual a 8. */}
      {m.porAtendente.length > 0 && (
        <div data-testid="inbox-metricas-atendentes">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Por atendente
          </div>
          <ul className="flex flex-col gap-1">
            {m.porAtendente.slice(0, 8).map((a) => (
              <li
                key={a.atendenteId ?? 'sem-atendente'}
                className="flex items-center justify-between gap-3 text-sm py-1.5 px-2.5 rounded-md bg-bg-alt"
                style={{ borderRadius: radius.lg }}
              >
                <span className="text-text truncate">{a.atendenteNome}</span>
                <span className="shrink-0 text-xs text-muted tabular">
                  abertas <strong className="text-text">{a.abertas}</strong>
                  {' · '}aguardando{' '}
                  <strong className={a.aguardando > 0 ? 'text-warning' : 'text-text'}>
                    {a.aguardando}
                  </strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
    (fmtPeer(conv.canal, conv.metadata?.telefone || conv.peerId || conv.peer) ||
      CANAL_LABEL[conv.canal]);
  const unread = (conv.naoLidas ?? 0) > 0;
  // Sprint 2.3 — pulsa quando a última mensagem chegou nos últimos 30s.
  const recente = conv.ultimaMsgEm
    ? Date.now() - new Date(conv.ultimaMsgEm).getTime() < 30_000
    : false;
  const botPausado = conv.botPausadoAte
    ? new Date(conv.botPausadoAte).getTime() > Date.now()
    : false;
  // #25 fatia 2 — selo de SLA (há quanto tempo o cliente espera resposta).
  const sla = slaBadge(conv.aguardandoDesde);

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

        <Avatar name={name} size="md" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {unread &&
                (recente && unread ? (
                  <span aria-label="Mensagem nova" className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                  </span>
                ) : (
                  <span
                    aria-label="Não lida"
                    className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                  />
                ))}
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
            botPausado ||
            sla) && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {sla && (
                <span
                  data-testid="inbox-sla-badge"
                  className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 leading-none"
                  style={{
                    color: sla.cor,
                    backgroundColor: alpha(sla.cor, 15),
                    borderRadius: radius.lg,
                  }}
                >
                  {sla.texto}
                </span>
              )}
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

// Emojis comuns pro seletor do composer (sem dependência nova).
const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎','🤔','😅','😢','😭','😡','🥳','😉','😴',
  '👍','👎','🙏','👏','🙌','💪','👋','🔥','🎉','❤️','✅','❌','⚠️','💯','🚀','🤝',
];

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
  // Item #25 fatia 4 — presença ao vivo: quem MAIS está nesta conversa agora
  // (exceto eu). Alimentado pelo heartbeat abaixo. Usado pro banner de aviso e
  // pra confirmação antes de enviar (evita dois atendentes respondendo junto).
  const [outros, setOutros] = useState<Array<{ id: string; nome: string }>>([]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [atribuirOpen, setAtribuirOpen] = useState(false);
  const [criarPedido, setCriarPedido] = useState(false);
  const [clienteDrawerOpen, setClienteDrawerOpen] = useState(false);
  // Item #25 — drawer de notas internas + estado das tags de triagem.
  const [notasDrawerOpen, setNotasDrawerOpen] = useState(false);
  const [novaTag, setNovaTag] = useState('');
  const [salvandoTags, setSalvandoTags] = useState(false);
  // "Zerar conversa" (testar bot): confirma em 2 cliques. ADMIN/DIRECTOR.
  const role = useRole();
  const podeZerar = role === 'ADMIN' || role === 'DIRECTOR';
  const [confirmZerar, setConfirmZerar] = useState(false);
  const [emojiAberto, setEmojiAberto] = useState(false);
  // Quote/citação: a mensagem que estou respondendo (preview acima do composer).
  const [respondendoA, setRespondendoA] = useState<Mensagem | null>(null);

  // Sprint 2.3 — respostas rápidas / templates (dropdown ao digitar "/").
  const templates = useApiQuery<RespostaRapida[]>('/respostas-rapidas');
  const empresaInfo = useApiQuery<{ nome?: string }>('/empresas/atual');
  const composeRef = useRef<HTMLTextAreaElement | null>(null);

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

  // Item #25 fatia 4 — heartbeat de presença. Enquanto esta conversa está
  // aberta, avisa o backend que estou aqui (imediatamente + a cada 20s) e
  // guarda quem MAIS está agora. No cleanup (troca de conversa/desmontar),
  // sai best-effort. Falhas são silenciosas — é background, não toast.
  useEffect(() => {
    let ativo = true;
    const ping = () => {
      api
        .post<{ outros: Array<{ id: string; nome: string }> }>(`/inbox/${id}/presenca`)
        .then((r) => {
          if (ativo) setOutros(r.outros ?? []);
        })
        .catch(() => {});
    };
    ping();
    const i = setInterval(ping, 20_000);
    return () => {
      ativo = false;
      clearInterval(i);
      setOutros([]);
      // Usa o `id` capturado no escopo deste efeito (não o da próxima conversa).
      api.delete(`/inbox/${id}/presenca`).catch(() => {});
    };
  }, [id]);

  // Reage a uma mensagem (👍 etc.) via WhatsApp; atualiza a bolha depois.
  async function reagir(messageId: string, emoji: string) {
    try {
      await api.post(`/inbox/messages/${messageId}/reagir`, { emoji });
      msgs.refetch();
    } catch (err) {
      toast.error('Falha ao reagir', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Insere um emoji na posição do cursor do composer (sem dependência nova).
  function inserirEmoji(emoji: string) {
    const el = composeRef.current;
    if (!el) {
      setResposta((r) => r + emoji);
      return;
    }
    const start = el.selectionStart ?? resposta.length;
    const end = el.selectionEnd ?? resposta.length;
    setResposta(resposta.slice(0, start) + emoji + resposta.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function enviar() {
    const texto = resposta.trim();
    if (!texto) return;
    // Item #25 fatia 4 — se outro(s) atendente(s) estão nesta conversa agora,
    // confirma antes de enviar pra evitar resposta em duplicidade.
    if (outros.length > 0) {
      const nomes = outros.map((o) => o.nome).join(', ');
      const verbo = outros.length > 1 ? 'estão' : 'está';
      if (!window.confirm(`${nomes} também ${verbo} nesta conversa. Enviar mesmo assim?`)) {
        return;
      }
    }
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/inbox/${id}/responder`, {
        texto,
        ...(respondendoA ? { respondendoA: respondendoA.id } : {}),
      });
      setResposta('');
      setRespondendoA(null);
      msgs.refetch();
      conv.refetch();
      onChanged();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Falha ao enviar');
    } finally {
      setSending(false);
    }
  }

  // ── Templates: dropdown abre quando o texto começa com "/" (sem espaço) ──
  const mostrarTemplates =
    resposta.startsWith('/') && !resposta.includes(' ') && !resposta.includes('\n');
  const filtroTemplate = mostrarTemplates ? resposta.slice(1).toLowerCase() : '';
  const templatesFiltrados = (templates.data ?? [])
    .filter(
      (t) =>
        t.atalho.toLowerCase().includes(filtroTemplate) ||
        t.titulo.toLowerCase().includes(filtroTemplate),
    )
    .slice(0, 8);

  function substituir(texto: string, map: Record<string, string>): string {
    let out = texto;
    for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
    return out;
  }

  async function inserirTemplate(t: RespostaRapida) {
    let texto = substituir(t.conteudo, {
      '{nome_cliente}': conv.data?.cliente?.nome ?? 'cliente',
      '{nome_empresa}': empresaInfo.data?.nome ?? '',
    });
    // representante — busca o cliente só se o template usar (best-effort).
    if (texto.includes('{representante}') && conv.data?.cliente?.id) {
      try {
        const cli = await api.get<{ representante?: { nome?: string } | null }>(
          `/clientes/${conv.data.cliente.id}`,
        );
        texto = texto.split('{representante}').join(cli.representante?.nome ?? '');
      } catch {
        texto = texto.split('{representante}').join('');
      }
    } else {
      texto = texto.split('{representante}').join('');
    }
    // {ultimo_pedido} não tem fonte confiável aqui — limpa pra não vazar a chave.
    texto = texto.split('{ultimo_pedido}').join('');
    setResposta(texto);
    setTimeout(() => composeRef.current?.focus(), 0);
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

  // Override persistente do bot NESTA conversa (independe do global da empresa):
  // true = sempre liga aqui (mesmo com o bot geral desligado) · false = sempre
  // desliga aqui · null = segue a configuração geral. Resolve o caso do Leo de
  // ligar o bot só pra alguns contatos com o global off.
  async function definirBotLigado(ligado: boolean | null) {
    try {
      await api.post(`/inbox/${id}/bot/ligado`, { ligado });
      toast.success(
        ligado === true
          ? 'Bot ligado só nesta conversa'
          : ligado === false
            ? 'Bot desligado só nesta conversa'
            : 'Bot voltou a seguir a configuração geral',
      );
      conv.refetch();
      onChanged();
    } catch (err) {
      toast.error('Falha ao alterar o bot', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Zera a conversa: apaga as mensagens da thread (reseta a memória do bot, que
  // monta contexto pelo histórico) e zera não-lidas/precisaHumano. Mantém o contato.
  async function zerarConversa() {
    try {
      const r = await api.delete<{ mensagens: number }>(`/inbox/${id}/mensagens`);
      toast.success(
        'Conversa zerada',
        `${r.mensagens} mensagem(ns) apagada(s) — memória do bot resetada.`,
      );
      msgs.refetch();
      conv.refetch();
      onChanged();
    } catch (err) {
      toast.error('Falha ao zerar conversa', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Item #25 — tags de triagem. Recalcula o array completo e manda no PUT
  // (o backend troca a lista inteira). Atualiza a UI com a resposta.
  const tagsAtuais = conv.data?.tagsInternas ?? [];

  async function salvarTags(tags: string[]) {
    setSalvandoTags(true);
    try {
      const resp = await api.put<{ tagsInternas: string[] }>(`/inbox/${id}/tags`, { tags });
      // Reflete a lista canônica devolvida pelo backend (refetch traz o resto).
      conv.refetch();
      onChanged();
      return resp.tagsInternas;
    } catch (err) {
      toast.error('Falha ao salvar tags', err instanceof ApiError ? err.message : undefined);
      return null;
    } finally {
      setSalvandoTags(false);
    }
  }

  async function adicionarTag() {
    const t = novaTag.trim();
    if (!t) return;
    if (t.length > 30) {
      toast.error('Tag muito longa', 'Use até 30 caracteres.');
      return;
    }
    if (tagsAtuais.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setNovaTag('');
      return;
    }
    if (tagsAtuais.length >= 12) {
      toast.error('Limite de tags', 'Máximo de 12 tags por conversa.');
      return;
    }
    const ok = await salvarTags([...tagsAtuais, t]);
    if (ok) setNovaTag('');
  }

  async function removerTag(tag: string) {
    await salvarTags(tagsAtuais.filter((x) => x !== tag));
  }

  const c = conv.data;
  const botPausadoConv = c?.botPausadoAte
    ? new Date(c.botPausadoAte).getTime() > Date.now()
    : false;
  // Telefone formatado do contato. Preferimos o telefone REAL resolvido no backend
  // (metadata.telefone) — cobre contatos com LID/número oculto. '' quando não há
  // telefone de verdade (LID sem número exposto, grupo, ID interno).
  const numeroContato = c
    ? fmtPeer(c.canal, c.metadata?.telefone || c.peerId || c.peer)
    : '';
  const messages = msgs.data ?? [];
  const lockedCompose = c && (c.status === 'RESOLVIDA' || c.status === 'ARQUIVADA');
  // Sprint 2.3 — canal que não aceita resposta de texto livre (Amazon/TikTok/Shopee-devolução).
  const bloqueioCanal = c ? canalSemTextoLivre(c.canal, c.categoria) : { bloqueado: false };

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
            {/* Item #25 — notas internas (só a equipe vê) */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="inbox-notas-btn"
              onClick={() => setNotasDrawerOpen(true)}
              leftIcon={<StickyNote className="h-3.5 w-3.5" />}
              title="Notas internas da conversa (só a equipe vê)"
            >
              Notas
            </Button>
            {/* Zerar conversa — apaga as mensagens da thread e reseta a memória do
                bot (útil pra testar o prompt do zero). 2 cliques pra confirmar. */}
            {podeZerar && (
              <Button
                type="button"
                variant={confirmZerar ? 'danger' : 'ghost'}
                size="sm"
                data-testid="inbox-zerar-conversa-btn"
                onClick={() => {
                  if (confirmZerar) {
                    setConfirmZerar(false);
                    void zerarConversa();
                  } else {
                    setConfirmZerar(true);
                    setTimeout(() => setConfirmZerar(false), 3000);
                  }
                }}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                title="Zerar conversa: apaga as mensagens e reseta a memória do bot (mantém o contato)"
              >
                {confirmZerar ? 'Confirmar?' : 'Zerar'}
              </Button>
            )}
            {/* Status — dropdown inline: troca direto pra Aberta/Pendente/Resolvida/
                Arquivada (Resolvida sai da lista ativa → "vai pra outra aba"). */}
            <label
              className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap"
              title="Mudar o status da conversa"
            >
              Status:
              <select
                data-testid="inbox-status-select"
                value={c.status}
                onChange={(e) => void mudarStatus(e.target.value as ConversationStatus)}
                className="rounded-md border border-border-strong bg-surface px-1.5 py-1 text-[11px] text-text"
              >
                {(Object.keys(STATUS_LABEL) as ConversationStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
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
            {/* Fase 2 — controle do bot Muller nesta conversa (só WhatsApp da empresa) */}
            {c.canal === 'WHATSAPP' && (
              <>
                {/* Override persistente: força ligado/desligado aqui, ou segue o global.
                    Atende o caso de ligar o bot só pra alguns contatos com o global off. */}
                <label
                  className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap"
                  title="Liga/desliga o bot só nesta conversa. 'Padrão' segue a configuração geral da empresa."
                >
                  Bot:
                  <select
                    data-testid="inbox-bot-override"
                    value={c.botLigado === true ? 'on' : c.botLigado === false ? 'off' : 'auto'}
                    onChange={(e) => {
                      const v = e.target.value;
                      void definirBotLigado(v === 'on' ? true : v === 'off' ? false : null);
                    }}
                    className="rounded-md border border-border-strong bg-surface px-1.5 py-1 text-[11px] text-text"
                  >
                    <option value="auto">Padrão</option>
                    <option value="on">Ligado</option>
                    <option value="off">Desligado</option>
                  </select>
                </label>
                {/* RELIGAR — aparece SEMPRE que o bot está travado nesta conversa
                    (pausado OU escalado pra humano), independente do override.
                    Antes só no modo "Padrão", então em "Ligado" você tinha que
                    desativar+ativar. Religar limpa a pausa E o "precisa humano". */}
                {(botPausadoConv || c.precisaHumano) && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="inbox-bot-religar"
                    onClick={() => alternarBot('religar')}
                    title="Religar o bot Muller agora (limpa a pausa e o 'precisa humano')"
                  >
                    ▶ Religar bot
                  </Button>
                )}
                {/* PAUSAR — só no modo Padrão e quando NÃO está pausado/escalado. */}
                {c.botLigado == null && !botPausadoConv && !c.precisaHumano && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="inbox-bot-btn"
                    onClick={() => alternarBot('pausar')}
                    title="Pausar o bot Muller nesta conversa (atendimento humano)"
                  >
                    ⏸ Pausar bot
                  </Button>
                )}
              </>
            )}
          </>
        ) : (
          <span className="text-muted text-sm">Carregando…</span>
        )}
      </header>

      {/* Item #25 — faixa de tags internas de triagem (só a equipe vê).
          Chips removíveis + input "+ tag" (Enter adiciona). */}
      {c && (
        <div
          data-testid="inbox-tags-bar"
          className="px-4 py-2 border-b border-border bg-bg-alt flex items-center gap-1.5 flex-wrap"
        >
          <Tag className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden />
          {tagsAtuais.map((tag) => (
            <span
              key={tag}
              data-testid={`inbox-tag-${tag}`}
              className="inline-flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-full text-[11px] font-semibold bg-primary/15 text-primary border border-primary/25"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remover tag ${tag}`}
                data-testid={`inbox-tag-remove-${tag}`}
                disabled={salvandoTags}
                onClick={() => void removerTag(tag)}
                className="inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-primary/20 disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {tagsAtuais.length < 12 && (
            <input
              type="text"
              data-testid="inbox-tag-input"
              value={novaTag}
              onChange={(e) => setNovaTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void adicionarTag();
                }
              }}
              disabled={salvandoTags}
              maxLength={30}
              placeholder="+ tag"
              className="h-[22px] min-w-[70px] w-24 px-2 rounded-full text-[11px] bg-surface border border-dashed border-border text-text placeholder:text-muted focus:outline-none focus:border-primary disabled:opacity-40"
            />
          )}
          {tagsAtuais.length === 0 && (
            <span className="text-[11px] text-muted ml-1">
              Etiquetas de triagem internas
            </span>
          )}
        </div>
      )}

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
            // Quote: resolve a msg citada pelo id local guardado em meta.respondendoA.
            const refId = typeof m.meta?.respondendoA === 'string' ? m.meta.respondendoA : null;
            const citada = refId ? (messages.find((x) => x.id === refId) ?? null) : null;
            return (
              <MessageBubble
                key={m.id}
                msg={m}
                showAuthor={!!showAuthor}
                podeReagir={c?.canal === 'WHATSAPP'}
                onReagir={(emoji) => void reagir(m.id, emoji)}
                onResponder={c?.canal === 'WHATSAPP' ? () => setRespondendoA(m) : undefined}
                citada={citada}
              />
            );
          })}
          <div ref={endRef} />
        </StateView>
      </div>

      {/* Item #25 fatia 4 — aviso de presença: outro(s) atendente(s) estão
          nesta conversa agora. Não bloqueia — só avisa (a confirmação de envio
          mora em enviar()). Tom warning do design system. */}
      {outros.length > 0 && (
        <div
          data-testid="inbox-presenca-aviso"
          className="px-4 py-2 border-t border-warning/40 bg-warning/10 flex items-center gap-2 text-sm text-warning"
        >
          <UserCheck className="h-4 w-4 shrink-0" />
          <span>
            👤{' '}
            <strong>{outros.map((o) => o.nome).join(', ')}</strong>{' '}
            {outros.length > 1 ? 'estão' : 'está'} nesta conversa agora
          </span>
        </div>
      )}

      {/* Compose */}
      {/* Sprint 2.3 — banner quando o canal não aceita texto livre (compose oculto) */}
      {c && !lockedCompose && bloqueioCanal.bloqueado && (
        <div
          data-testid="inbox-canal-bloqueado"
          className="px-4 py-3 border-t border-warning/40 bg-warning/10"
        >
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Este canal não aceita resposta livre por aqui.</strong>
              <p className="text-text-subtle mt-0.5">{bloqueioCanal.motivo}</p>
            </div>
          </div>
        </div>
      )}

      {c && !lockedCompose && !bloqueioCanal.bloqueado && (
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

          {/* Preview "respondendo a…" (quote) acima do composer. */}
          {respondendoA && (
            <div
              data-testid="inbox-reply-preview"
              className="flex items-center gap-2 mb-1.5 pl-2 border-l-2 border-primary bg-surface-elevated rounded px-2 py-1.5"
            >
              <Reply className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] font-semibold text-primary">
                  Respondendo {respondendoA.direction === 'OUTBOUND' ? 'você mesmo' : 'o contato'}
                </span>
                <span className="block text-xs text-muted truncate">
                  {respondendoA.conteudo || `[${respondendoA.tipo.toLowerCase()}]`}
                </span>
              </div>
              <button
                type="button"
                data-testid="inbox-reply-cancel"
                onClick={() => setRespondendoA(null)}
                className="p-1 rounded text-muted hover:text-text hover:bg-surface-hover shrink-0"
                title="Cancelar resposta"
              >
                <X className="h-3.5 w-3.5" />
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
            {/* Emoji — qualquer canal (emoji é só texto). Picker inline, sem lib. */}
            <div className="relative pb-1">
              <button
                type="button"
                data-testid="inbox-emoji-btn"
                onClick={() => setEmojiAberto((v) => !v)}
                disabled={sending}
                className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Emoji"
              >
                <Smile className="h-4 w-4" />
              </button>
              {emojiAberto && (
                <>
                  {/* backdrop pra fechar ao clicar fora */}
                  <button
                    type="button"
                    aria-label="Fechar emojis"
                    className="fixed inset-0 z-20 cursor-default"
                    onClick={() => setEmojiAberto(false)}
                  />
                  <div className="absolute bottom-full left-0 mb-2 w-64 p-2 rounded-md border border-border bg-surface-elevated shadow-lg z-30 grid grid-cols-8 gap-0.5">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => inserirEmoji(e)}
                        className="text-xl leading-none p-1 rounded hover:bg-surface-hover"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative flex-1">
              {mostrarTemplates && templatesFiltrados.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-elevated shadow-lg z-20">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted border-b border-border">
                    Respostas rápidas
                  </div>
                  {templatesFiltrados.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`template-${t.id}`}
                      onClick={() => void inserirTemplate(t)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-primary shrink-0">{t.atalho}</code>
                        <span className="text-sm font-medium truncate">{t.titulo}</span>
                      </div>
                      <div className="text-xs text-muted truncate">{t.conteudo}</div>
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                ref={composeRef}
                data-testid="inbox-compose"
                placeholder="Digite sua resposta… (ou / pra respostas rápidas)"
                value={resposta}
                onChange={(e) => setResposta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void enviar();
                  } else if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
                    // Ctrl/Cmd + / abre o seletor de respostas rápidas.
                    e.preventDefault();
                    setResposta('/');
                  } else if (e.key === 'Escape' && mostrarTemplates) {
                    setResposta('');
                  }
                }}
                className="min-h-[44px] max-h-32 resize-none w-full"
                maxLength={4096}
              />
            </div>
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
      {notasDrawerOpen && (
        <NotasInternasDrawer
          conversaId={id}
          onClose={() => setNotasDrawerOpen(false)}
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
            <CtxRow icon={<Building2 />} value={data.representante?.nome ?? null} label="Representante" />
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

// ─── Item #25 — Notas internas da conversa ──────────────────────────

/**
 * Drawer de notas internas (anotações da equipe; o cliente NÃO vê).
 * Espelha o estilo do `ClienteContextDrawer`. Lista as notas (mais recentes
 * primeiro), permite adicionar, editar e excluir. Só o autor (ou ADMIN) edita
 * a própria — o backend devolve 403 nos demais (tratado com toast).
 */
function NotasInternasDrawer({
  conversaId,
  onClose,
}: {
  conversaId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<NotaInterna[]>(
    `/inbox/${conversaId}/notas`,
  );
  // Usuário atual — pra decidir quem vê os botões editar/excluir (UX).
  // O backend é a fonte da verdade (403); aqui é só pra não mostrar botão inútil.
  const sess = getSession();
  const meuId = sess?.user?.id ?? null;
  const souAdmin = sess?.user?.role === 'ADMIN';

  const [novaNota, setNovaNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const notas = data ?? [];

  async function adicionar() {
    const texto = novaNota.trim();
    if (!texto) return;
    setSalvando(true);
    try {
      await api.post(`/inbox/${conversaId}/notas`, { texto });
      setNovaNota('');
      refetch();
    } catch (err) {
      toast.error('Falha ao adicionar nota', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(notaId: string) {
    const texto = editTexto.trim();
    if (!texto) return;
    setBusyId(notaId);
    try {
      await api.patch(`/inbox/${conversaId}/notas/${notaId}`, { texto });
      setEditandoId(null);
      setEditTexto('');
      refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('Você só pode editar suas próprias notas');
      } else {
        toast.error('Falha ao editar nota', err instanceof ApiError ? err.message : undefined);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function excluir(notaId: string) {
    setBusyId(notaId);
    try {
      await api.delete(`/inbox/${conversaId}/notas/${notaId}`);
      refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('Você só pode excluir suas próprias notas');
      } else {
        toast.error('Falha ao excluir nota', err instanceof ApiError ? err.message : undefined);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Notas internas"
      description="Só a equipe vê — o cliente não recebe."
      width="sm"
    >
      <div className="flex flex-col gap-4">
        {/* Compositor de nova nota */}
        <div className="flex flex-col gap-2">
          <Textarea
            data-testid="inbox-nota-input"
            placeholder="Escreva uma anotação interna…"
            value={novaNota}
            onChange={(e) => setNovaNota(e.target.value)}
            className="min-h-[72px] max-h-40 resize-none w-full"
            maxLength={2000}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted tabular">{novaNota.length}/2000</span>
            <Button
              type="button"
              size="sm"
              data-testid="inbox-nota-add-btn"
              disabled={salvando || novaNota.trim().length === 0}
              loading={salvando}
              onClick={() => void adicionar()}
              leftIcon={!salvando ? <Plus className="h-3.5 w-3.5" /> : undefined}
            >
              Adicionar nota
            </Button>
          </div>
        </div>

        {/* Lista de notas */}
        <StateView
          loading={loading && !data}
          error={error}
          empty={!loading && !error && notas.length === 0}
          emptyMessage="Nenhuma nota interna ainda."
          onRetry={refetch}
        >
          <ul className="flex flex-col gap-2.5">
            {notas.map((n) => {
              const podeEditar = souAdmin || (meuId !== null && n.usuarioId === meuId);
              const editando = editandoId === n.id;
              return (
                <li
                  key={n.id}
                  data-testid={`inbox-nota-${n.id}`}
                  className="rounded-md border border-border bg-surface px-3 py-2.5 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Avatar name={n.usuario?.nome ?? '?'} size="sm" />
                      <span className="text-xs font-medium text-text truncate">
                        {n.usuario?.nome ?? 'Usuário'}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted tabular shrink-0" title={fmtTime(n.criadoEm)}>
                      {fmtTime(n.criadoEm)}
                    </span>
                  </div>

                  {editando ? (
                    <div className="flex flex-col gap-1.5">
                      <Textarea
                        data-testid={`inbox-nota-edit-input-${n.id}`}
                        value={editTexto}
                        onChange={(e) => setEditTexto(e.target.value)}
                        className="min-h-[60px] max-h-40 resize-none w-full"
                        maxLength={2000}
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`inbox-nota-edit-cancel-${n.id}`}
                          onClick={() => {
                            setEditandoId(null);
                            setEditTexto('');
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`inbox-nota-edit-save-${n.id}`}
                          disabled={busyId === n.id || editTexto.trim().length === 0}
                          loading={busyId === n.id}
                          onClick={() => void salvarEdicao(n.id)}
                        >
                          Salvar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="m-0 text-sm text-text whitespace-pre-wrap break-words">{n.texto}</p>
                  )}

                  {podeEditar && !editando && (
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        data-testid={`inbox-nota-editar-${n.id}`}
                        disabled={busyId === n.id}
                        onClick={() => {
                          setEditandoId(n.id);
                          setEditTexto(n.texto);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40"
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </button>
                      <button
                        type="button"
                        data-testid={`inbox-nota-excluir-${n.id}`}
                        disabled={busyId === n.id}
                        onClick={() => void excluir(n.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-1 rounded text-danger hover:bg-danger/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                        Excluir
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </StateView>
      </div>
    </Drawer>
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

function MessageBubble({
  msg,
  showAuthor,
  podeReagir,
  onReagir,
  onResponder,
  citada,
}: {
  msg: Mensagem;
  showAuthor: boolean;
  podeReagir?: boolean;
  onReagir?: (emoji: string) => void;
  onResponder?: () => void;
  citada?: Mensagem | null;
}) {
  const outbound = msg.direction === 'OUTBOUND';
  const reacao = typeof msg.meta?.reacao === 'string' ? msg.meta.reacao : null;
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
      className={cn('flex items-end gap-1 group', outbound ? 'justify-end' : 'justify-start')}
    >
      {(podeReagir || onResponder) && outbound && (
        <MsgActions
          msgId={msg.id}
          onReagir={podeReagir ? onReagir : undefined}
          onResponder={onResponder}
        />
      )}
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
          {/* Quote: trecho da mensagem citada, dentro da bolha (estilo WhatsApp). */}
          {citada && (
            <div
              data-testid={`msg-quote-${msg.id}`}
              className="mb-1.5 pl-2 border-l-2 border-primary/60 bg-black/10 rounded px-2 py-1"
            >
              <span className="block text-[10px] font-semibold text-primary">
                {citada.direction === 'OUTBOUND'
                  ? 'Você'
                  : (citada.meta?.senderName ?? 'Contato')}
              </span>
              <span className="block text-xs text-muted truncate max-w-[240px]">
                {citada.conteudo || `[${citada.tipo.toLowerCase()}]`}
              </span>
            </div>
          )}
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
        {/* Reação enviada na mensagem (estilo WhatsApp, na borda da bolha). */}
        {reacao && (
          <span className={cn('-mt-2 px-1 z-10', outbound ? 'self-end' : 'self-start')}>
            <span
              className="inline-block rounded-full border border-border bg-surface-elevated px-1.5 py-0.5 text-sm leading-none shadow-sm"
              data-testid={`msg-reacao-${msg.id}`}
            >
              {reacao}
            </span>
          </span>
        )}
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
      {(podeReagir || onResponder) && !outbound && (
        <MsgActions
          msgId={msg.id}
          onReagir={podeReagir ? onReagir : undefined}
          onResponder={onResponder}
        />
      )}
    </div>
  );
}

// Botão de reagir (aparece no hover da mensagem) + mini-picker de reações.
function ReactButton({ onReagir }: { onReagir?: (emoji: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const REACOES = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  if (!onReagir) return null;
  return (
    <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
      <button
        type="button"
        data-testid="msg-reagir-btn"
        onClick={() => setAberto((v) => !v)}
        className="p-1 rounded-full text-muted hover:text-text hover:bg-surface-hover"
        title="Reagir"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      {aberto && (
        <>
          <button
            type="button"
            aria-label="Fechar reações"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setAberto(false)}
          />
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-30 flex gap-0.5 p-1 rounded-full border border-border bg-surface-elevated shadow-lg">
            {REACOES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  onReagir(e);
                  setAberto(false);
                }}
                className="text-lg leading-none p-1 rounded-full hover:bg-surface-hover"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Ações da mensagem no hover: Responder (citar) + Reagir.
function MsgActions({
  msgId,
  onReagir,
  onResponder,
}: {
  msgId: string;
  onReagir?: (emoji: string) => void;
  onResponder?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 self-center">
      {onResponder && (
        <button
          type="button"
          data-testid={`msg-responder-${msgId}`}
          onClick={onResponder}
          title="Responder"
          className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity p-1 rounded-full text-muted hover:text-text hover:bg-surface-hover"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
      )}
      {onReagir && <ReactButton onReagir={onReagir} />}
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
