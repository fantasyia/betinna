import { Injectable, Logger } from '@nestjs/common';
import type { Amostra, Cliente, Empresa, Produto } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { addBreadcrumb } from '@shared/observability/sentry';
import { MetricsService } from '@shared/observability/metrics.service';
import { OmieClientService } from './omie-client.service';
import { OmieMapper } from './omie.mapper';
import type { OmieIncluirPedidoParam } from './omie.types';

export interface OmieAmostraEnvioResult {
  amostraId: string;
  numeroOmie: string;
  cfop: string;
  codigoStatusOmie: string;
  descricaoStatusOmie: string;
}

type AmostraComRel = Amostra & {
  produto: Produto | null;
  cliente: Cliente;
  empresa: Empresa;
};

/**
 * P7 — Push de remessa de amostra grátis pro OMIE.
 *
 * Regra fiscal (aprovada pelo usuário): amostra grátis pode ser emitida sem
 * destaque de tributos desde que o produto esteja identificado como amostra,
 * a quantidade seja reduzida e a embalagem seja própria, sem valor de revenda.
 *
 * Na prática no OMIE isso é uma remessa com:
 *  - CFOP 5911 (mesma UF) ou 6911 (interestadual);
 *  - cenário fiscal "sem destaque de tributos" (configurado na conta OMIE do
 *    cliente, referenciado por OMIE_CENARIO_IMPOSTO_AMOSTRA — opcional);
 *  - valor de referência (a amostra é grátis, mas o OMIE exige base de cálculo).
 *
 * Persiste em Amostra: numeroOmie, enviadoOmieEm, cfop.
 */
@Injectable()
export class OmieAmostrasService {
  private readonly logger = new Logger(OmieAmostrasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly omie: OmieClientService,
    private readonly integracoes: IntegracoesService,
    private readonly metrics: MetricsService,
    private readonly env: EnvService,
  ) {}

  /**
   * Resolve o CFOP da remessa: "mesma UF" (5911) se cliente e empresa estão no
   * mesmo estado, "interestadual" (6911) se em UFs diferentes. Quando alguma UF
   * é desconhecida, assume mesma UF — o caso interestadual exige UF explícita
   * pra não errar a tributação.
   */
  private resolverCfop(empresaUf: string | null, clienteUf: string | null): string {
    const mesmaUf = this.env.get('OMIE_CFOP_AMOSTRA_UF');
    const interestadual = this.env.get('OMIE_CFOP_AMOSTRA_INTERESTADUAL');
    const ufA = empresaUf?.trim().toUpperCase();
    const ufB = clienteUf?.trim().toUpperCase();
    return ufA && ufB && ufA !== ufB ? interestadual : mesmaUf;
  }

  /**
   * Envia a remessa de amostra pro OMIE.
   *
   * @param amostraId id da Amostra
   * @param empresaId tenant esperado (defense in depth — filtra findFirst também).
   */
  async enviarAmostra(amostraId: string, empresaId?: string): Promise<OmieAmostraEnvioResult> {
    const amostra = (await this.prisma.amostra.findFirst({
      where: empresaId ? { id: amostraId, empresaId } : { id: amostraId },
      include: { produto: true, cliente: true, empresa: true },
    })) as AmostraComRel | null;

    if (!amostra) {
      throw new BusinessRuleException(`Amostra ${amostraId} não encontrada`);
    }
    if (amostra.numeroOmie) {
      throw new BusinessRuleException(`Amostra já enviada ao OMIE (remessa ${amostra.numeroOmie})`);
    }
    if (!amostra.produto) {
      throw new BusinessRuleException(
        'Vincule um produto do catálogo à amostra antes de enviar ao OMIE (precisa do código OMIE do produto).',
      );
    }
    if (!amostra.produto.codigoOmie && !amostra.produto.sku) {
      throw new BusinessRuleException(
        `Produto "${amostra.produto.nome}" não tem código OMIE nem SKU. Sincronize o catálogo com o OMIE primeiro.`,
        ErrorCode.OMIE_ERROR,
      );
    }
    if (!amostra.cliente.codigoOmie) {
      throw new BusinessRuleException(
        `Cliente ${amostra.cliente.nome} não possui codigoOmie. Sincronize com OMIE primeiro.`,
        ErrorCode.OMIE_ERROR,
      );
    }
    if (amostra.cliente.omieStatus !== 'ATIVO') {
      throw new BusinessRuleException(
        'Cliente bloqueado no OMIE — não é possível enviar a remessa',
        ErrorCode.CLIENTE_BLOQUEADO_OMIE,
      );
    }
    if (amostra.quantidade <= 0) {
      throw new BusinessRuleException('Quantidade da amostra deve ser maior que zero');
    }

    const cfop = this.resolverCfop(amostra.empresa.uf, amostra.cliente.uf);

    addBreadcrumb('omie', 'amostra-push-start', {
      amostraId,
      empresaId: amostra.empresaId,
      cfop,
    });

    const stopTimer = this.metrics.omiePushDuration.startTimer();
    const payload = this.buildPayload(amostra, cfop);
    let response;
    try {
      response = await this.omie.incluirPedido(amostra.empresaId, payload);
    } catch (err) {
      stopTimer();
      this.metrics.omiePush.inc({ empresa: amostra.empresaId, status: 'error' });
      throw err;
    }
    stopTimer();
    this.metrics.omiePush.inc({ empresa: amostra.empresaId, status: 'success' });

    const numeroOmie = response.numero_pedido?.toString() ?? response.codigo_pedido.toString();

    addBreadcrumb('omie', 'amostra-push-success', { amostraId, numeroOmie });

    await this.prisma.amostra.update({
      where: { id: amostraId },
      data: { numeroOmie, enviadoOmieEm: new Date(), cfop },
    });

    await this.integracoes.registrarSyncOk(amostra.empresaId, 'omie').catch(() => {});

    this.logger.log(
      `Amostra ${amostraId} → OMIE remessa ${numeroOmie} (CFOP ${cfop}, ${response.descricao_status})`,
    );

    return {
      amostraId,
      numeroOmie,
      cfop,
      codigoStatusOmie: response.codigo_status,
      descricaoStatusOmie: response.descricao_status,
    };
  }

  private buildPayload(amostra: AmostraComRel, cfop: string): OmieIncluirPedidoParam {
    const cenario = this.env.get('OMIE_CENARIO_IMPOSTO_AMOSTRA');
    const produto = amostra.produto!;

    return {
      cabecalho: {
        codigo_cliente: Number(amostra.cliente.codigoOmie),
        codigo_pedido_integracao: `AMO-${amostra.id}`,
        data_previsao: OmieMapper.dateToOmie(new Date()),
        quantidade_itens: 1,
      },
      det: [
        OmieMapper.amostraItemToOmie({
          produtoCodigoOmie: produto.codigoOmie,
          produtoSku: produto.sku,
          quantidade: amostra.quantidade,
          // valor de referência: usa o valor da amostra, ou cai no preço de tabela do produto
          valorReferencia: amostra.valor > 0 ? amostra.valor : produto.precoTabela,
          cfop,
        }),
      ],
      informacoes_adicionais: cenario > 0 ? { codigo_cenario_imposto: cenario } : undefined,
      observacoes: {
        obs_venda:
          'Remessa de amostra grátis — sem valor comercial. Produto identificado como amostra.',
      },
    };
  }
}
