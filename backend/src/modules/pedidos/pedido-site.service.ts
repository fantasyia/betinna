import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { LeadCaptureService } from '@modules/leads/lead-capture.service';
import { TinyPedidoPushService } from '@integrations/tiny/tiny-pedido-push.service';
import { PedidoComissoesService } from './pedido-comissoes.service';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { SequenceService } from '@shared/utils/sequence.service';

export interface PedidoDoSiteDto {
  /** Número que o CLIENTE vê no site (SB1234). É a chave do retorno. */
  numeroSite: string;
  cliente: {
    nome: string;
    cpfCnpj?: string;
    email?: string;
    telefone?: string;
  };
  itens: Array<{ sku: string; quantidade: number; valorUnitario: number }>;
  valorFrete?: number;
  observacoes?: string;
  entrega?: {
    cep: string;
    logradouro: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
  };
}

/**
 * O pedido do checkout do site entrando no Betinna.
 *
 * O site é dono da **tela do cliente** (número do pedido, acompanhamento); o
 * Betinna é o hub que fala com o ERP. Por isso o site POSTa aqui e recebe de
 * volta, depois, as mudanças de situação e rastreio — em vez de falar com o
 * Tiny direto, o que exigiria guardar refresh token na borda.
 *
 * **Idempotente pelo `numeroSite`.** Checkout com clique duplo, retry do
 * gateway ou reenvio manual não podem virar dois pedidos: seria cobrança dupla
 * e duas notas. Reenvio devolve o pedido que já existe.
 *
 * A origem é `SITE`, e isso não é rótulo: é o que decide a comissão de
 * originação (canal, não representante).
 */
@Injectable()
export class PedidoSiteService {
  private readonly logger = new Logger(PedidoSiteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly captura: LeadCaptureService,
    private readonly sequence: SequenceService,
    private readonly erpPush: TinyPedidoPushService,
    private readonly comissoes: PedidoComissoesService,
  ) {}

