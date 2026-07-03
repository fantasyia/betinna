import { Injectable, Logger } from '@nestjs/common';
import type { IntegracaoConexao, Prisma } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CryptoUtil } from '@shared/utils/crypto.util';
import { ResendService } from '@integrations/resend/resend.service';
import type { ConectarDto, ListConexoesDto } from './integracoes.dto';
import { servicoRequerDirector, type ServicoEmpresa } from './integracoes.constants';
import { IntegracaoStatusService } from './integracao-status.service';

/** Mascara o local-part de um e-mail pra exibição (contato@x → co***@x). */
function mascararEmail(email: string): string {
  const [local, dominio] = email.split('@');
  if (!dominio) return email;
  const visivel = local.slice(0, 2);
  return `${visivel}${'*'.repeat(Math.max(1, local.length - 2))}@${dominio}`;
}

/**
 * Conexão decriptada (uso interno por serviços de integração).
 * NUNCA retornar isso pra fora — credenciais expostas.
 */
export interface ConexaoDescriptada {
  id: string;
  empresaId: string;
  servico: string;
  ativo: boolean;
  credenciais: Record<string, unknown>;
  ultimoSync: Date | null;
  errosRecentes: number;
}

/**
 * Versão segura pra retornar via API (sem credenciais).
 */
export type ConexaoPublica = Omit<IntegracaoConexao, 'credenciais'> & {
  credenciaisConfiguradas: boolean;
  camposCredenciais: string[];
};

/**
 * Serviço central que gerencia conexões de integração.
 *
 * Responsabilidades:
 *  - CRUD em `IntegracaoConexao` com criptografia AES-256-GCM at-rest
 *  - Cache em memória (5min) pra reduzir descriptografia
 *  - Resolução por empresa (multi-tenant correto)
 *  - Helpers para serviços de integração obterem suas credenciais
 *
 * Não usa Prisma `credenciais` JSON sem criptografia — todo valor passa por `CryptoUtil`.
 */
@Injectable()
export class IntegracoesService {
  private readonly logger = new Logger(IntegracoesService.name);
  private readonly crypto: CryptoUtil;
  private readonly cache = new Map<string, { value: ConexaoDescriptada; expira: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly status: IntegracaoStatusService,
    private readonly resend: ResendService,
  ) {
    this.crypto = new CryptoUtil(env.get('ENCRYPTION_KEY'));
  }

