import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { custoDosItens } from '@modules/pedidos-marketplace/financeiro';
import { MagaluClientService } from './magalu-client.service';
import { pedidoMagalu } from './magalu-pedidos';
import type { MagaluLista, MagaluPedido } from './magalu.types';

const PAGINA = 50;
const MAX_PAGINAS = 20;

/**
 * Pedidos do Magalu → MarketplaceOrder (plataforma MAGALU), idempotente
 * (upsert por plataforma+número). Busca o que mudou desde a data pedida
 * (`updated_at__gte`). Doc: developers.magalu.com/docs/apis/orders/ref/seller-v-1-get-order-list
 */
@Injectable()
export class MagaluOrdersService {
  private readonly logger = new Logger(MagaluOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly magalu: MagaluClientService,
  ) {}

  async sincronizar(empresaId: string, desde: Date): Promise<{ pedidos: number }> {
    let n = 0;
    for (let pag = 0; pag < MAX_PAGINAS; pag++) {
      const r = await this.magalu.get<MagaluLista<MagaluPedido>>(empresaId, '/seller/v1/orders', {
        updated_at__gte: desde.toISOString(),
        _offset: pag * PAGINA,
        _limit: PAGINA,
      });
      const pedidos = r.results ?? [];
      for (const o of pedidos) {
        try {
          await this.gravar(empresaId, o);
          n++;
        } catch (err) {
          this.logger.warn(`[Magalu] pedido ${o.code} não gravou: ${String(err)}`);
        }
      }
      if (pedidos.length < PAGINA) break;
    }
    return { pedidos: n };
  }

  async gravar(empresaId: string, o: MagaluPedido): Promise<void> {
    const p = pedidoMagalu(o);
    const c = await custoDosItens(this.prisma, empresaId, 'MAGALU', p.itens);
    const data = {
      empresaId,
      plataforma: 'MAGALU' as const,
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
      custo: c.custo,
      custoCompleto: c.completo,
      financeiroEm: new Date(),
    };
    // Número é único por plataforma: se já existe de OUTRA empresa, não sobrescreve.
    const existente = await this.prisma.marketplaceOrder.findUnique({
      where: { plataforma_numeroExterno: { plataforma: 'MAGALU', numeroExterno: p.numeroExterno } },
      select: { empresaId: true },
    });
    if (existente && existente.empresaId !== empresaId) {
      this.logger.warn(`[Magalu] pedido ${p.numeroExterno} pertence a outra empresa — ignorado`);
      return;
    }
    await this.prisma.marketplaceOrder.upsert({
      where: { plataforma_numeroExterno: { plataforma: 'MAGALU', numeroExterno: p.numeroExterno } },
      create: data,
      update: data,
    });
  }
}
