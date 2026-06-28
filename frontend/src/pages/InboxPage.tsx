import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import { useRole } from '@/hooks/usePermission';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout, useIsMobile } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { Card, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Canal, Conversation } from '@/pages/inbox/lib/types';
import { POLL_INTERVAL_MS } from '@/pages/inbox/lib/canais';
import { MetricasPanel } from '@/pages/inbox/components/MetricasPanel';
import { ListaConversas } from '@/pages/inbox/components/ListaConversas';
import { ConversationThread } from '@/pages/inbox/components/ConversationThread';
import { useAvisoNovaMensagem } from '@/pages/inbox/hooks/useAvisoNovaMensagem';
import { useInboxStream } from '@/pages/inbox/hooks/useInboxStream';

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

  // SSE push-to-invalidate: a cada mudança no Inbox (mensagem nova etc.), refetcha a lista na hora —
  // sem esperar o poll. `conectado` desacelera o poll abaixo pra um simples safety-net.
  const { conectado: sseConectado } = useInboxStream(
    useCallback(() => {
      if (document.visibilityState === 'visible') refetch();
    }, [refetch]),
  );

  // Poll em BACKGROUND: revalida a MESMA query (queryKey estável) via refetch().
  // O TanStack mantém os dados durante o refetch → sem flicker e sem falso
  // "nova mensagem". (Antes usava `_t: pollBump` na URL como cache-buster, o que
  // com o TanStack virava uma query NOVA a cada 2s: limpava os dados → loading
  // piscando + totalNaoLidas caía a 0 → notificação "nova mensagem" em loop.)
  // PERF: pausa em 2º plano (revalida ao focar). Quando o SSE está conectado, o intervalo vira um
  // safety-net longo (o push cobre o tempo-real) — derruba a carga da rota mais cara do SAC.
  useEffect(() => {
    const intervaloMs = sseConectado ? 30_000 : POLL_INTERVAL_MS;
    function atualizar() {
      if (document.visibilityState !== 'visible') return;
      refetch();
    }
    document.addEventListener('visibilitychange', atualizar);
    const i = setInterval(atualizar, intervaloMs);
    return () => {
      document.removeEventListener('visibilitychange', atualizar);
      clearInterval(i);
    };
  }, [refetch, sseConectado]);

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
          <ListaConversas
            canalTab={canalTab}
            setCanalTab={setCanalTab}
            status={status}
            setStatus={setStatus}
            filterMeu={filterMeu}
            setFilterMeu={setFilterMeu}
            situacao={situacao}
            setSituacao={setSituacao}
            search={search}
            setSearch={setSearch}
            pageResp={pageResp}
            loading={loading}
            error={error}
            refetch={refetch}
            selectedId={selectedId}
            onSelect={setSelectedId}
            somLigado={somLigado}
            alternarSom={alternarSom}
            botGlobalAtivo={botGlobalAtivo}
          />
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
