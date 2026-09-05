import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NOME_FORMA, dividirEmParcelas } from '@modules/pedidos/parcelas.util';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { TinyPedidosService, type EnderecoEntregaTiny } from './tiny-pedidos.service';
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

  /**
   * Endereço de entrega do pedido, no formato do ERP.
   *
   * Sem CEP e logradouro não adianta mandar: o Tiny recusa endereço pela
   * metade, e um pedido recusado é pior que um pedido sem endereço (que ao
   * menos existe e dá pra completar no painel).
   *
   * Os nomes dos campos são do contrato da Olist: `enderecoNro` e `municipio`,
   * não `numero` e `cidade`.
   */
  private enderecoDe(c: {
    nome: string;
    cep: string | null;
    endereco: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    telefone: string | null;
    cnpj: string | null;
  }): EnderecoEntregaTiny | null {
    const cep = (c.cep ?? '').replace(/\D/g, '');
    if (!cep || !c.endereco) return null;
    const doc = (c.cnpj ?? '').replace(/\D/g, '');
    return {
      endereco: c.endereco,
      enderecoNro: c.numero ?? 'S/N',
      ...(c.complemento ? { complemento: c.complemento } : {}),
      ...(c.bairro ? { bairro: c.bairro } : {}),
      ...(c.cidade ? { municipio: c.cidade } : {}),
      cep,
      ...(c.uf ? { uf: c.uf } : {}),
      ...(c.telefone ? { fone: c.telefone } : {}),
      nomeDestinatario: c.nome,
      ...(doc
        ? { cpfCnpj: doc, tipoPessoa: doc.length > 11 ? ('J' as const) : ('F' as const) }
        : {}),
    };
  }

  /**
   * Cancela no ERP o pedido correspondente ao número guardado aqui.
   *
   * Recebe o NÚMERO do ERP (o que o app guarda) e resolve o id interno — são
   * coisas diferentes lá, e cancelar pelo número errado cancelaria outro pedido.
   */
  async cancelarNoErp(empresaId: string, numeroErp: string): Promise<void> {
    const { itens } = await this.pedidos.listar(empresaId, { numero: numeroErp, limit: 20 });
    const alvo = itens.find((p) => String(p.numeroPedido) === String(numeroErp));
    if (!alvo) {
      throw new Error(`pedido ${numeroErp} não encontrado no ERP`);
    }
    await this.pedidos.cancelar(empresaId, alvo.id);
  }

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

    // Canal de e-commerce do tenant (Integrações → e-commerce, no ERP). É
    // opcional: sem ele o pedido entra igual, só não fica amarrado ao canal.
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: pedido.empresaId },
      select: { config: true },
    });
    const erpCfg = ((empresa?.config as Record<string, unknown> | null)?.erp ?? {}) as {
      ecommerceId?: number;
    };

    // Parcelas: é o que faz o Tiny gerar (e estornar) as contas a receber
    // junto com a nota. Forma pelo cadastro do tenant; sem ela, só as parcelas.
    const formaRecebimentoId = await this.pedidos.acharFormaRecebimento(
      pedido.empresaId,
      NOME_FORMA[pedido.formaPagamento] ?? 'Pix',
    );
    const parcelas = dividirEmParcelas(Number(pedido.total), pedido.condicaoPagamento);

    const r = await this.pedidos.criar(pedido.empresaId, {
      cliente: {
        nome: pedido.cliente.nome,
        cpfCnpj: pedido.cliente.cnpj ?? undefined,
        email: pedido.cliente.email ?? undefined,
        telefone: pedido.cliente.telefone ?? undefined,
        // Endereço junto — o ERP precisa dele pra cotar frete e emitir etiqueta.
        endereco: {
          cep: pedido.cliente.cep,
          endereco: pedido.cliente.endereco,
          numero: pedido.cliente.numero,
          complemento: pedido.cliente.complemento,
          bairro: pedido.cliente.bairro,
          cidade: pedido.cliente.cidade,
          uf: pedido.cliente.uf,
        },
      },
      itens: pedido.itens.map((i) => ({
        sku: i.produto!.sku!,
        quantidade: i.quantidade,
        valorUnitario: Number(i.precoUnitario),
      })),
      // O número que a pessoa vai DIZER quando ligar.
      //
      // Pedido nascido no site tem dois números: o SB… que o cliente recebeu
      // por e-mail e vai citar no WhatsApp, e o PED-… interno daqui. No ERP
      // vale o primeiro — quem atende procura pelo que o cliente falou, e
      // `numeroPedidoEcommerce` é campo de busca, diferente da observação.
      // (O casamento na volta é por `numeroErp`, não por este campo, então
      // trocar aqui não afeta a sincronização.)
      numeroPedidoEcommerce: pedido.numeroSite ?? pedido.numero,
      // E o mesmo número no "Nº da ordem de compra": é o campo que aparece no
      // cabeçalho e na lista do painel. O de e-commerce só aparece na busca —
      // quem abre o pedido 40 lá precisa ver "SB239379" (ou "PED-0001") na cara.
      numeroOrdemCompra: pedido.numeroSite ?? pedido.numero,
      pagamento: {
        ...(formaRecebimentoId ? { formaRecebimentoId } : {}),
        parcelas,
      },
      // Data no fuso do Brasil. Sem este campo o Tiny aceitava o pedido com
      // `data: ""` — e o painel, que lista por período, não mostrava NENHUM
      // pedido vindo daqui. Existiam, em "preparando envio", invisíveis.
      data: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
      ...(this.enderecoDe(pedido.cliente)
        ? { enderecoEntrega: this.enderecoDe(pedido.cliente)! }
        : {}),
      ...(erpCfg.ecommerceId ? { ecommerceId: Number(erpCfg.ecommerceId) } : {}),
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
