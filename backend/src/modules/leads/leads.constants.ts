import type { LeadEtapa } from '@prisma/client';

/**
 * Probabilidade de fechamento por etapa do funil.
 * Usada pra cálculo de pipeline ponderado.
 */
export const PROBABILIDADE_POR_ETAPA: Record<LeadEtapa, number> = {
  NOVO: 10,
  QUALIFICANDO: 25,
  PROPOSTA: 50,
  NEGOCIACAO: 75,
  GANHO: 100,
  PERDIDO: 0,
};

/**
 * Tempo máximo (em dias) que um lead pode ficar em cada etapa antes
 * de ser considerado "em aging" (risco). Usado em alertas e na UI.
 */
export const SLA_DIAS_POR_ETAPA: Record<LeadEtapa, number> = {
  NOVO: 3,
  QUALIFICANDO: 5,
  PROPOSTA: 7,
  NEGOCIACAO: 10,
  GANHO: 0,
  PERDIDO: 0,
};

/**
 * Motivos pré-definidos pra ganho/perda.
 * O frontend mostra esses como sugestão mas o usuário pode digitar livremente.
 */
export const MOTIVOS_GANHO = [
  'Preço competitivo',
  'Atendimento personalizado',
  'Variedade de linha',
  'Confiança no rep',
  'Prazo de entrega',
  'MullerBot fechou',
];

export const MOTIVOS_PERDA = [
  'Preço — concorrência ganhou',
  'Já tem fornecedor exclusivo',
  'Sem retorno · sumiu',
  'Volume baixo (não viável)',
  'Prazo de entrega ruim',
  'Outros',
];

/**
 * Máquina de estados das transições de etapa do funil padrão.
 *
 * Sales tem ida e volta — cliente esfria, retorna pra qualificando; ou
 * decide acelerar, pula direto pra negociação. Etapas ATIVAS são livres
 * entre si pra refletir essa realidade.
 *
 * GANHO permite voltar pra NEGOCIACAO (pra reabrir caso tenha sido marcado
 * por engano). PERDIDO permite reabrir em qualquer etapa ativa.
 *
 * Quando o lead pertence a um funil customizado (`Lead.funilId`), as
 * transições vêm das etapas configuradas em `Funil.etapas` em vez deste.
 */
const ATIVAS: LeadEtapa[] = ['NOVO', 'QUALIFICANDO', 'PROPOSTA', 'NEGOCIACAO'];

export const TRANSICOES_ETAPA: Record<LeadEtapa, LeadEtapa[]> = {
  NOVO: [...ATIVAS.filter((e) => e !== 'NOVO'), 'GANHO', 'PERDIDO'],
  QUALIFICANDO: [...ATIVAS.filter((e) => e !== 'QUALIFICANDO'), 'GANHO', 'PERDIDO'],
  PROPOSTA: [...ATIVAS.filter((e) => e !== 'PROPOSTA'), 'GANHO', 'PERDIDO'],
  NEGOCIACAO: [...ATIVAS.filter((e) => e !== 'NEGOCIACAO'), 'GANHO', 'PERDIDO'],
  GANHO: ['NEGOCIACAO'],
  PERDIDO: [...ATIVAS],
};
