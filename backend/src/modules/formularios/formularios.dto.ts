import { z } from 'zod';

export const FORM_CAMPO_TIPOS = [
  'TEXT',
  'EMAIL',
  'TEL',
  'NUMERO',
  'TEXTAREA',
  'SELECT',
  'CHECKBOX',
  'RADIO',
] as const;
export type FormCampoTipo = (typeof FORM_CAMPO_TIPOS)[number];

const slugRegex = /^[a-z0-9-]+$/;

export const campoSchema = z.object({
  ordem: z.number().int().min(0),
  tipo: z.enum(FORM_CAMPO_TIPOS),
  label: z.string().trim().min(1).max(200),
  campo: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Use snake_case ou camelCase, sem espaços'),
  placeholder: z.string().trim().max(200).optional(),
  obrigatorio: z.boolean().default(false),
  opcoes: z.array(z.string().min(1).max(80)).max(50).optional(),
  validacao: z
    .object({
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().positive().max(5000).optional(),
      pattern: z.string().max(200).optional(),
    })
    .optional(),
  hint: z.string().trim().max(200).optional(),
});
export type CampoDto = z.infer<typeof campoSchema>;

export const upsertFormularioSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(slugRegex, 'Slug deve conter apenas a-z, 0-9 e hífen'),
  titulo: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(2000).nullable().optional(),
  mensagemSucesso: z.string().trim().max(1000).nullable().optional(),
  redirectUrl: z.string().url().nullable().optional(),
  geraLead: z.boolean().default(true),
  leadEtapaInicial: z.string().trim().max(40).nullable().optional(),
  notificarUsuarioIds: z.array(z.string().cuid()).max(20).optional(),
  campos: z.array(campoSchema).min(1).max(40),
  ativo: z.boolean().default(true),
});
export type UpsertFormularioDto = z.infer<typeof upsertFormularioSchema>;

/** Submit público — chaves são os `campo` definidos no schema. */
export const submeterRespostaSchema = z.object({
  dados: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  // Honeypot anti-bot — se preenchido, rejeita silenciosamente
  _hp: z.string().max(0).optional(),
});
export type SubmeterRespostaDto = z.infer<typeof submeterRespostaSchema>;
