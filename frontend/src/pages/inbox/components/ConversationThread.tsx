import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRole } from '@/hooks/usePermission';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { NovoPedidoDialog } from '@/components/NovoPedidoDialog';
import type { Conversation, Mensagem } from '@/pages/inbox/lib/types';
import { POLL_INTERVAL_MS } from '@/pages/inbox/lib/canais';
import { ClienteContextDrawer } from '@/pages/inbox/components/ClienteContextDrawer';
import { NotasInternasDrawer } from '@/pages/inbox/components/NotasInternasDrawer';
import { AtribuirModal } from '@/pages/inbox/components/AtribuirModal';
import { BarraTagsTriagem } from '@/pages/inbox/components/BarraTagsTriagem';
import { AvisoPresenca } from '@/pages/inbox/components/AvisoPresenca';
import { ThreadHeader } from '@/pages/inbox/components/ThreadHeader';
import { ThreadMensagens } from '@/pages/inbox/components/ThreadMensagens';
import { Composer } from '@/pages/inbox/components/Composer';
import { useTemplatesResposta } from '@/pages/inbox/hooks/useTemplatesResposta';
import { usePresencaConversa } from '@/pages/inbox/hooks/usePresencaConversa';
import { useScrollToBottom } from '@/pages/inbox/hooks/useScrollToBottom';
import { useMarcarLida } from '@/pages/inbox/hooks/useMarcarLida';
import { useEnvioMensagem } from '@/pages/inbox/hooks/useEnvioMensagem';
import { useGravacaoVoz } from '@/pages/inbox/hooks/useGravacaoVoz';
import { useAcoesConversa } from '@/pages/inbox/hooks/useAcoesConversa';

// ─── Thread (chat pane) ────────────────────────────────────────────

// Emojis comuns pro seletor do composer (sem dependência nova).
export function ConversationThread({
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
  // PERF: pausa em 2º plano (mensagens?limit=80 é o payload mais pesado do SAC) + revalida ao voltar.
  useEffect(() => {
    function atualizar() {
      if (document.visibilityState !== 'visible') return;
      refetchConv();
      refetchMsgs();
    }
    document.addEventListener('visibilitychange', atualizar);
    const i = setInterval(atualizar, POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', atualizar);
      clearInterval(i);
    };
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
