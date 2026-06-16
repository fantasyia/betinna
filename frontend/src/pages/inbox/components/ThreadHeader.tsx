import { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Receipt,
  StickyNote,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { Avatar, Button, ChannelBadge, IconButton } from '@/components/ui';
import type { UserRole } from '@/types/auth';
import type { Conversation, ConversationStatus } from '../lib/types';
import { CANAL_LABEL, STATUS_LABEL } from '../lib/canais';
import { fmtPeer } from '../lib/format';

/**
 * Header de ações da thread aberta — extraído do ConversationThread (refactor
 * 2026-06-16). JSX movido VERBATIM: avatar+nome+ChannelBadge+telefone, botões
 * Cliente/Pedido/Notas/Zerar (Zerar = confirmação em 2 cliques), o <select> de
 * Status inline, botão Atribuir e o bloco WhatsApp-only de controle do bot
 * (ControlesBot).
 *
 * O header só DISPARA callbacks — drawers/modais e seus toggles ficam no
 * ConversationThread. Gates preservados: "Zerar" por `podeZerar` (role
 * ADMIN/DIRECTOR), e a lógica `botEfetivoOnConv`/`botPausadoConv` derivada de
 * `conv` + `botGlobalAtivo`.
 */
export function ThreadHeader({
  conv,
  botGlobalAtivo,
  role,
  onBack,
  acoes,
  onAbrirCliente,
  onAbrirNotas,
  onAtribuir,
  onCriarPedido,
}: {
  conv: Conversation | null | undefined;
  botGlobalAtivo: boolean;
  role: UserRole | null;
  onBack?: () => void;
  acoes: {
    mudarStatus: (status: ConversationStatus) => void;
    alternarBot: (acao: 'pausar' | 'religar') => void;
    definirBotLigado: (ligado: boolean | null) => void;
    zerarConversa: () => void;
  };
  onAbrirCliente: () => void;
  onAbrirNotas: () => void;
  onAtribuir: () => void;
  onCriarPedido: () => void;
}) {
  const c = conv;
  // "Zerar conversa" (testar bot): confirma em 2 cliques. ADMIN/DIRECTOR.
  const podeZerar = role === 'ADMIN' || role === 'DIRECTOR';
  const [confirmZerar, setConfirmZerar] = useState(false);

  // Telefone formatado do contato. Preferimos o telefone REAL resolvido no backend
  // (metadata.telefone) — cobre contatos com LID/número oculto. '' quando não há
  // telefone de verdade (LID sem número exposto, grupo, ID interno).
  const numeroContato = c
    ? fmtPeer(c.canal, c.metadata?.telefone || c.peerId || c.peer)
    : '';

  return (
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
              onClick={onAbrirCliente}
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
              onClick={onCriarPedido}
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
            onClick={onAbrirNotas}
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
                  void acoes.zerarConversa();
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
              onChange={(e) => void acoes.mudarStatus(e.target.value as ConversationStatus)}
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
            onClick={onAtribuir}
            leftIcon={<UserCheck className="h-3.5 w-3.5" />}
          >
            {c.atribuido ? c.atribuido.nome : 'Atribuir'}
          </Button>
          {/* Fase 2 — controle do bot Muller nesta conversa (só WhatsApp da empresa) */}
          {c.canal === 'WHATSAPP' && (
            <ControlesBot conv={c} botGlobalAtivo={botGlobalAtivo} acoes={acoes} />
          )}
        </>
      ) : (
        <span className="text-muted text-sm">Carregando…</span>
      )}
    </header>
  );
}

/**
 * Bloco WhatsApp-only de controle do bot Muller nesta conversa: <select> de
 * override (Padrão/Ligado/Desligado) + botões Religar/Pausar condicionais.
 * `botEfetivoOnConv`/`botPausadoConv` derivados de `conv` + `botGlobalAtivo`.
 * Subcomponente interno (não exportado) — só desmembra o JSX grande do header.
 */
function ControlesBot({
  conv: c,
  botGlobalAtivo,
  acoes,
}: {
  conv: Conversation;
  botGlobalAtivo: boolean;
  acoes: {
    alternarBot: (acao: 'pausar' | 'religar') => void;
    definirBotLigado: (ligado: boolean | null) => void;
  };
}) {
  // "Bot pausado"/"Religar" só quando o bot está EFETIVAMENTE ligado nesta conversa
  // (override on, ou padrão seguindo o global ligado) — senão são selos enganosos
  // pra um bot que é off por padrão.
  const botEfetivoOnConv =
    c.botLigado === true || (c.botLigado == null && botGlobalAtivo);
  const botPausadoConv =
    botEfetivoOnConv && c.botPausadoAte
      ? new Date(c.botPausadoAte).getTime() > Date.now()
      : false;

  return (
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
            void acoes.definirBotLigado(v === 'on' ? true : v === 'off' ? false : null);
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
          onClick={() => acoes.alternarBot('religar')}
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
          onClick={() => acoes.alternarBot('pausar')}
          title="Pausar o bot Muller nesta conversa (atendimento humano)"
        >
          ⏸ Pausar bot
        </Button>
      )}
    </>
  );
}
