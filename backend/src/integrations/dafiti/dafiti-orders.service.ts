import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { custoDosItens } from '@modules/pedidos-marketplace/financeiro';
import { DafitiClientService } from './dafiti.client';
import { pedidoDafiti, type DafitiItem, type DafitiPedido } from './dafiti-pedidos';

const PAGINA = 50;
const MAX_PAGINAS = 20;

/**
 * Pedidos da Dafiti → MarketplaceOrder (plataforma DAFITI), com itens, comissão,
 * líquido (repasse), situação e custo do cadastro. Busca o que mudou desde a
 * data pedida (updateDateStart) — a sincronização passa a cada 30 min.
 */
@Injectable()
export class DafitiOrdersService {
  private readonly logger = new Logger(DafitiOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dafiti: DafitiClientService,
  ) {}

  async sincronizar(empresaId: string, desde: Date): Promise<{ pedidos: number }> {
    const dia = desde.toISOString().slice(0, 10);
    let n = 0;
    for (let pag = 0; pag < MAX_PAGINAS; pag++) {
      const r = await this.dafiti.get<{
        items?: DafitiPedido[];
        pagination?: { hasNext?: boolean };
      }>(empresaId, '/v2/orders', {
        limit: PAGINA,
        offset: pag * PAGINA,
        updateDateStart: dia,
        sortDir: 'desc',
      });
      const pedidos = r.items ?? [];
      for (const o of pedidos) {
        try {
          await this.gravar(empresaId, o);
          n++;
        } catch (err) {
          this.logger.warn(`[Dafiti] pedido ${o.number} não gravou: ${String(err)}`);
        }
      }
      if (!r.pagination?.hasNext || !pedidos.length) break;
    }
    return { pedidos: n };
  }

  private async gravar(empresaId: string, o: DafitiPedido): Promise<void> {
    // A listagem traz o resumo dos itens; os campos de dinheiro vêm de /order-items.
    const itens = await this.dafiti
      .get<{ items?: DafitiItem[] }>(empresaId, '/v2/order-items', {
        'orderIds[]': [String(o.id)],
        limit: 100,
      })
      .then((x) => x.items ?? [])
      .catch(() => o.items ?? []);
    const p = pedidoDafiti({ ...o, items: itens.length ? itens : o.items });
    const c = await custoDosItens(this.prisma, empresaId, 'DAFITI', p.itens);
    const data = {
      empresaId,
      plataforma: 'DAFITI' as const,
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
      liquido: p.liquido,
      extrato: (p.extrato ?? undefined) as unknown as object | undefined,
      custo: c.custo,
      custoCompleto: c.completo,
      financeiroEm: new Date(),
    };
    await this.prisma.marketplaceOrder.upsert({
      where: { plataforma_numeroExterno: { plataforma: 'DAFITI', numeroExterno: p.numeroExterno } },
      create: data,
      update: data,
    });
  }
}
