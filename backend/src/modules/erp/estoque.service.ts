import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { AjusteEstoqueDto, MovimentosQueryDto } from './estoque.dto';

/** Reserva do pedido da vitrine (Léo, 06/10: "20 minutos com relógio"). */
export const RESERVA_MINUTOS = 20;
export const MOTIVO_EXPIRADA = 'reserva expirada (20 min sem pagamento)';

type Tx = Prisma.TransactionClient;

/** Reserva que ainda SEGURA estoque: confirmada, ou ativa dentro do prazo. */
const reservaValida = (agora: Date): Prisma.EstoqueReservaWhereInput => ({
  OR: [{ status: 'CONFIRMADA' }, { status: 'ATIVA', expiraEm: { gt: agora } }],
});

/**
 * ERP próprio · Fase 2 · estoque de peça pronta (Ribelt Distribuidora).
 *
 * 🔒 Ligado por empresa em `Empresa.config.erpInterno.ativo` (só a migration
 * liga). Empresa sem a flag: as telas e rotas recusam com 422, e os ganchos do
 * pedido não fazem nada — eles só agem sobre pedido que TEM reserva, e reserva
 * só nasce com a flag ligada.
 *
 * Saldo físico = soma dos movimentos. Reservado = reservas válidas. Disponível
 * = físico − reservado. Nenhum número é editado à mão: ajuste é movimento com
 * motivo e autor.
 */
