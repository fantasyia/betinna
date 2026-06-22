import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { SequenceService } from '@shared/utils/sequence.service';

/**
 * C3 (Lote 6) — Aceite externo de proposta pelo cliente.
 *
 * Fluxo:
 *  1. Rep gera link (gerarLink) → JWT assinado + salvo em Proposta.aceiteToken,
 *     status vira AGUARDANDO_ASSINATURA, TTL default 7 dias.
 *  2. Cliente acessa página pública /proposta/aceite/<token> — resolverPreview
 *     valida o token e devolve os dados pra exibição (sem login).
 *  3. Cliente aceita/recusa — registrarDecisao:
 *       ACEITA  → status ACEITA + aceitoEm/aceitoDoIp + cria Pedido RASCUNHO
 *                 automaticamente + notifica o rep.
 *       RECUSADA → status RECUSADA.
 *     Token é invalidado (one-time) após a decisão.
 *
 * Segurança: JWT HS256 com secret derivada da ENCRYPTION_KEY (isolada via
 * SHA256, mesmo padrão do CatalogShareService / D14). Token validado contra
 * o `aceiteToken` salvo no banco — assim revogação/one-time é garantida mesmo
 * com JWT ainda válido por tempo.
 */

const TTL_DEFAULT_SECONDS = 60 * 60 * 24 * 7; // 7 dias

interface AcceptPayload {
  propostaId: string;
  empresaId: string;
}

export interface AceitePreview {
  numero: string;
  empresaNome: string;
  clienteNome: string;
  status: string;
  validoAte: Date | null;
  formaPagamento: string;
  condicaoPagamento: string | null;
  subtotal: number;
  descontoGeral: number;
  valor: number;
  observacoes: string | null;
  jaRespondida: boolean; // true se status final (ACEITA/RECUSADA/EXPIRADA)
  itens: Array<{
    produtoNome: string;
    quantidade: number;
    precoUnitario: number;
    desconto: number;
    total: number;
  }>;
}

