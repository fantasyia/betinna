import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { TinyPedidosService } from './tiny-pedidos.service';
import { TinyContatosService } from './tiny-contatos.service';

export interface ResultadoPush {
  pedidoId: string;
  numeroErp: string;
  idTiny: number;
}

/**
 * Envia um Pedido do Betinna para o Tiny.
 *
 * Substitui o antigo push do OMIE — mesma responsabilidade, ERP diferente
 * (D50). O que muda em relação a como era:
 *
 *  - **Itens vão por SKU, não por código do ERP.** Antes o produto precisava
 *    ter `codigoErp` preenchido pelo sync antes de qualquer venda; agora o SKU
 *    é a chave que as três pontas (site, app, ERP) já conhecem, então produto
 *    recém-criado no ERP vende sem esperar sync.
 *  - **O cliente não precisa estar sincronizado.** O Tiny exige `idContato`, e
 *    o `TinyPedidosService` resolve por CPF/CNPJ (ou cria). Antes, cliente sem
 *    `codigoErp` bloqueava o pedido inteiro.
 *
 * O que NÃO muda: quem valida regra de negócio (status, aprovação de desconto,
 * cliente bloqueado, pedido mínimo) continua sendo o `PedidosService`. Este
 * service só traduz e persiste o resultado.
 */
@Injectable()
export class TinyPedidoPushService {
  private readonly logger = new Logger(TinyPedidoPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pedidos: TinyPedidosService,
    private readonly contatos: TinyContatosService,
    private readonly integracoes: IntegracoesService,
  ) {}

  async enviarPedido(pedidoId: string, empresaId?: string): Promise<ResultadoPush> {
    const pedido = await this.prisma.pedido.findFirst({
      where: empresaId ? { id: pedidoId, empresaId } : { id: pedidoId },
      include: {
        itens: { include: { produto: true } },
        cliente: true,
        representante: { select: { nome: true, contatoErpId: true } },
      },
    });
    if (!pedido) throw new BusinessRuleException(`Pedido ${pedidoId} não encontrado`);

    const semSku = pedido.itens.filter((i) => !i.produto?.sku);
    if (semSku.length > 0) {
      // Falha ANTES de criar qualquer coisa no ERP: pedido com item faltando
      // vira nota errada, e nota errada é problema fiscal, não bug de tela.
      throw new BusinessRuleException(
        `Produto sem SKU no pedido (${semSku.map((i) => i.produto?.nome ?? i.produtoId).join(', ')}) — ` +
          'o SKU é o que amarra o item ao ERP.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // VENDEDOR: sem ele, o pedido nasce órfão no ERP e a comissão de lá fica sem
    // dono — alguém teria que corrigir à mão, pedido a pedido. O rep vira
    // contato pela rodada diária; virar VENDEDOR é um clique no painel, e
    // enquanto não for, isto devolve null e o pedido sobe sem vendedor (que é
    // melhor que subir no vendedor errado).
    const contatoDoRep = Number(pedido.representante?.contatoErpId ?? 0);
    const vendedorId = contatoDoRep
      ? await this.contatos.acharVendedorPorContato(pedido.empresaId, contatoDoRep)
      : null;
    if (contatoDoRep && !vendedorId) {
      this.logger.warn(
        `[erp] ${pedido.representante?.nome ?? 'rep'} ainda não é VENDEDOR no Tiny — ` +
          `pedido ${pedido.numero} sobe sem vendedor (marque o papel em Cadastros → Vendedores)`,
      );
    }

    const r = await this.pedidos.criar(pedido.empresaId, {
      cliente: {
        nome: pedido.cliente.nome,
        cpfCnpj: pedido.cliente.cnpj ?? undefined,
        email: pedido.cliente.email ?? undefined,
        telefone: pedido.cliente.telefone ?? undefined,
      },
      itens: pedido.itens.map((i) => ({
        sku: i.produto!.sku!,
        quantidade: i.quantidade,
        valorUnitario: Number(i.precoUnitario),
      })),
      // O número do NOSSO pedido viaja junto: é por ele que o webhook de volta
      // casa o pedido do ERP com o daqui, sem depender de ordem de criação.
      numeroPedidoEcommerce: pedido.numero,
      ...(vendedorId ? { vendedorId } : {}),
      observacoes: pedido.observacoes ?? undefined,
    });

    const numeroErp = String(r.numeroPedido ?? r.id);
    await this.prisma.pedido.update({
      where: { id: pedido.id },
      data: {
        status: 'ENVIADO_ERP',
        numeroErp,
        // Preserva a data do PRIMEIRO envio: reenvio não pode remarcar, senão a
        // comissão do mês seria recontada em outro fechamento.
        enviadoErpEm: pedido.enviadoErpEm ?? new Date(),
      },
    });

    // Saúde, não sync: `registrarSyncOk` avançaria o cursor do incremental e o
    // próximo sync pularia tudo que mudou no ERP no meio do caminho.
    await this.integracoes.registrarSaudeOk(pedido.empresaId, 'tiny').catch(() => undefined);

    this.logger.log(`Pedido ${pedido.numero} → Tiny ${numeroErp} (id ${r.id})`);
    return { pedidoId: pedido.id, numeroErp, idTiny: r.id };
  }
}
