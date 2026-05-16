import { z } from 'zod';

const destinatarioSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

export const sendgridTestSchema = z
  .object({
    para: z.union([z.string().email(), destinatarioSchema, z.array(destinatarioSchema).min(1)]),
    assunto: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
    texto: z.string().min(1).optional(),
    templateId: z.string().regex(/^d-/).optional(),
    variaveis: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => d.templateId || d.html || d.texto, {
    message: 'Informe templateId OU html OU texto',
  })
  .refine((d) => d.templateId || d.assunto, {
    message: 'assunto obrigatório quando não usa templateId',
  });

export type SendGridTestDto = z.infer<typeof sendgridTestSchema>;
