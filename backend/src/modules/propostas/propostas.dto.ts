import { PagamentoForma, PropostaModalidade, PropostaStatus } from '@prisma/client';
import { z } from 'zod';
import { usuarioIdSchema } from '@shared/validators/id.schema';

export const propostaItemInputSchema = z.object({
  produtoId: z.string().cuid(),
  quantidade: z.number().int().min(1).max(100_000),
  desconto: z.number().min(0).max(80).default(0),
  precoUnitarioOverride: z.number().positive().optional(),
});
export type PropostaItemInputDto = z.infer<typeof propostaItemInputSchema>;

export const createPropostaSchema = z.object({
  clienteId: z.string().cuid(),
  itens: z.array(propostaItemInputSchema).min(1),
  formaPagamento: z.nativeEnum(PagamentoForma).default('BOLETO'),
  condicaoPagamento: z.enum(['avista', '15dias', '30dias', '30_60', '30_60_90']).default('30dias'),
  prazoEntrega: z.coerce.date().optional(),
  descontoGeral: z.number().min(0).max(50).default(0),
  probabilidade: z.number().int().min(0).max(100).default(50),
  validoAte: z.coerce.date().optional(),
  observacoes: z.string().max(2000).optional(),
  /**
   * De quem é a venda. Só a gestão escolhe — o rep é sempre ele mesmo.
   *
   * Proposta da gestão sem dono viraria pedido sem vendedor no ERP, e comissão
   * de ninguém. Como o orçamento do Tiny EXIGE vendedor, isso quebraria no
   * envio; melhor decidir aqui, onde dá pra escolher.
   */
  representanteId: usuarioIdSchema.optional(),
  /**
   * VENDA ou LOCACAO. O REP não escolhe: ele vende locação, sempre.
   *
   * A gestão escolhe porque apresenta as duas modalidades. Sem isto a proposta
   * do rep saía com preço de VENDA — o número errado chegando no cliente.
   */
  modalidade: z.nativeEnum(PropostaModalidade).optional(),
  /**
   * Termos do CONTRATO — só fazem sentido em LOCACAO, e sem os três não dá pra
   * criar o contrato recorrente no ERP (é ele que gera os pedidos mensais).
   *
   * `diaVencimento` para em 28 de propósito: 29, 30 e 31 não existem em todo
   * mês, e vencimento que "pula" é cobrança errada — o cliente reclama e o
   * financeiro conserta na mão todo fevereiro.
   *
   * `carenciaDias` é o período de avaliação GRÁTIS: a 1ª cobrança cai depois
   * dele. Contrato que começa a cobrar no ato contraria a oferta comercial.
   */
  prazoMeses: z.number().int().min(1).max(120).optional(),
  diaVencimento: z.number().int().min(1).max(28).optional(),
  carenciaDias: z.number().int().min(0).max(180).optional(),
  /**
   * QUEM assina o contrato pelo cliente — pessoa, não empresa.
   *
   * A assinatura eletrônica recusa razão social como nome de signatário, e o
   * cadastro de Cliente só guarda a empresa. Sem uma pessoa aqui o contrato
   * não sai da proposta aceita.
   */
  signatarioNome: z.string().trim().min(3).max(120).optional(),
  signatarioEmail: z.string().trim().email().max(160).optional(),
});
export type CreatePropostaDto = z.infer<typeof createPropostaSchema>;

export const updatePropostaSchema = createPropostaSchema
  .omit({ clienteId: true, itens: true })
  .partial();
export type UpdatePropostaDto = z.infer<typeof updatePropostaSchema>;

export const changeStatusSchema = z.object({
  status: z.nativeEnum(PropostaStatus),
  motivo: z.string().max(500).optional(),
});
export type ChangeStatusDto = z.infer<typeof changeStatusSchema>;

export const listPropostasSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['criadoEm', 'valor', 'numero', 'probabilidade']).default('criadoEm'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  status: z.nativeEnum(PropostaStatus).optional(),
  clienteId: z.string().cuid().optional(),
  representanteId: usuarioIdSchema.optional(),
});
export type ListPropostasDto = z.infer<typeof listPropostasSchema>;
