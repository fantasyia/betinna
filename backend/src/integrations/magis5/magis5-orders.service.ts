import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { inicioDaLeitura, lerPedido } from './magis5-pedidos';
import { Magis5ClientService } from './magis5.client';

/**
 * Espelho dos pedidos do Magis5 (Fase 1, 03/11). Só lê e guarda em tabela
 * própria: não mexe em `MarketplaceOrder`, nem reserva, nem baixa estoque. Sem
 * `PATCH queueStatus`: a leitura por data já evita repetir.
 */
@Injectable()
export class Magis5OrdersService {
  private readonly logger = new Logger(Magis5OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: Magis5ClientService,
  ) {}

  async sincronizar(empresaId: string): Promise<{ pedidos: number; falhas: number }> {
    const conexao = await this.prisma.integracaoConexao.findUnique({
      where: { empresaId_servico: { empresaId, servico: 'magis5' } },
      select: { ultimoSync: true },
    });
    const agora = new Date();
    const desde = inicioDaLeitura(conexao?.ultimoSync ?? null, agora);
    const lidos = await this.client.listar(empresaId, '/orders', {
      status: 'all',
      structureType: 'complete',
      dateSearchType: 'lastUpdated',
      timestampFrom: Math.floor(desde.getTime() / 1000),
    });

    let pedidos = 0;
    let falhas = 0;
    for (const dados of lidos) {
      const { numero, ...campos } = lerPedido(dados);
      if (!numero) {
        falhas++;
        this.logger.warn(`[Magis5] ${empresaId}: pedido sem número`);
        continue;
      }
      const json = dados as Prisma.InputJsonObject;
      await this.prisma.magis5Pedido.upsert({
        where: { empresaId_numero: { empresaId, numero } },
        create: { empresaId, numero, ...campos, dados: json },
        update: { ...campos, dados: json },
      });
      pedidos++;
    }
    // O cursor só anda depois de tudo gravado: falhou antes, a próxima relê.
    await this.prisma.integracaoConexao.update({
      where: { empresaId_servico: { empresaId, servico: 'magis5' } },
      data: { ultimoSync: agora },
    });
    return { pedidos, falhas };
  }
}
