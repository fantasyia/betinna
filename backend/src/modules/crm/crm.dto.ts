import { z } from 'zod';

/**
 * Ações de CRM sobre UM contato, via MCP (Claude Code). Escopo de token `crm`
 * (escrita). Identifica o contato por leadId, clienteId ou telefone.
 */

/** Demanda 4 — adicionar/remover tags de um contato (por NOME). */
export const contatoTagsSchema = z
  .object({
    leadId: z.string().min(1).optional(),
    clienteId: z.string().min(1).optional(),
    telefone: z.string().trim().max(30).optional(),
    adicionar: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    remover: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  })
  .refine((d) => Boolean(d.leadId || d.clienteId || d.telefone), {
    message: 'Informe leadId, clienteId ou telefone',
  })
  .refine((d) => d.adicionar.length > 0 || d.remover.length > 0, {
    message: 'Informe ao menos uma tag em adicionar ou remover',
  });
export type ContatoTagsDto = z.infer<typeof contatoTagsSchema>;

/** Demanda 3 — mover um lead de etapa dentro de um funil. */
export const contatoEtapaSchema = z.object({
  leadId: z.string().min(1),
  funilId: z.string().min(1).optional(),
  etapaId: z.string().min(1),
  motivo: z.string().max(300).optional(),
});
export type ContatoEtapaDto = z.infer<typeof contatoEtapaSchema>;