  /**
   * Status do e-mail transacional (Resend) pra gestão pela UI. O Resend é
   * SISTÊMICO (configurado por env, não por tenant), mas o semáforo de saúde
   * (IntegracaoStatus) é por empresa — atualizado nos envios e no teste.
   */
  async emailStatus(user: AuthenticatedUser): Promise<{
    servico: 'email';
    configurado: boolean;
    fromEmail: string | null;
    fromName: string;
    status: string;
    ultimoErro: string | null;
    ultimoErroEm: Date | null;
    /** Override por-tenant salvo em Empresa.config (o que a UI edita). */
    override: { fromNome: string | null; replyTo: string | null };
  }> {
    const empresaId = this.requireEmpresa(user);
    const configurado = this.resend.isConfigured();
    const fromEmail = this.env.get('RESEND_FROM_EMAIL') || null;
    const fromNameEnv = this.env.get('RESEND_FROM_NAME') || 'Betinna.ai';
    const [st, empresa] = await Promise.all([
      this.prisma.integracaoStatus.findUnique({
        where: { empresaId_servico: { empresaId, servico: 'email' } },
      }),
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { config: true } }),
    ]);
    const override = (empresa?.config as { emailTransacional?: unknown } | null)
      ?.emailTransacional as { fromNome?: string; replyTo?: string } | undefined;
    return {
      servico: 'email',
      configurado,
      fromEmail: fromEmail ? mascararEmail(fromEmail) : null,
      // Nome exibido = override do tenant, se houver; senão o do env.
      fromName: override?.fromNome?.trim() || fromNameEnv,
      // Sem registro ainda: deriva do env (configurado = ATIVA, senão DESCONECTADA).
      status: st?.status ?? (configurado ? 'ATIVA' : 'DESCONECTADA'),
      ultimoErro: st?.ultimoErro ?? null,
      ultimoErroEm: st?.ultimoErroEm ?? null,
      override: {
        fromNome: override?.fromNome?.trim() || null,
        replyTo: override?.replyTo?.trim() || null,
      },
    };
  }

  /**
   * Envia um e-mail de TESTE pro próprio usuário logado (não aceita destinatário
   * arbitrário) e registra o resultado no semáforo. Serve pra validar a config
   * do Resend pela UI sem depender de um envio real de negócio.
   */
  async enviarEmailTeste(
    user: AuthenticatedUser,
    agoraMs: number,
  ): Promise<{ ok: boolean; para: string }> {
    const empresaId = this.requireEmpresa(user);
    if (!this.resend.isConfigured()) {
      throw new BusinessRuleException(
        'Resend não configurado. Defina RESEND_API_KEY e RESEND_FROM_EMAIL no ambiente.',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const para = user.email;
    if (!para) {
      throw new BusinessRuleException(
        'Seu usuário não tem e-mail cadastrado pra receber o teste.',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    try {
      await this.resend.enviar({
        para,
        assunto: 'Teste de e-mail — Betinna.ai',
        html:
          '<div style="font-family:sans-serif;font-size:14px;color:#201554">' +
          '<h2 style="color:#201554">✅ E-mail transacional funcionando</h2>' +
          '<p>Se você recebeu esta mensagem, a integração de e-mail (Resend) da sua ' +
          'empresa está configurada e enviando normalmente.</p>' +
          '<p style="color:#6b7280;font-size:12px">Disparado pelo painel de Integrações do Betinna.ai.</p>' +
          '</div>',
        // Chave por-clique (timestamp injetado): retries do wrapper deduplicam,
        // mas cada teste manual novo realmente dispara.
        idempotencyKey: `email-teste:${empresaId}:${user.id}:${agoraMs}`,
      });
      void this.status.registrarSucesso(empresaId, 'email');
      return { ok: true, para };
    } catch (err) {
      void this.status.registrarErro(
        empresaId,
        'email',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  /**
   * D45 (revisto D48): serviços com `requerDirector=true` (OMIE, marketplaces,
   * social, WhatsApp empresa) só aceitam DIRECTOR ou ADMIN.
   *
   * Hierarquia conceitual:
   * - DIRECTOR = mandatário do TENANT — decide config do tenant dele
   * - ADMIN    = MASTER da PLATAFORMA — pode operar em qualquer tenant como
   *              suporte/override (cross-tenant)
   *
   * Outros papéis (GERENTE/SAC/REP) continuam bloqueados — eles não decidem
   * config de tenant nem têm escopo cross-tenant.
   */
  private assertDirectorRequerido(user: AuthenticatedUser, servico: ServicoEmpresa): void {
    if (servicoRequerDirector(servico) && user.role !== 'DIRECTOR' && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        `Apenas DIRETOR (do tenant) ou ADMIN (master da plataforma) pode conectar/desconectar a integração ${servico}`,
        ErrorCode.FORBIDDEN,
      );
    }
  }

  /** Lista conexões da empresa do usuário (sem credenciais). */
  async list(user: AuthenticatedUser, params: ListConexoesDto): Promise<ConexaoPublica[]> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.IntegracaoConexaoWhereInput = { empresaId };
    if (params.servico) where.servico = params.servico;
    if (params.ativo !== undefined) where.ativo = params.ativo;

    const items = await this.prisma.integracaoConexao.findMany({
      where,
      orderBy: { servico: 'asc' },
    });
    return items.map((c) => this.toPublic(c));
  }

  async findByServico(
    user: AuthenticatedUser,
    servico: ServicoEmpresa,
  ): Promise<ConexaoPublica | null> {
    const empresaId = this.requireEmpresa(user);
    const c = await this.prisma.integracaoConexao.findUnique({
      where: { empresaId_servico: { empresaId, servico } },
    });
    return c ? this.toPublic(c) : null;
  }

  /**
   * Cria ou atualiza conexão. Criptografa as credenciais antes de salvar.
   * Invalida o cache pra forçar reload no próximo uso.
   */
  async conectar(user: AuthenticatedUser, dto: ConectarDto): Promise<ConexaoPublica> {
    const empresaId = this.requireEmpresa(user);
    // D45 (2026-05-17): integrações marcadas `requerDirector` exigem role
    // DIRECTOR — nem ADMIN bypassa. OMIE é a primeira (afeta dados
    // fiscais/contábeis críticos, decisão contratual do diretor).
    this.assertDirectorRequerido(user, dto.servico);
    const enc = this.crypto.encrypt(JSON.stringify(dto.credenciais));

    const conexao = await this.prisma.integracaoConexao.upsert({
      where: { empresaId_servico: { empresaId, servico: dto.servico } },
      update: {
        credenciais: enc,
        ativo: true,
        errosRecentes: 0,
      },
      create: {
        empresaId,
        servico: dto.servico,
        ativo: true,
        credenciais: enc,
      },
    });

    this.invalidarCache(empresaId, dto.servico);
    this.logger.log(`[${dto.servico}] conexão criada/atualizada para empresa ${empresaId}`);
    return this.toPublic(conexao);
  }

  /**
   * Desativa a conexão (não apaga — mantém histórico).
   */
  async desconectar(user: AuthenticatedUser, servico: ServicoEmpresa): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    // D45: mesmo guard de DIRECTOR — quem conectou pode desconectar.
    this.assertDirectorRequerido(user, servico);
    const existing = await this.prisma.integracaoConexao.findUnique({
      where: { empresaId_servico: { empresaId, servico } },
    });
    if (!existing) throw new NotFoundException('Conexão', servico);

    await this.prisma.integracaoConexao.update({
      where: { empresaId_servico: { empresaId, servico } },
      data: { ativo: false },
    });
    this.invalidarCache(empresaId, servico);
    this.logger.log(`[${servico}] conexão desativada para empresa ${empresaId}`);
    return { ok: true };
  }

  /**
   * USO INTERNO POR SERVIÇOS DE INTEGRAÇÃO.
   * Retorna conexão decriptada (com credenciais). Cacheia 5min.
   * Lança se inexistente ou inativa.
   */
  async obterCredenciaisInternas(
    empresaId: string,
    servico: ServicoEmpresa,
  ): Promise<ConexaoDescriptada> {
    const key = `${empresaId}:${servico}`;
    const cached = this.cache.get(key);
    if (cached && cached.expira > Date.now()) {
      return cached.value;
    }

    const conexao = await this.prisma.integracaoConexao.findUnique({
      where: { empresaId_servico: { empresaId, servico } },
    });
    if (!conexao) {
      throw new BusinessRuleException(`Integração ${servico} não configurada para esta empresa`);
    }
    if (!conexao.ativo) {
      throw new BusinessRuleException(`Integração ${servico} está desativada para esta empresa`);
    }

    let credenciais: Record<string, unknown>;
    try {
      const raw = this.crypto.decrypt(conexao.credenciais as unknown as string);
      credenciais = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BusinessRuleException(`Falha ao descriptografar credenciais de ${servico}: ${msg}`);
    }

    const value: ConexaoDescriptada = {
      id: conexao.id,
      empresaId: conexao.empresaId,
      servico: conexao.servico,
      ativo: conexao.ativo,
      credenciais,
      ultimoSync: conexao.ultimoSync,
      errosRecentes: conexao.errosRecentes,
    };
    this.cache.set(key, { value, expira: Date.now() + IntegracoesService.CACHE_TTL_MS });
    return value;
  }

  /**
   * USO INTERNO POR SERVIÇOS DE INTEGRAÇÃO — escrita (par do `obterCredenciaisInternas`).
   *
   * Cifra + grava (upsert) as credenciais da conexão de empresa, marca como ativa,
   * zera erros, grava o `externalAccountId` (id da conta externa — userId/shopId/
   * sellingPartnerId/pageId — usado no routing reverso de webhook) e registra o sync
   * OK (best-effort). Centraliza o código SENSÍVEL de persistência de credencial num
   * lugar só — antes cada OAuth service (ML/Shopee/Amazon/TikTok/Meta) tinha sua
   * própria cópia de `new CryptoUtil` + `encrypt` + `upsert`. Endurecer a cripto
   * (ex.: rotação de chave) agora é UMA edição.
   *
   * `externalAccountId` é OBRIGATÓRIO (`string`, não `string | null`): todo OAuth de
   * escopo empresa tem uma conta externa. Tipar como obrigatório evita a armadilha do
   * `?? undefined` — que faria um `null` PRESERVAR o valor no UPDATE mas gravar NULL no
   * CREATE (assimetria silenciosa do Prisma).
   */
  async salvarCredenciaisInternas(
    empresaId: string,
    servico: ServicoEmpresa,
    credenciais: Record<string, unknown>,
    externalAccountId: string,
  ): Promise<void> {
    const enc = this.crypto.encrypt(JSON.stringify(credenciais));
    await this.prisma.integracaoConexao.upsert({
      where: { empresaId_servico: { empresaId, servico } },
      update: {
        credenciais: enc,
        ativo: true,
        errosRecentes: 0,
        externalAccountId,
      },
      create: {
        empresaId,
        servico,
        ativo: true,
        credenciais: enc,
        externalAccountId,
      },
    });
    // Mesmo comportamento que os services tinham após o upsert: registra sync OK
    // (atualiza ultimoSync, zera erros, invalida cache, semáforo de saúde), best-effort.
    await this.registrarSyncOk(empresaId, servico).catch(() => undefined);
  }

  /**
   * Marca um sync bem-sucedido (atualiza `ultimoSync` e zera erros).
   *
   * `ultimoSync` (high-water-mark): passe o INÍCIO do sync — não o fim. Carimbar o fim
   * (`new Date()` pós-processamento) faz registros alterados no ERP DURANTE o sync caírem
   * entre o cutoff e o carimbo, e o próximo run incremental os pula (perda). Com o início
   * há um pequeno overlap re-processado (idempotente via upsert), mas nada se perde.
   * Default `new Date()` p/ chamadas que só sinalizam saúde (não são sync incremental).
   */
  async registrarSyncOk(
    empresaId: string,
    servico: ServicoEmpresa,
    ultimoSync: Date = new Date(),
  ): Promise<void> {
    await this.prisma.integracaoConexao.updateMany({
      where: { empresaId, servico },
      data: { ultimoSync, errosRecentes: 0 },
    });
    this.invalidarCache(empresaId, servico);
    // Atualiza o semáforo de saúde (best-effort).
    void this.status.registrarSucesso(empresaId, servico);
  }

  /**
   * Marca uma falha — incrementa errosRecentes e atualiza o semáforo de saúde.
   * @param erro mensagem do erro (pra tooltip/diagnóstico)
   * @param opts.desconectado true quando é desconexão definitiva (token/sessão caiu)
   */
  async registrarSyncErro(
    empresaId: string,
    servico: ServicoEmpresa,
    erro?: string,
    opts?: { desconectado?: boolean },
  ): Promise<void> {
    await this.prisma.integracaoConexao.updateMany({
      where: { empresaId, servico },
      data: { errosRecentes: { increment: 1 } },
    });
    void this.status.registrarErro(empresaId, servico, erro, opts);
  }

  /** Marca uma integração como desconectada (token/sessão caiu) — alerta imediato. */
  async marcarDesconectado(
    empresaId: string,
    servico: ServicoEmpresa,
    erro?: string,
  ): Promise<void> {
    await this.status.marcarDesconectado(empresaId, servico, erro);
  }

  /** Lista o status (semáforo) de todas as integrações da empresa do usuário. */
  async listarStatus(user: AuthenticatedUser) {
    const empresaId = this.requireEmpresa(user);
    return this.status.listar(empresaId);
  }

  /**
   * Retorna empresa/servico de TODAS as conexões ativas — usado por jobs
   * agendados pra iterar empresas que têm a integração configurada.
   */
  async listarAtivasPorServico(
    servico: ServicoEmpresa,
  ): Promise<Array<{ empresaId: string; conexaoId: string }>> {
    const items = await this.prisma.integracaoConexao.findMany({
      where: { servico, ativo: true },
      select: { id: true, empresaId: true },
    });
    return items.map((i) => ({ empresaId: i.empresaId, conexaoId: i.id }));
  }

  private invalidarCache(empresaId: string, servico: string): void {
    this.cache.delete(`${empresaId}:${servico}`);
  }

  private toPublic(c: IntegracaoConexao): ConexaoPublica {
    // Decifra apenas pra contar campos — não devolve valores
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
      empresaId: c.empresaId,
      servico: c.servico,
      ativo: c.ativo,
      credenciais: null as never, // mascarado
      externalAccountId: c.externalAccountId,
      ultimoSync: c.ultimoSync,
      errosRecentes: c.errosRecentes,
      criadoEm: c.criadoEm,
      atualizadoEm: c.atualizadoEm,
      credenciaisConfiguradas: configurado,
      camposCredenciais,
    } as ConexaoPublica;
  }
}
