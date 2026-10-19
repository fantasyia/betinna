import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * Modo interno da vitrine (card cmv8ztb8u00bvnw5iqrzyhi7p — #04/Léo, 19/10):
 * visita da EQUIPE não conta como cliente — sem pixel do Meta, sem Google Ads,
 * GA4 marcado como tráfego interno e pedido sem compra pro Meta/Google.
 *
 * Interno é quem tem UM dos dois:
 *  - o código do link "marcar este aparelho" (HMAC da empresa — não fica no banco);
 *  - um IP que algum usuário da empresa já usou no app (histórico de ações),
 *    mais os IPs cadastrados à mão na tela.
 */

/** Código do link de marcação: estável por empresa, impossível de adivinhar. PURO. */
export function codigoInterno(empresaId: string, chave: string): string {
  return createHmac('sha256', chave)
    .update(`vitrine-interno:${empresaId}`)
    .digest('hex')
    .slice(0, 24);
}

export function codigoConfere(empresaId: string, chave: string, codigo: unknown): boolean {
  if (typeof codigo !== 'string' || !/^[0-9a-f]{24}$/.test(codigo) || !chave) return false;
  const certo = Buffer.from(codigoInterno(empresaId, chave));
  return timingSafeEqual(certo, Buffer.from(codigo));
}

/** IP que serve pra reconhecer alguém (fora loopback/rede interna). PURO. */
export function ipUtil(ip: string | null | undefined): string | null {
  const v = (ip ?? '').trim().replace(/^::ffff:/, '');
  if (!v || v.length > 64) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|::1$|fc|fd|fe80)/i.test(v)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return null;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return null; // CGNAT do proxy
  return v;
}

interface ConfigInterno {
  /** IPs cadastrados à mão (escritório, casa…). */
  ips?: string[];
}

export function configInterno(config: unknown): ConfigInterno {
  return (((config ?? {}) as Record<string, unknown>).interno ?? {}) as ConfigInterno;
}

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);
const CACHE_MS = 10 * 60_000;

@Injectable()
export class ModoInternoService {
  private readonly logger = new Logger(ModoInternoService.name);
  private readonly cache = new Map<string, { em: number; ips: Set<string> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  private chave(): string {
    return this.env.get('ENCRYPTION_KEY') || '';
  }

  /**
   * Todos os IPs da equipe: os que os usuários da empresa já usaram no app
   * (desde sempre) + os cadastrados à mão. Cache de 10 min.
   */
  async ipsDaEquipe(empresaId: string): Promise<{ doApp: string[]; manuais: string[] }> {
    const [doApp, emp] = await Promise.all([
      this.prisma.$queryRaw<Array<{ ip: string }>>`
        SELECT DISTINCT a.ip FROM "AuditLog" a
        WHERE a.ip IS NOT NULL
          AND (a."empresaId" = ${empresaId}
            OR a."usuarioId" IN (SELECT ue."usuarioId" FROM "UsuarioEmpresa" ue WHERE ue."empresaId" = ${empresaId}))`,
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { config: true } }),
    ]);
    return {
      doApp: [...new Set(doApp.map((r) => ipUtil(r.ip)).filter((x): x is string => !!x))].sort(),
      manuais: (configInterno(emp?.config).ips ?? [])
        .map((x) => ipUtil(x))
        .filter((x): x is string => !!x),
    };
  }

  private async conjunto(empresaId: string): Promise<Set<string>> {
    const c = this.cache.get(empresaId);
    if (c && Date.now() - c.em < CACHE_MS) return c.ips;
    const { doApp, manuais } = await this.ipsDaEquipe(empresaId);
    const ips = new Set([...doApp, ...manuais]);
    this.cache.set(empresaId, { em: Date.now(), ips });
    return ips;
  }

  /** Esta visita/pedido é da equipe? Nunca lança (na dúvida, NÃO é interno). */
  async ehInterno(
    empresaId: string,
    ip: string | null | undefined,
    codigo?: unknown,
  ): Promise<boolean> {
    try {
      if (codigoConfere(empresaId, this.chave(), codigo)) return true;
      const v = ipUtil(ip);
      return !!v && (await this.conjunto(empresaId)).has(v);
    } catch (err) {
      this.logger.warn(`[interno] empresa ${empresaId}: não conferiu — ${String(err)}`);
      return false;
    }
  }

  // ─── Tela de configuração ────────────────────────────────────────────────

  private empresaDo(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw regra('Empresa não definida');
    return id;
  }

  async status(user: AuthenticatedUser) {
    const empresaId = this.empresaDo(user);
    const [ips, emp] = await Promise.all([
      this.ipsDaEquipe(empresaId),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { config: true, vitrine: { select: { slug: true } } },
      }),
    ]);
    const dominio = ((emp?.config ?? {}) as { branding?: { dominio?: string } }).branding?.dominio;
    return {
      codigo: codigoInterno(empresaId, this.chave()),
      dominio: dominio || null,
      slug: emp?.vitrine?.slug ?? null,
      ...ips,
    };
  }

  async salvarIps(user: AuthenticatedUser, ips: string[]) {
    const empresaId = this.empresaDo(user);
    const limpos = [...new Set(ips.map((x) => ipUtil(x)).filter((x): x is string => !!x))].slice(
      0,
      50,
    );
    await this.prisma.$executeRaw`
      UPDATE "Empresa"
      SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{interno}', ${JSON.stringify({ ips: limpos })}::jsonb, true)
      WHERE "id" = ${empresaId}`;
    this.cache.delete(empresaId);
    return this.status(user);
  }
}
