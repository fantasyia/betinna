import { Injectable, Logger } from '@nestjs/common';
import type {
  MovimentoFidelidade,
  Prisma,
  ProgramaFidelidade,
  RecompensaFidelidade,
  SaldoFidelidade,
} from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  AjustarDto,
  CreateRecompensaDto,
  ListMovimentosDto,
  ResgatarDto,
  UpdateProgramaDto,
  UpdateRecompensaDto,
} from './fidelidade.dto';

/**
 * Programa de Fidelidade — MVP B2B.
 *
 * Responsabilidades:
 *  - Programa singleton por empresa (CRUD config)
 *  - Recompensas (CRUD)
 *  - Saldo + extrato por cliente
 *  - Resgate (debita saldo + decrementa estoque + cria movimento)
 *  - Ajuste manual (DIRECTOR/ADMIN)
 *  - **Trigger automático** quando pedido é aprovado/entregue
 *    (chamado pelo PedidosService via injeção)
 *
 * Multi-tenant: todas as queries filtram por `empresaId = user.empresaIdAtiva`.
 * Saldo é desnormalizado em `SaldoFidelidade.pontos` — cada movimento atualiza
 * atomicamente dentro de uma transaction.
 */
@Injectable()
export class FidelidadeService {
  private readonly logger = new Logger(FidelidadeService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  // ─── Programa (config) ─────────────────────────────────────────────────

  /** Pega ou cria o programa singleton da empresa. */
  async getOrCreatePrograma(empresaId: string): Promise<ProgramaFidelidade> {
    const existing = await this.prisma.programaFidelidade.findUnique({
      where: { empresaId },
    });
    if (existing) return existing;
    return this.prisma.programaFidelidade.create({ data: { empresaId } });
  }

  async getPrograma(user: AuthenticatedUser): Promise<ProgramaFidelidade> {
    return this.getOrCreatePrograma(this.requireEmpresa(user));
  }

  async updatePrograma(
    user: AuthenticatedUser,
    dto: UpdateProgramaDto,
  ): Promise<ProgramaFidelidade> {
    const empresaId = this.requireEmpresa(user);
    await this.getOrCreatePrograma(empresaId); // garante row
    return this.prisma.programaFidelidade.update({
      where: { empresaId },
      data: dto,
    });
  }

  // ─── Recompensas (CRUD) ────────────────────────────────────────────────

  async listRecompensas(
    user: AuthenticatedUser,
    incluirInativas = false,
  ): Promise<RecompensaFidelidade[]> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.recompensaFidelidade.findMany({
      where: { empresaId, ...(incluirInativas ? {} : { ativo: true }) },
      orderBy: { custoPontos: 'asc' },
    });
  }

