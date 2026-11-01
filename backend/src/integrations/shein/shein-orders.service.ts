import { Injectable } from '@nestjs/common';
import { horaShein } from './shein-assinatura';
import { SheinClientService } from './shein.client';

export interface SheinPedidoResumo {
  orderNo: string;
  orderStatus?: number;
  orderCreateTime?: string;
  orderUpdateTime?: string;
}

/**
 * Pedidos da Shein, só leitura (01/11). Primeira etapa: ler a lista e o
 * detalhe crus, pra conhecer os status reais da loja ANTES de mapear pro
 * MarketplaceOrder — status desconhecido não vira situação por chute.
 */
@Injectable()
export class SheinOrdersService {
  constructor(private readonly shein: SheinClientService) {}

  /**
   * Pedidos das últimas `horas` (a Shein limita a janela a 48 h; páginas de 30).
   * tipo 1 = criados na janela · 2 = atualizados na janela.
   */
  async listar(empresaId: string, horas: number, tipo: 1 | 2 = 1) {
    const fim = new Date();
    const ini = new Date(fim.getTime() - Math.min(horas, 48) * 3_600_000);
    const pedidos: SheinPedidoResumo[] = [];
    let total = 0;
    for (let page = 1; page <= 20; page++) {
      const r = await this.shein.post<{ count?: number; orderList?: SheinPedidoResumo[] }>(
        empresaId,
        '/open-api/order/order-list',
        { queryType: tipo, startTime: horaShein(ini), endTime: horaShein(fim), page, pageSize: 30 },
      );
      total = r?.count ?? 0;
      const lista = r?.orderList ?? [];
      pedidos.push(...lista);
      if (lista.length < 30 || pedidos.length >= total) break;
    }
    return { total, pedidos };
  }

  /** Detalhe de até 30 pedidos (itens, valores, rastreio). */
  detalhe(empresaId: string, orderNos: string[]) {
    return this.shein.post<unknown[]>(empresaId, '/open-api/order/order-detail', {
      orderNoList: orderNos.slice(0, 30),
    });
  }
}
