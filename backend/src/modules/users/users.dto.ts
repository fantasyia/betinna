import { UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';

const roleEnum = z.nativeEnum(UserRole);
const statusEnum = z.nativeEnum(UserStatus);

export const createUserSchema = z
  .object({
    nome: z.string().min(2).max(150),
    email: z.string().email(),
    telefone: z.string().min(8).max(30).optional(),
    role: roleEnum,
    regiao: z.string().max(100).optional(),
    tetoDesconto: z.number().min(0).max(100).optional(),
    comissaoPadrao: z.number().min(0).max(100).optional(),
    empresaIds: z.array(z.string().cuid()).min(1, 'Pelo menos uma empresa é necessária'),
    /** Apenas para REP: id do GERENTE responsável pela carteira (opcional — sem gerente, DIRECTOR cuida). */
    gerenteId: z.string().cuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
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
  role: roleEnum.optional(),
  status: statusEnum.optional(),
  regiao: z.string().max(100).optional(),
  tetoDesconto: z.number().min(0).max(100).optional(),
  comissaoPadrao: z.number().min(0).max(100).optional(),
  empresaIds: z.array(z.string().cuid()).optional(),
  gerenteId: z.string().cuid().nullable().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

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

export const updateComissaoPercentualSchema = z.object({
  comissaoPadrao: z.number().min(0).max(100),
});
export type UpdateComissaoPercentualDto = z.infer<typeof updateComissaoPercentualSchema>;
