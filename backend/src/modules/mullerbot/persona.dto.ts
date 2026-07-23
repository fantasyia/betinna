import { z } from 'zod';

/** Tom de voz — define como a persona se expressa. */
export const TOM_VOZ = [
  'FORMAL',
  'PROFISSIONAL',
  'AMIGAVEL',
  'DESCONTRAIDO',
  'ENTUSIASMADO',
] as const;
export type TomVoz = (typeof TOM_VOZ)[number];

export const exemploSchema = z.object({
  pergunta: z.string().trim().min(2).max(500),
  resposta: z.string().trim().min(2).max(2000),
});
export type ExemploDto = z.infer<typeof exemploSchema>;

export const upsertPersonaSchema = z.object({
  nome: z.string().trim().min(1).max(60).default('MullerBot'),
  tomVoz: z.enum(TOM_VOZ).default('PROFISSIONAL'),
  instrucoes: z.string().trim().max(2000).nullable().optional(),
  exemplos: z.array(exemploSchema).max(10).optional(),
  saudacao: z.string().trim().max(280).nullable().optional(),
  ativo: z.boolean().default(true),
  /**
   * Prompt COMPLETO do Muller. Quando preenchido, é usado tal e qual como system
   * prompt (forma principal de configurar). Até 20k chars (~5k tokens).
   */
  promptCustom: z.string().trim().max(50000).nullable().optional(),
  /**
   * Modelo da OpenAI usado pelo bot. Quando null/vazio, usa o padrão do servidor
   * (env MULLERBOT_MODEL). A lista de opções é controlada pelo dropdown no front.
   */
  modelo: z.string().trim().max(60).nullable().optional(),
  // Sprint 2.2 — teto de custo (tokens). Opcionais: quando omitidos, mantém o atual.
  limiteTokensDiaIn: z.number().int().min(0).max(100_000_000).optional(),
  limiteTokensMesIn: z.number().int().min(0).max(2_000_000_000).optional(),
  // Comportamento do bot (pacote 2026-06): contexto, delay e "digitando".
  historicoMensagens: z.number().int().min(1).max(50).optional(),
  delayRespostaSegundos: z.number().int().min(0).max(60).optional(),
  mostrarDigitando: z.boolean().optional(),
  // Quebra da resposta em vários balões (mais humano) + teto de balões.
  quebrarMensagens: z.boolean().optional(),
  maxMensagens: z.number().int().min(2).max(6).optional(),
  // Multimodal: transcrever áudios (voz→texto) e analisar imagens (visão).
  transcreverAudio: z.boolean().optional(),
  analisarImagem: z.boolean().optional(),
});
export type UpsertPersonaDto = z.infer<typeof upsertPersonaSchema>;

/**
 * PATCH parcial da config do bot (usado pelo MCP `bot_config_atualizar`). TODOS
 * os campos são opcionais e SEM default: só o que vier é alterado, o resto fica
 * como está. (O PUT/upsert acima substitui — omitir `nome` lá volta pro default;
 * aqui não.) Espelha o comportamento "passe só o que muda" dos prompts de fluxo.
 */
export const patchPersonaSchema = z
  .object({
    nome: z.string().trim().min(1).max(60),
    tomVoz: z.enum(TOM_VOZ),
    instrucoes: z.string().trim().max(2000).nullable(),
    exemplos: z.array(exemploSchema).max(10),
    saudacao: z.string().trim().max(280).nullable(),
    ativo: z.boolean(),
    promptCustom: z.string().trim().max(50000).nullable(),
    modelo: z.string().trim().max(60).nullable(),
    limiteTokensDiaIn: z.number().int().min(0).max(100_000_000),
    limiteTokensMesIn: z.number().int().min(0).max(2_000_000_000),
    historicoMensagens: z.number().int().min(1).max(50),
    delayRespostaSegundos: z.number().int().min(0).max(60),
    mostrarDigitando: z.boolean(),
    quebrarMensagens: z.boolean(),
    maxMensagens: z.number().int().min(2).max(6),
    transcreverAudio: z.boolean(),
    analisarImagem: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'Informe ao menos um campo para alterar' });
export type PatchPersonaDto = z.infer<typeof patchPersonaSchema>;
