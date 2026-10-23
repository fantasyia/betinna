import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { pagamentoOnlineLigado } from '@modules/checkout/checkout.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { leadDoPedidoSemMover } from '@modules/pedidos/email-do-comprador';
import {
  ESPERA_MIN,
  VALIDADE_HORAS,
  leadDoRef,
  linkDoCarrinho,
  primeiroNome,
  reais,
} from './carrinho-recuperador';

type ItemSalvo = { corId: string; tamanhoId: string; quantidade: number };

/**
 * Recuperador de carrinho (Léo, 14/10 — card cmv8ikbin0011pt5ie51wvco8).
 *
 * 1) Pedido enviado e NÃO pago: o carrinho do pedido fica salvo; 20 min depois,
 *    sem pagamento, dispara PEDIDO_NAO_PAGO com o link que remonta o pedido
 *    (o pedido antigo já expirou — o cliente reenvia e paga um novo).
 * 2) Carrinho de quem veio pelo link do WhatsApp (?r=<ref do lead>): a vitrine
 *    vai salvando aqui; 20 min parado e sem pedido → CARRINHO_ABANDONADO.
 *
 * Regras: UMA mensagem por carrinho (notificadoEm por CAS); nunca depois de
 * pago; quem refez o pedido não recebe; carrinho com mais de 24 h não avisa
 * (go-live sem rajada); a supressão LGPD é do próprio ENVIAR_WHATSAPP.
 */
@Injectable()
export class CarrinhoRecuperadorService {
  private readonly logger = new Logger(CarrinhoRecuperadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly bus: FluxoEventBusService,
  ) {}

  private segredo() {
    return this.env.get('ENCRYPTION_KEY') || '';
  }

  private novoToken() {
    return randomBytes(18).toString('base64url');
  }

  private async vitrineDoSlug(slug: string) {
    const v = await this.prisma.vitrine.findUnique({
      where: { slug },
      select: { id: true, empresaId: true, ativa: true, empresa: { select: { ativo: true } } },
    });
    if (!v || !v.ativa || !v.empresa.ativo) throw new NotFoundException('Vitrine');
    return v;
  }

