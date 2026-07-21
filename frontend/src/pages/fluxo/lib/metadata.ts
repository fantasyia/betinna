import {
  Zap,
  GitBranch,
  Play,
  Timer,
  MessageSquare,
  Mail,
  CheckSquare,
  Tag,
  ArrowRight,
  UserCheck,
  Webhook,
  Bot,
  Send,
  PowerOff,
  UserPlus,
} from 'lucide-react';
import type { AcaoTipo, FluxoNoTipo, NodePayload, PaletteItem, TriggerTipo } from './types';

/**
 * Mapeamentos de UI (labels/ícones/accents) e a paleta de itens arrastáveis.
 * Tudo puro, sem estado.
 */

// ─── Mapeamento UI ───────────────────────────────────────────────

export const TRIGGER_LABEL: Record<TriggerTipo, string> = {
  LEAD_CRIADO: 'Lead criado',
  LEAD_ETAPA_MUDOU: 'Lead mudou etapa',
  PEDIDO_APROVADO: 'Pedido aprovado',
  PEDIDO_ENTREGUE: 'Pedido entregue',
  OCORRENCIA_ABERTA: 'Ocorrência aberta',
  CLIENTE_INATIVO_30D: 'Cliente inativo 30d',
  AMOSTRA_FOLLOWUP: 'Amostra follow-up',
  CRON_AGENDADO: 'Cron agendado',
  LEAD_RESPONDEU: 'Lead respondeu',
  LEAD_SEM_RESPOSTA: 'Lead sem resposta',
  IA_CLASSIFICOU: 'IA classificou',
  LEAD_RECEBEU_TAG: 'Lead recebeu tag',
  MENSAGEM_CANAL: 'Mensagem recebida (canal / palavra-chave)',
  WEBHOOK_RECEBIDO: 'Webhook recebido',
};

export const ACAO_LABEL: Record<AcaoTipo, string> = {
  ENVIAR_WHATSAPP: 'Enviar WhatsApp',
  ENVIAR_EMAIL: 'Enviar e-mail',
  CRIAR_TAREFA: 'Criar tarefa',
  MUDAR_TAG: 'Mudar tag',
  MOVER_LEAD_ETAPA: 'Mover lead de etapa',
  ATRIBUIR_REP: 'Atribuir representante',
  WEBHOOK_EXTERNO: 'Webhook externo',
  CONVERSAR_IA: 'Conversar com IA',
  LIBERAR_LOTE: 'Liberar lote',
  PAUSAR_IA: 'Pausar IA na conversa',
  CRIAR_LEAD: 'Criar lead da conversa',
};

export const ACAO_ICONS: Record<AcaoTipo, typeof MessageSquare> = {
  ENVIAR_WHATSAPP: MessageSquare,
  ENVIAR_EMAIL: Mail,
  CRIAR_TAREFA: CheckSquare,
  MUDAR_TAG: Tag,
  MOVER_LEAD_ETAPA: ArrowRight,
  ATRIBUIR_REP: UserCheck,
  WEBHOOK_EXTERNO: Webhook,
  CONVERSAR_IA: Bot,
  LIBERAR_LOTE: Send,
  PAUSAR_IA: PowerOff,
  CRIAR_LEAD: UserPlus,
};

export const TIPO_LABEL: Record<FluxoNoTipo, string> = {
  TRIGGER: 'Gatilho',
  CONDICAO: 'Condição',
  ACAO: 'Ação',
  DELAY: 'Tempo',
};

export const TIPO_ACCENT: Record<FluxoNoTipo, string> = {
  TRIGGER: 'var(--success)',
  CONDICAO: 'var(--warning)',
  ACAO: 'var(--info)',
  DELAY: 'var(--muted)',
};

/**
 * Trigger Manual = nó TRIGGER sem `triggerTipo` (o fluxo dispara só na mão, via
 * "Disparar agora"). Não usa enum no banco — o fluxo salva com triggerTipo nulo.
 */
export function isManualTrigger(data: { tipo: FluxoNoTipo; triggerTipo?: TriggerTipo }): boolean {
  return data.tipo === 'TRIGGER' && !data.triggerTipo;
}

export function pickIcon(data: NodePayload) {
  if (data.tipo === 'TRIGGER') return isManualTrigger(data) ? Play : Zap;
  if (data.tipo === 'CONDICAO') return GitBranch;
  if (data.tipo === 'DELAY') return Timer;
  if (data.acaoTipo) return ACAO_ICONS[data.acaoTipo];
  return Play;
}

