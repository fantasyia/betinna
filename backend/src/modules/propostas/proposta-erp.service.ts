import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { TinyOrcamentosService } from '@integrations/tiny/tiny-orcamentos.service';
import { TinyContatosService } from '@integrations/tiny/tiny-contatos.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

export interface ResultadoPedidoErp {
  propostaId: string;
  /** Id do pedido de venda no ERP. */
  pedidoErpId: string;
  numeroPedido?: string;
}

export interface ResultadoPropostaErp {
  propostaId: string;
  orcamentoErpId: string;
  numeroProposta?: string;
  /** Vendedor casado no ERP; ausente = subiu sem vendedor (e o Tiny recusa). */
  vendedorErpId?: number;
}

/**
 * Sobe a proposta comercial do app como ORÇAMENTO no ERP.
 *
 * O ciclo que isto fecha: o rep monta a proposta aqui, o cliente aprova, e o
 * pedido nasce no ERP **a partir do orçamento aprovado** — não redigitado. Sem
 * isso, alguém relança à mão e o pedido pode sair com valor diferente do que o
 * cliente assinou.
 *
 * **Quem aprova é o DIRETOR, no ERP** (regra do Léo, 29/08) — e é lá, na
 * aprovação, que ele atribui o representante como vendedor do pedido de venda.
 * O app não aprova nem decide vendedor: ele sobe a proposta e AVISA que há
 * demanda esperando. Por isso o vendedor daqui é uma dica (vai junto quando o
 * rep já é vendedor no painel, poupando um passo), nunca uma trava: travar aqui
 * seguraria a proposta por causa de um cadastro que a própria aprovação resolve.
 */
@Injectable()
export class PropostaErpService {
  private readonly logger = new Logger(PropostaErpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orcamentos: TinyOrcamentosService,
    private readonly contatos: TinyContatosService,
    private readonly notificacoes: NotificacoesService,
  ) {}

  async enviar(propostaId: string, empresaId: string): Promise<ResultadoPropostaErp> {
    // Dois cliques (ou dois chamadores — 4 caminhos chegam aqui) no mesmo
    // instante passavam os dois pelo "já está no ERP?" e criavam DOIS orçamentos
    // (auditoria 13/09, I-J). Advisory lock por proposta na transação; o corpo
    // roda fora dela (usa this.prisma) — o lock só serializa a entrada, e a
    // re-leitura do orcamentoErpId no começo vê o que o primeiro gravou.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`proposta-erp:${propostaId}`}))`;
        return this.enviarSemLock(propostaId, empresaId);
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }

