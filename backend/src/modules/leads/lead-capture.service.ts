import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AppException, UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { LeadsService } from './leads.service';
import type { LeadCapturePublicoDto } from './lead-capture.dto';

/** Teto de POSTs por chave por minuto (formulário de site não passa disso). */
const RL_MAX_POR_MIN = 60;

/**
 * Captura PÚBLICA de leads — formulários do site do tenant POSTam aqui.
 *
 * Modelo de credencial: chave de API por tenant (`blc_<hex>`), enviada no header
 * `x-api-key`. Só o SHA-256 fica no banco; a chave em claro aparece UMA vez ao
 * gerar/rotacionar (estilo Stripe, mesmo padrão do WebhookEntrada).
 *
 * A chave vive no JS público do site — por isso o escopo dela é MÍNIMO (só criar
 * lead), com rate-limit por chave, dedup por telefone (sufixo-8, D18) e rotação.
 *
 * 401 uniforme pra chave inexistente/inativa (sem oráculo de existência).
 */
@Injectable()
export class LeadCaptureService {
  private readonly logger = new Logger(LeadCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly leads: LeadsService,
  ) {}

  // ─── Gestão (DIRECTOR/ADMIN, autenticado) ────────────────────────────

  /** Gera (ou ROTACIONA) a chave da empresa. A chave em claro sai UMA vez. */
  async gerarChave(user: AuthenticatedUser): Promise<{ chave: string; prefixo: string }> {
    const empresaId = this.requireEmpresa(user);
    const chave = `blc_${randomBytes(24).toString('hex')}`;
    const prefixo = `${chave.slice(0, 12)}…`;
    await this.prisma.leadCaptureChave.upsert({
      where: { empresaId },
      update: { chaveHash: this.hash(chave), prefixo, ativo: true, ultimoUsoEm: null },
      create: { empresaId, chaveHash: this.hash(chave), prefixo, ativo: true },
    });
    this.logger.log(`Chave de captura de leads gerada/rotacionada (empresa ${empresaId})`);
    return { chave, prefixo };
  }

  /** Status da chave (sem expor a chave — só prefixo/uso). */
  async status(user: AuthenticatedUser): Promise<{
    configurada: boolean;
    ativo: boolean;
    prefixo: string | null;
    criadoEm: Date | null;
    ultimoUsoEm: Date | null;
  }> {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.leadCaptureChave.findUnique({
      where: { empresaId },
      select: { ativo: true, prefixo: true, criadoEm: true, ultimoUsoEm: true },
    });
    return {
      configurada: !!row,
      ativo: row?.ativo ?? false,
      prefixo: row?.prefixo ?? null,
      criadoEm: row?.criadoEm ?? null,
      ultimoUsoEm: row?.ultimoUsoEm ?? null,
    };
  }

