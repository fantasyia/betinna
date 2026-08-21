/**
 * Vocabulário de ORIGEM do lead (`Lead.origemCadastro`) e os dois grupos que o
 * produto usa pra falar de porta de entrada.
 *
 * Vive aqui, e não dentro de fluxos, porque DOIS consumidores dependem da mesma
 * lista e não podem divergir:
 *  - `fluxo-event-bus` — filtro do gatilho LEAD_CRIADO (por qual porta o lead entrou);
 *  - `contatos.service` — filtro da tela de Contatos.
 * Se a tela e o motor tivessem cada um a sua lista, o dia em que entrasse uma
 * porta nova o filtro visual e a régua passariam a discordar em silêncio — e o
 * sintoma seria "o fluxo não disparou pra esse lead", que é caro de achar.
 *
 * O campo é VARCHAR, não enum: porta nova de captura não pode exigir migration.
 * Por isso estas constantes descrevem o que EXISTE hoje, e valor fora da lista
 * continua sendo aceito e filtrável — só não entra em grupo nenhum.
 */

/** O lead veio até nós. */
export const ORIGENS_INBOUND = [
  'site',
  'whatsapp',
  'click_to_whatsapp',
  'meta_lead_ads',
  'google_lead_form',
] as const;

/** Fomos atrás dele. */
export const ORIGENS_OUTBOUND = ['importacao', 'manual_rep'] as const;

/**
 * `api` NÃO entra em grupo nenhum de propósito — pode ser tanto um formulário
 * de parceiro (inbound) quanto carga em massa (outbound). Quem quiser filtrar
 * `api` lista explícito.
 */
export const GRUPOS_ORIGEM: Record<string, readonly string[]> = {
  inbound: ORIGENS_INBOUND,
  outbound: ORIGENS_OUTBOUND,
};

/** Formulário do site que converteu o lead (`Lead.formularioOrigem`). */
export const FORMULARIOS_ORIGEM = [
  'contato',
  'representante',
  'amostra',
  'calculadora',
  'seletor',
] as const;