  private async enviarSemLock(
    propostaId: string,
    empresaId: string,
  ): Promise<ResultadoPropostaErp> {
    const proposta = await this.prisma.proposta.findFirst({
      where: { id: propostaId, empresaId },
      include: {
        cliente: true,
        itens: true,
        representante: { select: { nome: true, contatoErpId: true } },
      },
    });
    if (!proposta) throw new BusinessRuleException('Proposta não encontrada');
    if (proposta.orcamentoErpId) {
      // Reenviar criaria um segundo orçamento pro mesmo negócio, e o cliente
      // receberia duas propostas com números diferentes.
      throw new BusinessRuleException(
        `Proposta já está no ERP (orçamento ${proposta.orcamentoErpId})`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (proposta.status === 'RASCUNHO') {
      throw new BusinessRuleException(
        'Proposta em rascunho — envie ou aprove antes de subir ao ERP',
      );
    }
    // CONTRATO ASSINADO É A CONDIÇÃO DE SUBIDA.
    //
    // O que o Leandro analisa no ERP é o contrato já assinado pelo cliente —
    // subir antes disso põe na mesa dele uma proposta que ninguém aceitou, e
    // some a diferença entre "negócio fechado" e "negócio em conversa".
    //
    // A subida acontece sozinha no retorno da assinatura; este caminho manual
    // existe só como FORÇAR, pra quando o envio automático falhar (ERP fora do
    // ar, token vencido) — e é por isso que a regra vale nos dois: se o
    // contrato não está assinado, não há o que forçar.
    const contrato = await this.prisma.contrato.findFirst({
      where: { propostaId },
      select: { status: true },
    });
    if (contrato && contrato.status !== 'ASSINADO') {
      throw new BusinessRuleException(
        `Contrato ainda não assinado (${contrato.status}) — a proposta sobe pro ERP sozinha ` +
          'assim que o cliente assinar. Só depois disso dá pra forçar por aqui.',
      );
    }

    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: proposta.itens.map((i) => i.produtoId) } },
      select: { id: true, sku: true, nome: true, valorBem: true },
    });
    const skuPorProduto = new Map(produtos.map((p) => [p.id, p.sku]));
    const semSku = proposta.itens.filter((i) => !skuPorProduto.get(i.produtoId));
    if (semSku.length > 0) {
      throw new BusinessRuleException(
        `Produto sem SKU na proposta (${semSku.map((i) => i.produtoNome).join(', ')}) — ` +
          'o SKU é o que amarra o item ao ERP.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    /**
     * 🔴 LOCAÇÃO sobe valorada pelo EQUIPAMENTO, não pela mensalidade.
     *
     * O orçamento vira pedido de venda, e é do pedido que sai a NF de COMODATO
     * (decisão do Léo, 12/09: a remessa nunca é nota avulsa). A nota declara o
     * que está saindo da empresa — e o que sai é o equipamento, não o aluguel.
     * Subir R$ 522/mês faria a remessa declarar um patrimônio de 522 reais
     * saindo quando o bem vale muito mais, numa nota que não se corrige depois.
     *
     * A mensalidade não se perde: ela é o `valorMensal` do contrato recorrente,
     * que é quem cobra todo mês — e é de lá que a comissão do rep sai.
     *
     * ⚠️ Só vale quando o tenant LIGOU o comodato. Enquanto a contabilidade não
     * definiu a natureza da operação, o orçamento continua como sempre foi:
     * trocar a valoração por conta própria mudaria, em silêncio, o número que o
     * diretor aprova.
     */
    const valorBemPorProduto = new Map(produtos.map((p) => [p.id, p.valorBem]));
    const comodatoLigado =
      proposta.modalidade === 'LOCACAO' && (await this.comodatoLigado(empresaId));
    if (comodatoLigado) {
      const semValor = proposta.itens.filter((i) => valorBemPorProduto.get(i.produtoId) == null);
      if (semValor.length > 0) {
        throw new BusinessRuleException(
          `Falta o valor do equipamento em: ${semValor.map((i) => i.produtoNome).join(', ')}. ` +
            'Na locação o orçamento sobe valorado pelo BEM (é dele que a NF de comodato nasce) — ' +
            'preencha "valorBem" no produto. Subir com a mensalidade faria a remessa declarar o valor errado.',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
    }

    const vendedorErpId = await this.resolverVendedor(empresaId, proposta.representante);

    const r = await this.orcamentos.criar(empresaId, {
      cliente: {
        nome: proposta.cliente.nome,
        cpfCnpj: proposta.cliente.cnpj ?? undefined,
        email: proposta.cliente.email ?? undefined,
        telefone: proposta.cliente.telefone ?? undefined,
        // O endereço vai junto: é ele que faz o ERP conseguir cotar frete e
        // emitir etiqueta depois. Sem isso o contato nasce sem CEP e a falha
        // só aparece na expedição, com uma mensagem que não fala em cadastro.
        endereco: {
          cep: proposta.cliente.cep,
          endereco: proposta.cliente.endereco,
          numero: proposta.cliente.numero,
          complemento: proposta.cliente.complemento,
          bairro: proposta.cliente.bairro,
          cidade: proposta.cliente.cidade,
          uf: proposta.cliente.uf,
        },
      },
      itens: proposta.itens.map((i) => ({
        sku: skuPorProduto.get(i.produtoId)!,
        quantidade: i.quantidade,
        // O unitário JÁ com o desconto do item: é o preço que o cliente leu na
        // proposta. Mandar o cheio e o desconto separado faria o total do ERP
        // divergir do PDF que ele aprovou.
        valorUnitario: comodatoLigado
          ? Number(valorBemPorProduto.get(i.produtoId))
          : Number(i.total) / Math.max(1, i.quantidade),
      })),
      ...(vendedorErpId ? { vendedorId: vendedorErpId } : {}),
      ...(proposta.validoAte ? { validadeDias: this.diasAte(proposta.validoAte) } : {}),
      ...(proposta.prazoEntrega
        ? { dataPrevistaEntrega: proposta.prazoEntrega.toISOString().slice(0, 10) }
        : {}),
      ...(this.prazoEmDias(proposta.condicaoPagamento)
        ? { condicaoPagamento: this.prazoEmDias(proposta.condicaoPagamento)! }
        : {}),
      observacao: [
        // Marcador NO INÍCIO e entre colchetes: o pedido gerado a partir deste
        // orçamento herda a observação, e é por ela que o app descobre de qual
        // proposta o pedido nasceu. Frase solta no meio do texto é achável por
        // gente, não por código — e o campo de "ordem de compra", que seria o
        // lugar próprio, não existe no orçamento do Tiny.
        `[${proposta.numero}]`,
        `Proposta ${proposta.numero} (Betinna)`,
        proposta.modalidade === 'LOCACAO'
          ? comodatoLigado
            ? `LOCAÇÃO — itens valorados pelo EQUIPAMENTO (remessa em comodato). Aluguel: ${this.dinheiro(proposta.valor)}/mês, cobrado pelo contrato recorrente`
            : 'LOCAÇÃO MENSAL (valor por mês)'
          : 'VENDA',
        proposta.observacoes ?? '',
      ]
        .filter(Boolean)
        .join(' — '),
    });

    await this.prisma.proposta.update({
      where: { id: proposta.id },
      data: { orcamentoErpId: String(r.id), enviadaErpEm: new Date() },
    });

    // O diretor precisa SABER que tem proposta esperando aprovação no ERP —
    // senão a proposta fica lá parada e o rep cobra o app por algo que só
    // acontece no Tiny.
    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['DIRECTOR', 'ADMIN'],
        tipo: 'APROVACAO_PENDENTE',
        titulo: `Proposta ${proposta.numero} aguarda aprovação no ERP`,
        mensagem:
          `${proposta.cliente.nome} — orçamento ${r.numeroProposta ?? r.id} no Tiny. ` +
          `Aprove lá e atribua ${proposta.representante?.nome ?? 'o representante'} como vendedor: ` +
          'é a aprovação que transforma a proposta em pedido de venda.',
        prioridade: 'ALTA',
        link: `/propostas?highlight=${proposta.id}`,
        metadata: { orcamentoErpId: String(r.id), propostaId: proposta.id },
      })
      .catch(() => undefined);

    this.logger.log(
      `Proposta ${proposta.numero} → orçamento Tiny ${r.numeroProposta ?? r.id} (id ${r.id})`,
    );
    return {
      propostaId: proposta.id,
      orcamentoErpId: String(r.id),
      numeroProposta: r.numeroProposta,
      ...(vendedorErpId ? { vendedorErpId } : {}),
    };
  }

  /**
   * Orçamento aprovado no ERP → PEDIDO DE VENDA, sem redigitar.
   *
   * A aprovação é do diretor, no painel do Tiny (regra do Léo, 29/08). Depois
   * dela sobrava um passo manual: relançar o orçamento como pedido. Relançar é
   * onde o valor diverge do que o cliente aprovou, e a divergência só aparece
   * na nota.
   *
   * A trava do pedido duplicado é DAQUI: o Tiny gera um pedido novo a cada
   * chamada, sem reclamar da segunda.
   */
  async gerarPedido(propostaId: string, empresaId: string): Promise<ResultadoPedidoErp> {
    const proposta = await this.prisma.proposta.findFirst({
      where: { id: propostaId, empresaId },
      select: {
        id: true,
        numero: true,
        status: true,
        orcamentoErpId: true,
        pedidoErpId: true,
        cliente: { select: { nome: true } },
      },
    });
    if (!proposta) throw new BusinessRuleException('Proposta não encontrada');
    if (!proposta.orcamentoErpId) {
      throw new BusinessRuleException(
        'Proposta ainda não está no ERP — suba o orçamento antes (Enviar para o ERP).',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (proposta.pedidoErpId) {
      throw new BusinessRuleException(
        `Esta proposta já virou o pedido ${proposta.pedidoErpId} no ERP.`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    // ACEITA (venda) ou ASSINADA (locação, contrato de volta). Gerar pedido de
    // proposta que o cliente não aceitou é criar demanda de faturamento pra um
    // negócio que ainda está em negociação.
    if (proposta.status !== 'ACEITA' && proposta.status !== 'ASSINADA') {
      throw new BusinessRuleException(
        `A proposta precisa estar ACEITA pelo cliente (está ${proposta.status}).`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const r = await this.orcamentos.gerarVenda(empresaId, Number(proposta.orcamentoErpId));
    if (!r?.id) {
      throw new BusinessRuleException(
        'O ERP não devolveu o pedido gerado — confira o orçamento no painel antes de tentar de novo.',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    await this.prisma.proposta.update({
      where: { id: proposta.id },
      data: { pedidoErpId: String(r.id), pedidoErpEm: new Date() },
    });

    await this.notificacoes
      .criarParaRole({
        empresaId,
        roles: ['DIRECTOR', 'ADMIN'],
        // O enum não tem "pedido gerado no ERP"; PEDIDO_APROVADO é o que já
        // significa "virou pedido lá" pro resto do app.
        tipo: 'PEDIDO_APROVADO',
        titulo: `Proposta ${proposta.numero} virou pedido no ERP`,
        mensagem:
          `${proposta.cliente.nome} — pedido ${r.numeroPedido ?? r.id} gerado a partir do ` +
          'orçamento aprovado, com os valores que o cliente aceitou.',
        prioridade: 'NORMAL',
        link: `/propostas?highlight=${proposta.id}`,
        metadata: { pedidoErpId: String(r.id), propostaId: proposta.id },
      })
      .catch(() => undefined);

    this.logger.log(
      `Proposta ${proposta.numero} → pedido Tiny ${r.numeroPedido ?? r.id} (id ${r.id})`,
    );
    return {
      propostaId: proposta.id,
      pedidoErpId: String(r.id),
      numeroPedido: r.numeroPedido,
    };
  }

  /**
   * Vendedor do ERP correspondente ao rep — quando já existir.
   *
   * Devolve `undefined` sem reclamar: o vendedor definitivo é atribuído pelo
   * diretor na hora de aprovar, no painel do Tiny. Mandar o que já se sabe só
   * poupa um passo dele.
   */
  private async resolverVendedor(
    empresaId: string,
    rep: { nome: string; contatoErpId: string | null } | null,
  ): Promise<number | undefined> {
    const contato = Number(rep?.contatoErpId ?? 0);
    if (!contato) return undefined;
    const vendedor = await this.contatos.acharVendedorPorContato(empresaId, contato);
    return vendedor ?? undefined;
  }

  /** Condição do app → prazo legível ("30 60"). À vista não vira texto nenhum. */
  private prazoEmDias(condicao: string | null): string | null {
    const mapa: Record<string, string> = {
      '15dias': '15',
      '30dias': '30',
      '30_60': '30 60',
      '30_60_90': '30 60 90',
    };
    return condicao ? (mapa[condicao] ?? null) : null;
  }

  /** Validade em DIAS: é assim que o Tiny guarda, e é o que a proposta impressa mostra. */
  private diasAte(data: Date): number {
    const dia = 24 * 60 * 60 * 1000;
    return Math.max(1, Math.ceil((data.getTime() - Date.now()) / dia));
  }
  /** A valoração pelo bem só entra quando a contabilidade ligou o comodato. */
  private async comodatoLigado(empresaId: string): Promise<boolean> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const erp = ((empresa?.config as Record<string, unknown> | null)?.erp ?? {}) as {
      comodato?: { emiteNota?: boolean | null };
    };
    return erp.comodato?.emiteNota === true;
  }

  private dinheiro(v: unknown): string {
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
