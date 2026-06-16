import { memo } from 'react';
import { Avatar, Badge, ChannelBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Conversation } from '../lib/types';
import { fmtPeer, fmtRelative, slaBadge } from '../lib/format';
import { CANAL_LABEL, STATUS_LABEL, STATUS_VARIANT } from '../lib/canais';

// React.memo + onClick estável: como o Inbox faz polling a cada 2s e a lista
// re-renderiza, sem memo os ~40 itens re-renderizavam todos a cada poll. Com o
// TanStack Query (structural sharing) a referência das conversas que NÃO mudaram
// fica estável entre polls, então o memo (shallow) pula o re-render delas.
export const ConversationItem = memo(function ConversationItem({
  conv,
  active,
  botGlobalAtivo,
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  botGlobalAtivo: boolean;
  onClick: (id: string) => void;
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
  // "Bot pausado" só faz sentido quando o bot está EFETIVAMENTE ligado nesta
  // conversa (override on, OU padrão seguindo o global ligado). Se o bot é off
  // aqui, não mostra o selo (era o "Bot pausado que eu não pausei").
  const botEfetivoOn =
    conv.botLigado === true || (conv.botLigado == null && botGlobalAtivo);
  const botPausado =
    botEfetivoOn && conv.botPausadoAte
      ? new Date(conv.botPausadoAte).getTime() > Date.now()
      : false;
  // #25 fatia 2 — selo de SLA (há quanto tempo o cliente espera resposta).
  const sla = slaBadge(conv.aguardandoDesde);

  return (
    <li>
      <button
        type="button"
        data-testid={`conv-card-${conv.id}`}
        onClick={() => onClick(conv.id)}
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
                  className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 leading-none rounded-[10px]"
                  style={{
                    color: sla.cor,
                    backgroundColor: `color-mix(in srgb, ${sla.cor} 15%, transparent)`,
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
});
