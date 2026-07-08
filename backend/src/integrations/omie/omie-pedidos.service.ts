import { Injectable, Logger } from '@nestjs/common';
import type { Pedido, PedidoItem, Produto, Cliente } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { addBreadcrumb } from '@shared/observability/sentry';
import { MetricsService } from '@shared/observability/metrics.service';
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
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Envia pedido pro OMIE.
   *
   * @param pedidoId  id do Pedido
   * @param empresaId tenant esperado — quando informado, filtra também por empresaId
   *                  (defense in depth contra callers futuros que passem ID cru).
   *                  O caller principal (`PedidosService.enviarParaOmie`) já
   *                  validou tenant via `findById(user, id)`, então é opcional.
   */
  async enviarPedido(pedidoId: string, empresaId?: string): Promise<OmiePedidoEnvioResult> {
    const pedido = await this.prisma.pedido.findFirst({
      where: empresaId ? { id: pedidoId, empresaId } : { id: pedidoId },
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

    addBreadcrumb('omie', 'push-start', {
      pedidoId,
      pedidoNumero: pedido.numero,
      empresaId: pedido.empresaId,
      itens: pedido.itens.length,
    });

    const stopTimer = this.metrics.omiePushDuration.startTimer();
    const payload = this.buildPayload(pedido as PedidoComItens);
    let response;
    try {
      response = await this.omie.incluirPedido(pedido.empresaId, payload);
    } catch (err) {
      // Heal idempotente (ITEM 1): o envio pode ter falhado porque uma tentativa
      // ANTERIOR já criou o pedido no OMIE e a resposta se perdeu (timeout) — aí o
      // OMIE recusa o reenvio com "já cadastrado". Em vez de falhar e deixar o
      // pedido preso fora de ENVIADO_OMIE, consultamos o OMIE pelo
      // codigo_pedido_integracao (= pedido.numero). Se ele REALMENTE existe lá,
      // reconciliamos (marca como enviado com o número de lá). Se NÃO existe, é
      // erro real (validação, credencial, etc.) → propaga o erro original.
      const existente = await this.omie
        .consultarPedidoPorIntegracao(pedido.empresaId, pedido.numero)
        .catch(() => null);
      if (!existente) {
        stopTimer();
        this.metrics.omiePush.inc({ empresa: pedido.empresaId, status: 'error' });
        throw err;
      }
      response = existente;
      this.logger.warn(
        `Pedido ${pedido.numero}: já estava cadastrado no OMIE (resposta perdida em ` +
          `envio anterior) — reconciliado em vez de falhar.`,
      );
    }
    stopTimer();
    this.metrics.omiePush.inc({ empresa: pedido.empresaId, status: 'success' });

    const numeroOmie = response.numero_pedido?.toString() ?? response.codigo_pedido.toString();

    addBreadcrumb('omie', 'push-success', {
      pedidoId,
      numeroOmie,
      codigoStatusOmie: response.codigo_status,
    });

    await this.prisma.pedido.update({
      where: { id: pedidoId },
      data: {
        status: 'ENVIADO_OMIE',
        numeroOmie,
        // CAÇADA-BUG #4 (defesa em profundidade): preserva o carimbo do PRIMEIRO envio — é ele que
        // determina o mês de comissão no fecharMes. Sobrescrever num reenvio jogaria a comissão pra
        // outro mês (folha duplicada). O gate de enviarParaOmie já bloqueia reenvio; isto protege
        // callers diretos e o heal idempotente.
        enviadoOmieEm: pedido.enviadoOmieEm ?? new Date(),
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

    // CAÇADA-BUG #1: o payload OMIE só carrega desconto POR ITEM (percentual_desconto).
    // O `descontoGeral` (%) e o desconto à vista (PIX/boleto-à-vista) vivem no cabeçalho do
    // Pedido e NÃO tinham campo aqui → o OMIE faturava o cliente a MAIS que o total fechado
    // pelo rep. Fix: diluir o desconto de cabeçalho no percentual_desconto de cada item, usando
    // o `pedido.total` (autoritativo — é o valor que o rep fechou) como âncora. A razão
    // total/Σitem.total captura descontoGeral + à vista + arredondamento de uma vez, sem
    // depender de recalcular forma/condição de pagamento.
    const descontosDiluidos = this.diluirDescontosCabecalho(pedido);

    return {
      cabecalho: {
        codigo_cliente: Number(pedido.cliente.codigoOmie),
        codigo_pedido_integracao: pedido.numero,
        data_previsao: dataPrevisao,
        quantidade_itens: pedido.itens.length,
      },
      det: pedido.itens.map((item, i) =>
        OmieMapper.pedidoItemToOmie({
          produtoCodigoOmie: item.produto.codigoOmie,
          produtoSku: item.produto.sku,
          quantidade: item.quantidade,
          precoUnitario: Number(item.precoUnitario), // #17 — Decimal→number pro payload OMIE
          desconto: descontosDiluidos[i],
        }),
      ),
      observacoes: pedido.observacoes ? { obs_venda: pedido.observacoes } : undefined,
    };
  }

  /**
   * Diluição do desconto de cabeçalho (geral + à vista) no percentual_desconto de cada item.
   *
   * Para cada item: descEfetivo = 1 − (1 − descItem/100) × razão, onde
   * `razão = pedido.total / Σ(item.total)` (fração que sobra após os descontos de cabeçalho).
   * Isso garante Σ(linha OMIE) ≈ pedido.total — o cliente é faturado no valor fechado.
   * Fallbacks seguros: sem itens/total → devolve o desconto de item cru (sem diluir).
   */
  private diluirDescontosCabecalho(pedido: PedidoComItens): number[] {
    const totalItens = pedido.itens.reduce((s, it) => s + Number(it.total), 0);
    const totalPedido = Number(pedido.total);
    // razão ∈ [0,1]: nunca >1 (total não passa de totalItens); =1 quando não há dado pra diluir.
    const razao =
      totalItens > 0 && Number.isFinite(totalPedido)
        ? Math.min(1, Math.max(0, totalPedido / totalItens))
        : 1;

    const descontos = pedido.itens.map((it) => {
      const descItem = Math.min(100, Math.max(0, Number(it.desconto) || 0));
      const efetivo = 100 * (1 - (1 - descItem / 100) * razao);
      // 4 casas: precisão suficiente pro OMIE, minimiza drift de arredondamento.
      return Math.round(Math.min(100, Math.max(0, efetivo)) * 10000) / 10000;
    });

    // Reconciliação: reconstrói o total como o OMIE fará (linha a linha, 2 casas) e alerta se
    // divergir mais que 1 centavo por item — visibilidade sem bloquear o envio (bloquear
    // derrubaria pedido legítimo por resíduo de arredondamento inevitável).
    if (razao < 1) {
      const reconstruido = pedido.itens.reduce((s, it, i) => {
        const bruto = Number(it.precoUnitario) * it.quantidade;
        return s + Math.round(bruto * (1 - descontos[i] / 100) * 100) / 100;
      }, 0);
      const residuo = Math.abs(reconstruido - totalPedido);
      if (residuo > 0.01 * pedido.itens.length + 0.01) {
        this.logger.warn(
          `Pedido ${pedido.numero}: resíduo de arredondamento na diluição de desconto OMIE ` +
            `(reconstruído R$${reconstruido.toFixed(2)} vs total R$${totalPedido.toFixed(2)}, ` +
            `dif R$${residuo.toFixed(2)}).`,
        );
      }
    }

    return descontos;
  }
}
