import { SetMetadata } from '@nestjs/common';

/** Chave de metadata lida pelo TenantThrottlerGuard.getTracker. */
export const THROTTLE_PER_USER = 'throttle_per_user';

/**
 * Faz o `TenantThrottlerGuard` usar `user.id` como chave do rate-limit em vez de
 * `empresaId`. Use em recursos POR-USUÁRIO (ex: WhatsApp pessoal do rep) — senão
 * um único usuário esgotaria a cota de TODA a empresa (o tracker padrão é por-tenant).
 */
export const ThrottlePerUser = (): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_PER_USER, true);
