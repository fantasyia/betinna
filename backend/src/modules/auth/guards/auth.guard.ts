import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { KANBAN_TOKEN_PREFIX, hashKanbanToken } from '@modules/kanban/kanban-token.util';
import { IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { SupabaseAuthService } from '../supabase-auth.service';

/**
 * Cache hit body: { id, email, nome, role, status, empresaIds }
 * Persistido em JSON em Redis com TTL = AUTH_CACHE_TTL_SECONDS.
 */
interface CachedUser {
  id: string;
  email: string;
  nome: string;
  role: AuthenticatedUser['role'];
  status: 'ATIVO' | 'PENDENTE' | 'INATIVO';
  empresaIds: string[];
}

/**
 * Guard global de autenticação.
 *
 * Lê o header `Authorization: Bearer <jwt>`, valida no Supabase,
 * carrega o Usuario do cache Redis (fallback DB), e injeta em `req.user`.
 *
 * Rotas marcadas com `@Public()` são liberadas.
 *
 * Cache strategy (auditoria 2026-05-15, P0-5 performance):
 *  - Hit: JWT verify (CPU) + 1x Redis GET
 *  - Miss: JWT verify + Redis GET + 1x DB findUnique + Redis SETEX
 *  - Invalidação: chamar `invalidateAuthCache(userId)` em logout, mudança
 *    de role/status, vinculação/desvinculação de empresa.
 *
 * `ultimoAcesso` é atualizado de forma "best-effort throttled" — só refresca
 * se o último update foi há > 5min (evita writes em rajada).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly cacheTtlSeconds: number;
  // Throttle de ultimoAcesso — usa Redis com TTL (cluster-safe + sem memory leak).
  // Hardening 2026-05-16 (ALTA-4): substitui Map<string,number> em memória que
  // crescia indefinidamente e dava double-write em multi-replica.
  private static readonly ULTIMO_ACESSO_THROTTLE_SECONDS = 5 * 60; // 5min

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseAuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    env: EnvService,
  ) {
    this.cacheTtlSeconds = env.get('AUTH_CACHE_TTL_SECONDS');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    // Token de API do Kanban (prefixo bkt_, pro MCP server) — caminho próprio,
    // escopado às rotas /kanban. Ver @modules/kanban/kanban-token.util.
    if (token.startsWith(KANBAN_TOKEN_PREFIX)) {
      return this.autenticarKanbanToken(request, token);
    }

    // 1) JWT signature/expiry verify (sem DB)
    const payload = await this.supabase.verifyToken(token);
    const userId = payload.sub;

    // 2) Resolve usuario via cache (fallback DB)
    const cached = await this.loadUser(userId);
    if (!cached) {
      throw new UnauthorizedException(
        'Usuário autenticado no Supabase mas não cadastrado no sistema',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    if (cached.status === 'INATIVO') {
      throw new ForbiddenException('Usuário desativado', ErrorCode.AUTH_USER_DISABLED);
    }
    if (cached.status === 'PENDENTE') {
      throw new ForbiddenException(
        'Usuário ainda não finalizou o onboarding',
        ErrorCode.AUTH_USER_PENDING,
      );
    }

    const requestedEmpresa = this.extractEmpresaHeader(request);
    const empresaIdAtiva = this.resolveEmpresaAtiva(
      cached.empresaIds,
      requestedEmpresa,
      cached.role,
    );

    const authUser: AuthenticatedUser = {
      id: cached.id,
      email: cached.email,
      nome: cached.nome,
      role: cached.role,
      empresaIds: cached.empresaIds,
      empresaIdAtiva,
    };
    request.user = authUser;

    // 3) ultimoAcesso throttle — escreve no DB no máximo a cada 5min/user
    this.touchUltimoAcesso(userId);

    return true;
  }

  // ─── Token de API do Kanban (MCP) ───────────────────────────────────────

  /**
   * Autentica via KanbanApiToken (Batch 6 do Kanban):
   *  - SÓ vale em rotas /kanban (e nunca em /kanban/api-tokens — token não
   *    gera/gerencia token).
   *  - Valida o sha256 contra o banco; revogado/inexistente → 401.
   *  - Carrega o dono do token (mesmo cache Redis do fluxo JWT) e injeta
   *    req.user com empresaIdAtiva = empresa do token.
   *  - Atualiza ultimoUso com throttle de 60s (telemetria, best-effort).
   */
  private async autenticarKanbanToken(request: Request, token: string): Promise<boolean> {
    const path = request.path ?? '';
    const ehRotaKanban = /\/kanban(\/|$)/.test(path);
    const ehRotaTokens = path.includes('/kanban/api-tokens');
    if (!ehRotaKanban || ehRotaTokens) {
      throw new ForbiddenException(
        'Token de API do Kanban só pode acessar rotas /kanban (exceto gestão de tokens)',
      );
    }

    const row = await this.prisma.kanbanApiToken.findUnique({
      where: { tokenHash: hashKanbanToken(token) },
    });
    if (!row || row.revogado) {
      throw new UnauthorizedException('Token de API inválido ou revogado');
    }

    const cached = await this.loadUser(row.usuarioId);
    if (!cached) {
      throw new UnauthorizedException('Dono do token não existe mais');
    }
    if (cached.status !== 'ATIVO') {
      throw new ForbiddenException('Dono do token está desativado', ErrorCode.AUTH_USER_DISABLED);
    }
    // Token é escopado à empresa em que foi criado; o vínculo precisa seguir válido
    if (cached.role !== 'ADMIN' && !cached.empresaIds.includes(row.empresaId)) {
      throw new ForbiddenException(
        'Token de empresa à qual o usuário não pertence mais',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }

    request.user = {
      id: cached.id,
      email: cached.email,
      nome: cached.nome,
      role: cached.role,
      empresaIds: cached.empresaIds,
      empresaIdAtiva: row.empresaId,
    };

    // ultimoUso throttled (mesma técnica do ultimoAcesso)
    const throttleKey = `kanban:token:touched:${row.id}`;
    this.redis
      .setNxEx(throttleKey, '1', 60)
      .then((acquired) => {
        if (!acquired) return;
        return this.prisma.kanbanApiToken
          .update({ where: { id: row.id }, data: { ultimoUso: new Date() } })
          .then(() => undefined);
      })
      .catch(() => {
        /* best-effort */
      });

    return true;
  }

  // ─── Cache helpers ────────────────────────────────────────────────────

  private cacheKey(userId: string): string {
    return `auth:user:${userId}`;
  }

  private async loadUser(userId: string): Promise<CachedUser | null> {
    const key = this.cacheKey(userId);
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as CachedUser;
      }
    } catch (err) {
      this.logger.warn(`Auth cache read falhou: ${err instanceof Error ? err.message : err}`);
    }

    // Miss — busca DB
    const dbUser = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: { empresas: { select: { empresaId: true } } },
    });
    if (!dbUser) return null;

    const cached: CachedUser = {
      id: dbUser.id,
      email: dbUser.email,
      nome: dbUser.nome,
      role: dbUser.role,
      status: dbUser.status,
      empresaIds: dbUser.empresas.map((e) => e.empresaId),
    };

    try {
      await this.redis.setEx(key, JSON.stringify(cached), this.cacheTtlSeconds);
    } catch (err) {
      this.logger.warn(`Auth cache write falhou: ${err instanceof Error ? err.message : err}`);
    }

    return cached;
  }

  /**
   * Invalida o cache de um usuário. Chame em mudanças de role/status/empresas
   * e em logout explícito.
   *
   * NOTA: este método é estático para uso direto sem injetar AuthGuard.
   * Internamente usa o RedisService instance singleton via dependência indireta.
   */
  static async invalidate(redis: RedisService, userId: string): Promise<void> {
    await redis.del(`auth:user:${userId}`);
  }

  /**
   * Atualiza `ultimoAcesso` de forma throttled (no máximo 1x a cada 5min/user).
   *
   * Hardening 2026-05-16 (ALTA-4): usa Redis `SET NX EX` em vez de Map em memória.
   *  - Sem memory leak (TTL automático)
   *  - Cluster-safe (locks atômicos entre réplicas)
   *  - Fail-open: se Redis cair, escreve no DB normalmente (não é crítico)
   */
  private touchUltimoAcesso(userId: string): void {
    const key = `auth:touched:${userId}`;
    this.redis
      .setNxEx(key, '1', AuthGuard.ULTIMO_ACESSO_THROTTLE_SECONDS)
      .then((acquired) => {
        if (!acquired) return; // throttle ativo, outro request já escreveu
        return this.prisma.usuario
          .update({ where: { id: userId }, data: { ultimoAcesso: new Date() } })
          .then(() => undefined);
      })
      .catch(() => {
        /* não-crítico — telemetria de ultimoAcesso é best-effort */
      });
  }

  // ─── Token / header helpers ────────────────────────────────────────────

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization ?? req.headers.Authorization;
    if (typeof header !== 'string') return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value.trim();
  }

  private extractEmpresaHeader(req: Request): string | null {
    const v = req.headers['x-empresa-id'];
    if (typeof v === 'string' && v.length > 0) return v;
    return null;
  }

  private resolveEmpresaAtiva(
    empresaIds: string[],
    requested: string | null,
    role?: string,
  ): string | null {
    if (requested) {
      // ADMIN é master da plataforma (cross-tenant, D48): pode operar qualquer
      // empresa via o seletor — não precisa estar vinculado a ela.
      if (role === 'ADMIN') return requested;
      if (!empresaIds.includes(requested)) {
        throw new ForbiddenException(
          'Você não tem acesso a esta empresa',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      return requested;
    }
    return empresaIds[0] ?? null;
  }
}
