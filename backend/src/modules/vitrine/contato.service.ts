import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { ContatoConfigDto } from './vitrine.dto';

/** O que fica em `Empresa.config.contato` (público: aparece na vitrine). */
export interface ConfigContato {
  whatsapp?: string;
}

export function configContato(config: unknown): ConfigContato {
  return (((config ?? {}) as Record<string, unknown>).contato ?? {}) as ConfigContato;
}

/**
 * Número do WhatsApp de atendimento pronto pro wa.me: só dígitos, com 55.
 * 10–11 dígitos (DDD + número) ganham o 55; fora disso, null — o ícone some
 * em vez de abrir uma conversa com número errado. PURO.
 */
export function whatsappDaVitrine(config: unknown): string | null {
  const d = (configContato(config).whatsapp ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

/**
 * Ícone do WhatsApp no topo da vitrine (Léo, 14/10): o cliente fala com a
 * empresa sem sair procurando o número. Sem número salvo, o ícone não aparece.
 */
@Injectable()
export class ContatoService {
  private readonly logger = new Logger(ContatoService.name);

  constructor(private readonly prisma: PrismaService) {}

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id)
      throw new BusinessRuleException('Empresa não definida', ErrorCode.BUSINESS_RULE_VIOLATION);
    return id;
  }

  async status(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    return {
      whatsapp: configContato(e?.config).whatsapp ?? null,
      noAr: whatsappDaVitrine(e?.config) !== null,
    };
  }

  async salvar(user: AuthenticatedUser, dto: ContatoConfigDto) {
    const empresaId = this.empresaDo(user);
    const parte: ConfigContato = { whatsapp: dto.whatsapp };
    // jsonb_set atômico: só a seção `contato`.
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{contato}', ${JSON.stringify(parte)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.logger.log(`[contato] WhatsApp da vitrine salvo na empresa ${empresaId}`);
    return this.status(user);
  }
}
