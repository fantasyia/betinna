import { Injectable, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { addBreadcrumb } from '@shared/observability/sentry';
import { BrandingService } from '@shared/branding/branding.service';

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
 *  - `maxAge: 48h`               → sessão expira após 48h de INATIVIDADE (sem
 *                                   refresh). Enquanto o app é usado, o cookie é
 *                                   renovado a cada refresh, então não desloga no
 *                                   meio do uso — só pede login de novo depois de
 *                                   48h parado. (Antes era 30 dias.)
 *  - `path: '/api/v1/auth'`      → cookie só é enviado nesse path (minimiza
 *                                   surface CSRF — mesmo com SameSite=None)
 */
/** Pedidos de reset por endereço em 24h. Regra do Léo: manda de novo sempre, com limite claro. */
const RESET_MAX_DIA_PADRAO = 5;
/**
 * Teto por endereço em 24h. Sobrescrevível por `AUTH_RESET_MAX_DIA` no env pra
 * afrouxar durante depuração (06/09: subiu pra 50 enquanto o fluxo era
 * ajustado) e voltar a 5 sem deploy — basta remover a variável.
 */
const resetMaxDia = (): number => {
  const bruto = Number(process.env['AUTH_RESET_MAX_DIA']);
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : RESET_MAX_DIA_PADRAO;
};
/** Segundos pra absorver clique duplo sem gastar um dos cinco. */
const RESET_DEBOUNCE_S = 10;
/** Quanto o token de recovery fica reutilizável no Redis — abaixo da 1h do Supabase. */
const RESET_TOKEN_CACHE_S = 55 * 60;

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private static readonly COOKIE_NAME = 'betinna_rt';
  private static readonly COOKIE_PATH = '/api/v1/auth';
  private static readonly COOKIE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h de inatividade
  private readonly supabaseAdmin: SupabaseClient;

  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
    private readonly redis: RedisService,
    private readonly branding: BrandingService,
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
  /**
   * "Esqueceu sua senha?" — manda o link de redefinição.
   *
   * **Sempre responde a mesma coisa**, exista o e-mail ou não. Um endpoint
   * público que diferencia "não existe" de "enviado" vira consulta de quem tem
   * conta aqui: dá pra varrer uma lista inteira de endereços e descobrir os
   * clientes de um concorrente. O preço de não vazar isso é que quem digitou
   * errado não descobre pelo retorno.
   *
   * Reusa o `/welcome`, que já trata `type=recovery` — mesma tela que define a
   * senha do convite.
   *
   * A regra do Léo (06/09): **manda de novo toda vez que pedirem, com limite
   * claro.** Nada de janela muda de minutos — quem clica de novo é porque o
   * e-mail não chegou, e responder "enviado" sem mandar é o que faz a pessoa
   * clicar uma terceira vez.
   *
   *   - teto de 5 por endereço a cada 24h — é ESTA que impede bombardeio, e ao
   *     estourar a resposta DIZ que estourou (`enviado: false`). Não vaza se a
   *     conta existe: o contador é por ENDEREÇO digitado, não por conta;
   *   - 10s de debounce contra clique duplo — pra não gastar dois dos cinco num
   *     dedo nervoso. Dentro deles a resposta é a neutra.
   *
   * O `@Throttle` do controller conta por IP e sozinho não protege a CAIXA de
   * ninguém: quem trocar de IP mandaria um e-mail por requisição.
   */
  async esqueciSenha(
    email: string,
  ): Promise<{ enviado: boolean; motivo?: 'limite_diario'; restantes?: number }> {
    const alvo = email.trim().toLowerCase();
    const neutro = { enviado: true as const };

    try {
      if (!(await this.redis.setNxEx(`auth:reset:debounce:${alvo}`, '1', RESET_DEBOUNCE_S))) {
        this.logger.log(`[reset] ${alvo}: clique duplo (<${RESET_DEBOUNCE_S}s) — ignorado`);
        return neutro;
      }
      const doDia = await this.redis.incr(`auth:reset:dia:${alvo}`);
      if (doDia === 1) await this.redis.setEx(`auth:reset:dia:${alvo}`, '1', 24 * 60 * 60);
      if (doDia > resetMaxDia()) {
        this.logger.warn(
          `[reset] ${alvo}: ${doDia}º pedido em 24h — teto de ${resetMaxDia()} atingido`,
        );
        return { enviado: false, motivo: 'limite_diario', restantes: 0 };
      }
      const restantes = resetMaxDia() - doDia;

      const usuario = await this.prisma.usuario.findFirst({
        where: { email: alvo },
        // A empresa entra pro link sair no domínio DO TENANT: com white-label
        // no ar, `FRONTEND_URL` (uma só) mandaria o rep da Somatec pro domínio
        // do outro — com a marca errada, e talvez fora da allowlist do Supabase.
        select: { nome: true, status: true, empresas: { select: { empresaId: true }, take: 1 } },
      });
      // Desligado não redefine senha — seria porta de volta pra quem saiu.
      if (!usuario || usuario.status === 'INATIVO') {
        this.logger.log(`[reset] ${alvo}: sem conta ativa — nada enviado (resposta neutra)`);
        return neutro;
      }

      // O Supabase guarda UM token de recovery por usuário: cada generateLink
      // substitui o anterior. Com "manda de novo toda vez", quem tem três
      // e-mails na caixa e abre qualquer um que não seja o ÚLTIMO toma 403 —
      // medido em 06/09 (23:18 e 23:29). Então o reenvio manda o MESMO link
      // enquanto ele vale: o token vive 1h no Supabase e fica 55min no Redis;
      // gasto ou expirado, gera outro. Todos os e-mails da hora funcionam.
      // Prefixo v2: o cache anterior (06/09, antes do mapa reverso) guardou um
      // token já consumido sem jeito de invalidá-lo — trocar o namespace deixa
      // o resíduo morrer sozinho no TTL em vez de reenviar link morto.
      const chaveToken = `auth:reset:v2:token:${alvo}`;
      let tokenHash = await this.redis.get(chaveToken);
      if (!tokenHash) {
        const { data, error } = await this.supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email: alvo,
        });
        // NÃO manda o `action_link` do Supabase. Ele é um GET que CONSOME o
        // token ao ser aberto — uso único. Aberto duas vezes (segundo navegador,
        // clique duplo, scanner de link do Gmail), a segunda morre. Vai o
        // `hashed_token` numa URL NOSSA: abrir não consome nada; quem gasta o
        // token é o POST /auth/redefinir-senha, quando a senha nova é enviada.
        tokenHash = data?.properties?.hashed_token ?? null;
        if (error || !tokenHash) {
          this.logger.error(
            `[reset] ${alvo}: Supabase não gerou o token — ${error?.message ?? 'sem hashed_token'}`,
          );
          return neutro;
        }
        await this.redis.setEx(chaveToken, tokenHash, RESET_TOKEN_CACHE_S);
        // Mapa reverso: na hora de redefinir só se tem o hash, e qualquer
        // tentativa de usá-lo (com ou sem sucesso) precisa derrubar o cache.
        await this.redis.setEx(`auth:reset:v2:hash:${tokenHash}`, alvo, RESET_TOKEN_CACHE_S);
      } else {
        this.logger.log(`[reset] ${alvo}: reenviando o MESMO link (ainda válido)`);
      }
      const baseApp = await this.branding
        .urlDoApp(usuario.empresas?.[0]?.empresaId)
        .catch(() => this.env.get('FRONTEND_URL') ?? '');
      const resetUrl =
        `${(baseApp || this.env.get('FRONTEND_URL') || '').replace(/\/+$/, '')}/welcome` +
        `?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

      const enviado = await this.email.enviarRecuperacaoSenha({
        para: alvo,
        nome: usuario.nome,
        resetUrl,
        empresaId: usuario.empresas?.[0]?.empresaId,
      });
      if (!enviado.ok) {
        this.logger.error(
          `[reset] ${alvo}: e-mail NÃO saiu — ${JSON.stringify(enviado).slice(0, 200)}`,
        );
        return neutro;
      }
      this.logger.log(`[reset] ${alvo}: link enviado (${doDia}º de ${resetMaxDia()} hoje)`);
      return { enviado: true, restantes };
    } catch (err) {
      // Nunca propaga: o retorno é neutro por desenho, e um 500 aqui já contaria
      // que aquele endereço fez o servidor trabalhar.
      this.logger.error(
        `[reset] falha inesperada: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return neutro;
  }

  /**
   * Redefine a senha a partir do `token_hash` que veio no e-mail.
   *
   * O token é trocado por sessão AQUI, no POST — e não ao abrir o link. É o que
   * faz o link aguentar ser aberto em dois navegadores, ou duas vezes: até a
   * pessoa enviar a senha nova, nada foi consumido.
   *
   * Depois da troca, é o mesmo caminho do convite (`welcomeFinalize`): valida a
   * sessão, grava a senha, ativa o usuário e abre a sessão do app.
   */
  async redefinirSenha(
    tokenHash: string,
    password: string,
    res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    if (!tokenHash || tokenHash.length < 20) {
      throw new UnauthorizedException('Link de redefinição inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }
    if (!password || password.length < 8) {
      throw new BusinessRuleException('Senha deve ter no mínimo 8 caracteres');
    }
    const r = await fetch(`${this.supabaseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: this.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', token_hash: tokenHash }),
    });
    const body = (await r.json().catch(() => null)) as {
      access_token?: string;
      user?: { email?: string };
    } | null;
    // O verify CONSOME o token no Supabase, dê certo ou não. Se o cache
    // continuasse apontando pra ele, o próximo "esqueci" reenviaria um link
    // morto por até 55min. Foi o que armou o 06/09: o verify passou, o
    // welcomeFinalize deu 403 e o token gasto ficou no cache.
    await this.esquecerTokenEmCache(tokenHash, body?.user?.email);
    if (!r.ok || !body?.access_token) {
      this.logger.warn(
        `[reset] verify falhou (HTTP ${r.status}) — token usado, expirado ou inválido`,
      );
      throw new UnauthorizedException(
        'Este link já foi usado, expirou ou foi substituído por um mais novo. ' +
          'Use o e-mail MAIS RECENTE, ou peça outro em "Esqueceu sua senha?".',
        ErrorCode.AUTH_INVALID_TOKEN,
      );
    }
    return this.welcomeFinalize(body.access_token, password, res, 'reset');
  }

  /** Derruba o token do cache pelos dois lados: pelo hash e pelo e-mail dono. */
  private async esquecerTokenEmCache(tokenHash: string, emailConhecido?: string): Promise<void> {
    try {
      const chaveHash = `auth:reset:v2:hash:${tokenHash}`;
      const email = (emailConhecido ?? (await this.redis.get(chaveHash)) ?? '').toLowerCase();
      const chaves = [chaveHash, ...(email ? [`auth:reset:v2:token:${email}`] : [])];
      await this.redis.del(...chaves);
    } catch {
      /* best-effort: o pior caso é reenviar um link morto até o TTL vencer */
    }
  }

  async welcomeFinalize(
    accessToken: string,
    password: string,
    res: Response,
    /**
     * `convite` (padrão): só finaliza conta PENDENTE — é o gate contra sequestro
     * por access token velho de conta já ativa.
     * `reset`: a conta É ativa por definição. A prova de posse aqui é outra e
     * mais forte — o token de recovery que NÓS geramos e mandamos pra caixa da
     * pessoa, acabado de trocar por sessão. Medido em 06/09: sem este modo, o
     * reset do Leandro passava no verify e morria neste gate com 403,
     * consumindo o token no caminho.
     */
    modo: 'convite' | 'reset' = 'convite',
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
    if (modo === 'reset') {
      // Desligado não redefine senha — seria porta de volta pra quem saiu.
      if (!usuario || usuario.status === 'INATIVO') {
        throw new ForbiddenException(
          'Esta conta não está ativa. Fale com quem administra o sistema.',
          ErrorCode.FORBIDDEN,
        );
      }
    } else if (!usuario || usuario.status !== 'PENDENTE') {
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
