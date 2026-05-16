import { Injectable, Logger } from '@nestjs/common';
import type { Pedido, PedidoItem, Produto, Cliente } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { OmieClientService } from './omie-client.service';
import { OmieMapper } from './omie.mapper';
import type { OmieIncluirPedidoParam } from './omie.types';

export interface OmiePedidoEnvioResult {
  pedidoId: string;
  numeroOmie: string;
  codigoStatusOmie: string;
  descricaoStatusOmie: string;
}

type PedidoComItens = Pedido & {
  itens: Array<PedidoItem & { produto: Produto }>;
  cliente: Cliente;
};

/**
 * Push de pedidos pro OMIE.
 *
 * Pre-condições já validadas pelo PedidosService (status, cliente ATIVO, etc).
 * Aqui assumimos que o pedido está pronto pra enviar.
 *
 * Persiste:
 *  - numeroOmie atualizado em Pedido
 *  - enviadoOmieEm = agora
 *  - status → ENVIADO_OMIE
 */
@Injectable()
export class OmiePedidosService {
  private readonly logger = new Logger(OmiePedidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly omie: OmieClientService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async enviarPedido(pedidoId: string): Promise<OmiePedidoEnvioResult> {
    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      include: {
        itens: { include: { produto: true } },
        cliente: true,
      },
    });
    if (!pedido) {
      throw new BusinessRuleException(`Pedido ${pedidoId} não encontrado`);
    }
    if (!pedido.cliente.codigoOmie) {
      throw new BusinessRuleException(
        `Cliente ${pedido.cliente.id} não possui codigoOmie. Sincronize com OMIE primeiro.`,
        ErrorCode.OMIE_ERROR,
      );
    }

    const payload = this.buildPayload(pedido as PedidoComItens);
    const response = await this.omie.incluirPedido(pedido.empresaId, payload);

    const numeroOmie = response.numero_pedido?.toString() ?? response.codigo_pedido.toString();

    await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: {
        status: 'ENVIADO_OMIE',
        numeroOmie,
        enviadoOmieEm: new Date(),
      },
    });

    await this.integracoes.registrarSyncOk(pedido.empresaId, 'omie').catch(() => {});

    this.logger.log(`Pedido ${pedido.numero} → OMIE ${numeroOmie} (${response.descricao_status})`);

    return {
      pedidoId,
      numeroOmie,
      codigoStatusOmie: response.codigo_status,
      descricaoStatusOmie: response.descricao_status,
    };
  }

  private buildPayload(pedido: PedidoComItens): OmieIncluirPedidoParam {
    const dataPrevisao = pedido.prazoEntrega
      ? OmieMapper.dateToOmie(pedido.prazoEntrega)
      : OmieMapper.dateToOmie(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));

    return {
      cabecalho: {
        codigo_cliente: Number(pedido.cliente.codigoOmie),
        codigo_pedido_integracao: pedido.numero,
        data_previsao: dataPrevisao,
        quantidade_itens: pedido.itens.length,
      },
      det: pedido.itens.map((item) =>
        OmieMapper.pedidoItemToOmie({
          produtoCodigoOmie: item.produto.codigoOmie,
          produtoSku: item.produto.sku,
          quantidade: item.quantidade,
          precoUnitario: item.precoUnitario,
          desconto: item.desconto,
        }),
      ),
      observacoes: pedido.observacoes ? { obs_venda: pedido.observacoes } : undefined,
    };
  }
}
