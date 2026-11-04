import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { canalValido, montarPedidoMagis5, type PedidoVitrine } from './magis5-pedido-vitrine';
import { Magis5ClientService } from './magis5.client';

/** Pedido antigo já foi despachado por fora: não entra no Magis5. */
const A_PARTIR_DE = new Date('2026-11-04T03:00:00Z');

type Entrega = Partial<PedidoVitrine['entrega']> & {
  retirada?: boolean;
  freteAConfirmar?: boolean;
  servico?: { id: number };
  magis5?: { id: string; enviadoEm: string };
};

/**
 * Pedido pago da vitrine vira pedido no Magis5 (Fase 4, Léo 03/11). Lá o Melhor
 * Envio nativo paga e gera a etiqueta. Só liga com o código do canal em
 * Integrações → Magis5; marcado em `entrega.magis5`, o pedido não sobe de novo
 * e o botão de etiqueta do app trava, pra não pagar duas vezes.
 */
@Injectable()
export class Magis5VitrineService {
  private readonly logger = new Logger(Magis5VitrineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
    private readonly client: Magis5ClientService,
  ) {}

  async enviarPagos(empresaId: string): Promise<number> {
    const conn = await this.integracoes.obterCredenciaisInternas(empresaId, 'magis5');
    const canal = (conn.credenciais as { usuario?: string }).usuario?.trim();
    if (!canalValido(canal)) return 0;

    const pedidos = await this.prisma.pedido.findMany({
      where: { empresaId, origem: 'VITRINE', status: 'PAGO', criadoEm: { gte: A_PARTIR_DE } },
      include: {
        cliente: { select: { nome: true, cnpj: true, email: true, telefone: true } },
        itens: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
      },
    });

    let enviados = 0;
    for (const p of pedidos) {
      const entrega = (p.entrega ?? {}) as Entrega;
      if (entrega.magis5 || entrega.retirada || entrega.freteAConfirmar || !entrega.servico) {
        continue;
      }
      const variacoes = await this.prisma.catalogoVariacao.findMany({
        where: { empresaId, produtoId: { in: p.itens.map((i) => i.produtoId) } },
        select: { produtoId: true, sku: true, produto: { select: { nome: true } } },
      });
      const porProduto = new Map(variacoes.map((v) => [v.produtoId, v]));
      const itens = p.itens.flatMap((i) => {
        const v = porProduto.get(i.produtoId);
        return v?.sku
          ? [
              {
                sku: v.sku,
                nome: v.produto.nome,
                quantidade: i.quantidade,
                precoUnitario: Number(i.precoUnitario),
              },
            ]
          : [];
      });
      // Item sem SKU ficaria fora da nota: melhor o pedido não subir e aparecer no log.
      if (itens.length !== p.itens.length) {
        this.logger.warn(`[Magis5] ${p.numero}: item sem SKU, pedido não enviado`);
        continue;
      }
      try {
        await this.client.post(
          empresaId,
          '/orders',
          montarPedidoMagis5(
            {
              numero: p.numero,
              criadoEm: p.criadoEm,
              total: Number(p.total),
              frete: Number(p.frete),
              cliente: p.cliente,
              itens,
              entrega: entrega as PedidoVitrine['entrega'],
            },
            canal,
          ),
        );
        const marca = { magis5: { id: p.numero, enviadoEm: new Date().toISOString() } };
        await this.prisma.$executeRaw`
          UPDATE "Pedido"
          SET entrega = COALESCE(entrega, '{}'::jsonb) || ${JSON.stringify(marca)}::jsonb
          WHERE id = ${p.id} AND "empresaId" = ${empresaId}
        `;
        enviados++;
      } catch (err) {
        this.logger.warn(`[Magis5] ${p.numero} não enviado: ${String(err)}`);
      }
    }
    return enviados;
  }
}
