import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { pagamentoOnlineLigado } from '@modules/checkout/checkout.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { configFrete } from './frete';
import { politicaDePrivacidade, type Politica } from './privacidade';
import type { PrivacidadeConfigDto } from './vitrine.dto';

/** O que fica em `Empresa.config.privacidade` (sem segredo). */
export interface ConfigPrivacidade {
  razaoSocial?: string;
  email?: string;
  /** AAAA-MM-DD do último salvamento — vira a "Última atualização" da página. */
  atualizadaEm?: string;
}

export function configPrivacidade(config: unknown): ConfigPrivacidade {
  return (((config ?? {}) as Record<string, unknown>).privacidade ?? {}) as ConfigPrivacidade;
}

/** Publicada = tem quem responde pelos dados E um canal de contato. */
export function privacidadePublicada(config: unknown): boolean {
  const c = configPrivacidade(config);
  return !!c.razaoSocial?.trim() && !!c.email?.trim();
}

/**
 * Política de Privacidade da vitrine (card da #04, 09/10): o Meta não libera
 * formulário de anúncio sem ela. Uma por empresa, no domínio da vitrine.
 */
@Injectable()
export class PrivacidadeService {
  private readonly logger = new Logger(PrivacidadeService.name);

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
      select: { nome: true, cnpj: true, config: true },
    });
    const c = configPrivacidade(e?.config);
    return {
      razaoSocial: c.razaoSocial ?? null,
      email: c.email ?? null,
      atualizadaEm: c.atualizadaEm ?? null,
      publicada: privacidadePublicada(e?.config),
      empresa: { nome: e?.nome ?? null, cnpj: e?.cnpj ?? null },
    };
  }

  async salvar(user: AuthenticatedUser, dto: PrivacidadeConfigDto) {
    const empresaId = this.empresaDo(user);
    const parte: ConfigPrivacidade = {
      razaoSocial: dto.razaoSocial,
      email: dto.email,
      atualizadaEm: new Date().toISOString().slice(0, 10),
    };
    // jsonb_set atômico: só a seção `privacidade`.
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{privacidade}', ${JSON.stringify(parte)}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.logger.log(`[privacidade] dados salvos na empresa ${empresaId}`);
    return this.status(user);
  }

  /** A política montada pro que a empresa usa HOJE. 404 se não publicada. */
  async publica(slug: string): Promise<Politica> {
    const v = await this.prisma.vitrine.findUnique({
      where: { slug },
      select: {
        ativa: true,
        empresa: {
          select: {
            nome: true,
            cnpj: true,
            cidade: true,
            uf: true,
            ativo: true,
            botWhatsappAtivo: true,
            config: true,
          },
        },
      },
    });
    if (!v || !v.ativa || !v.empresa.ativo || !privacidadePublicada(v.empresa.config)) {
      throw new NotFoundException('Política de privacidade');
    }
    const e = v.empresa;
    const c = configPrivacidade(e.config);
    const marca =
      ((e.config ?? {}) as { branding?: { nome?: string } }).branding?.nome?.trim() || e.nome;
    return politicaDePrivacidade({
      controlador: c.razaoSocial!.trim(),
      marca,
      cnpj: e.cnpj,
      cidade: e.cidade,
      uf: e.uf,
      email: c.email!.trim(),
      atualizadaEm: c.atualizadaEm ?? new Date().toISOString().slice(0, 10),
      usa: {
        pagamentoOnline: pagamentoOnlineLigado(e.config),
        frete: configFrete(e.config).ativo === true,
        assistenteIa: e.botWhatsappAtivo,
      },
    });
  }
}
