import { z } from 'zod';

const TIPO_VALUES = [
  'APROVACAO_PENDENTE',
  'APROVACAO_RESOLVIDA',
  'OCORRENCIA_ABERTA',
  'OCORRENCIA_RESOLVIDA',
  'PEDIDO_APROVADO',
  'COMISSAO_FECHADA',
  'COMISSAO_PAGA',
  'MENSAGEM_INBOX',
  'AMOSTRA_FOLLOWUP',
  'LEAD_INATIVO',
  'CLIENTE_BLOQUEADO',
  'GENERICO',
] as const;

export const listSchema = z.object({
  apenasNaoLidas: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
  tipo: z.enum(TIPO_VALUES).optional(),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNotificacoesDto = z.infer<typeof listSchema>;

export const criarSchema = z.object({
  usuarioId: z.string().min(1),
  tipo: z.enum(TIPO_VALUES),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
  titulo: z.string().trim().min(2).max(160),
  mensagem: z.string().trim().min(2).max(500),
  link: z.string().trim().max(500).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export type CriarNotificacaoDto = z.infer<typeof criarSchema>;