  async receber(
    apiKey: string | undefined,
    dto: PedidoDoSiteDto,
  ): Promise<{ pedidoId: string; numero: string; numeroErp: string | null; duplicado: boolean }> {
    // Mesma chave do formulário de leads: duas chaves pro mesmo site seriam
    // duas coisas pra girar, e a esquecida vira porta aberta.
    const empresaId = await this.captura.autenticarChave(apiKey);

    const jaExiste = await this.prisma.pedido.findFirst({
      where: { empresaId, numeroSite: dto.numeroSite },
      select: { id: true, numero: true, numeroErp: true },
    });
    if (jaExiste) {
      return { ...jaExiste, pedidoId: jaExiste.id, duplicado: true };
    }

    const produtos = await this.prisma.produto.findMany({
      where: { empresaId, sku: { in: dto.itens.map((i) => i.sku) } },
      select: { id: true, sku: true, nome: true },
    });
    const porSku = new Map(produtos.map((p) => [p.sku, p]));
    const faltando = dto.itens.filter((i) => !porSku.get(i.sku));
    if (faltando.length > 0) {
      // Pedido com item faltando vira nota errada. Melhor recusar o checkout do
      // que aceitar meio pedido e descobrir na expedição.
      throw new BusinessRuleException(
        `SKU não cadastrado: ${faltando.map((i) => i.sku).join(', ')}`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const cliente = await this.acharOuCriarCliente(empresaId, dto.cliente, dto.entrega);
    const subtotal = dto.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
    const total = subtotal + (dto.valorFrete ?? 0);
    const seq = await this.sequence.next(empresaId, 'pedido');
    const numero = `PED-${seq.toString().padStart(4, '0')}`;

    const pedido = await this.prisma.pedido.create({
      data: {
        empresaId,
        numero,
        numeroSite: dto.numeroSite,
        clienteId: cliente.id,
        // Venda de canal: sem representante de propósito. Atribuir alguém aqui
        // criaria comissão de rep sobre venda que ninguém atendeu.
        representanteId: null,
        origem: 'SITE',
        status: 'RASCUNHO',
        // Venda do site é paga no checkout (Pix, à vista). É isto que decide a
        // conta a receber no ERP — o default do app (boleto) é do pedido de rep.
        formaPagamento: 'PIX',
        condicaoPagamento: 'avista',
        subtotal: new Prisma.Decimal(subtotal),
        total: new Prisma.Decimal(total),
        // Frete em coluna própria: entra no total, mas fica FORA da comissão.
        frete: new Prisma.Decimal(dto.valorFrete ?? 0),
        comissao: new Prisma.Decimal(0),
        // O frete também fica dito na observação, que é o que a expedição lê.
        observacoes: [
          `Pedido ${dto.numeroSite} (site)`,
          dto.valorFrete ? `frete R$ ${dto.valorFrete.toFixed(2)}` : '',
          dto.observacoes ?? '',
        ]
          .filter(Boolean)
          .join(' — '),
        itens: {
          // Só COLUNAS reais do PedidoItem. O nome do produto NÃO mora aqui —
          // vem por `produtoId`. Um campo a mais faz o Prisma recusar a
          // gravação inteira, e o `tsc` não pega: em `create` aninhado montado
          // por `.map()`, o excesso de propriedade passa batido pelo
          // typecheck. Foi assim que dois pedidos reais morreram em 400.
          create: dto.itens.map((i) => ({
            produtoId: porSku.get(i.sku)!.id,
            quantidade: i.quantidade,
            precoUnitario: new Prisma.Decimal(i.valorUnitario),
            desconto: 0,
            total: new Prisma.Decimal(i.quantidade * i.valorUnitario),
          })),
        },
      },
      select: { id: true, numero: true },
    });

    // Comissão de canal: quem tem % de site configurada ganha a linha dele
    // agora, amarrada a ESTE pedido — e não num agregado do fim do mês.
    await this.comissoes.recalcular(pedido.id);

    // Sobe pro ERP na hora: pedido do site que fica esperando a rodada diária é
    // pedido que o cliente pagou e a expedição não vê. Falha aqui NÃO derruba a
    // resposta — o pedido existe, e a rodada diária reenvia.
    let numeroErp: string | null = null;
    try {
      const r = await this.erpPush.enviarPedido(pedido.id, empresaId);
      numeroErp = r.numeroErp;
    } catch (err) {
      this.logger.error(
        `[site] pedido ${dto.numeroSite} criado (${pedido.numero}) mas NÃO subiu ao ERP: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(`[site] pedido ${dto.numeroSite} → ${pedido.numero} (ERP ${numeroErp ?? '—'})`);
    return { pedidoId: pedido.id, numero: pedido.numero, numeroErp, duplicado: false };
  }

  /**
   * Cliente do checkout: documento primeiro, telefone como segunda chave.
   *
   * A mesma regra que o resto do app usa — quem já comprou pelo rep e volta
   * pelo site precisa cair no MESMO cadastro, senão o histórico se parte em
   * dois e a carteira do rep perde o cliente.
   */
  private async acharOuCriarCliente(
    empresaId: string,
    c: PedidoDoSiteDto['cliente'],
    entrega?: PedidoDoSiteDto['entrega'],
  ): Promise<{ id: string }> {
    const doc = (c.cpfCnpj ?? '').replace(/\D/g, '');
    if (doc) {
      const porDoc = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Cliente"
        WHERE "empresaId" = ${empresaId}
          AND REGEXP_REPLACE(COALESCE("cnpj", ''), '[^0-9]', '', 'g') = ${doc}
        LIMIT 1`;
      if (porDoc[0]) return this.completar(porDoc[0].id, c, entrega);
    }
    const tel = (c.telefone ?? '').replace(/\D/g, '');
    if (tel.length >= 8) {
      const sufixo = tel.slice(-8);
      const porTel = await this.prisma.$queryRaw<Array<{ id: string; doc: string | null }>>`
        SELECT "id", REGEXP_REPLACE(COALESCE("cnpj", ''), '[^0-9]', '', 'g') AS doc
        FROM "Cliente"
        WHERE "empresaId" = ${empresaId}
          AND RIGHT(REGEXP_REPLACE(COALESCE("telefone", ''), '[^0-9]', '', 'g'), 8) = ${sufixo}
        LIMIT 1`;

      // ⚠️ O DOCUMENTO VETA o casamento por telefone.
      //
      // O sufixo de 8 dígitos ignora o DDD (D18), então "11 99999-0000" e
      // "71 99999-0000" são a MESMA chave: duas pessoas de estados diferentes
      // colidem. Aconteceu num teste real — o pedido caiu num cliente da Bahia
      // e a nota sairia no CPF dele.
      //
      // Documento é identidade forte; sufixo de telefone é pista. Quando os
      // dois discordam, quem manda é o documento: melhor criar cadastro novo
      // (que se funde depois) do que faturar no CPF de outra pessoa.
      const achado = porTel[0];
      const conflito = Boolean(doc && achado?.doc && achado.doc !== doc);
      if (achado && !conflito) return this.completar(achado.id, c, entrega);
      if (conflito) {
        this.logger.warn(
          `[site] telefone bate com cliente ${achado!.id}, mas o documento não — cadastro novo`,
        );
      }
    }
    return this.prisma.cliente.create({
      data: {
        empresaId,
        nome: c.nome,
        cnpj: c.cpfCnpj ?? null,
        email: c.email ?? null,
        telefone: c.telefone ?? null,
        ...this.enderecoParaCliente(entrega),
      },
      select: { id: true },
    });
  }

  /**
   * Cliente que já existe recebe o que veio novo — sem apagar o que já tinha.
   *
   * Duas coisas dependem disto e falham CALADAS quando faltam: o CPF/CNPJ, sem
   * o qual não se emite nota, e o endereço, sem o qual não se gera etiqueta.
   * Quem comprou pelo rep e volta pelo site normalmente não tem nem um nem
   * outro — e é justamente esse cadastro que trava o faturamento depois.
   *
   * O endereço é sobrescrito de propósito: é o destino que a pessoa acabou de
   * digitar pra ESTE pedido, e é pra lá que a etiqueta vai.
   */
  private async completar(
    id: string,
    c: PedidoDoSiteDto['cliente'],
    entrega?: PedidoDoSiteDto['entrega'],
  ): Promise<{ id: string }> {
    const atual = await this.prisma.cliente.findUnique({
      where: { id },
      select: { cnpj: true, email: true, telefone: true },
    });
    const patch: Record<string, unknown> = {
      ...this.enderecoParaCliente(entrega),
      // Só PREENCHE o que está vazio: sobrescrever documento de cadastro
      // antigo com o que veio de um formulário é como se perde dado bom.
      ...(!atual?.cnpj && c.cpfCnpj ? { cnpj: c.cpfCnpj } : {}),
      ...(!atual?.email && c.email ? { email: c.email } : {}),
      ...(!atual?.telefone && c.telefone ? { telefone: c.telefone } : {}),
    };
    if (Object.keys(patch).length > 0) {
      await this.prisma.cliente.update({ where: { id }, data: patch });
    }
    return { id };
  }

  /** Endereço do checkout nos campos do Cliente (de onde o ERP vai lê-lo). */
  private enderecoParaCliente(e?: PedidoDoSiteDto['entrega']): Record<string, string> {
    if (!e?.cep || !e.logradouro) return {};
    return {
      cep: e.cep,
      endereco: e.logradouro,
      ...(e.numero ? { numero: e.numero } : {}),
      ...(e.complemento ? { complemento: e.complemento } : {}),
      ...(e.bairro ? { bairro: e.bairro } : {}),
      ...(e.cidade ? { cidade: e.cidade } : {}),
      ...(e.uf ? { uf: e.uf.toUpperCase() } : {}),
    };
  }
}
