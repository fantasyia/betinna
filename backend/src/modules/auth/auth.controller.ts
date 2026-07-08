import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AuthSessionService } from './auth-session.service';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Comparação constant-time pra evitar timing attack em tokens de bootstrap.
 *
 * Se strings têm comprimentos diferentes, dummy compare pra manter tempo
 * constante mesmo na rejeição (Node `timingSafeEqual` lança RangeError em
 * tamanhos diferentes — bypassamos comparando dummy de mesmo tamanho).
 */
function safeTokenEquals(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    // Compara dummy de mesmo tamanho pra não vazar comprimento via timing
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

// D47: login com cookie httpOnly (refresh nunca toca JS)
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
type LoginDto = z.infer<typeof loginSchema>;

// U2/lote 4: finaliza convite — frontend pega access_token do hash do
// link Supabase + pede ao user pra definir senha
const welcomeSchema = z.object({
  accessToken: z.string().min(20, 'Token de convite inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
});
type WelcomeDto = z.infer<typeof welcomeSchema>;

const bootstrapSchema = z.object({
  email: z.string().email(),
  nome: z.string().min(2).max(150).optional().default('Diretor Betinna'),
  empresaNome: z.string().min(2).max(200).optional().default('Indústria Alimentos'),
  empresaCnpj: z.string().optional().default('00.000.000/0001-00'),
});
type BootstrapDto = z.infer<typeof bootstrapSchema>;

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
// Auditoria Sprint 2: rate limit estrito em endpoints de auth.
// 10 req/15min por IP — bloqueia brute force / token enumeration.
@Throttle({ default: { limit: 10, ttl: seconds(15 * 60) } })
export class AuthController {
  constructor(
    private readonly refreshTokens: RefreshTokenService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly authSession: AuthSessionService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Retorna o usuário autenticado (validação do JWT + carregamento do contexto)',
  })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Login com cookie httpOnly (D47 — 2026-05-17).
   *
   * Antes: frontend chamava Supabase Auth direto via SDK e refresh ficava
   * em localStorage (vulnerável a XSS). Agora o BACKEND troca credenciais
   * por tokens e set o refresh em cookie httpOnly; o frontend só vê o
   * access (em memória).
   *
   * Throttle estrito (10/15min do controller) já cobre brute force.
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login com cookie httpOnly. Retorna accessToken+expiresAt.' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    return this.authSession.login(dto.email, dto.password, res);
  }

  /**
   * Finaliza o convite Supabase (U2 / lote 4 — 2026-05-22).
   *
   * O frontend `/welcome` extrai o `access_token` do hash do URL e chama
   * este endpoint passando junto com a senha escolhida. Backend valida o
   * token, seta a senha no Supabase, marca o usuário como ATIVO no nosso
   * banco e abre a sessão httpOnly normal (mesmo retorno do login).
   *
   * Público (não exige token válido — o próprio body traz o token de
   * convite). Rate limit do controller já cobre brute force.
   */
  @Post('welcome')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finaliza convite: valida token Supabase, seta senha, ativa usuário e abre sessão',
  })
  async welcome(
    @Body(new ZodValidationPipe(welcomeSchema)) dto: WelcomeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    return this.authSession.welcomeFinalize(dto.accessToken, dto.password, res);
  }

  /**
   * Refresh do access token via cookie httpOnly. Retorna novo accessToken e
   * atualiza o cookie (Supabase rotaciona o refresh em cada uso).
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh do accessToken via cookie httpOnly' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; expiresAt: number; userId: string }> {
    return this.authSession.refresh(req, res);
  }

  /**
   * Logout completo: revoga refresh no Supabase + apaga cookie + invalida
   * cache local. Endpoint público (não exige token válido) — pode ser chamado
   * mesmo com sessão expirada pra limpar cookie residual.
   */
  @Post('signout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout completo: revoga Supabase + apaga cookie httpOnly' })
  async signoutSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authSession.signout(req, res);
  }

  /**
   * Logout legado — invalida cache do AuthGuard + refresh tracking.
   * Continua funcionando pra clientes antigos que ainda usam o SDK Supabase
   * direto. Novos clientes devem usar POST /auth/signout.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout: invalida cache local + tracking de refresh' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.refreshTokens.signOut(user);
  }

  /**
   * Bootstrap one-time pra sincronizar admin Supabase Auth → Postgres
   * quando o seed não consegue rodar via CLI (ambientes restritos).
   *
   * Segurança:
   *  - Endpoint só funciona se BOOTSTRAP_TOKEN estiver setado no env
   *  - Requer header `Authorization: Bearer <BOOTSTRAP_TOKEN>` matching
   *  - SÓ executa se o banco estiver com 0 usuários (first-run check)
   *  - Idempotente em si — se rodar 2x não duplica registros
   *
   * Após primeira execução bem-sucedida, ao final, a flag de "0 users"
   * naturalmente se torna false (você acabou de criar 1) → endpoint vira
   * inativo automaticamente. Tem que apagar a env var BOOTSTRAP_TOKEN
   * depois ou apenas confiar no first-run check.
   */
  @Post('bootstrap')
  @Public()
  // Rate limit estrito — endpoint privilegiado
  @Throttle({ default: { limit: 3, ttl: seconds(15 * 60) } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One-time admin bootstrap (sync Supabase Auth → Postgres). Requer header Authorization: Bearer BOOTSTRAP_TOKEN.',
  })
  async bootstrap(
    @Body(new ZodValidationPipe(bootstrapSchema)) dto: BootstrapDto,
    @Headers('authorization') auth: string | undefined,
  ): Promise<{
    ok: true;
    userId: string;
    empresaId: string;
    message: string;
  }> {
    const expectedToken = process.env.BOOTSTRAP_TOKEN;
    if (!expectedToken || expectedToken.length < 16) {
      throw new ForbiddenException(
        'Bootstrap endpoint não configurado (BOOTSTRAP_TOKEN ausente)',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const provided = (auth ?? '').replace(/^Bearer\s+/i, '').trim();
    // CRIT-1 fix: timing-safe compare evita ataque caractere-a-caractere
    if (!safeTokenEquals(provided, expectedToken)) {
      throw new UnauthorizedException('Token de bootstrap inválido', ErrorCode.AUTH_REQUIRED);
    }

    // First-run check — só permite quando ainda não há nenhum Usuario.
    // Isso evita uso indevido depois do go-live.
    const existingCount = await this.prisma.usuario.count();
    if (existingCount > 0) {
      throw new ForbiddenException(
        `Bootstrap só funciona em banco vazio. Já existem ${existingCount} usuário(s) — endpoint desabilitado automaticamente.`,
        ErrorCode.AUTH_USER_DISABLED,
      );
    }

    // Resolve Supabase user pelo email (usando service role key)
    const supabaseUrl = this.env.get('SUPABASE_URL');
    const serviceKey = this.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      throw new ForbiddenException(
        'Supabase não configurado no backend',
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
      throw new ForbiddenException(
        `Falha ao listar usuários do Supabase: ${listErr.message}`,
        ErrorCode.AUTH_USER_DISABLED,
      );
    }
    const supabaseUser = usersData?.users?.find(
      (u) => u.email?.toLowerCase() === dto.email.toLowerCase(),
    );
    if (!supabaseUser) {
      throw new ForbiddenException(
        `Usuário ${dto.email} não encontrado no Supabase Auth. Crie via Authentication → Users antes.`,
        ErrorCode.AUTH_USER_DISABLED,
      );
    }

    // Cria empresa + usuario + link em uma transação
    const result = await this.prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.upsert({
        where: { cnpj: dto.empresaCnpj },
        update: {},
        create: {
          nome: dto.empresaNome,
          cnpj: dto.empresaCnpj,
          ramo: 'Alimentos B2B',
          cidade: 'São Paulo',
          uf: 'SP',
          subtitulo: 'Matriz',
          ativo: true,
        },
      });

      const usuario = await tx.usuario.create({
        data: {
          id: supabaseUser.id,
          email: dto.email,
          nome: dto.nome,
          role: 'ADMIN',
          status: 'ATIVO',
          empresas: { create: { empresaId: empresa.id } },
        },
      });

      return { empresaId: empresa.id, userId: usuario.id };
    });

    return {
      ok: true,
      userId: result.userId,
      empresaId: result.empresaId,
      message: `Admin sincronizado com sucesso. Pode fazer login com ${dto.email}.`,
    };
  }
}