  /** A vitrine salva o carrinho de quem veio com ?r= (ref assinado do lead). */
  async salvarDoRef(slug: string, ref: string, itens: ItemSalvo[]) {
    const v = await this.vitrineDoSlug(slug);
    const leadId = leadDoRef(ref, this.segredo());
    if (!leadId) return { salvo: false };
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, empresaId: v.empresaId },
      select: { id: true },
    });
    if (!lead) return { salvo: false };
    const aberto = await this.prisma.carrinhoSalvo.findFirst({
      where: { vitrineId: v.id, leadId, origem: 'REF', convertidoEm: null },
      orderBy: { criadoEm: 'desc' },
      select: { id: true },
    });
    const dados = { itens: itens as unknown as Prisma.InputJsonValue };
    if (aberto) {
      await this.prisma.carrinhoSalvo.update({ where: { id: aberto.id }, data: dados });
    } else if (itens.length) {
      await this.prisma.carrinhoSalvo.create({
        data: {
          empresaId: v.empresaId,
          vitrineId: v.id,
          token: this.novoToken(),
          origem: 'REF',
          leadId,
          ...dados,
        },
      });
    }
    return { salvo: true };
  }

  /** O link ?c=<token>: itens + dados do cliente (só do carrinho DESTA vitrine). */
  async restaurar(slug: string, token: string) {
    const v = await this.vitrineDoSlug(slug);
    const c = await this.prisma.carrinhoSalvo.findUnique({
      where: { token },
      select: { vitrineId: true, itens: true, contato: true, frete: true },
    });
    if (!c || c.vitrineId !== v.id) throw new NotFoundException('Carrinho');
    return { itens: c.itens, contato: c.contato ?? null, frete: c.frete ?? null };
  }

  /** Pedido enviado: guarda o carrinho dele (pra reabrir) e fecha o do ?r=. */
  async aoEnviarPedido(args: {
    empresaId: string;
    vitrineId: string;
    pedidoId: string;
    itens: ItemSalvo[];
    contato: Record<string, unknown>;
    frete: unknown;
    ref?: string | null;
  }) {
    try {
      await this.prisma.carrinhoSalvo.create({
        data: {
          empresaId: args.empresaId,
          vitrineId: args.vitrineId,
          token: this.novoToken(),
          origem: 'PEDIDO',
          pedidoId: args.pedidoId,
          itens: args.itens as unknown as Prisma.InputJsonValue,
          contato: args.contato as Prisma.InputJsonValue,
          ...(args.frete ? { frete: args.frete as Prisma.InputJsonValue } : {}),
        },
      });
      const leadId = leadDoRef(args.ref, this.segredo());
      if (leadId) {
        await this.prisma.carrinhoSalvo.updateMany({
          where: { vitrineId: args.vitrineId, leadId, origem: 'REF', convertidoEm: null },
          data: { convertidoEm: new Date() },
        });
      }
    } catch (err) {
      // Melhor esforço: o pedido NÃO pode cair por causa do recuperador.
      this.logger.warn(
        `[recuperador] não salvou o carrinho do pedido ${args.pedidoId}: ${String(err)}`,
      );
    }
  }

  /** Rodada do job (a cada minuto): avisa o que passou de 20 min. */
  async verificar(agora = new Date()): Promise<number> {
    const limite = new Date(agora.getTime() - ESPERA_MIN * 60_000);
    const desde = new Date(agora.getTime() - VALIDADE_HORAS * 3_600_000);
    let avisos = 0;

    // 1) Pedido enviado e não pago.
    const doPedido = await this.prisma.carrinhoSalvo.findMany({
      where: {
        origem: 'PEDIDO',
        notificadoEm: null,
        convertidoEm: null,
        criadoEm: { lte: limite, gte: desde },
      },
      take: 50,
      select: { id: true, token: true, pedidoId: true, empresaId: true, vitrineId: true },
    });
    for (const c of doPedido) {
      const p = await this.prisma.pedido.findUnique({
        where: { id: c.pedidoId ?? '' },
        select: {
          id: true,
          numero: true,
          status: true,
          pagoEm: true,
          total: true,
          criadoEm: true,
          entrega: true,
          contatoNome: true,
          contatoTelefone: true,
          contatoEmail: true,
          clienteId: true,
          cliente: { select: { nome: true, email: true } },
          empresa: { select: { config: true } },
          itens: { select: { quantidade: true, precoUnitario: true } },
        },
      });
      const fechar = (motivo: string) =>
        this.prisma.carrinhoSalvo
          .updateMany({
            where: { id: c.id, convertidoEm: null },
            data: { convertidoEm: agora },
          })
          .then(() =>
            this.logger.log(`[recuperador] ${p?.numero ?? c.pedidoId}: sem aviso (${motivo})`),
          );
      if (!p) {
        await fechar('pedido sumiu');
        continue;
      }
      if (p.pagoEm || !['RASCUNHO', 'CANCELADO'].includes(p.status)) {
        await fechar('pago ou andando');
        continue;
      }
      // Sem pagamento online (ou preço/frete a confirmar), quem fecha é a equipe.
      const entrega = (p.entrega ?? {}) as { freteAConfirmar?: boolean };
      if (
        !pagamentoOnlineLigado(p.empresa.config) ||
        entrega.freteAConfirmar ||
        p.itens.some((i) => Number(i.precoUnitario) <= 0)
      ) {
        await fechar('sem pagamento online');
        continue;
      }
      // Refez o pedido depois (mesmo WhatsApp): não lembra do antigo.
      const refez = p.contatoTelefone
        ? await this.prisma.pedido.count({
            where: {
              empresaId: c.empresaId,
              contatoTelefone: p.contatoTelefone,
              criadoEm: { gt: p.criadoEm },
            },
          })
        : 0;
      if (refez) {
        await fechar('refez o pedido');
        continue;
      }
      if (!(await this.marcar(c.id, agora))) continue;
      const nome = p.contatoNome ?? p.cliente?.nome ?? '';
      const total = Number(p.total);
      // Lead do pedido (sem mexer no funil) — pra régua usar {{lead.*}} e parar.
      const leadId = await leadDoPedidoSemMover(
        this.prisma,
        c.empresaId,
        p.clienteId,
        p.contatoTelefone,
      );
      await this.bus.disparar(c.empresaId, 'PEDIDO_NAO_PAGO', {
        pedidoId: p.id,
        ...(leadId ? { leadId } : {}),
        pedido: {
          id: p.id,
          numero: p.numero,
          total,
          totalFormatado: reais(total),
          totalPecas: p.itens.reduce((s, i) => s + i.quantidade, 0),
        },
        origem: 'VITRINE',
        clienteId: p.clienteId,
        cliente: {
          id: p.clienteId,
          nome,
          primeiroNome: primeiroNome(nome),
          email: p.contatoEmail ?? p.cliente?.email ?? '',
        },
        telefone: p.contatoTelefone ?? null,
        link: await this.link(c.vitrineId, c.token),
      });
      avisos++;
    }

    // 2) Carrinho do ?r= parado e sem pedido.
    const doRef = await this.prisma.carrinhoSalvo.findMany({
      where: {
        origem: 'REF',
        notificadoEm: null,
        convertidoEm: null,
        atualizadoEm: { lte: limite, gte: desde },
      },
      take: 50,
      select: {
        id: true,
        token: true,
        leadId: true,
        empresaId: true,
        vitrineId: true,
        itens: true,
      },
    });
    for (const c of doRef) {
      const itens = Array.isArray(c.itens) ? (c.itens as ItemSalvo[]) : [];
      const pecas = itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
      if (!pecas || !c.leadId) continue;
      if (!(await this.marcar(c.id, agora))) continue;
      await this.bus.disparar(c.empresaId, 'CARRINHO_ABANDONADO', {
        leadId: c.leadId,
        origem: 'VITRINE',
        carrinho: { pecas },
        link: await this.link(c.vitrineId, c.token),
      });
      avisos++;
    }
    return avisos;
  }

  /** CAS: só um processo avisa, uma vez. */
  private async marcar(id: string, agora: Date) {
    const r = await this.prisma.carrinhoSalvo.updateMany({
      where: { id, notificadoEm: null },
      data: { notificadoEm: agora },
    });
    return r.count === 1;
  }

  private async link(vitrineId: string, token: string) {
    const v = await this.prisma.vitrine.findUnique({
      where: { id: vitrineId },
      select: { slug: true, empresa: { select: { config: true } } },
    });
    const dominio = ((v?.empresa.config ?? {}) as { branding?: { dominio?: string } }).branding
      ?.dominio;
    return linkDoCarrinho(token, v?.slug ?? '', dominio, this.env.get('FRONTEND_URL'));
  }
}
