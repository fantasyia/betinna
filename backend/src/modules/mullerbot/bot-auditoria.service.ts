import { Injectable, Logger } from '@nestjs/common';
import type { BotRespostaStatus, Prisma } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';

export interface RegistrarRespostaParams {
  empresaId: string;
  conversationId?: string | null;
  messageId?: string | null;
  pergunta: string;
  resposta?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  tempoMs?: number;
  modelo?: string | null;
  status: BotRespostaStatus;
}

export interface ListarAuditoriaFiltros {
  page: number;
  limit: number;
  status?: BotRespostaStatus;
  marcadaRevisao?: boolean;
  de?: string; // ISO date
  ate?: string;
}

/**
 * Sprint 2.2 — Auditoria das respostas do bot.
 *
 * Registra cada resposta (pergunta, resposta, tokens, tempo, modelo, status) e
 * marca 🚩 automaticamente as que citam preço/estoque/prazo/etc. (palavras
 * configuráveis em `BOT_AUDIT_KEYWORDS`) — como o bot roda sem catálogo, essas
 * respostas podem estar inventando e merecem revisão humana.
 */
@Injectable()
export class BotAuditoriaService {
  private readonly logger = new Logger(BotAuditoriaService.name);
  private readonly keywords: string[];
  private static readonly EXPORT_MAX = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    env: EnvService,
  ) {
    this.keywords = env
      .get('BOT_AUDIT_KEYWORDS')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  }

  /** Avalia se a resposta deve ser marcada pra revisão (cita preço/estoque/etc.). */
  avaliarRevisao(resposta: string | null | undefined): { marcar: boolean; motivo?: string } {
    const txt = (resposta ?? '').toLowerCase();
    if (!txt) return { marcar: false };
    const hits = this.keywords.filter((k) => txt.includes(k));
    if (hits.length === 0) return { marcar: false };
    return { marcar: true, motivo: `Cita: ${hits.slice(0, 5).join(', ')}` };
  }

  /** Registra uma resposta do bot (best-effort — nunca derruba o fluxo). */
  async registrar(params: RegistrarRespostaParams): Promise<void> {
    try {
      const rev = this.avaliarRevisao(params.resposta);
      await this.prisma.botResposta.create({
        data: {
          empresaId: params.empresaId,
          conversationId: params.conversationId ?? null,
          messageId: params.messageId ?? null,
          pergunta: (params.pergunta ?? '').slice(0, 4000),
          resposta: params.resposta ? params.resposta.slice(0, 8000) : null,
          tokensIn: params.tokensIn ?? 0,
          tokensOut: params.tokensOut ?? 0,
          tempoMs: params.tempoMs ?? null,
          modelo: params.modelo ?? null,
          status: params.status,
          marcadaRevisao: rev.marcar,
          motivoRevisao: rev.motivo ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`[auditoria] falha registrando resposta: ${err instanceof Error ? err.message : err}`);
    }
  }

  private montarWhere(empresaId: string, f: Partial<ListarAuditoriaFiltros>): Prisma.BotRespostaWhereInput {
    const where: Prisma.BotRespostaWhereInput = { empresaId };
    if (f.status) where.status = f.status;
    if (f.marcadaRevisao !== undefined) where.marcadaRevisao = f.marcadaRevisao;
    if (f.de || f.ate) {
      where.criadoEm = {
        ...(f.de ? { gte: new Date(f.de) } : {}),
        ...(f.ate ? { lte: new Date(f.ate) } : {}),
      };
    }
    return where;
  }

  /** Lista paginada das respostas, com filtros. */
  async listar(empresaId: string, f: ListarAuditoriaFiltros) {
    const where = this.montarWhere(empresaId, f);
    const [total, data] = await Promise.all([
      this.prisma.botResposta.count({ where }),
      this.prisma.botResposta.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (f.page - 1) * f.limit,
        take: f.limit,
      }),
    ]);
    return {
      data,
      pagination: { page: f.page, limit: f.limit, total, totalPages: Math.ceil(total / f.limit) },
    };
  }

  /** Gera um CSV do período filtrado (até EXPORT_MAX linhas). */
  async exportarCsv(empresaId: string, f: Partial<ListarAuditoriaFiltros>): Promise<string> {
    const where = this.montarWhere(empresaId, f);
    const rows = await this.prisma.botResposta.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: BotAuditoriaService.EXPORT_MAX,
    });
    const header = [
      'data',
      'status',
      'revisar',
      'motivo',
      'pergunta',
      'resposta',
      'tokens_in',
      'tokens_out',
      'tempo_ms',
      'modelo',
      'conversa',
    ];
    const linhas = rows.map((r) =>
      [
        r.criadoEm.toISOString(),
        r.status,
        r.marcadaRevisao ? 'SIM' : '',
        r.motivoRevisao ?? '',
        r.pergunta,
        r.resposta ?? '',
        String(r.tokensIn),
        String(r.tokensOut),
        r.tempoMs != null ? String(r.tempoMs) : '',
        r.modelo ?? '',
        r.conversationId ?? '',
      ]
        .map((v) => this.csvCell(v))
        .join(','),
    );
    return [header.join(','), ...linhas].join('\r\n');
  }

  private csvCell(v: string): string {
    // Escapa aspas e envolve em aspas se houver vírgula/quebra/aspas.
    const needs = /[",\r\n]/.test(v);
    const esc = v.replace(/"/g, '""');
    return needs ? `"${esc}"` : esc;
  }
}
