import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';

/** Uso de tokens (entrada/saída) do dia e do mês. */
interface UsoAtual {
  diaIn: number;
  diaOut: number;
  mesIn: number;
  mesOut: number;
}

export interface StatusCusto {
  /** Limite é UM orçamento por período (total de tokens in+out), não dois somados. */
  dia: { usado: number; limite: number; pct: number };
  mes: { usado: number; limite: number; pct: number };
  pausadoPorCustoAte: string | null;
}

/**
 * Sprint 2.2 — Teto de custo (tokens OpenAI) do bot, por empresa.
 *
 * - Conta tokens por dia (tabela BotUsoTokens, chave = dia no fuso de Brasília).
 * - Aos 80% do teto (dia ou mês) → e-mail de alerta ao DIRETOR (1x/dia).
 * - Aos 100% → pausa o bot até a virada do dia/mês (Brasília).
 *
 * Brasil não tem horário de verão desde 2019 → fuso fixo UTC-3.
 */

// Tetos default de tokens quando a empresa não salvou a tela Persona (mesmos do statusCusto e do
// @default do schema). #31: sem estes, verificarTeto não capava nada sem persona.
const LIMITE_TOKENS_DIA_DEFAULT = 100_000;
const LIMITE_TOKENS_MES_DEFAULT = 2_000_000;