// ─── Palette items (categorias do print) ────────────────────────

export const PALETTE_CATEGORIES: Array<{ title: string; items: PaletteItem[] }> = [
  {
    title: 'Gatilhos',
    items: [
      { id: 't-manual', label: 'Trigger Manual', tipo: 'TRIGGER', manual: true },
      { id: 't-lead', label: 'Lead criado', tipo: 'TRIGGER', triggerTipo: 'LEAD_CRIADO' },
      { id: 't-etapa', label: 'Lead mudou etapa', tipo: 'TRIGGER', triggerTipo: 'LEAD_ETAPA_MUDOU' },
      { id: 't-pedido-ok', label: 'Pedido aprovado', tipo: 'TRIGGER', triggerTipo: 'PEDIDO_APROVADO' },
      { id: 't-pedido-ent', label: 'Pedido entregue', tipo: 'TRIGGER', triggerTipo: 'PEDIDO_ENTREGUE' },
      { id: 't-ocor', label: 'Ocorrência aberta', tipo: 'TRIGGER', triggerTipo: 'OCORRENCIA_ABERTA' },
      { id: 't-inat', label: 'Cliente inativo 30d', tipo: 'TRIGGER', triggerTipo: 'CLIENTE_INATIVO_30D' },
      { id: 't-amos', label: 'Amostra follow-up', tipo: 'TRIGGER', triggerTipo: 'AMOSTRA_FOLLOWUP' },
      { id: 't-cron', label: 'Cron agendado', tipo: 'TRIGGER', triggerTipo: 'CRON_AGENDADO' },
      { id: 't-resp', label: 'Lead respondeu', tipo: 'TRIGGER', triggerTipo: 'LEAD_RESPONDEU' },
      { id: 't-semresp', label: 'Lead sem resposta', tipo: 'TRIGGER', triggerTipo: 'LEAD_SEM_RESPOSTA' },
      { id: 't-iaclass', label: 'IA classificou', tipo: 'TRIGGER', triggerTipo: 'IA_CLASSIFICOU' },
      { id: 't-tag', label: 'Lead recebeu tag', tipo: 'TRIGGER', triggerTipo: 'LEAD_RECEBEU_TAG' },
      { id: 't-canal', label: 'Mensagem chegou (canal)', tipo: 'TRIGGER', triggerTipo: 'MENSAGEM_CANAL' },
      { id: 't-webhook', label: 'Webhook recebido', tipo: 'TRIGGER', triggerTipo: 'WEBHOOK_RECEBIDO' },
    ],
  },
  {
    title: 'Condições',
    items: [{ id: 'c-cond', label: 'Condição', tipo: 'CONDICAO' }],
  },
  {
    title: 'Ações',
    items: [
      { id: 'a-wa', label: 'Enviar WhatsApp', tipo: 'ACAO', acaoTipo: 'ENVIAR_WHATSAPP' },
      { id: 'a-em', label: 'Enviar e-mail', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL' },
      { id: 'a-task', label: 'Criar tarefa', tipo: 'ACAO', acaoTipo: 'CRIAR_TAREFA' },
      { id: 'a-tag', label: 'Mudar tag', tipo: 'ACAO', acaoTipo: 'MUDAR_TAG' },
      { id: 'a-mov', label: 'Mover lead', tipo: 'ACAO', acaoTipo: 'MOVER_LEAD_ETAPA' },
      { id: 'a-atr', label: 'Atribuir representante', tipo: 'ACAO', acaoTipo: 'ATRIBUIR_REP' },
      { id: 'a-hook', label: 'Webhook externo', tipo: 'ACAO', acaoTipo: 'WEBHOOK_EXTERNO' },
      { id: 'a-ia', label: 'Conversar com IA', tipo: 'ACAO', acaoTipo: 'CONVERSAR_IA' },
      { id: 'a-lote', label: 'Liberar lote', tipo: 'ACAO', acaoTipo: 'LIBERAR_LOTE' },
      { id: 'a-pausa-ia', label: 'Pausar IA na conversa', tipo: 'ACAO', acaoTipo: 'PAUSAR_IA' },
      { id: 'a-lead', label: 'Criar lead da conversa', tipo: 'ACAO', acaoTipo: 'CRIAR_LEAD' },
    ],
  },
  {
    title: 'Tempo',
    items: [{ id: 'd-delay', label: 'Aguardar', tipo: 'DELAY' }],
  },
];
