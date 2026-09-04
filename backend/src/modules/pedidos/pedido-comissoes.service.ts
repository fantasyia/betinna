import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

/**
 * Venda de CANAL: entrou sozinha, ninguém atendeu. Não gera comissão de rep e é
 * a única que paga a % de site.
 *
 * `ERP` ficou de FORA de propósito. É a origem de tudo que a rodada diária
 * importa — inclusive o pedido que o financeiro digita no painel pra um cliente
 * de rep — e o app tem código (`adotarRepresentante`) que existe justamente pra
 * dar dono a esses pedidos. Tratá-los como canal pagaria % de site por venda que
 * o site não fez, e calaria a comissão do rep que a fez.
 */
const ORIGENS_CANAL = new Set([
  'SITE',
  'MARKETPLACE_ML',
  'MARKETPLACE_SHOPEE',
  'MARKETPLACE_AMAZON',
  'MARKETPLACE_TIKTOK',
]);

/** Pedido nesses estados não gera comissão nenhuma — e apaga a que já existia. */
const SEM_COMISSAO = new Set(['CANCELADO']);

/**
 * Comissão de cada pedido, pessoa por pessoa.
 *
 * O `Pedido.comissao` é um campo só, do representante: não cabe um segundo
 * beneficiário e some dentro do agregado do mês. Com uma linha por pedido dá
 * pra abrir a folha e ver **de quais vendas** ela veio — e pedido cancelado ou
 * devolvido deixa de contar sem ninguém precisar lembrar de nada.
 *
 * Duas regras, e cada uma vem de um campo do USUÁRIO (não da empresa):
 *
 * - **REP** (`Usuario.comissaoPadrao`, default 10%) — sobre o pedido que a
 *   pessoa vendeu.
 * - **SITE** (`Usuario.comissaoSite`, default 0%) — sobre venda de canal, onde
 *   não há representante. Só quem tem % configurada participa; por isso é do
 *   usuário e não da empresa: a regra é de algumas pessoas.
 *
 * A base é sempre o total **líquido de devolução**. Recalcular é idempotente:
 * a linha é única por (pedido, pessoa, tipo).
 */
@Injectable()
export class PedidoComissoesService {
  private readonly logger = new Logger(PedidoComissoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refaz as linhas de comissão de um pedido.
   *
   * **Best-effort**: comissão errada se conserta recalculando; derrubar a
   * criação de um pedido por causa dela seria trocar um problema pequeno por
   * um grande.
   */
  async recalcular(pedidoId: string): Promise<void> {
    try {
      await this.executar(pedidoId);
    } catch (err) {
      this.logger.error(
        `Falha calculando comissões do pedido ${pedidoId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async executar(pedidoId: string): Promise<void> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        empresaId: true,
        origem: true,
        status: true,
        total: true,
        valorDevolvido: true,
        representanteId: true,
      },
    });
    if (!pedido) return;

    if (SEM_COMISSAO.has(pedido.status)) {
      const { count } = await this.prisma.pedidoComissao.deleteMany({ where: { pedidoId } });
      if (count > 0)
        this.logger.log(`Pedido ${pedidoId} cancelado — ${count} comissão(ões) removida(s)`);
      return;
    }

    // Líquido de devolução: é o que o rep e o canal realmente faturaram.
    // Em Decimal do começo ao fim: `50 × 7,25%` dá 3,625, e em float isso é
    // 3,62499…, que arredonda pra BAIXO — meio centavo somindo em toda venda
    // que cai na metade exata.
    const base = Prisma.Decimal.max(
      0,
      new Prisma.Decimal(pedido.total).minus(pedido.valorDevolvido ?? 0),
    );

    const linhas: Array<{ usuarioId: string; tipo: 'REP' | 'SITE'; percentual: number }> = [];

    // REP — quem vendeu. Venda de canal não tem dono, e atribuir um aqui
    // criaria comissão sobre venda que ninguém atendeu.
    if (pedido.representanteId && !ORIGENS_CANAL.has(pedido.origem)) {
      const rep = await this.prisma.usuario.findUnique({
        where: { id: pedido.representanteId },
        select: { comissaoPadrao: true },
      });
      const pct = rep?.comissaoPadrao ?? 0;
      if (pct > 0) linhas.push({ usuarioId: pedido.representanteId, tipo: 'REP', percentual: pct });
    }

    // SITE — todo mundo que tem % de canal configurada.
    if (ORIGENS_CANAL.has(pedido.origem)) {
      const doCanal = await this.prisma.usuario.findMany({
        where: {
          empresas: { some: { empresaId: pedido.empresaId } },
          // Quem PERDE a comissão é quem foi desligado. PENDENTE é gente
          // convidada que ainda não fez o primeiro login — e a % dela já foi
          // decidida por quem configurou; deixar de fora seria calote silencioso.
          status: { not: 'INATIVO' },
          comissaoSite: { gt: 0 },
        },
        select: { id: true, comissaoSite: true },
      });
      for (const u of doCanal) {
        linhas.push({ usuarioId: u.id, tipo: 'SITE', percentual: u.comissaoSite ?? 0 });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Fora as que valem agora — cobre troca de dono e % zerada.
      await tx.pedidoComissao.deleteMany({
        where: {
          pedidoId,
          NOT: linhas.map((l) => ({ usuarioId: l.usuarioId, tipo: l.tipo })),
        },
      });
      for (const l of linhas) {
        const valor = base
          .mul(l.percentual)
          .div(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        await tx.pedidoComissao.upsert({
          where: {
            pedidoId_usuarioId_tipo: { pedidoId, usuarioId: l.usuarioId, tipo: l.tipo },
          },
          create: {
            empresaId: pedido.empresaId,
            pedidoId,
            usuarioId: l.usuarioId,
            tipo: l.tipo,
            percentual: l.percentual,
            base,
            valor,
          },
          update: {
            percentual: l.percentual,
            base,
            valor,
          },
        });
      }
    });

    if (linhas.length > 0) {
      this.logger.log(
        `Pedido ${pedidoId}: ${linhas.map((l) => `${l.tipo} ${l.percentual}%`).join(' + ')} sobre R$ ${base.toFixed(2)}`,
      );
    }
  }
}
