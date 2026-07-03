import { z } from 'zod';

/**
 * Payload PÚBLICO da captura de leads (formulário do site do tenant).
 * Exige nome + pelo menos UM contato (telefone ou e-mail) — sem contato o
 * lead é inacionável e vira lixo no funil.
 */
export const leadCapturePublicoSchema = z
  .object({
    nome: z.string().trim().min(2).max(200),
    contatoNome: z.string().trim().max(150).optional(),
    telefone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(200).optional(),
    cidade: z.string().trim().max(100).optional(),
    uf: z.string().trim().length(2).optional(),
    segmento: z.string().trim().max(60).optional(),
    /** Mensagem livre do formulário → observações do lead. */
    mensagem: z.string().trim().max(2000).optional(),
    /** Identificação da página/campanha de origem (ex: "landing-masterblock"). */
    origem: z.string().trim().max(120).optional(),
    /** Funil/etapa de destino. Omitidos → funil padrão da empresa, 1ª etapa ativa. */
    funilId: z.string().min(1).max(60).optional(),
    funilEtapaId: z.string().min(1).max(60).optional(),
  })
  .refine((v) => !!(v.telefone?.trim() || v.email?.trim()), {
    message: 'Informe pelo menos telefone ou e-mail',
    path: ['telefone'],
  });

export type LeadCapturePublicoDto = z.infer<typeof leadCapturePublicoSchema>;