@Injectable()
export class EstoqueService {
  private readonly logger = new Logger(EstoqueService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Flag ───────────────────────────────────────────────────────────────

  async ativoNaEmpresa(empresaId: string): Promise<boolean> {
    const e = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const cfg = (e?.config ?? {}) as { erpInterno?: { ativo?: boolean } };
    return cfg.erpInterno?.ativo === true;
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  /** Empresa da sessão, desde que o ERP próprio esteja ligado nela (senão 422). */
  async empresaLigada(user: AuthenticatedUser): Promise<string> {
    const empresaId = this.requireEmpresa(user);
    if (!(await this.ativoNaEmpresa(empresaId))) {
      throw new BusinessRuleException('O estoque (ERP) não está ligado nesta empresa');
    }
    return empresaId;
  }

  async status(user: AuthenticatedUser): Promise<{ ativo: boolean }> {
    return { ativo: await this.ativoNaEmpresa(this.requireEmpresa(user)) };
  }

  // ─── Pedido da vitrine: reserva ─────────────────────────────────────────

  /**
   * Reserva as peças do pedido por 20 minutos. Empresa sem ERP: não faz nada
   * e devolve null (a vitrine segue como antes).
   */
  async reservarPedido(
    empresaId: string,
    pedidoId: string,
    itens: Array<{ produtoId: string; quantidade: number }>,
  ): Promise<Date | null> {
    if (!(await this.ativoNaEmpresa(empresaId))) return null;
    const expiraEm = new Date(Date.now() + RESERVA_MINUTOS * 60_000);
    await this.prisma.estoqueReserva.createMany({
      data: itens.map((i) => ({
        empresaId,
        pedidoId,
        produtoId: i.produtoId,
        quantidade: i.quantidade,
        status: 'ATIVA' as const,
        expiraEm,
      })),
    });
    return expiraEm;
  }

  // ─── Ganchos do pedido (chamados pelo PedidosService) ───────────────────

  /** Despachou: reserva vira saída do estoque. Pedido sem reserva: nada. */
  async baixarNoDespacho(pedidoId: string, usuarioId: string | null): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const reservas = await tx.estoqueReserva.findMany({
        where: { pedidoId, status: { in: ['ATIVA', 'CONFIRMADA'] } },
        select: { id: true, empresaId: true, produtoId: true, quantidade: true },
      });
      let baixadas = 0;
      for (const r of reservas) {
        // CAS: duas chamadas concorrentes não baixam a mesma reserva duas vezes.
        const cas = await tx.estoqueReserva.updateMany({
          where: { id: r.id, status: { in: ['ATIVA', 'CONFIRMADA'] } },
          data: { status: 'BAIXADA', expiraEm: null },
        });
        if (cas.count === 0) continue;
        await tx.estoqueMovimento.create({
          data: {
            empresaId: r.empresaId,
            produtoId: r.produtoId,
            tipo: 'SAIDA_PEDIDO',
            quantidade: -r.quantidade,
            pedidoId,
            motivo: 'Pedido despachado',
            usuarioId,
          },
        });
        baixadas++;
      }
      return baixadas;
    });
  }

  /** Cancelou: devolve o reservado ao disponível. Pedido sem reserva: nada. */
  async liberarDoPedido(pedidoId: string, motivo: string): Promise<number> {
    const r = await this.prisma.estoqueReserva.updateMany({
      where: { pedidoId, status: { in: ['ATIVA', 'CONFIRMADA'] } },
      data: { status: 'LIBERADA', expiraEm: null, motivoLiberacao: motivo.slice(0, 300) },
    });
    return r.count;
  }

  // ─── Ações da equipe no pedido ──────────────────────────────────────────

  private async pedidoDaEmpresa(empresaId: string, pedidoId: string) {
    const p = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, empresaId },
      select: { id: true, numero: true, status: true, observacoes: true },
    });
    if (!p) throw new NotFoundException('Pedido', pedidoId);
    return p;
  }

  /** Situação da reserva pra tela do pedido. */
  async reservaDoPedido(user: AuthenticatedUser, pedidoId: string) {
    const empresaId = await this.empresaLigada(user);
    const p = await this.pedidoDaEmpresa(empresaId, pedidoId);
    const reservas = await this.prisma.estoqueReserva.findMany({
      where: { pedidoId },
      orderBy: { criadoEm: 'desc' },
      select: { status: true, expiraEm: true, motivoLiberacao: true, quantidade: true },
    });
    if (reservas.length === 0) return { pedidoStatus: p.status, reserva: null };
    const ordem = ['ATIVA', 'CONFIRMADA', 'BAIXADA', 'LIBERADA'] as const;
    const status = ordem.find((s) => reservas.some((r) => r.status === s))!;
    const daVez = reservas.filter((r) => r.status === status);
    const expiraEm =
      status === 'ATIVA'
        ? daVez.map((r) => r.expiraEm).sort((a, b) => (a && b ? +a - +b : 0))[0]
        : null;
    return {
      pedidoStatus: p.status,
      reserva: {
        status,
        expiraEm,
        pecas: daVez.reduce((s, r) => s + r.quantidade, 0),
        motivoLiberacao: status === 'LIBERADA' ? daVez[0].motivoLiberacao : null,
      },
    };
  }

  /**
   * "Pagamento recebido" (Pix manual, antes da Fase 3): a reserva deixa de ter
   * prazo e o pedido vai pra PAGO. Daí o fluxo normal segue (separação → envio).
   */
  async pagamentoRecebido(user: AuthenticatedUser, pedidoId: string) {
    const empresaId = await this.empresaLigada(user);
    const p = await this.pedidoDaEmpresa(empresaId, pedidoId);
    if (p.status !== 'RASCUNHO') {
      throw new BusinessRuleException(
        p.status === 'CANCELADO'
          ? 'Pedido cancelado — se a reserva expirou, use "Reativar" primeiro'
          : `Pedido em ${p.status} — o pagamento já foi registrado`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Reserva ainda ATIVA (mesmo vencida há segundos, se o job não passou):
      // quem pagou não perde a peça por causa do relógio da rodada.
      const conf = await tx.estoqueReserva.updateMany({
        where: { pedidoId, status: 'ATIVA' },
        data: { status: 'CONFIRMADA', expiraEm: null },
      });
      if (conf.count === 0) {
        throw new BusinessRuleException(
          'Este pedido não tem reserva ativa — reative o pedido antes de confirmar o pagamento',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      const cas = await tx.pedido.updateMany({
        where: { id: pedidoId, empresaId, status: 'RASCUNHO' },
        data: { status: 'PAGO', pagoEm: new Date() },
      });
      if (cas.count === 0) {
        throw new BusinessRuleException(
          'Pedido mudou de status — recarregue e tente novamente',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    });
    this.logger.log(`[estoque] pedido ${p.numero}: pagamento recebido, reserva confirmada`);
    return this.reservaDoPedido(user, pedidoId);
  }

  /** Reserva expirou e o cliente voltou: pedido volta pra RASCUNHO com 20 min novos. */
  async reativar(user: AuthenticatedUser, pedidoId: string) {
    const empresaId = await this.empresaLigada(user);
    const p = await this.pedidoDaEmpresa(empresaId, pedidoId);
    const expirada = await this.prisma.estoqueReserva.findFirst({
      where: { pedidoId, status: 'LIBERADA', motivoLiberacao: MOTIVO_EXPIRADA },
      select: { id: true },
    });
    if (p.status !== 'CANCELADO' || !expirada) {
      throw new BusinessRuleException(
        'Só dá pra reativar pedido cancelado porque a reserva expirou',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const itens = await this.prisma.pedidoItem.findMany({
      where: { pedidoId },
      select: { produtoId: true, quantidade: true },
    });
    const expiraEm = new Date(Date.now() + RESERVA_MINUTOS * 60_000);
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.pedido.updateMany({
        where: { id: pedidoId, empresaId, status: 'CANCELADO' },
        data: {
          status: 'RASCUNHO',
          observacoes: `${p.observacoes ? `${p.observacoes}\n` : ''}[Reativado] nova reserva de ${RESERVA_MINUTOS} min`,
        },
      });
      if (cas.count === 0) {
        throw new BusinessRuleException(
          'Pedido mudou de status — recarregue e tente novamente',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      await tx.estoqueReserva.createMany({
        data: itens.map((i) => ({
          empresaId,
          pedidoId,
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          status: 'ATIVA' as const,
          expiraEm,
        })),
      });
    });
    return this.reservaDoPedido(user, pedidoId);
  }

  // ─── Job: reservas vencidas ─────────────────────────────────────────────

  /**
   * Libera reservas ATIVAS vencidas e cancela o pedido que ainda estava
   * esperando pagamento. Idempotente (CAS em tudo).
   */
  async expirarVencidas(agora = new Date()): Promise<number> {
    const vencidas = await this.prisma.estoqueReserva.findMany({
      where: { status: 'ATIVA', expiraEm: { lte: agora } },
      select: { pedidoId: true },
      distinct: ['pedidoId'],
      take: 200,
    });
    let pedidos = 0;
    for (const { pedidoId } of vencidas) {
      await this.prisma.$transaction(async (tx: Tx) => {
        const lib = await tx.estoqueReserva.updateMany({
          where: { pedidoId, status: 'ATIVA', expiraEm: { lte: agora } },
          data: { status: 'LIBERADA', expiraEm: null, motivoLiberacao: MOTIVO_EXPIRADA },
        });
        if (lib.count === 0) return;
        const p = await tx.pedido.findUnique({
          where: { id: pedidoId },
          select: { status: true, observacoes: true, numero: true },
        });
        if (p?.status !== 'RASCUNHO') return;
        await tx.pedido.updateMany({
          where: { id: pedidoId, status: 'RASCUNHO' },
          data: {
            status: 'CANCELADO',
            observacoes: `${p.observacoes ? `${p.observacoes}\n` : ''}[Cancelado] ${MOTIVO_EXPIRADA}`,
          },
        });
        pedidos++;
        this.logger.log(`[estoque] pedido ${p.numero}: ${MOTIVO_EXPIRADA}`);
      });
    }
    return pedidos;
  }

  // ─── Telas de estoque ───────────────────────────────────────────────────

  /** Saldo por variação (modelo × cor × linha × tamanho). */
  async saldos(user: AuthenticatedUser) {
    const empresaId = await this.empresaLigada(user);
    const agora = new Date();
    const [variacoes, fisico, reservado] = await Promise.all([
      this.prisma.catalogoVariacao.findMany({
        where: { empresaId },
        select: {
          produtoId: true,
          ativo: true,
          modelo: { select: { id: true, nome: true, ordem: true } },
          modeloCor: { select: { ordem: true, cor: { select: { nome: true, hex: true } } } },
          modeloLinha: { select: { linha: { select: { nome: true, ordem: true } } } },
          modeloTamanho: { select: { tamanho: { select: { nome: true, ordem: true } } } },
        },
      }),
      this.prisma.estoqueMovimento.groupBy({
        by: ['produtoId'],
        where: { empresaId },
        _sum: { quantidade: true },
      }),
      this.prisma.estoqueReserva.groupBy({
        by: ['produtoId'],
        where: { empresaId, ...reservaValida(agora) },
        _sum: { quantidade: true },
      }),
    ]);
    const fis = new Map(fisico.map((f) => [f.produtoId, f._sum.quantidade ?? 0]));
    const res = new Map(reservado.map((r) => [r.produtoId, r._sum.quantidade ?? 0]));
    return variacoes.map((v) => {
      const f = fis.get(v.produtoId) ?? 0;
      const r = res.get(v.produtoId) ?? 0;
      return {
        produtoId: v.produtoId,
        ativo: v.ativo,
        modelo: v.modelo,
        cor: { nome: v.modeloCor.cor.nome, hex: v.modeloCor.cor.hex, ordem: v.modeloCor.ordem },
        linha: v.modeloLinha.linha,
        tamanho: v.modeloTamanho.tamanho,
        fisico: f,
        reservado: r,
        disponivel: f - r,
      };
    });
  }

  async movimentos(user: AuthenticatedUser, q: MovimentosQueryDto) {
    const empresaId = await this.empresaLigada(user);
    return this.prisma.estoqueMovimento.findMany({
      where: { empresaId, ...(q.produtoId ? { produtoId: q.produtoId } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: q.limite,
      select: {
        id: true,
        tipo: true,
        quantidade: true,
        motivo: true,
        documento: true,
        usuarioId: true,
        criadoEm: true,
        produto: { select: { id: true, nome: true } },
        pedido: { select: { id: true, numero: true } },
      },
    });
  }

  async ajustar(user: AuthenticatedUser, dto: AjusteEstoqueDto) {
    const empresaId = await this.empresaLigada(user);
    const produto = await this.prisma.produto.findFirst({
      where: { id: dto.produtoId, empresaId },
      select: { id: true },
    });
    if (!produto) throw new NotFoundException('Produto', dto.produtoId);
    return this.prisma.estoqueMovimento.create({
      data: {
        empresaId,
        produtoId: produto.id,
        tipo: dto.tipo,
        quantidade: dto.quantidade,
        motivo: dto.motivo,
        usuarioId: user.id,
      },
      select: { id: true, tipo: true, quantidade: true, criadoEm: true },
    });
  }
}
