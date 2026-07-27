import { z } from 'zod';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** true se `v` é um CUID (o que o `z.string().cuid()` aceita). */
function isCuid(v: string): boolean {
  return z.string().cuid().safeParse(v).success;
}

/**
 * ID de USUÁRIO (`Usuario.id`). Aceita **UUID e CUID** de propósito.
 *
 * Motivo: o `Usuario.id` vem do Supabase Auth (UUID) na prática — ex.:
 * `efae4ce7-6509-44a0-9708-f1ea3007ca16` — mas o default do Prisma ainda é
 * `@default(cuid())`, então um usuário criado só via Prisma seria CUID. As
 * demais entidades (cliente, funil, pedido, fluxo…) são CUID.
 *
 * ⚠️ NUNCA validar campo que aponta pra usuário com `z.string().cuid()` — isso
 * rejeita TODO usuário real (que é UUID) com "Invalid cuid". Use ESTE schema em
 * representanteId / atribuidoId / responsavelId / usuarioId / gerenteId / etc.
 */
export const usuarioIdSchema = z.string().refine((v) => UUID_RE.test(v) || isCuid(v), {
  message: 'ID de usuário inválido (esperado UUID ou CUID)',
});
