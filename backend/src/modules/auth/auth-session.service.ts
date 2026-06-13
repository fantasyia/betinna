import { Injectable, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { addBreadcrumb } from '@shared/observability/sentry';

/**
 * Sessão de auth via cookie httpOnly (D47 — 2026-05-17).
 *
 * Antes: refresh token vivia em localStorage do frontend, vulnerável a XSS.
 * Agora: o backend é o **único** que conhece o refresh token; o frontend
 * só tem o access token em memória.
 *
 * Fluxo:
 *  1. `POST /auth/login` → chama Supabase Auth REST, recebe access+refresh,
 *     set cookie httpOnly com refresh, retorna access pro frontend
 *  2. `POST /auth/refresh` → lê refresh do cookie, troca por novo access+refresh
 *     no Supabase, atualiza cookie, retorna novo access
 *  3. `POST /auth/signout` → revoga refresh no Supabase, apaga cookie
 *
 * Cookie config:
 *  - `httpOnly: true`            → JS não lê, XSS não rouba
 *  - `secure: true` em prod      → só HTTPS (Railway é tudo HTTPS)
 *  - `sameSite: 'none'` em prod  → cookies cross-site funcionam (front e back
 *                                   em domínios Railway diferentes)
 *  - `sameSite: 'lax'` em dev    → localhost:5173 → localhost:3001 funciona
 *  - `maxAge: 30 dias`           → casa com a vida útil do refresh do Supabase
 *  - `path: '/api/v1/auth'`      → cookie só é enviado nesse path (minimiza
 *                                   surface CSRF — mesmo com SameSite=None)
 */
@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private static readonly COOKIE_NAME = 'betinna_rt';
  private static readonly COOKIE_PATH = '/api/v1/auth';
  private static readonly COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
  private readonly supabaseAdmin: SupabaseClient;

  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
  ) {
    this.supabaseAdmin = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  private get supabaseUrl(): string {
    return this.env.get('SUPABASE_URL').replace(/\/$/, '');
  }

  private get supabaseAnonKey(): string {
    return this.env.get('SUPABASE_ANON_KEY');
  }

  private get isProduction(): boolean {
    return this.env.get('NODE_ENV') === 'production';
  }

  /** Login: troca email+password por access+refresh no Supabase Auth. */
  async login(
    email: string,
    password: string,
    res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    const tokenRes = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.supabaseAnonKey,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!tokenRes.ok) {
      const body = (await tokenRes.json().catch(() => null)) as {
        error_description?: string;
        msg?: string;
      } | null;
      const msg = body?.error_description ?? body?.msg ?? 'Credenciais inválidas';
      addBreadcrumb('auth', 'login-failed', { status: tokenRes.status }, 'warning');
      throw new UnauthorizedException(msg, ErrorCode.AUTH_INVALID_TOKEN);
    }

    addBreadcrumb('auth', 'login-success');

    const data = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      user?: { id?: string };
    };

    if (!data.access_token || !data.refresh_token || !data.user?.id) {
      throw new IntegrationException(
        'Supabase Auth retornou resposta incompleta',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    this.setRefreshCookie(res, data.refresh_token);
    return {
      accessToken: data.access_token,
      expiresAt: (data.expires_at ?? 0) * 1000,
      userId: data.user.id,
    };
  }

  /** Refresh: usa o refresh cookie pra obter novo access+refresh. */
  async refresh(
    req: Request,
    res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    const refreshToken = this.readRefreshCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException(
        'Refresh cookie ausente — faça login novamente',
        ErrorCode.AUTH_REQUIRED,
      );
    }

    const tokenRes = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!tokenRes.ok) {
      // Refresh token inválido/expirado/revogado → apaga cookie e força login
      this.clearRefreshCookie(res);
      throw new UnauthorizedException(
        'Sessão expirada — faça login novamente',
        ErrorCode.AUTH_EXPIRED_TOKEN,
      );
    }

    const data = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      user?: { id?: string };
    };

    if (!data.access_token || !data.refresh_token || !data.user?.id) {
      this.clearRefreshCookie(res);
      throw new IntegrationException(
        'Supabase Auth refresh retornou resposta incompleta',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // Supabase rotaciona o refresh em cada uso — sempre atualizamos o cookie.
    this.setRefreshCookie(res, data.refresh_token);
    return {
      accessToken: data.access_token,
      expiresAt: (data.expires_at ?? 0) * 1000,
      userId: data.user.id,
    };
  }

  /**
   * Finaliza o convite (welcome flow) — Lote 4 / U2 (2026-05-22).
   *
   * Fluxo do convite Supabase:
   *  1. ADMIN/DIRECTOR chama POST /users → Supabase manda email com link
   *     `<FRONTEND_URL>/welcome#access_token=...&type=invite`
   *  2. Usuário clica → WelcomePage no front pega o access_token do hash
   *     e chama POST /auth/welcome { accessToken, password }
   *  3. Backend (este método): valida o access_token chamando
   *     `GET /auth/v1/user` no Supabase → obtém { id, email }
   *     Confere que o user é PENDENTE no nosso banco (idempotente:
   *     se já ATIVO, segue mesmo assim)
   *     Chama admin.updateUserById pra setar a senha + email_confirm=true
   *     Marca status='ATIVO' no Usuario
   *     Chama this.login(email, password, res) pra abrir sessão httpOnly
   */
  async welcomeFinalize(
    accessToken: string,
    password: string,
    res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    if (!accessToken || accessToken.length < 20) {
      throw new UnauthorizedException(
        'Token de convite ausente ou inválido',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }
    if (!password || password.length < 8) {
      throw new BusinessRuleException('Senha deve ter no mínimo 8 caracteres');
    }

    // 1) Valida o accessToken no Supabase e obtém o user
    const userRes = await fetch(`${this.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: this.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!userRes.ok) {
      throw new UnauthorizedException(
        'Convite expirado ou inválido. Solicite reenvio.',
        ErrorCode.AUTH_EXPIRED_TOKEN,
      );
    }
    const supaUser = (await userRes.json()) as { id?: string; email?: string };
    if (!supaUser.id || !supaUser.email) {
      throw new IntegrationException(
        'Resposta do Supabase incompleta',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // 1.5) SEGURANÇA: o welcome só finaliza convites PENDENTES. Sem esta
    //      checagem, qualquer access token válido (de uma conta JÁ ATIVA)
    //      podia trocar a senha da conta → sequestro de conta. Conta ativa
    //      redefine senha pelo fluxo "Esqueci minha senha", não por aqui.
    //      (Mesmo gate do reenvio de convite em UsersService.)
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: supaUser.id },
      select: { status: true },
    });
    if (!usuario || usuario.status !== 'PENDENTE') {
      throw new ForbiddenException(
        'Este convite já foi finalizado ou a conta já está ativa. Para redefinir a senha, use "Esqueci minha senha".',
        ErrorCode.FORBIDDEN,
      );
    }

    // 2) Seta a senha + confirma o e-mail via admin API
    const { error: updErr } = await this.supabaseAdmin.auth.admin.updateUserById(supaUser.id, {
      password,
      email_confirm: true,
    });
    if (updErr) {
      throw new BusinessRuleException(`Falha ao definir senha: ${updErr.message}`);
    }

    // 3) Marca o usuário como ATIVO no nosso banco (best-effort; se
    //    não existir ainda, segue e o AuthGuard sincroniza depois)
    try {
      await this.prisma.usuario.update({
        where: { id: supaUser.id },
        data: { status: 'ATIVO' },
      });
    } catch (err) {
      this.logger.warn(
        `welcomeFinalize: não foi possível ativar Usuario ${supaUser.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    addBreadcrumb('auth', 'welcome-finalized', { userId: supaUser.id });

    // 4) Faz login completo (cria sessão httpOnly + retorna access)
    return this.login(supaUser.email, password, res);
  }

  /** Logout: revoga no Supabase + apaga cookie. */
  async signout(req: Request, res: Response): Promise<void> {
    const refreshToken = this.readRefreshCookie(req);
    if (refreshToken) {
      // Revoke é best-effort — mesmo se Supabase falhar, apagamos cookie local.
      try {
        await fetch(`${this.supabaseUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.supabaseAnonKey,
            Authorization: `Bearer ${refreshToken}`,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Supabase logout falhou (cookie será apagado mesmo assim): ${msg}`);
      }
    }
    this.clearRefreshCookie(res);
  }

  // ─── Helpers de cookie ──────────────────────────────────────────────────

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(AuthSessionService.COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: this.isProduction,
      // SameSite=None exige Secure → só em prod (HTTPS). Em dev, Lax suficiente.
      sameSite: this.isProduction ? 'none' : 'lax',
      maxAge: AuthSessionService.COOKIE_MAX_AGE_MS,
      path: AuthSessionService.COOKIE_PATH,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(AuthSessionService.COOKIE_NAME, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.isProduction ? 'none' : 'lax',
      path: AuthSessionService.COOKIE_PATH,
    });
  }

  private readRefreshCookie(req: Request): string | null {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[AuthSessionService.COOKIE_NAME] ?? null;
  }
}
