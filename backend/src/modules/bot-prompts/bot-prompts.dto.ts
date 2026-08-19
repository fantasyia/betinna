import { z } from 'zod';

/**
 * DTOs da biblioteca de prompts do bot (orquestração Fase A).
 */
export const createBotPromptSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  descricao: z.string().trim().max(1000).optional(),
  // Cap 100k (era 50k): playbooks de prospecção ricos passam de 50k. DB é `text`
  // (ilimitado). ⚠️ Prompt gigante = ~1 token/4 chars por MENSAGEM — ok pra bot de
  // volume baixo (prospecção outbound), caro pra bot de alto volume (suporte).
  texto: z.string().trim().min(1).max(100000),
  /** Override do modelo OpenAI (vazio = usa o da empresa/persona). */
  modelo: z.string().trim().max(60).optional(),
  temperatura: z.number().min(0).max(2).optional(),
  isPadrao: z.boolean().optional(),
  ativo: z.boolean().optional(),
  /** Teto de tokens por prompt (spec §7). Null/omitido = sem teto próprio. */
  tetoTokensDia: z.number().int().min(0).nullable().optional(),
  tetoTokensMes: z.number().int().min(0).nullable().optional(),
});
export type CreateBotPromptDto = z.infer<typeof createBotPromptSchema>;

/**
 * Edição CIRÚRGICA do texto: troca trechos em vez de reenviar o prompt inteiro.
 *
 * Os prompts do projeto são grandes (o de prospecção passa de 64 mil caracteres)
 * e as edições são quase sempre de uma linha — uma regra nova, uma URL, um
 * exemplo errado. Exigir o texto completo pra isso não é caro, é ARRISCADO:
 * quem edita tem que reproduzir centenas de linhas verbatim, e uma linha comida
 * no meio de um prompt de produção é bem pior que o erro que a edição conserta.
 *
 * Contrato igual ao de um editor de arquivo: cada `de` tem que casar UMA vez.
 * Zero → erro; duas ou mais → erro dizendo quantas. Nunca "troca a primeira".
 */
export const substituicaoPromptSchema = z.object({
  de: z.string().min(1, 'Trecho a procurar não pode ser vazio'),
  para: z.string(),
});

export const updateBotPromptSchema = createBotPromptSchema.partial().extend({
  substituir: z.array(substituicaoPromptSchema).min(1).max(50).optional(),
});
export type UpdateBotPromptDto = z.infer<typeof updateBotPromptSchema>;

export const listBotPromptsSchema = z.object({
  search: z.string().optional(),
});
export type ListBotPromptsDto = z.infer<typeof listBotPromptsSchema>;