  /** Desativa a chave (formulários param de criar lead até rotacionar/reativar). */
  async desativar(user: AuthenticatedUser): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    await this.prisma.leadCaptureChave.updateMany({
      where: { empresaId },
      data: { ativo: false },
    });
    return { ok: true };
  }

  // ─── Receiver público ────────────────────────────────────────────────

  /**
   * Cria o lead a partir do formulário do site.
   * Dedup: telefone (sufixo-8, D18) OU e-mail igual em lead ABERTO da empresa →
   * retorna o existente com `duplicado: true` (form reenviado não duplica funil).
   */
  async capturar(
    chaveApresentada: string | undefined,
    dto: LeadCapturePublicoDto,
  ): Promise<{ ok: true; leadId: string; duplicado: boolean }> {
    const empresaId = await this.autenticarChave(chaveApresentada);

    // marca uso (best-effort, não bloqueia o caminho feliz)
    void this.prisma.leadCaptureChave
      .updateMany({ where: { empresaId }, data: { ultimoUsoEm: new Date() } })
      .catch(() => undefined);

    const duplicado = await this.acharLeadAberto(empresaId, dto.telefone, dto.email);
    if (duplicado) {
      return { ok: true, leadId: duplicado, duplicado: true };
    }

    const lead = await this.leads.createPublico(empresaId, {
      nome: dto.nome,
      contatoNome: dto.contatoNome,
      contatoTelefone: dto.telefone,
      contatoEmail: dto.email,
      cidade: dto.cidade,
      uf: dto.uf,
      segmento: dto.segmento,
      // Só a mensagem livre vai pra observações; o resto vira campo estruturado.
      observacoes: dto.mensagem?.trim() || undefined,
      funilId: dto.funilId,
      funilEtapaId: dto.funilEtapaId,
      variaveis: this.montarVariaveis(dto),
    });
    this.logger.log(`Lead capturado do site: ${lead.id} (empresa ${empresaId})`);
    return { ok: true, leadId: lead.id, duplicado: false };
  }

  /**
   * Lista os funis (com etapas) do tenant da chave — pro dev do site descobrir
   * funilId/funilEtapaId programaticamente. Mesma auth (x-api-key) da captura.
   */
  async listarFunis(
    chaveApresentada: string | undefined,
  ): Promise<Array<{ id: string; nome: string; etapas: Array<{ id: string; nome: string }> }>> {
    const empresaId = await this.autenticarChave(chaveApresentada);
    return this.prisma.funil.findMany({
      where: { empresaId, ativo: true },
      orderBy: { ordem: 'asc' },
      select: {
        id: true,
        nome: true,
        etapas: { orderBy: { ordem: 'asc' }, select: { id: true, nome: true } },
      },
    });
  }

  // ─── internos ────────────────────────────────────────────────────────

  /**
   * Valida a chave x-api-key (formato + rate-limit + lookup) → empresaId.
   * 401 uniforme pra chave inexistente/inativa (sem oráculo de existência).
   */
  private async autenticarChave(chaveApresentada: string | undefined): Promise<string> {
    const chave = (chaveApresentada ?? '').trim();
    if (!chave.startsWith('blc_') || chave.length < 20) {
      throw new UnauthorizedException('Chave de API inválida');
    }
    if (!(await this.dentroDoLimite(chave))) {
      throw new AppException(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Muitas requisições',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const row = await this.prisma.leadCaptureChave.findUnique({
      where: { chaveHash: this.hash(chave) },
      select: { empresaId: true, ativo: true },
    });
    if (!row || !row.ativo) {
      throw new UnauthorizedException('Chave de API inválida');
    }
    return row.empresaId;
  }

  /**
   * Monta o JSON `Lead.variaveis` com os campos estruturados da captura (só os
   * enviados). Ficam legíveis nos fluxos como {{custom.<chave>}} e na tela do lead.
   */
  private montarVariaveis(dto: LeadCapturePublicoDto): Record<string, unknown> {
    const v: Record<string, unknown> = {};
    if (dto.origem?.trim()) v.origem = dto.origem.trim();
    if (dto.empresa?.trim()) v.empresa = dto.empresa.trim();
    if (dto.cargo?.trim()) v.cargo = dto.cargo.trim();
    if (dto.regiao?.trim()) v.regiao = dto.regiao.trim();
    if (dto.experiencia?.trim()) v.experiencia = dto.experiencia.trim();
    if (dto.paginaOrigem?.trim()) v.paginaOrigem = dto.paginaOrigem.trim();
    if (dto.consentimentoLgpd) v.consentimentoLgpd = dto.consentimentoLgpd;
    if (dto.metadados) v.metadados = dto.metadados;
    return v;
  }

  /**
   * Lead ABERTO da empresa com o mesmo telefone (sufixo-8, D18 — NUNCA
   * `contains`: quebra com telefone formatado) ou mesmo e-mail.
   */
  private async acharLeadAberto(
    empresaId: string,
    telefone?: string,
    email?: string,
  ): Promise<string | null> {
    const digitos = (telefone ?? '').replace(/\D/g, '');
    if (digitos.length >= 8) {
      const sufixo = digitos.slice(-8);
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Lead"
        WHERE "empresaId" = ${empresaId}
          AND etapa NOT IN ('GANHO', 'PERDIDO')
          AND "contatoTelefone" IS NOT NULL
          AND RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8) = ${sufixo}
        ORDER BY "criadoEm" DESC
        LIMIT 1
      `;
      if (rows[0]) return rows[0].id;
    }
    if (email) {
      const porEmail = await this.prisma.lead.findFirst({
        where: {
          empresaId,
          contatoEmail: { equals: email, mode: 'insensitive' },
          etapa: { notIn: ['GANHO', 'PERDIDO'] },
        },
        orderBy: { criadoEm: 'desc' },
        select: { id: true },
      });
      if (porEmail) return porEmail.id;
    }
    return null;
  }

  /** Rate-limit por chave (janela 1min). Fail-open se Redis cair. */
  private async dentroDoLimite(chave: string): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `leadcap:rl:${this.hash(chave).slice(0, 16)}:${bucket}`;
    try {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.client.expire(key, 90);
      return n <= RL_MAX_POR_MIN;
    } catch {
      return true;
    }
  }

  private hash(chave: string): string {
    return createHash('sha256').update(chave).digest('hex');
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Usuário sem empresa ativa',
        HttpStatus.BAD_REQUEST,
      );
    }
    return user.empresaIdAtiva;
  }
}