@Injectable()
export class PropostaAceiteService {
  private readonly logger = new Logger(PropostaAceiteService.name);
  private readonly secret: Uint8Array;
  private readonly ttlSeconds = TTL_DEFAULT_SECONDS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly sequence: SequenceService,
    private readonly notificacoes: NotificacoesService,
  ) {
    const derivedKey = createHash('sha256')
      .update(this.env.get('ENCRYPTION_KEY'))
      .update('proposta-aceite-token')
      .digest();
    this.secret = new Uint8Array(derivedKey);
  }

  private frontendUrl(): string {
    const fromEnv = this.env.get('FRONTEND_URL');
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const cors = this.env.get('CORS_ORIGINS').split(',')[0]?.trim();
    return (cors ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  /**
   * Gera link de aceite pra uma proposta JÁ VALIDADA (acesso checado pelo
   * PropostasService). Salva o token, expiração e muda status pra
   * AGUARDANDO_ASSINATURA. Retorna a URL pública pronta pra enviar.
   */
  async gerarLink(
    propostaId: string,
    empresaId: string,
    statusAtual: string,
  ): Promise<{ token: string; url: string; expiraEm: Date }> {
    if (['ACEITA', 'RECUSADA'].includes(statusAtual)) {
      throw new BusinessRuleException(
        `Proposta em status ${statusAtual} não pode ser enviada pra aceite.`,
      );
    }
    const token = await new SignJWT({ pid: propostaId, eid: empresaId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);

    const expiraEm = new Date(Date.now() + this.ttlSeconds * 1000);
    await this.prisma.proposta.update({
      where: { id: propostaId },
      data: { aceiteToken: token, aceiteExpiraEm: expiraEm, status: 'AGUARDANDO_ASSINATURA' },
    });

    return { token, url: `${this.frontendUrl()}/proposta/aceite/${token}`, expiraEm };
  }

  private async validarToken(token: string): Promise<AcceptPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      const propostaId = typeof payload.pid === 'string' ? payload.pid : null;
      const empresaId = typeof payload.eid === 'string' ? payload.eid : null;
      if (!propostaId || !empresaId) {
        throw new BusinessRuleException('Token de aceite mal formado');
      }
      return { propostaId, empresaId };
    } catch (err) {
      this.logger.warn(
        `Token de aceite inválido: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BusinessRuleException(
        'Link expirado ou inválido. Peça um novo link ao representante.',
      );
    }
  }

  /** Preview público da proposta (sem login). */
  async resolverPreview(token: string): Promise<AceitePreview> {
    const { propostaId } = await this.validarToken(token);
    const proposta = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      include: {
        itens: true,
        cliente: { select: { nome: true } },
        empresa: { select: { nome: true } },
      },
    });
    if (!proposta) throw new NotFoundException('Proposta', propostaId);
    // Token salvo deve bater com o token apresentado (one-time / revogação).
    // Se a proposta já foi respondida, aceiteToken vira null → mostra "já respondida".
    const jaRespondida =
      proposta.aceiteToken !== token ||
      ['ACEITA', 'RECUSADA', 'EXPIRADA'].includes(proposta.status);

    return {
      numero: proposta.numero,
      empresaNome: proposta.empresa.nome,
      clienteNome: proposta.cliente.nome,
      status: proposta.status,
      validoAte: proposta.validoAte,
      formaPagamento: proposta.formaPagamento,
      condicaoPagamento: proposta.condicaoPagamento,
      // #17 — dinheiro vem Decimal; converte pra number no preview público (DTO number).
      subtotal: Number(proposta.subtotal),
      descontoGeral: proposta.descontoGeral, // %
      valor: Number(proposta.valor),
      observacoes: proposta.observacoes,
      jaRespondida,
      itens: proposta.itens.map((i) => ({
        produtoNome: i.produtoNome,
        quantidade: i.quantidade,
        precoUnitario: Number(i.precoUnitario), // #17 — Decimal→number
        desconto: i.desconto, // %
        total: Number(i.total), // #17 — Decimal→number
      })),
    };
  }

  /**
   * Cliente aceita ou recusa a proposta.
   * Aceite → status ACEITA + cria Pedido RASCUNHO automático + notifica rep.
   * Recusa → status RECUSADA.
   * Token invalidado após (one-time).
   */
  async registrarDecisao(
    token: string,
    decisao: 'ACEITA' | 'RECUSADA',
    ip: string | undefined,
  ): Promise<{ status: 'ACEITA' | 'RECUSADA'; pedidoNumero?: string }> {
    const { propostaId, empresaId } = await this.validarToken(token);
    const proposta = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      include: { itens: true },
    });
    if (!proposta) throw new NotFoundException('Proposta', propostaId);
    if (proposta.aceiteToken !== token) {
      throw new BusinessRuleException('Esta proposta já foi respondida.');
    }
    if (['ACEITA', 'RECUSADA'].includes(proposta.status)) {
      throw new BusinessRuleException('Esta proposta já foi respondida.');
    }

    if (decisao === 'RECUSADA') {
      // CAS atômico: reivindica o token num único UPDATE. Duplo-clique/retry
      // simultâneo → só 1 request casa (count===1); os demais veem count===0.
      const claim = await this.prisma.proposta.updateMany({
        where: { id: propostaId, aceiteToken: token, status: { notIn: ['ACEITA', 'RECUSADA'] } },
        data: {
          status: 'RECUSADA',
          aceitoEm: new Date(),
          aceitoDoIp: ip ?? null,
          aceiteToken: null, // invalida link
        },
      });
      if (claim.count === 0) {
        throw new BusinessRuleException('Esta proposta já foi respondida.');
      }
      await this.notificarRep(proposta.representanteId, empresaId, proposta.numero, false);
      this.logger.log(`Proposta ${proposta.numero} RECUSADA pelo cliente (ip ${ip ?? '?'})`);
      return { status: 'RECUSADA' };
    }

    // ACEITA → reivindica o token (CAS) e cria o pedido NA MESMA transação.
    // O CAS (`updateMany` com aceiteToken no where) garante que só UM request
    // cria pedido mesmo com duplo-clique/retry simultâneo. Antes a checagem
    // ficava FORA da transação e dois cliques criavam 2 pedidos + queimavam 2
    // números de sequência. A sequência agora é consumida só pelo vencedor.
    let numeroPedido = '';
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.proposta.updateMany({
        where: { id: propostaId, aceiteToken: token, status: { notIn: ['ACEITA', 'RECUSADA'] } },
        data: {
          status: 'ACEITA',
          aceitoEm: new Date(),
          aceitoDoIp: ip ?? null,
          aceiteToken: null, // invalida link
          convertidaEm: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new BusinessRuleException('Esta proposta já foi respondida.');
      }
      // Só o vencedor do CAS chega aqui → consome a sequência e cria o pedido.
      const pedidoSeq = await this.sequence.next(empresaId, 'pedido');
      numeroPedido = `PED-${pedidoSeq.toString().padStart(4, '0')}`;
      const ped = await tx.pedido.create({
        data: {
          empresaId,
          numero: numeroPedido,
          clienteId: proposta.clienteId,
          representanteId: proposta.representanteId,
          origem: 'REP_APP',
          status: 'RASCUNHO',
          formaPagamento: proposta.formaPagamento,
          condicaoPagamento: proposta.condicaoPagamento,
          prazoEntrega: proposta.prazoEntrega,
          subtotal: proposta.subtotal,
          descontoGeral: proposta.descontoGeral,
          total: proposta.valor,
          comissao: proposta.comissaoEstimada,
          observacoes: `Gerado pelo aceite externo da proposta ${proposta.numero}${
            proposta.observacoes ? '\n' + proposta.observacoes : ''
          }`,
          itens: {
            create: proposta.itens.map((it) => ({
              produtoId: it.produtoId,
              quantidade: it.quantidade,
              precoUnitario: it.precoUnitario,
              desconto: it.desconto,
              total: it.total,
              negociado: it.negociado,
            })),
          },
        },
        select: { id: true },
      });
      await tx.proposta.update({ where: { id: propostaId }, data: { pedidoId: ped.id } });
    });

    await this.notificarRep(
      proposta.representanteId,
      empresaId,
      proposta.numero,
      true,
      numeroPedido,
    );
    this.logger.log(
      `Proposta ${proposta.numero} ACEITA pelo cliente (ip ${ip ?? '?'}) → pedido ${numeroPedido}`,
    );
    return { status: 'ACEITA', pedidoNumero: numeroPedido };
  }

  private async notificarRep(
    representanteId: string | null,
    empresaId: string,
    numeroProposta: string,
    aceita: boolean,
    numeroPedido?: string,
  ): Promise<void> {
    try {
      // O REP dono da proposta é quem acompanha o cliente — antes só GERENTE/DIRECTOR
      // recebiam o aviso (o representanteId só ia no metadata, sem notificar ninguém).
      if (representanteId) {
        await this.notificacoes.criarParaUsuario({
          empresaId,
          usuarioId: representanteId,
          tipo: 'GENERICO',
          prioridade: aceita ? 'ALTA' : 'NORMAL',
          titulo: aceita ? 'Sua proposta foi aceita!' : 'Sua proposta foi recusada',
          mensagem: aceita
            ? `Sua proposta ${numeroProposta} foi aceita. Pedido ${numeroPedido} criado automaticamente.`
            : `Sua proposta ${numeroProposta} foi recusada pelo cliente.`,
          link: numeroPedido ? `/pedidos` : `/propostas`,
          metadata: { numeroProposta, numeroPedido },
        });
      }
      await this.notificacoes.criarParaRole({
        empresaId,
        roles: ['GERENTE', 'DIRECTOR'],
        // Não há tipo específico de proposta no enum — usa GENERICO.
        tipo: 'GENERICO',
        prioridade: aceita ? 'ALTA' : 'NORMAL',
        titulo: aceita ? 'Proposta aceita pelo cliente!' : 'Proposta recusada pelo cliente',
        mensagem: aceita
          ? `Proposta ${numeroProposta} foi aceita. Pedido ${numeroPedido} criado automaticamente.`
          : `Proposta ${numeroProposta} foi recusada pelo cliente.`,
        link: numeroPedido ? `/pedidos` : `/propostas`,
        metadata: { numeroProposta, numeroPedido, representanteId },
      });
    } catch (err) {
      // Notificação é best-effort — não derruba o aceite
      this.logger.warn(
        `Falha notificando aceite da proposta ${numeroProposta}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
