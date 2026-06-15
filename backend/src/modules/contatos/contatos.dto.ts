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
  sortBy: z.enum(['recente', 'nome']).default('recente'),
});
export type ListContatosDto = z.infer<typeof listContatosSchema>;

/**
 * Ação em lote sobre contatos. Como cada contato é agregado (pode ser Lead +
 * Cliente + Conversa), o front manda os ids subjacentes agrupados por tipo, e o
 * backend aplica a ação em cada entidade (rep-scoped). Ações: tag, excluir,
 * mover-etapa (essa só vale pros que são Lead).
 */
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
