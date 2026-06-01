import { ClienteOmieStatus, ClienteStatus } from '@prisma/client';
import { z } from 'zod';
import { cnpjSchema, cepSchema, telefoneBrSchema } from '@shared/validators/br-validators';

const clienteStatusEnum = z.nativeEnum(ClienteStatus);
const omieStatusEnum = z.nativeEnum(ClienteOmieStatus);

const UF_REGEX = /^[A-Z]{2}$/;

/**
 * Schema de criação de cliente — campos OBRIGATÓRIOS quando criado via API
 * pelo frontend (form Novo Cliente). Tornar obrigatório aqui evita lixo no DB
 * (clientes sem CNPJ/contato/endereço — impossíveis de atender de verdade).
 *
 * Schema do Prisma mantém nullable: clientes vindos do OMIE sync podem não ter
 * todos os campos (legado), e isso é OK porque é importação automática.
 *
 * Validadores BR (CNPJ, CEP, telefone) verificam dígito + formato.
 */
export const createClienteSchema = z.object({
  nome: z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres').max(200),
  cnpj: cnpjSchema,
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200),
  telefone: telefoneBrSchema,
  segmento: z.string().trim().min(2, 'Segmento obrigatório').max(60),
  // Endereço completo
  cep: cepSchema,
  endereco: z.string().trim().min(3, 'Endereço obrigatório').max(200),
  numero: z.string().trim().min(1, 'Número obrigatório').max(20),
  complemento: z.string().trim().max(100).optional().nullable(),
  bairro: z.string().trim().min(2, 'Bairro obrigatório').max(100),
  cidade: z.string().trim().min(2, 'Cidade obrigatória').max(100),
  uf: z.string().trim().toUpperCase().regex(UF_REGEX, 'UF deve ter 2 letras maiúsculas (ex: SP)'),
  regiao: z.string().trim().max(60).optional(),
  // Campos não obrigatórios pro form (sistema/integração)
  codigoOmie: z.string().max(50).optional(),
  status: clienteStatusEnum.default('NOVO'),
  omieStatus: omieStatusEnum.default('ATIVO'),
  prazoPagamento: z.number().int().min(0).max(180).default(30),
  limiteCredito: z.number().min(0).optional(),
  representanteId: z.string().cuid().optional(),
  tagIds: z.array(z.string().cuid()).optional().default([]),
});
export type CreateClienteDto = z.infer<typeof createClienteSchema>;

// Update: todos opcionais (PATCH semântico) — usuário pode editar 1 campo.
export const updateClienteSchema = createClienteSchema.partial();
export type UpdateClienteDto = z.infer<typeof updateClienteSchema>;

export const listClientesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['nome', 'criadoEm', 'atualizadoEm', 'ultimoPedidoEm']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  segmento: z.string().optional(),
  regiao: z.string().optional(),
  status: clienteStatusEnum.optional(),
  omieStatus: omieStatusEnum.optional(),
  representanteId: z.string().cuid().optional(),
  tagId: z.string().cuid().optional(),
  /** ID da lista dinâmica (risco, criticos, novos, horeca, inadimplentes) */
  lista: z.enum(['risco', 'criticos', 'novos', 'horeca', 'inadimplentes']).optional(),
});
export type ListClientesDto = z.infer<typeof listClientesSchema>;

export const assignRepSchema = z.object({
  representanteId: z.string().cuid().nullable(),
});
export type AssignRepDto = z.infer<typeof assignRepSchema>;

export const bulkAssignRepSchema = z.object({
  clienteIds: z.array(z.string().cuid()).min(1).max(500),
  representanteId: z.string().cuid().nullable(),
});
export type BulkAssignRepDto = z.infer<typeof bulkAssignRepSchema>;

// CL1 (Lote 7) — ações em massa: tag, status, exclusão.
export const bulkTagsSchema = z.object({
  clienteIds: z.array(z.string().cuid()).min(1).max(500),
  tagIds: z.array(z.string().cuid()).min(1).max(50),
  modo: z.enum(['adicionar', 'remover']),
});
export type BulkTagsDto = z.infer<typeof bulkTagsSchema>;

export const bulkStatusSchema = z.object({
  clienteIds: z.array(z.string().cuid()).min(1).max(500),
  status: clienteStatusEnum,
});
export type BulkStatusDto = z.infer<typeof bulkStatusSchema>;

export const bulkDeleteSchema = z.object({
  clienteIds: z.array(z.string().cuid()).min(1).max(500),
});
export type BulkDeleteDto = z.infer<typeof bulkDeleteSchema>;

export const setTagsSchema = z.object({
  tagIds: z.array(z.string().cuid()),
});
export type SetTagsDto = z.infer<typeof setTagsSchema>;

export const updateOmieStatusSchema = z.object({
  omieStatus: omieStatusEnum,
});
export type UpdateOmieStatusDto = z.infer<typeof updateOmieStatusSchema>;
