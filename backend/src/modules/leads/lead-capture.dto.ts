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

    // ── Campos estruturados adicionais (todos OPCIONAIS; retrocompat total) ──
    /** Nome da empresa do lead. */
    empresa: z.string().trim().max(200).optional(),
    /** Cargo/função do contato. */
    cargo: z.string().trim().max(120).optional(),
    /** Região de atuação (leads de representante). */
    regiao: z.string().trim().max(150).optional(),
    /** Experiência declarada (leads de representante). */
    experiencia: z.string().trim().max(1000).optional(),
    /** Página do site de onde veio (ex: "/contato", "/representantes"). */
    paginaOrigem: z.string().trim().max(300).optional(),
    /** Registro de consentimento LGPD (trilha de auditoria). Subcampos tolerados ausentes. */
    consentimentoLgpd: z
      .object({
        aceito: z.boolean().optional(),
        timestamp: z.string().trim().max(60).optional(),
        versaoTexto: z.string().trim().max(60).optional(),
        hashTexto: z.string().trim().max(200).optional(),
      })
      .optional(),
    /** Dados técnicos p/ triagem/anti-fraude. Subcampos tolerados ausentes. */
    metadados: z
      .object({
        userAgent: z.string().trim().max(500).optional(),
        referer: z.string().trim().max(500).optional(),
      })
      .optional(),
  })
  .refine((v) => !!(v.telefone?.trim() || v.email?.trim()), {
    message: 'Informe pelo menos telefone ou e-mail',
    path: ['telefone'],
  });

export type LeadCapturePublicoDto = z.infer<typeof leadCapturePublicoSchema>;
