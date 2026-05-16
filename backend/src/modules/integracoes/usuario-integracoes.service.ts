import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, UsuarioIntegracao } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CryptoUtil } from '@shared/utils/crypto.util';
import type { ServicoUsuario } from './integracoes.constants';
import type { ConectarUsuarioDto, ListConexoesUsuarioDto } from './integracoes.dto';

export interface ConexaoUsuarioDescriptada {
  id: string;
  usuarioId: string;
  servico: string;
  ativo: boolean;
  credenciais: Record<string, unknown>;
  ultimoSync: Date | null;
  errosRecentes: number;
}

export type ConexaoUsuarioPublica = Omit<UsuarioIntegracao, 'credenciais'> & {
  credenciaisConfiguradas: boolean;
  camposCredenciais: string[];
};

/**
 * Gerencia conexões com escopo USUÁRIO (SendGrid, Google Calendar, OpenAI, Anthropic).
 * Cada rep tem sua própria conexão — agenda e e-mail são pessoais.
 *
 * Mesmas garantias do `IntegracoesService`:
 *  - Credenciais cifradas AES-256-GCM at-rest
 *  - Cache em memória (5min)
 *  - Helpers `obterCredenciaisInternas` pros serviços que consomem
 */
@Injectable()
export class UsuarioIntegracoesService {
  private readonly logger = new Logger(UsuarioIntegracoesService.name);
  private readonly crypto: CryptoUtil;
  private readonly cache = new Map<string, { value: ConexaoUsuarioDescriptada; expira: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    env: EnvService,
  ) {
    this.crypto = new CryptoUtil(env.get('ENCRYPTION_KEY'));
  }

  async list(
    user: AuthenticatedUser,
    params: ListConexoesUsuarioDto,
  ): Promise<ConexaoUsuarioPublica[]> {
    const where: Prisma.UsuarioIntegracaoWhereInput = { usuarioId: user.id };
    if (params.servico) where.servico = params.servico;
    if (params.ativo !== undefined) where.ativo = params.ativo;

    const items = await this.prisma.usuarioIntegracao.findMany({
      where,
      orderBy: { servico: 'asc' },
    });
    return items.map((c) => this.toPublic(c));
  }

  async findByServico(
    user: AuthenticatedUser,
    servico: ServicoUsuario,
  ): Promise<ConexaoUsuarioPublica | null> {
    const c = await this.prisma.usuarioIntegracao.findUnique({
      where: { usuarioId_servico: { usuarioId: user.id, servico } },
    });
    return c ? this.toPublic(c) : null;
  }

  async conectar(
    user: AuthenticatedUser,
    dto: ConectarUsuarioDto,
  ): Promise<ConexaoUsuarioPublica> {
    return this.conectarInterno(user.id, dto.servico, dto.credenciais);
  }

  /**
   * Para uso interno (OAuth callback do Google, refresh token, etc.).
   * Não passa por validação de DTO porque é chamado por outros services.
   */
  async conectarInterno(
    usuarioId: string,
    servico: ServicoUsuario,
    credenciais: Record<string, unknown>,
  ): Promise<ConexaoUsuarioPublica> {
    const enc = this.crypto.encrypt(JSON.stringify(credenciais));
    const conexao = await this.prisma.usuarioIntegracao.upsert({
      where: { usuarioId_servico: { usuarioId, servico } },
      update: { credenciais: enc, ativo: true, errosRecentes: 0 },
      create: { usuarioId, servico, ativo: true, credenciais: enc },
    });
    this.invalidarCache(usuarioId, servico);
    this.logger.log(`[${servico}] conexão criada/atualizada para usuário ${usuarioId}`);
    return this.toPublic(conexao);
  }

  async desconectar(user: AuthenticatedUser, servico: ServicoUsuario): Promise<{ ok: true }> {
    const existing = await this.prisma.usuarioIntegracao.findUnique({
      where: { usuarioId_servico: { usuarioId: user.id, servico } },
    });
    if (!existing) throw new NotFoundException('Conexão', servico);

    await this.prisma.usuarioIntegracao.update({
      where: { usuarioId_servico: { usuarioId: user.id, servico } },
      data: { ativo: false },
    });
    this.invalidarCache(user.id, servico);
    this.logger.log(`[${servico}] conexão desativada para usuário ${user.id}`);
    return { ok: true };
  }

  /**
   * USO INTERNO POR SERVIÇOS. Retorna conexão decriptada (com credenciais).
   * Lança se inexistente ou inativa.
   */
  async obterCredenciaisInternas(
    usuarioId: string,
    servico: ServicoUsuario,
  ): Promise<ConexaoUsuarioDescriptada> {
    const key = `${usuarioId}:${servico}`;
    const cached = this.cache.get(key);
    if (cached && cached.expira > Date.now()) {
      return cached.value;
    }

    const conexao = await this.prisma.usuarioIntegracao.findUnique({
      where: { usuarioId_servico: { usuarioId, servico } },
    });
    if (!conexao) {
      throw new BusinessRuleException(
        `Integração ${servico} não configurada para este usuário`,
      );
    }
    if (!conexao.ativo) {
      throw new BusinessRuleException(
        `Integração ${servico} está desativada para este usuário`,
      );
    }

    let credenciais: Record<string, unknown>;
    try {
      const raw = this.crypto.decrypt(conexao.credenciais as unknown as string);
      credenciais = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BusinessRuleException(
        `Falha ao descriptografar credenciais de ${servico}: ${msg}`,
      );
    }

    const value: ConexaoUsuarioDescriptada = {
      id: conexao.id,
      usuarioId: conexao.usuarioId,
      servico: conexao.servico,
      ativo: conexao.ativo,
      credenciais,
      ultimoSync: conexao.ultimoSync,
      errosRecentes: conexao.errosRecentes,
    };
    this.cache.set(key, { value, expira: Date.now() + UsuarioIntegracoesService.CACHE_TTL_MS });
    return value;
  }

  async registrarSyncOk(usuarioId: string, servico: ServicoUsuario): Promise<void> {
    await this.prisma.usuarioIntegracao.updateMany({
      where: { usuarioId, servico },
      data: { ultimoSync: new Date(), errosRecentes: 0 },
    });
    this.invalidarCache(usuarioId, servico);
  }

  async registrarSyncErro(usuarioId: string, servico: ServicoUsuario): Promise<void> {
    await this.prisma.usuarioIntegracao.updateMany({
      where: { usuarioId, servico },
      data: { errosRecentes: { increment: 1 } },
    });
  }

  private invalidarCache(usuarioId: string, servico: string): void {
    this.cache.delete(`${usuarioId}:${servico}`);
  }

  private toPublic(c: UsuarioIntegracao): ConexaoUsuarioPublica {
    let camposCredenciais: string[] = [];
    let configurado = false;
    try {
      const raw = this.crypto.decrypt(c.credenciais as unknown as string);
      const obj = JSON.parse(raw) as Record<string, unknown>;
      camposCredenciais = Object.keys(obj);
      configurado = camposCredenciais.length > 0;
    } catch {
      configurado = false;
    }
    return {
      id: c.id,
      usuarioId: c.usuarioId,
      servico: c.servico,
      ativo: c.ativo,
      credenciais: null as never,
      ultimoSync: c.ultimoSync,
      errosRecentes: c.errosRecentes,
      criadoEm: c.criadoEm,
      atualizadoEm: c.atualizadoEm,
      credenciaisConfiguradas: configurado,
      camposCredenciais,
    } as ConexaoUsuarioPublica;
  }
}
