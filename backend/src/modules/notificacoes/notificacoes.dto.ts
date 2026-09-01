import { z } from 'zod';

const TIPO_VALUES = [
  'APROVACAO_PENDENTE',
  'APROVACAO_RESOLVIDA',
  'OCORRENCIA_ABERTA',
  'OCORRENCIA_RESOLVIDA',
  'PEDIDO_APROVADO',
  'COMISSAO_FECHADA',
  'COMISSAO_PAGA',
  'MENSAGEM_INBOX',
  'AMOSTRA_FOLLOWUP',
  'LEAD_INATIVO',
  'CLIENTE_BLOQUEADO',
  'GENERICO',
] as const;

export const listSchema = z.object({
  apenasNaoLidas: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
  tipo: z.enum(TIPO_VALUES).optional(),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNotificacoesDto = z.infer<typeof listSchema>;

/**
 * O `link` da notificação vira `navigate(n.link)` no sino do frontend. Sem
 * amarrar o formato, quem pode criar notificação (ADMIN/DIRECTOR da empresa)
 * escolhe pra onde o clique leva — inclusive pra fora, com `//evil` ou `\\evil`,
 * que o navegador lê como protocol-relative e o roteador segue.
 *
 * Então: SÓ caminho interno. Uma barra, e a segunda posição não pode ser outra
 * barra nem contrabarra — é essa dupla que forma o "//" e o "/\" que escapam da
 * origem. É a mesma classe do advisory do react-router (open redirect via
 * backslash em <Link>/useNavigate), e vale ter a trava aqui também: assim o
 * buraco não volta se a UI mudar de roteador.
 */
const linkInterno = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^\/(?![/\\])/.test(v), {
    message: 'link deve ser um caminho interno começando com "/" (ex: /leads/abc123)',
  });

export const criarSchema = z.object({
  usuarioId: z.string().min(1),
  tipo: z.enum(TIPO_VALUES),
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
  titulo: z.string().trim().min(2).max(160),
  mensagem: z.string().trim().min(2).max(500),
  link: linkInterno.optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
export type CriarNotificacaoDto = z.infer<typeof criarSchema>;
