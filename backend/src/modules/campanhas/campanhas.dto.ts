import { z } from 'zod';

// ─── Enums (espelham o schema Prisma) ─────────────────────────────────────────

export const CAMPANHA_CANAIS = ['WHATSAPP', 'EMAIL', 'WHATSAPP_EMAIL'] as const;
export const CAMPANHA_STATUS = [
  'RASCUNHO',
  'AGENDADA',
  'ENVIANDO',
  'ENVIADA',
  'PAUSADA',
  'CANCELADA',
] as const;

const TONS_IA = ['formal', 'amigavel', 'urgente', 'consultivo'] as const;

// ─── Create ───────────────────────────────────────────────────────────────────

export const createCampanhaSchema = z
  .object({
    nome: z.string().min(1).max(120),
    canal: z.enum(CAMPANHA_CANAIS),
    // Segmentação — todos vazios = toda a base ativa da empresa
    segTagIds: z.array(z.string().cuid()).default([]),
    segRepIds: z.array(z.string().cuid()).default([]),
    segClienteIds: z.array(z.string().cuid()).default([]),
    // Conteúdo
    assunto: z.string().max(200).optional(),
    mensagemWa: z.string().min(1).max(4096).optional(),
    mensagemEmail: z.string().min(1).optional(),
    // Contexto IA
    objetivo: z.string().max(500).optional(),
    usarIaPersonalizacao: z.boolean().default(false),
    // Agendamento opcional — se fornecido, campanha já fica AGENDADA
    agendadoPara: z.coerce.date().optional(),
  })
  .refine(
    (d) => d.canal === 'EMAIL' || d.mensagemWa !== undefined,
    { message: 'mensagemWa é obrigatório para canais com WhatsApp', path: ['mensagemWa'] },
  )
  .refine(
    (d) => d.canal === 'WHATSAPP' || d.mensagemEmail !== undefined,
    { message: 'mensagemEmail é obrigatório para canais com email', path: ['mensagemEmail'] },
  );

export type CreateCampanhaDto = z.infer<typeof createCampanhaSchema>;

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateCampanhaSchema = z.object({
  nome: z.string().min(1).max(120).optional(),
  canal: z.enum(CAMPANHA_CANAIS).optional(),
  segTagIds: z.array(z.string().cuid()).optional(),
  segRepIds: z.array(z.string().cuid()).optional(),
  segClienteIds: z.array(z.string().cuid()).optional(),
  assunto: z.string().max(200).optional(),
  mensagemWa: z.string().min(1).max(4096).optional(),
  mensagemEmail: z.string().min(1).optional(),
  objetivo: z.string().max(500).optional(),
  usarIaPersonalizacao: z.boolean().optional(),
});

export type UpdateCampanhaDto = z.infer<typeof updateCampanhaSchema>;

// ─── Agendar ──────────────────────────────────────────────────────────────────

export const agendarCampanhaSchema = z.object({
  agendadoPara: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now(), {
      message: 'agendadoPara deve ser uma data futura',
    }),
});

export type AgendarCampanhaDto = z.infer<typeof agendarCampanhaSchema>;

// ─── List ─────────────────────────────────────────────────────────────────────

export const listCampanhasSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(CAMPANHA_STATUS).optional(),
  canal: z.enum(CAMPANHA_CANAIS).optional(),
  search: z.string().optional(),
});

export type ListCampanhasDto = z.infer<typeof listCampanhasSchema>;

// ─── IA: Gerar Conteúdo ───────────────────────────────────────────────────────

export const gerarConteudoSchema = z.object({
  canal: z.enum(CAMPANHA_CANAIS),
  objetivo: z.string().min(10).max(500),
  tom: z.enum(TONS_IA).default('amigavel'),
  segTagIds: z.array(z.string()).default([]),
  segRepIds: z.array(z.string()).default([]),
  segClienteIds: z.array(z.string()).default([]),
  numVariacoes: z.number().int().min(0).max(3).default(2),
  modelo: z.string().optional(),
});

export type GerarConteudoDto = z.infer<typeof gerarConteudoSchema>;

// ─── IA: Otimizar Mensagem ────────────────────────────────────────────────────

export const otimizarMensagemSchema = z.object({
  canal: z.enum(['WHATSAPP', 'EMAIL'] as const),
  mensagem: z.string().min(10).max(4096),
  assunto: z.string().max(200).optional(),
  objetivo: z.string().max(300).optional(),
  modelo: z.string().optional(),
});

export type OtimizarMensagemDto = z.infer<typeof otimizarMensagemSchema>;

// ─── IA: Analisar Resultado ───────────────────────────────────────────────────

export const analisarResultadoSchema = z.object({
  modelo: z.string().optional(),
});

export type AnalisarResultadoDto = z.infer<typeof analisarResultadoSchema>;

// ─── IA: Sugerir Segmento ─────────────────────────────────────────────────────

export const sugerirSegmentoSchema = z.object({
  objetivo: z.string().min(10).max(500),
  modelo: z.string().optional(),
});

export type SugerirSegmentoDto = z.infer<typeof sugerirSegmentoSchema>;
