import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { Public } from '@shared/decorators/public.decorator';
import {
  ForbiddenException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { ZodValidationPipe } from '@shared/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { RefreshTokenService } from './refresh-token.service';

const refreshTrackSchema = z.object({
  refreshToken: z.string().min(20),
});
type RefreshTrackDto = z.infer<typeof refreshTrackSchema>;

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
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Retorna o usuário autenticado (validação do JWT + carregamento do contexto)',
  })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Logout — invalida cache do AuthGuard + refresh tracking.
   * Frontend DEVE também chamar `supabase.auth.signOut()` para invalidar
   * o refresh token no Supabase (revoke).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout: invalida cache local + tracking de refresh' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.refreshTokens.signOut(user);
  }

  /**
   * Endpoint de defesa em profundidade — frontend chama APÓS um refresh
   * bem-sucedido para registrar o novo `refreshToken` como o ATUAL.
   *
   * Se um token antigo for apresentado depois, detectamos reuse e
   * invalidamos todas as sessões do usuário.
   *
   * Supabase Auth já implementa rotation internamente; este endpoint é
   * camada EXTRA para detectar reuse no nosso lado.
   */
  @Post('refresh-track')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registra novo refresh token como atual (chamado após refreshSession do Supabase)',
  })
  async trackRefresh(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(refreshTrackSchema)) dto: RefreshTrackDto,
  ): Promise<void> {
    await this.refreshTokens.assertCurrent(user.id, dto.refreshToken);
    // Marca o novo como atual — se passou assertCurrent (ou primeira vez), promove
    await this.refreshTokens.markCurrent(user.id, dto.refreshToken);
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
    if (provided !== expectedToken) {
      throw new UnauthorizedException(
        'Token de bootstrap inválido',
        ErrorCode.AUTH_REQUIRED,
      );
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
          plano: 'Enterprise',
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
