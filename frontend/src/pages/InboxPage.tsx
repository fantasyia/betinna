import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Inbox as InboxIcon,
  Bell,
  BellOff,
} from 'lucide-react';
import { useRole } from '@/hooks/usePermission';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { StateView } from '@/components/StateView';
import { useToast } from '@/components/toast';
import { NovoPedidoDialog } from '@/components/NovoPedidoDialog';
import { Card, EmptyState, Input, Select, Tabs } from '@/components/ui';
import { cn } from '@/lib/cn';
import type {
  Canal,
  ConversationStatus,
  Conversation,
  Mensagem,
} from '@/pages/inbox/lib/types';
import { STATUS_LABEL, POLL_INTERVAL_MS } from '@/pages/inbox/lib/canais';
import { MetricasPanel } from '@/pages/inbox/components/MetricasPanel';
import { ConversationItem } from '@/pages/inbox/components/ConversationItem';
import { ClienteContextDrawer } from '@/pages/inbox/components/ClienteContextDrawer';
import { NotasInternasDrawer } from '@/pages/inbox/components/NotasInternasDrawer';
import { AtribuirModal } from '@/pages/inbox/components/AtribuirModal';
import { BarraTagsTriagem } from '@/pages/inbox/components/BarraTagsTriagem';
import { AvisoPresenca } from '@/pages/inbox/components/AvisoPresenca';
import { ThreadHeader } from '@/pages/inbox/components/ThreadHeader';
import { ThreadMensagens } from '@/pages/inbox/components/ThreadMensagens';
import { Composer } from '@/pages/inbox/components/Composer';
import { useTemplatesResposta } from '@/pages/inbox/hooks/useTemplatesResposta';
import { useAvisoNovaMensagem } from '@/pages/inbox/hooks/useAvisoNovaMensagem';
import { usePresencaConversa } from '@/pages/inbox/hooks/usePresencaConversa';
import { useScrollToBottom } from '@/pages/inbox/hooks/useScrollToBottom';
import { useMarcarLida } from '@/pages/inbox/hooks/useMarcarLida';
import { useEnvioMensagem } from '@/pages/inbox/hooks/useEnvioMensagem';
import { useGravacaoVoz } from '@/pages/inbox/hooks/useGravacaoVoz';
import { useAcoesConversa } from '@/pages/inbox/hooks/useAcoesConversa';

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
  const [atribuirOpen, setAtribuirOpen] = useState(false);
  const [criarPedido, setCriarPedido] = useState(false);
  const [clienteDrawerOpen, setClienteDrawerOpen] = useState(false);
  // Item #25 — drawer de notas internas. (As tags de triagem agora vivem no
  // hook useTagsConversa, chamado pelo <BarraTagsTriagem />.)
  const [notasDrawerOpen, setNotasDrawerOpen] = useState(false);
  // Papel do usuário — repassado ao ThreadHeader (gate de "Zerar" por role).
  const role = useRole();
  const [emojiAberto, setEmojiAberto] = useState(false);
  // Quote/citação: a mensagem que estou respondendo (preview acima do composer).
  const [respondendoA, setRespondendoA] = useState<Mensagem | null>(null);

  // Sprint 2.3 — respostas rápidas / templates (dropdown ao digitar "/"). A
  // query de templates + a substituição de placeholders vivem no hook; aqui
  // ficam só `composeRef`/`empresaInfo` (este último também alimenta o header).
  const empresaInfo = useApiQuery<{ nome?: string; botWhatsappAtivo?: boolean }>('/empresas/atual');
  const composeRef = useRef<HTMLTextAreaElement | null>(null);

  // Envio (texto + mídia). `resposta`/`respondendoA` ficam aqui (compartilhados
  // com o composer/JSX); o hook recebe valores+setters via params. `sending` é
  // único e bloqueia texto+mic+anexo juntos; cada envio revalida a thread. O
  // objeto inteiro (`envio`) desce pro <Composer />.
  const envio = useEnvioMensagem({
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
  // O objeto inteiro (`gravacao`) desce pro <Composer />.
  const gravacao = useGravacaoVoz({
    onGravado: (file) => void envio.enviarMidia(file, 'AUDIO'),
    // Limpa o erro ao iniciar (null) e mostra falha de mic no mesmo sendError do
    // envio (comportamento idêntico ao antigo startRecording).
    onErro: envio.setSendError,
  });

  // Só rola pra baixo quando a ÚLTIMA mensagem mudou (id diferente do polling
  // anterior). O hook depende SÓ do id da última msg — nunca do array (o poll
  // cria nova referência a cada 2s e arrastaria o usuário pra baixo).
  const lastMsgIdForScroll =
    msgs.data && msgs.data.length > 0 ? msgs.data[0].id : null;
  const endRef = useScrollToBottom(lastMsgIdForScroll);

  // Marca a conversa como lida (best-effort, dedup por conversa) ao carregar.
  useMarcarLida(conv.data, id);

  // Ações do header da thread (reagir/mudarStatus/alternarBot/definirBotLigado/
  // zerarConversa) — extraídas pro hook. `reagir` é repassado às bolhas abaixo.
  const acoes = useAcoesConversa(id, conv.refetch, msgs.refetch, onChanged);

  // Respostas rápidas / templates — query + substituição de placeholders
  // ({nome_cliente}/{nome_empresa}/{representante}/{ultimo_pedido}) no hook.
  const { templates, inserirTemplate } = useTemplatesResposta(conv.data, composeRef, setResposta);

  const c = conv.data;
  const messages = msgs.data ?? [];

  return (
    <>
      {/* Thread header — ações da conversa (extraído pro ThreadHeader). Os
          drawers/modais e seus toggles ficam aqui; o header só dispara os
          callbacks. `botGlobalAtivo` alimenta a lógica botEfetivoOnConv. */}
      <ThreadHeader
        conv={c}
        botGlobalAtivo={empresaInfo.data?.botWhatsappAtivo ?? false}
        role={role}
        onBack={onBack}
        acoes={acoes}
        onAbrirCliente={() => setClienteDrawerOpen(true)}
        onAbrirNotas={() => setNotasDrawerOpen(true)}
        onAtribuir={() => setAtribuirOpen(true)}
        onCriarPedido={() => setCriarPedido(true)}
      />

      {/* Item #25 — faixa de tags internas de triagem (só a equipe vê). */}
      <BarraTagsTriagem conv={conv.data} id={id} refetchConv={conv.refetch} onChanged={onChanged} />

      {/* Messages — área scrollable de bolhas (extraída pro ThreadMensagens). */}
      <ThreadMensagens
        messages={messages}
        loading={msgs.loading}
        error={msgs.error}
        refetch={msgs.refetch}
        canal={c?.canal}
        endRef={endRef}
        onReagir={(msgId, emoji) => void acoes.reagir(msgId, emoji)}
        onResponder={(m) => setRespondendoA(m)}
      />

      {/* Item #25 fatia 4 — aviso de presença: outro(s) atendente(s) na conversa. */}
      <AvisoPresenca outros={outros} />

      {/* Compose — caixa de resposta inteira (extraída pro Composer). */}
      <Composer
        conv={c}
        resposta={resposta}
        setResposta={setResposta}
        respondendoA={respondendoA}
        setRespondendoA={setRespondendoA}
        composeRef={composeRef}
        emojiAberto={emojiAberto}
        setEmojiAberto={setEmojiAberto}
        templates={templates}
        inserirTemplate={inserirTemplate}
        envio={envio}
        gravacao={gravacao}
      />

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

