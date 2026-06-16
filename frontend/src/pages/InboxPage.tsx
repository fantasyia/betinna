import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ArrowLeft,
  Send,
  UserCheck,
  CheckCircle2,
  Inbox as InboxIcon,
  Image as ImageIcon,
  Mic,
  Square,
  Receipt,
  Paperclip,
  Reply,
  Smile,
  Building2,
  AlertTriangle,
  Bell,
  BellOff,
  Tag,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
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
  EmptyState,
  IconButton,
  Input,
  Select,
  Tabs,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type {
  Canal,
  ConversationStatus,
  RespostaRapida,
  Conversation,
  Mensagem,
} from '@/pages/inbox/lib/types';
import {
  canalSemTextoLivre,
  CANAL_LABEL,
  STATUS_LABEL,
  STATUS_VARIANT,
  POLL_INTERVAL_MS,
  EMOJIS,
} from '@/pages/inbox/lib/canais';
import { fmtPeer } from '@/pages/inbox/lib/format';
import { MetricasPanel } from '@/pages/inbox/components/MetricasPanel';
import { ConversationItem } from '@/pages/inbox/components/ConversationItem';
import { ClienteContextDrawer } from '@/pages/inbox/components/ClienteContextDrawer';
import { NotasInternasDrawer } from '@/pages/inbox/components/NotasInternasDrawer';
import { MessageBubble } from '@/pages/inbox/components/MessageBubble';
import { AtribuirModal } from '@/pages/inbox/components/AtribuirModal';
import { useAvisoNovaMensagem } from '@/pages/inbox/hooks/useAvisoNovaMensagem';
import { usePresencaConversa } from '@/pages/inbox/hooks/usePresencaConversa';
import { useScrollToBottom } from '@/pages/inbox/hooks/useScrollToBottom';
import { useMarcarLida } from '@/pages/inbox/hooks/useMarcarLida';
import { useEnvioMensagem } from '@/pages/inbox/hooks/useEnvioMensagem';
import { useGravacaoVoz } from '@/pages/inbox/hooks/useGravacaoVoz';

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
    const qs = new URLSearchParams({ limit: '40' });
    if (canal) qs.set('canal', canal);
    if (status) qs.set('status', status);
    if (filterMeu === 'meu') qs.set('meu', 'true');
    if (filterMeu === 'nao_atribuidas') qs.set('naoAtribuidas', 'true');
    if (situacao === 'precisa_humano') qs.set('precisaHumano', 'true');
    if (situacao === 'nao_lidas') qs.set('naoLidas', 'true');
    if (search.trim()) qs.set('search', search.trim());
    return `/inbox?${qs.toString()}`;
  }, [canal, status, filterMeu, situacao, search]);

  const {
    data: pageResp,
    loading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse<Conversation>>(listPath);

  // Poll em BACKGROUND: revalida a MESMA query (queryKey estável) via refetch().
  // O TanStack mantém os dados durante o refetch → sem flicker e sem falso
  // "nova mensagem". (Antes usava `_t: pollBump` na URL como cache-buster, o que
  // com o TanStack virava uma query NOVA a cada 2s: limpava os dados → loading
  // piscando + totalNaoLidas caía a 0 → notificação "nova mensagem" em loop.)
  useEffect(() => {
    const i = setInterval(() => refetch(), POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, [refetch]);

  // Estado GLOBAL do bot (empresa) — pra os selos "Bot pausado"/"Religar" só
  // aparecerem quando o bot está de fato ativo na conversa (senão confunde:
  // pausar/religar um bot desligado por padrão não faz sentido).
  const { data: empresaAtual } = useApiQuery<{ botWhatsappAtivo?: boolean }>('/empresas/atual');
  const botGlobalAtivo = empresaAtual?.botWhatsappAtivo ?? false;

  const isMobile = useIsMobile();

  useEffect(() => {
    if (!selectedId && pageResp && pageResp.data.length > 0 && !isMobile) {
      setSelectedId(pageResp.data[0]!.id);
    }
  }, [pageResp, selectedId, isMobile]);

  const showList = !isMobile || selectedId === null;
  const showThread = !isMobile || selectedId !== null;

  // Aviso de mensagem nova (som + notificação + título da aba) — ver inbox/hooks.
  const { somLigado, alternarSom } = useAvisoNovaMensagem(pageResp);

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
                        botGlobalAtivo={botGlobalAtivo}
                        onClick={setSelectedId}
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

// MetricasPanel + ConversationItem extraídos pra inbox/components/ (Fase 2).

// ─── Thread (chat pane) ────────────────────────────────────────────

// Emojis comuns pro seletor do composer (sem dependência nova).
function ConversationThread({
  id,
  onChanged,
  onBack,
}: {
  id: string;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  // queryKey ESTÁVEL (sem cache-buster `_t`). O poll é via refetch() em background
  // logo abaixo — o TanStack mantém os dados durante o refetch, então a thread NÃO
  // pisca/recarrega do zero a cada 2s (era a causa do "chat piscando").
  const detailPath = useMemo(() => `/inbox/${id}`, [id]);
  const msgsPath = useMemo(() => `/inbox/${id}/mensagens?limit=80`, [id]);

  const conv = useApiQuery<Conversation>(detailPath);
  // Backend retorna Message[] direto (não { data: [] }) — fix 2026-05-27.
  const msgs = useApiQuery<Mensagem[]>(msgsPath);

  // Poll em background da conversa aberta: revalida detalhe + mensagens sem limpar
  // os dados (sem flicker). Substitui o antigo cache-buster via prop `pollBump`.
  const refetchConv = conv.refetch;
  const refetchMsgs = msgs.refetch;
  useEffect(() => {
    const i = setInterval(() => {
      refetchConv();
      refetchMsgs();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(i);
  }, [refetchConv, refetchMsgs]);

  const [resposta, setResposta] = useState('');
  // Item #25 fatia 4 — presença ao vivo: quem MAIS está nesta conversa agora
  // (exceto eu). Alimentado pelo heartbeat do hook. Usado pro banner de aviso e
  // pra confirmação antes de enviar (evita dois atendentes respondendo junto).
  const outros = usePresencaConversa(id);
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
  const empresaInfo = useApiQuery<{ nome?: string; botWhatsappAtivo?: boolean }>('/empresas/atual');
  const composeRef = useRef<HTMLTextAreaElement | null>(null);

  // Envio (texto + mídia). `resposta`/`respondendoA` ficam aqui (compartilhados
  // com o composer/JSX); o hook recebe valores+setters via params. `sending` é
  // único e bloqueia texto+mic+anexo juntos; cada envio revalida a thread.
  const {
    sending,
    sendError,
    setSendError,
    enviar,
    enviarMidia,
    onFileSelected,
    onAttachSelected,
    imageInputRef,
    attachInputRef,
  } = useEnvioMensagem({
    id,
    resposta,
    setResposta,
    respondendoA,
    setRespondendoA,
    outros,
    refetchMsgs,
    refetchConv,
    onChanged,
  });

  // Gravação de voice note (MediaRecorder). Acoplado ao envio: o onstop chama
  // onGravado → enviarMidia. Erro de mic cai no sendError (comportamento antigo).
  const {
    recording,
    recordSeconds,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
  } = useGravacaoVoz({
    onGravado: (file) => void enviarMidia(file, 'AUDIO'),
    // Limpa o erro ao iniciar (null) e mostra falha de mic no mesmo sendError do
    // envio (comportamento idêntico ao antigo startRecording).
    onErro: setSendError,
  });

  // Só rola pra baixo quando a ÚLTIMA mensagem mudou (id diferente do polling
  // anterior). O hook depende SÓ do id da última msg — nunca do array (o poll
  // cria nova referência a cada 2s e arrastaria o usuário pra baixo).
  const lastMsgIdForScroll =
    msgs.data && msgs.data.length > 0 ? msgs.data[0].id : null;
  const endRef = useScrollToBottom(lastMsgIdForScroll);

  // Marca a conversa como lida (best-effort, dedup por conversa) ao carregar.
  useMarcarLida(conv.data, id);

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
  // "Bot pausado"/"Religar" só quando o bot está EFETIVAMENTE ligado nesta conversa
  // (override on, ou padrão seguindo o global ligado) — senão são selos enganosos
  // pra um bot que é off por padrão.
  const botEfetivoOnConv =
    c?.botLigado === true || (c?.botLigado == null && (empresaInfo.data?.botWhatsappAtivo ?? false));
  const botPausadoConv =
    botEfetivoOnConv && c?.botPausadoAte
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
                {c.botLigado == null && botEfetivoOnConv && !botPausadoConv && !c.precisaHumano && (
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