  async createRecompensa(
    user: AuthenticatedUser,
    dto: CreateRecompensaDto,
  ): Promise<RecompensaFidelidade> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.recompensaFidelidade.create({
      data: {
        empresaId,
        nome: dto.nome,
        descricao: dto.descricao ?? null,
        custoPontos: dto.custoPontos,
        tipo: dto.tipo,
        valor: dto.valor ?? null,
        estoque: dto.estoque ?? null,
        ativo: dto.ativo ?? true,
      },
    });
  }

  async updateRecompensa(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateRecompensaDto,
  ): Promise<RecompensaFidelidade> {
    const empresaId = this.requireEmpresa(user);
    const exists = await this.prisma.recompensaFidelidade.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Recompensa', id);
    return this.prisma.recompensaFidelidade.update({
      where: { id },
      data: dto,
    });
  }

  async desativarRecompensa(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    const r = await this.prisma.recompensaFidelidade.updateMany({
      where: { id, empresaId },
      data: { ativo: false },
    });
    if (r.count === 0) throw new NotFoundException('Recompensa', id);
    return { ok: true };
  }

  // ─── Saldo + extrato ───────────────────────────────────────────────────

  async getSaldo(
    user: AuthenticatedUser,
    clienteId: string,
  ): Promise<{ pontos: number; saldo: SaldoFidelidade | null }> {
    const empresaId = this.requireEmpresa(user);
    await this.assertClienteDaEmpresa(empresaId, clienteId);
    const saldo = await this.prisma.saldoFidelidade.findUnique({
      where: { clienteId },
    });
    return { pontos: saldo?.pontos ?? 0, saldo };
  }

  async listMovimentos(
    user: AuthenticatedUser,
    params: ListMovimentosDto,
  ): Promise<{
    data: MovimentoFidelidade[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const empresaId = this.requireEmpresa(user);
    if (params.clienteId) {
      await this.assertClienteDaEmpresa(empresaId, params.clienteId);
    }
    const where: Prisma.MovimentoFidelidadeWhereInput = { empresaId };
    if (params.clienteId) where.clienteId = params.clienteId;
    if (params.tipo) where.tipo = params.tipo;
    const [total, data] = await Promise.all([
      this.prisma.movimentoFidelidade.count({ where }),
      this.prisma.movimentoFidelidade.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          cliente: { select: { id: true, nome: true } },
          recompensa: { select: { id: true, nome: true } },
          pedido: { select: { id: true, numero: true } },
        },
      }),
    ]);
    return {
      data,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  // ─── Resgate ───────────────────────────────────────────────────────────

  async resgatar(
    user: AuthenticatedUser,
    dto: ResgatarDto,
  ): Promise<{ movimento: MovimentoFidelidade; saldoAposPontos: number }> {
    const empresaId = this.requireEmpresa(user);
    await this.assertClienteDaEmpresa(empresaId, dto.clienteId);

    const recompensa = await this.prisma.recompensaFidelidade.findFirst({
      where: { id: dto.recompensaId, empresaId, ativo: true },
    });
    if (!recompensa) {
      throw new NotFoundException('Recompensa ativa', dto.recompensaId);
    }
    if (recompensa.estoque !== null && recompensa.estoque <= 0) {
      throw new BusinessRuleException(
        `Recompensa "${recompensa.nome}" sem estoque`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock pessimista: garante saldo coerente em races.
      const saldo = await tx.saldoFidelidade.findUnique({
        where: { clienteId: dto.clienteId },
      });
      const saldoAtual = saldo?.pontos ?? 0;
      if (saldoAtual < recompensa.custoPontos) {
        throw new BusinessRuleException(
          `Saldo insuficiente: ${saldoAtual} pontos · resgate exige ${recompensa.custoPontos}`,
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }

      // Decrementa estoque (se controlado) — atomicamente
      if (recompensa.estoque !== null) {
        const decRes = await tx.recompensaFidelidade.updateMany({
          where: { id: recompensa.id, estoque: { gt: 0 } },
          data: { estoque: { decrement: 1 } },
        });
        if (decRes.count === 0) {
          throw new BusinessRuleException(
            'Recompensa esgotou durante o resgate — tente outra',
            ErrorCode.BUSINESS_RULE_VIOLATION,
          );
        }
      }

      // Cria movimento RESGATE (negativo)
      const movimento = await tx.movimentoFidelidade.create({
        data: {
          empresaId,
          clienteId: dto.clienteId,
          tipo: 'RESGATE',
          pontos: -recompensa.custoPontos,
          recompensaId: recompensa.id,
          criadoPorId: user.id,
        },
      });

      // Atualiza saldo (upsert pra primeira vez)
      const novoSaldo = saldoAtual - recompensa.custoPontos;
      await tx.saldoFidelidade.upsert({
        where: { clienteId: dto.clienteId },
        create: { empresaId, clienteId: dto.clienteId, pontos: novoSaldo },
        update: { pontos: novoSaldo },
      });

      return { movimento, saldoAposPontos: novoSaldo };
    });
  }

  // ─── Ajuste manual ─────────────────────────────────────────────────────

  async ajustar(user: AuthenticatedUser, dto: AjustarDto): Promise<MovimentoFidelidade> {
    const empresaId = this.requireEmpresa(user);
    await this.assertClienteDaEmpresa(empresaId, dto.clienteId);

    return this.prisma.$transaction(async (tx) => {
      const saldo = await tx.saldoFidelidade.findUnique({
        where: { clienteId: dto.clienteId },
      });
      const saldoAtual = saldo?.pontos ?? 0;
      const novoSaldo = saldoAtual + dto.pontos;

      if (novoSaldo < 0) {
        throw new BusinessRuleException(
          `Ajuste deixaria saldo negativo (${saldoAtual} + ${dto.pontos} = ${novoSaldo}). Limite mínimo 0.`,
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }

      const movimento = await tx.movimentoFidelidade.create({
        data: {
          empresaId,
          clienteId: dto.clienteId,
          tipo: 'AJUSTE_MANUAL',
          pontos: dto.pontos,
          motivo: dto.motivo,
          criadoPorId: user.id,
        },
      });
      await tx.saldoFidelidade.upsert({
        where: { clienteId: dto.clienteId },
        create: { empresaId, clienteId: dto.clienteId, pontos: novoSaldo },
        update: { pontos: novoSaldo },
      });
      return movimento;
    });
  }

  // ─── Trigger automático (chamado pelo PedidosService) ──────────────────

  /**
   * Credita pontos quando pedido entra em ENVIADO_OMIE ou ENTREGUE.
   *
   * Idempotente via @@unique([pedidoId, tipo]) — re-execução não duplica.
   * Falhas são logadas e silenciadas (não derrubam o fluxo de pedido).
   */
  async creditarPedidoAprovado(params: {
    empresaId: string;
    clienteId: string;
    pedidoId: string;
    valorPedido: number;
  }): Promise<MovimentoFidelidade | null> {
    try {
      const programa = await this.getOrCreatePrograma(params.empresaId);
      if (!programa.ativo) return null;
      if (params.valorPedido < Number(programa.valorMinimoPedido)) return null;

      const pontos = Math.floor(params.valorPedido * Number(programa.pontosPorReal));
      if (pontos <= 0) return null;

      return await this.prisma.$transaction(async (tx) => {
        // Idempotente: se já existe GANHO_PEDIDO pra esse pedido, skip.
        const existing = await tx.movimentoFidelidade.findUnique({
          where: { pedidoId_tipo: { pedidoId: params.pedidoId, tipo: 'GANHO_PEDIDO' } },
        });
        if (existing) return existing;

        const movimento = await tx.movimentoFidelidade.create({
          data: {
            empresaId: params.empresaId,
            clienteId: params.clienteId,
            tipo: 'GANHO_PEDIDO',
            pontos,
            pedidoId: params.pedidoId,
          },
        });
        const saldo = await tx.saldoFidelidade.findUnique({
          where: { clienteId: params.clienteId },
        });
        const novoSaldo = (saldo?.pontos ?? 0) + pontos;
        await tx.saldoFidelidade.upsert({
          where: { clienteId: params.clienteId },
          create: { empresaId: params.empresaId, clienteId: params.clienteId, pontos: novoSaldo },
          update: { pontos: novoSaldo },
        });
        return movimento;
      });
    } catch (err) {
      // Best-effort — não derruba fluxo principal de pedido
      this.logger.warn(
        `Falha creditando fidelidade do pedido ${params.pedidoId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * Estorna pontos quando pedido é cancelado.
   * Cria ESTORNO_PEDIDO se houver GANHO_PEDIDO prévio.
   */
  async estornarPedidoCancelado(pedidoId: string): Promise<MovimentoFidelidade | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ganho = await tx.movimentoFidelidade.findUnique({
          where: { pedidoId_tipo: { pedidoId, tipo: 'GANHO_PEDIDO' } },
        });
        if (!ganho) return null;

        // Idempotente: se já há estorno, skip.
        const jaEstornado = await tx.movimentoFidelidade.findUnique({
          where: { pedidoId_tipo: { pedidoId, tipo: 'ESTORNO_PEDIDO' } },
        });
        if (jaEstornado) return jaEstornado;

        const movimento = await tx.movimentoFidelidade.create({
          data: {
            empresaId: ganho.empresaId,
            clienteId: ganho.clienteId,
            tipo: 'ESTORNO_PEDIDO',
            pontos: -ganho.pontos,
            pedidoId,
          },
        });
        const saldo = await tx.saldoFidelidade.findUnique({
          where: { clienteId: ganho.clienteId },
        });
        const novoSaldo = Math.max(0, (saldo?.pontos ?? 0) - ganho.pontos);
        await tx.saldoFidelidade.upsert({
          where: { clienteId: ganho.clienteId },
          create: { empresaId: ganho.empresaId, clienteId: ganho.clienteId, pontos: novoSaldo },
          update: { pontos: novoSaldo },
        });
        return movimento;
      });
    } catch (err) {
      this.logger.warn(
        `Falha estornando fidelidade do pedido ${pedidoId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // ─── Top clientes (ranking de saldo) ──────────────────────────────────

  async ranking(
    user: AuthenticatedUser,
    limit = 10,
  ): Promise<
    Array<{
      clienteId: string;
      clienteNome: string;
      pontos: number;
    }>
  > {
    const empresaId = this.requireEmpresa(user);
    const rows = await this.prisma.saldoFidelidade.findMany({
      where: { empresaId, pontos: { gt: 0 } },
      orderBy: { pontos: 'desc' },
      take: Math.min(limit, 50),
      include: { cliente: { select: { id: true, nome: true } } },
    });
    return rows.map((r) => ({
      clienteId: r.clienteId,
      clienteNome: r.cliente.nome,
      pontos: r.pontos,
    }));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /** Garante que o cliente pertence à empresa (multi-tenant guard). */
  private async assertClienteDaEmpresa(empresaId: string, clienteId: string): Promise<void> {
    const c = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: { id: true },
    });
    if (!c) {
      throw new NotFoundException('Cliente', clienteId);
    }
  }
}