@Injectable()
export class BotCustoService {
  private readonly logger = new Logger(BotCustoService.name);
  private static readonly BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
  ) {}

  // ─── Fuso de Brasília ────────────────────────────────────────────────────

  /** Data YYYY-MM-DD no fuso de Brasília. */
  private diaBrasilia(d = new Date()): string {
    return new Date(d.getTime() - BotCustoService.BRT_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** Mês YYYY-MM no fuso de Brasília. */
  private mesBrasilia(d = new Date()): string {
    return this.diaBrasilia(d).slice(0, 7);
  }

  /** Próxima meia-noite de Brasília (em UTC). 00:00 BRT = 03:00 UTC. */
  private proximaViradaDia(): Date {
    const hojeMeiaNoiteUtc = new Date(`${this.diaBrasilia()}T03:00:00.000Z`);
    return new Date(hojeMeiaNoiteUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  /** Primeiro dia do próximo mês, 00:00 BRT (em UTC). */
  private proximaViradaMes(): Date {
    const [ano, mes] = this.mesBrasilia().split('-').map(Number);
    const proxAno = mes === 12 ? ano + 1 : ano;
    const proxMes = mes === 12 ? 1 : mes + 1;
    const mm = String(proxMes).padStart(2, '0');
    return new Date(`${proxAno}-${mm}-01T03:00:00.000Z`);
  }

  // ─── Uso ─────────────────────────────────────────────────────────────────

  private async usoAtual(empresaId: string): Promise<UsoAtual> {
    const dia = this.diaBrasilia();
    const mesPrefix = this.mesBrasilia();
    const [hoje, mesAgg] = await Promise.all([
      this.prisma.botUsoTokens.findUnique({ where: { empresaId_dia: { empresaId, dia } } }),
      this.prisma.botUsoTokens.aggregate({
        where: { empresaId, dia: { startsWith: mesPrefix } },
        _sum: { tokensIn: true, tokensOut: true },
      }),
    ]);
    return {
      diaIn: hoje?.tokensIn ?? 0,
      diaOut: hoje?.tokensOut ?? 0,
      mesIn: mesAgg._sum.tokensIn ?? 0,
      mesOut: mesAgg._sum.tokensOut ?? 0,
    };
  }

  /**
   * O bot está bloqueado por custo? Checa a pausa ativa E os tetos ao vivo
   * (caso o limite tenha sido atingido entre uma checagem e outra).
   */
  async verificarTeto(empresaId: string): Promise<{ bloqueado: boolean; motivo?: string }> {
    const persona = await this.prisma.mullerBotPersona.findUnique({ where: { empresaId } });
    // CAÇADA-BUG #31: antes retornava `bloqueado: false` cedo quando NÃO havia persona salva — mas o
    // statusCusto já exibe os limites default (100k/2M). Empresa com o bot ligado que nunca abriu a
    // tela Persona gastava tokens SEM teto nenhum. Aplica os mesmos defaults quando não há persona.
    const limiteDia = persona?.limiteTokensDiaIn ?? LIMITE_TOKENS_DIA_DEFAULT;
    const limiteMes = persona?.limiteTokensMesIn ?? LIMITE_TOKENS_MES_DEFAULT;

    if (persona?.pausadoPorCustoAte && persona.pausadoPorCustoAte.getTime() > Date.now()) {
      return {
        bloqueado: true,
        motivo: 'Teto de custo do bot atingido (pausado automaticamente).',
      };
    }

    const uso = await this.usoAtual(empresaId);
    // Orçamento único por período: total de tokens (entrada + saída) vs o limite.
    const usadoDia = uso.diaIn + uso.diaOut;
    const usadoMes = uso.mesIn + uso.mesOut;
    if (usadoDia >= limiteDia || usadoMes >= limiteMes) {
      return { bloqueado: true, motivo: 'Teto de custo do bot atingido.' };
    }
    return { bloqueado: false };
  }

  /** Soma tokens ao contador do dia e re-avalia os tetos (best-effort). */
  async registrarUso(empresaId: string, tokensIn: number, tokensOut: number): Promise<void> {
    if (tokensIn <= 0 && tokensOut <= 0) return;
    const dia = this.diaBrasilia();
    try {
      await this.prisma.botUsoTokens.upsert({
        where: { empresaId_dia: { empresaId, dia } },
        update: { tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut } },
        create: { empresaId, dia, tokensIn, tokensOut },
      });
      await this.avaliarLimites(empresaId);
    } catch (err) {
      this.logger.warn(
        `[custo] falha registrando uso: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Status pra UI (barras de progresso dia/mês). */
  async statusCusto(empresaId: string): Promise<StatusCusto> {
    const persona = await this.prisma.mullerBotPersona.findUnique({ where: { empresaId } });
    const uso = await this.usoAtual(empresaId);
    // Um orçamento por período (total in+out). limiteTokens*In guarda esse total.
    const limiteDia = persona?.limiteTokensDiaIn ?? LIMITE_TOKENS_DIA_DEFAULT;
    const limiteMes = persona?.limiteTokensMesIn ?? LIMITE_TOKENS_MES_DEFAULT;
    const usadoDia = uso.diaIn + uso.diaOut;
    const usadoMes = uso.mesIn + uso.mesOut;
    return {
      dia: { usado: usadoDia, limite: limiteDia, pct: this.pct(usadoDia, limiteDia) },
      mes: { usado: usadoMes, limite: limiteMes, pct: this.pct(usadoMes, limiteMes) },
      pausadoPorCustoAte: persona?.pausadoPorCustoAte?.toISOString() ?? null,
    };
  }

  // ─── Limites: alerta 80% / pausa 100% ────────────────────────────────────

  private async avaliarLimites(empresaId: string): Promise<void> {
    const persona = await this.prisma.mullerBotPersona.findUnique({ where: { empresaId } });
    if (!persona) return;
    const uso = await this.usoAtual(empresaId);

    const pctDia = this.pct(uso.diaIn + uso.diaOut, persona.limiteTokensDiaIn);
    const pctMes = this.pct(uso.mesIn + uso.mesOut, persona.limiteTokensMesIn);
    const estouLimiteMes = pctMes >= 100;
    const pct = Math.max(pctDia, pctMes);

    if (pct >= 100) {
      const ate = estouLimiteMes ? this.proximaViradaMes() : this.proximaViradaDia();
      // Só atualiza/alerta se ainda não estava pausado por custo.
      const jaPausado =
        persona.pausadoPorCustoAte && persona.pausadoPorCustoAte.getTime() > Date.now();
      await this.prisma.mullerBotPersona.update({
        where: { empresaId },
        data: { pausadoPorCustoAte: ate },
      });
      if (!jaPausado) {
        await this.alertar(
          empresaId,
          `🚨 O bot atingiu 100% do teto de tokens (${estouLimiteMes ? 'mensal' : 'diário'}) e foi ` +
            `<strong>pausado automaticamente</strong> até ${this.fmt(ate)}. As mensagens que chegarem ` +
            `serão marcadas como "precisa humano" no Inbox.`,
        );
      }
      return;
    }

    if (pct >= 80) {
      // Alerta de 80% no máximo 1x por dia (throttle por ultimoAlertaCustoEm).
      const jaAlertouHoje =
        persona.ultimoAlertaCustoEm &&
        this.diaBrasilia(persona.ultimoAlertaCustoEm) === this.diaBrasilia();
      if (!jaAlertouHoje) {
        await this.prisma.mullerBotPersona.update({
          where: { empresaId },
          data: { ultimoAlertaCustoEm: new Date() },
        });
        await this.alertar(
          empresaId,
          `⚠️ O bot já consumiu <strong>${Math.round(pct)}%</strong> do teto de tokens. ` +
            `Ao chegar em 100% ele pausa sozinho até a virada do período.`,
        );
      }
    }
  }

  private pct(usado: number, limite: number): number {
    return limite > 0 ? (usado / limite) * 100 : 0;
  }

  private fmt(d: Date): string {
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  // ─── Alerta por e-mail ───────────────────────────────────────────────────

  private async alertar(empresaId: string, mensagem: string): Promise<void> {
    const para = await this.resolverDestinatario(empresaId);
    if (!para) return;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nome: true },
    });
    await this.email.enviarAlertaSistema({
      para,
      assunto: `Bot Muller — alerta de custo (${empresa?.nome ?? 'empresa'})`,
      titulo: 'Alerta de custo do bot',
      mensagem,
    });
  }

  private async resolverDestinatario(empresaId: string): Promise<string | null> {
    const director = await this.prisma.usuario.findFirst({
      where: { role: 'DIRECTOR', status: 'ATIVO', empresas: { some: { empresaId } } },
      orderBy: { criadoEm: 'asc' },
      select: { email: true },
    });
    if (director?.email) return director.email;
    const admin = await this.prisma.usuario.findFirst({
      where: { role: 'ADMIN', status: 'ATIVO' },
      orderBy: { criadoEm: 'asc' },
      select: { email: true },
    });
    return admin?.email ?? null;
  }
}
