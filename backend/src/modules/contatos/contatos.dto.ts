import { z } from 'zod';

/**
 * Contatos — visão UNIFICADA de Lead + Cliente + Conversa (Inbox).
 *
 * Objetivo: dar a "noção" de o que é lead, o que é cliente real e o que é só
 * uma conversa solta — num lugar só, deduplicado por telefone (últimos 8
 * dígitos, regra D18). Não cria entidade nova: agrega as 3 fontes existentes.
 */
export const listContatosSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
  search: z.string().trim().max(120).optional(),
  /** Filtra pra contatos que SÃO desse tipo (um contato pode ter vários). */
  tipo: z.enum(['LEAD', 'CLIENTE', 'CONVERSA']).optional(),
  representanteId: z.string().cuid().optional(),
  /** Filtra por tags (CSV `a,b` ou repetido `?tagIds=a&tagIds=b`). Semântica E:
   *  o contato precisa ter TODAS as tags selecionadas. Conversas não têm tag. */
  tagIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v == null
        ? undefined
        : (Array.isArray(v) ? v : v.split(','))
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 50),
    ),
  sortBy: z.enum(['recente', 'nome']).default('recente'),
});
export type ListContatosDto = z.infer<typeof listContatosSchema>;

/**
 * Ação em lote sobre contatos. Como cada contato é agregado (pode ser Lead +
 * Cliente + Conversa), o front manda os ids subjacentes agrupados por tipo, e o
 * backend aplica a ação em cada entidade (rep-scoped). Ações: tag, excluir,
 * mover-etapa (essa só vale pros que são Lead).
 */
/**
 * Detalhe de UM contato (visão unificada) por identificador. Aceita leadId,
 * clienteId, telefone ou email — pelo menos um. Base do MCP `contatos_ver`.
 */
export const detalheContatoSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    clienteId: z.string().min(1).optional(),
    telefone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(200).optional(),
  })
  .refine((d) => Boolean(d.leadId || d.clienteId || d.telefone || d.email), {
    message: 'Informe leadId, clienteId, telefone ou email',
  });
export type DetalheContatoDto = z.infer<typeof detalheContatoSchema>;

export const acaoMassaSchema = z
  .object({
    acao: z.enum(['tag', 'excluir', 'mover-etapa']),
    leadIds: z.array(z.string().min(1)).max(500).default([]),
    clienteIds: z.array(z.string().min(1)).max(500).default([]),
    conversaIds: z.array(z.string().min(1)).max(500).default([]),
    // tag:
    tagIds: z.array(z.string().cuid()).max(50).optional(),
    modo: z.enum(['adicionar', 'remover']).optional(),
    // mover-etapa:
    funilEtapaId: z.string().min(1).optional(),
    motivo: z.string().max(300).optional(),
  })
  .refine((d) => d.leadIds.length + d.clienteIds.length + d.conversaIds.length > 0, {
    message: 'Selecione ao menos um contato',
  })
  .refine((d) => d.acao !== 'tag' || ((d.tagIds?.length ?? 0) > 0 && Boolean(d.modo)), {
    message: 'Para tag, informe tagIds e modo (adicionar/remover)',
  })
  .refine((d) => d.acao !== 'mover-etapa' || Boolean(d.funilEtapaId), {
    message: 'Para mover-etapa, informe funilEtapaId',
  });
export type AcaoMassaDto = z.infer<typeof acaoMassaSchema>;

/**
 * Adicionar contatos a um funil — cria um Lead pra cada contato selecionado que
 * ainda NÃO é lead. Diferente do acao-massa (que opera em ids existentes), aqui
 * o front manda os DADOS dos contatos (nome/telefone/...) e o backend cria os
 * leads, pulando quem já tem lead com o mesmo telefone (dedup D18).
 */
export const criarLeadsSchema = z.object({
  /** Funil destino. Omitido → funil padrão da empresa. */
  funilId: z.string().min(1).optional(),
  /** Etapa inicial. Omitida → 1ª etapa ATIVA do funil. */
  funilEtapaId: z.string().min(1).optional(),
  /** Cria os leads SEM funil (contatos soltos, fora de qualquer funil/cron).
   *  Tem precedência sobre funilId/funilEtapaId — usado na importação de base fria. */
  semFunil: z.boolean().optional(),
  /** Tags aplicadas a CADA lead criado (ex: cold, email-mkt, <segmento>). */
  tagIds: z.array(z.string().cuid()).max(50).optional(),
  representanteId: z.string().cuid().optional(),
  contatos: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(200),
        telefone: z.string().trim().max(30).optional(),
        email: z.string().trim().max(200).optional(),
        cidade: z.string().trim().max(100).optional(),
        uf: z.string().trim().length(2).optional(),
        representanteId: z.string().cuid().optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type CriarLeadsDto = z.infer<typeof criarLeadsSchema>;
