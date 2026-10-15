import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { GoogleTagConfigDto } from './vitrine.dto';

/**
 * Tag do Google na vitrine (card cmv8rfj43000knz5igb2y3ws2 — #04/Léo, 15/10):
 * GA4 (G-…) e Google Ads (AW-… + rótulo da conversão de compra). Tudo
 * público (vai no HTML); fica em `Empresa.config.googleTag`, igual ao pixel.
 */
export interface ConfigGoogleTag {
  ativo?: boolean;
  ga4Id?: string | null;
  adsId?: string | null;
  /** Rótulo da conversão de compra (o que vem depois da barra no send_to). */
  compraLabel?: string | null;
}

export function configGoogleTag(config: unknown): ConfigGoogleTag {
  return (((config ?? {}) as Record<string, unknown>).googleTag ?? {}) as ConfigGoogleTag;
}

/** O que a vitrine pública recebe. null = desligada (ou sem nenhum ID). PURO. */
export function googleTagLigada(
  config: unknown,
): { ga4Id: string | null; adsId: string | null; compraSendTo: string | null } | null {
  const c = configGoogleTag(config);
  if (c.ativo !== true || (!c.ga4Id && !c.adsId)) return null;
  return {
    ga4Id: c.ga4Id || null,
    adsId: c.adsId || null,
    compraSendTo: c.adsId && c.compraLabel ? `${c.adsId}/${c.compraLabel}` : null,
  };
}

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);

@Injectable()
export class GoogleTagService {
  private readonly logger = new Logger(GoogleTagService.name);

  constructor(private readonly prisma: PrismaService) {}

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw regra('Empresa não definida');
    return id;
  }

  async status(user: AuthenticatedUser) {
    const e = await this.prisma.empresa.findUnique({
      where: { id: this.empresaDo(user) },
      select: { config: true },
    });
    return { config: configGoogleTag(e?.config) };
  }

  async salvar(user: AuthenticatedUser, dto: GoogleTagConfigDto) {
    const empresaId = this.empresaDo(user);
    const parte: ConfigGoogleTag = {
      ativo: dto.ativo,
      ga4Id: dto.ga4Id || null,
      adsId: dto.adsId || null,
      compraLabel: dto.compraLabel || null,
    };
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{googleTag}', ${JSON.stringify(parte)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.logger.log(`[google-tag] config salva na empresa ${empresaId} (ativo=${dto.ativo})`);
    return this.status(user);
  }
}
