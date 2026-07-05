import { z } from 'zod';

/** Canal do template — espelha o enum CampanhaCanal do Prisma. */
export const campanhaCanalSchema = z.enum(['WHATSAPP', 'EMAIL', 'WHATSAPP_EMAIL']);

/**
 * Template de campanha reutilizável. `nome` obrigatório; conteúdo por canal
 * opcional (um template de e-mail pode não ter mensagem de WhatsApp e vice-versa).
 */
export const createCampanhaTemplateSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(500).optional(),
  canal: campanhaCanalSchema.default('EMAIL'),
  assunto: z.string().trim().max(300).optional(),
  mensagemWa: z.string().trim().max(10000).optional(),
  mensagemEmail: z.string().trim().max(50000).optional(),
  objetivo: z.string().trim().max(2000).optional(),
});

export const updateCampanhaTemplateSchema = createCampanhaTemplateSchema.partial();

export type CreateCampanhaTemplateDto = z.infer<typeof createCampanhaTemplateSchema>;
export type UpdateCampanhaTemplateDto = z.infer<typeof updateCampanhaTemplateSchema>;
