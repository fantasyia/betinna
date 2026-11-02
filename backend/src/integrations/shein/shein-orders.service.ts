import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { custoDosItens } from '@modules/pedidos-marketplace/financeiro';
import { horaShein } from './shein-assinatura';
import { pedidoShein, type SheinPedido } from './shein-pedidos';
import { SheinClientService } from './shein.client';

export interface SheinPedidoResumo {
  orderNo: string;
  orderStatus?: number | string;
  orderCreateTime?: string;
  orderUpdateTime?: string;
}

const JANELA_MS = 48 * 3_600_000;
const POR_PAGINA = 30;

/**
 * Pedidos da Shein → MarketplaceOrder (plataforma SHEIN), 01/11.
 *
 * A lista só aceita janelas de 48 h (fuso UTC+8) e, pra loja do Brasil, SEM
 * `queryOrderType` devolve só pedido saído do armazém do vendedor — por isso
 * sempre 4 (todos). Conferido na documentação oficial em 01/11.
 */
@Injectable()
export class SheinOrdersService {
  private readonly logger = new Logger(SheinOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shein: SheinClientService,
  ) {}

  /** Uma janela de até 48 h. tipo 1 = criados · 2 = atualizados. */
  async listarJanela(empresaId: string, ini: Date, fim: Date, tipo: 1 | 2) {
    const pedidos: SheinPedidoResumo[] = [];
    let total = 0;
    for (let page = 1; page <= 334; page++) {
      const r = await this.shein.post<{ count?: number; orderList?: SheinPedidoResumo[] }>(
        empresaId,
        '/open-api/order/order-list',
        {
          queryType: tipo,
          startTime: horaShein(ini),
          endTime: horaShein(fim),
          page,
          pageSize: POR_PAGINA,
          queryOrderType: 4,
        },
      );
      total = r?.count ?? 0;
      const lista = r?.orderList ?? [];
      pedidos.push(...lista);
      if (lista.length < POR_PAGINA || pedidos.length >= total) break;
    }
    return { total, pedidos };
  }

  /** As últimas `horas` (máx. 48), cru — pra conferência. */
  listar(empresaId: string, horas: number, tipo: 1 | 2 = 1) {
    const fim = new Date();
    return this.listarJanela(
      empresaId,
      new Date(fim.getTime() - Math.min(horas, 48) * 3_600_000),
      fim,
      tipo,
    );
  }

  /** Detalhe de até 30 pedidos (itens, valores, rastreio). */
  detalhe(empresaId: string, orderNos: string[]) {
    return this.shein.post<SheinPedido[]>(empresaId, '/open-api/order/order-detail', {
      orderNoList: orderNos.slice(0, 30),
    });
  }

  /**
   * Grava no Vendas marketplaces tudo de `desde` até agora, de 48 em 48 h.
   * tipo 1 (criados) pro histórico; tipo 2 (atualizados) pro sincronismo.
   */
  async sincronizar(
    empresaId: string,
    desde: Date,
    tipo: 1 | 2,
  ): Promise<{ pedidos: number; falhas: number }> {
    const agora = Date.now();
    let n = 0;
    let falhas = 0;
    for (let ini = desde.getTime(); ini < agora; ini += JANELA_MS) {
      const fim = new Date(Math.min(ini + JANELA_MS, agora));
      const { pedidos } = await this.listarJanela(empresaId, new Date(ini), fim, tipo);
      const numeros = [...new Set(pedidos.map((p) => p.orderNo))];
      for (let i = 0; i < numeros.length; i += 30) {
        const detalhes = (await this.detalhe(empresaId, numeros.slice(i, i + 30))) ?? [];
        for (const o of detalhes) {
          try {
            await this.gravar(empresaId, o);
            n++;
          } catch (err) {
            falhas++;
            this.logger.warn(`[Shein] pedido ${o.orderNo} não gravou: ${String(err)}`);
          }
        }
      }
    }
    return { pedidos: n, falhas };
  }

  /** Um pedido só (aviso do webhook): busca o detalhe e grava. */
  async sincronizarPedido(empresaId: string, orderNo: string): Promise<boolean> {
    const [o] = (await this.detalhe(empresaId, [orderNo])) ?? [];
    if (!o) return false;
    await this.gravar(empresaId, o);
    return true;
  }

  private async gravar(empresaId: string, o: SheinPedido): Promise<void> {
    const p = pedidoShein(o);
    const c = await custoDosItens(this.prisma, empresaId, 'SHEIN', p.itens);
    const data = {
      empresaId,
      plataforma: 'SHEIN' as const,
      numeroExterno: p.numeroExterno,
      comprador: p.comprador,
      produtoNome: p.produtoNome,
      quantidade: p.quantidade,
      valor: p.valor,
      status: p.status,
      rastreio: p.rastreio,
      pedidoEm: p.pedidoEm,
      situacao: p.situacao,
      itens: c.itens as unknown as object,
      taxas: p.taxas,
      frete: p.frete,
      liquido: p.liquido,
      extrato: (p.extrato ?? undefined) as unknown as object | undefined,
      custo: c.custo,
      custoCompleto: c.completo,
      financeiroEm: new Date(),
    };
    await this.prisma.marketplaceOrder.upsert({
      where: { plataforma_numeroExterno: { plataforma: 'SHEIN', numeroExterno: p.numeroExterno } },
      create: data,
      update: data,
    });
  }
}
