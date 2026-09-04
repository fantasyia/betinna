import { UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { usuarioIdSchema } from '@shared/validators/id.schema';

const roleEnum = z.nativeEnum(UserRole);
const statusEnum = z.nativeEnum(UserStatus);

/** CPF (11) ou CNPJ (14) — máscara é aceita, mas o que fica é só dígito. */
const documentoSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 11 || v.length === 14, {
    message: 'CPF (11 dígitos) ou CNPJ (14 dígitos)',
  });

export const createUserSchema = z
  .object({
    nome: z.string().min(2).max(150),
    email: z.string().email(),
    telefone: z.string().min(8).max(30).optional(),
    /**
     * CPF ou CNPJ (aceita com ou sem máscara; guardamos só os dígitos).
     *
     * É a chave que amarra o rep ao CONTATO do ERP — nome varia demais e cada
     * variação criaria um contato novo lá.
     */
    cpfCnpj: documentoSchema.optional(),
    role: roleEnum,
    regiao: z.string().max(100).optional(),
    tetoDesconto: z.number().min(0).max(100).optional(),
    comissaoPadrao: z.number().min(0).max(100).optional(),
    /** % sobre pedido que entra pelo SITE (canal). Default 0 — participa quem tem valor aqui. */
    comissaoSite: z.number().min(0).max(100).optional(),
    empresaIds: z.array(z.string().cuid()).min(1, 'Pelo menos uma empresa é necessária'),
    /** Apenas para REP: id do GERENTE responsável pela carteira (opcional — sem gerente, DIRECTOR cuida). */
    gerenteId: usuarioIdSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // O REP vira CONTATO no ERP (e depois vendedor). Sem documento, a rodada
    // diária não consegue subir sem risco de duplicar cadastro — então o campo
    // é pedido na hora de criar, não descoberto depois.
    if (data.role === 'REP' && !data.cpfCnpj) {
      ctx.addIssue({
        code: 'custom',
        path: ['cpfCnpj'],
        message: 'CPF/CNPJ é obrigatório para representantes (vira contato no ERP)',
      });
    }
    if (data.role === 'REP' && !data.telefone) {
      ctx.addIssue({
        code: 'custom',
        path: ['telefone'],
        message: 'Telefone é obrigatório para representantes',
      });
    }
    if (data.role === 'REP' && !data.regiao) {
      ctx.addIssue({
        code: 'custom',
        path: ['regiao'],
        message: 'Região é obrigatória para representantes',
      });
    }
    if (data.gerenteId && data.role !== 'REP') {
      ctx.addIssue({
        code: 'custom',
        path: ['gerenteId'],
        message: 'gerenteId só faz sentido para REP',
      });
    }
  });

export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  nome: z.string().min(2).max(150).optional(),
  telefone: z.string().min(8).max(30).optional(),
  /** Corrigir documento é comum (digitação); o vínculo com o ERP se refaz sozinho. */
  cpfCnpj: documentoSchema.optional(),
  role: roleEnum.optional(),
  status: statusEnum.optional(),
  regiao: z.string().max(100).optional(),
  tetoDesconto: z.number().min(0).max(100).optional(),
  comissaoPadrao: z.number().min(0).max(100).optional(),
  comissaoSite: z.number().min(0).max(100).optional(),
  empresaIds: z.array(z.string().cuid()).optional(),
  gerenteId: usuarioIdSchema.nullable().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

/**
 * O que o usuário pode mudar NO PRÓPRIO cadastro (PATCH /users/me).
 *
 * Schema separado do `updateUserSchema` de propósito: aqui é lista de permissão,
 * não de bloqueio. `role`, `status`, `tetoDesconto`, `comissaoPadrao`,
 * `empresaIds` e `gerenteId` NÃO existem neste schema — um campo novo lá não
 * vaza pra cá por esquecimento, que é como escalada de privilégio costuma
 * nascer. Quem muda esses continua sendo ADMIN/DIRECTOR pelas rotas próprias.
 *
 * `regiao` fica de fora: é atribuição comercial (quem atende onde), não dado
 * pessoal — o rep não escolhe a própria área.
 */
export const updateMeSchema = z.object({
  nome: z.string().min(2).max(150).optional(),
  telefone: z.string().min(8).max(30).optional(),
});
export type UpdateMeDto = z.infer<typeof updateMeSchema>;

export const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: roleEnum.optional(),
  status: statusEnum.optional(),
  empresaId: z.string().cuid().optional(),
});
export type ListUsersDto = z.infer<typeof listUsersSchema>;

export const updateRepDiscountLimitSchema = z.object({
  tetoDesconto: z.number().min(0).max(100),
});
export type UpdateRepDiscountLimitDto = z.infer<typeof updateRepDiscountLimitSchema>;

/**
 * As duas % de comissao da PESSOA. Sao independentes: `comissaoPadrao` e sobre
 * o pedido que ela mesma vendeu, `comissaoSite` sobre a venda de canal, onde
 * nao ha representante. Mandar so uma nao zera a outra.
 */
export const updateComissaoPercentualSchema = z
  .object({
    comissaoPadrao: z.number().min(0).max(100).optional(),
    comissaoSite: z.number().min(0).max(100).optional(),
  })
  .refine((d) => d.comissaoPadrao !== undefined || d.comissaoSite !== undefined, {
    message: 'Informe comissaoPadrao e/ou comissaoSite',
  });
export type UpdateComissaoPercentualDto = z.infer<typeof updateComissaoPercentualSchema>;

/**
 * Amarra um usuário a um CONTATO que já existe no ERP.
 *
 * O caminho normal é a rodada diária criar o contato pelo CPF/CNPJ. Isso não
 * cobre o rep que já estava cadastrado lá antes (comum: quem virou VENDEDOR no
 * painel, às vezes sem documento). Sem amarrar, a rodada criaria um segundo
 * contato e o pedido nasceria no vendedor errado.
 */
export const vincularContatoErpSchema = z.object({
  contatoErpId: z.string().trim().min(1).max(40),
});
export type VincularContatoErpDto = z.infer<typeof vincularContatoErpSchema>;
