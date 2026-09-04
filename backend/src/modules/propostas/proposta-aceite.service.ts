import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { ClickSignService } from '@integrations/clicksign/clicksign.service';
import { variaveisDoContrato } from './contrato-variaveis.util';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { PedidoPricingService } from '@modules/pedidos/pedido-pricing.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { SequenceService } from '@shared/utils/sequence.service';
import { vigenteAteFimDoDiaBrt } from '@shared/utils/data-brt.util';

/** Comissão padrão (espelha propostas/pedidos.service) — usada só no cálculo do teto. */
const COMISSAO_PADRAO_PCT = 5;

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
    private readonly pedidoPricing: PedidoPricingService,
    private readonly clicksign: ClickSignService,
  ) {
    const derivedKey = createHash('sha256')
      .update(this.env.get('ENCRYPTION_KEY'))
      .update('proposta-aceite-token')
      .digest();
    this.secret = new Uint8Array(derivedKey);
  }

  /**
   * Base do link de aceite — o endereço que vai PRO CLIENTE.
   *
   * ⚠️ Este link sai da empresa. Link errado aqui não quebra nada do nosso lado:
   * o rep envia, o cliente clica, não abre, e a gente só descobre pelo cliente.
   * Por isso os dois cuidados abaixo, medidos em produção (03/09):
   *
   * 1. **Prefixo colado**: a variável em produção estava com o valor
   *    `CORS_ORIGINS=http://localhost:5173` — o nome da variável foi junto no
   *    paste. O link saía `CORS_ORIGINS=http://localhost:5173/proposta/...`.
   * 2. **localhost em produção**: sem `FRONTEND_URL` configurada, o fallback
   *    entregava um endereço que só existe na máquina do dev.
   *
   * Em produção, agora, isso ESTOURA na hora de gerar — erro pro rep na tela é
   * muito mais barato que link morto na mão do cliente.
   */
  private frontendUrl(): string {
    const limpar = (v: string | undefined): string => {
      if (!v) return '';
      // Tira um `NOME_DA_VARIAVEL=` que tenha vindo colado no valor.
      const semPrefixo = v.replace(/^[A-Z0-9_]+=/, '').trim();
      return semPrefixo.replace(/\/$/, '');
    };

    const base =
      limpar(this.env.get('FRONTEND_URL')) || limpar(this.env.get('CORS_ORIGINS').split(',')[0]);

    if (this.env.isProduction && (!base || /localhost|127\.0\.0\.1/.test(base))) {
      throw new BusinessRuleException(
        'FRONTEND_URL não está configurada — o link de aceite sairia apontando pra localhost ' +
          'e o cliente receberia um endereço que não abre. Configure FRONTEND_URL no ambiente.',
      );
    }
    return base || 'http://localhost:3000';
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
      // `cliente.erpStatus` entra pra revalidar o bloqueio no aceite (ver abaixo).
      include: { itens: true, cliente: { select: { erpStatus: true } } },
    });
    if (!proposta) throw new NotFoundException('Proposta', propostaId);
    if (proposta.aceiteToken !== token) {
      throw new BusinessRuleException('Esta proposta já foi respondida.');
    }
    if (['ACEITA', 'RECUSADA'].includes(proposta.status)) {
      throw new BusinessRuleException('Esta proposta já foi respondida.');
    }

    // CAÇADA-BUG #23/#24: o aceite externo cria pedido igual ao converterEmPedido — precisa das MESMAS
    // validações. Só barra no ACEITE (recusar uma proposta vencida/com produto inativo é sempre ok).
    if (decisao === 'ACEITA') {
      // #R2 — validade vale até o FIM do dia BRT (date-only 00:00 UTC vencia às 21h da véspera →
      // cliente não conseguia aceitar no dia impresso na proposta). Mesmo critério de converterEmPedido.
      if (proposta.validoAte && !vigenteAteFimDoDiaBrt(proposta.validoAte, new Date())) {
        throw new BusinessRuleException(
          'Esta proposta está vencida (fora do prazo de validade). Peça uma nova ao seu contato.',
        );
      }
      // AUDITORIA (média): validade e produto inativo eram revalidados aqui, mas
      // o erpStatus NÃO — e ele é revalidado nos outros dois caminhos
      // (assertClienteValido e converterEmPedido). Cenário: cliente é BLOQUEADO
      // no ERP depois do envio da proposta, clica Aceitar no link público, o
      // pedido é criado, o rep é notificado "proposta aceita!" — e a falha só
      // aparece lá na frente, no envio ao ERP. Barra no mesmo lugar dos outros.
      if (proposta.cliente?.erpStatus === 'BLOQUEADO') {
        throw new BusinessRuleException(
          'Não é possível aceitar esta proposta no momento. Fale com o seu contato comercial.',
        );
      }
      const produtoIds = [...new Set(proposta.itens.map((i) => i.produtoId))];
      if (produtoIds.length > 0) {
        const inativos = await this.prisma.produto.findMany({
          where: { id: { in: produtoIds }, empresaId, ativo: false },
          select: { id: true },
        });
        if (inativos.length > 0) {
          throw new BusinessRuleException(
            'Um ou mais itens desta proposta não estão mais disponíveis. Peça uma nova ao seu contato.',
          );
        }
      }
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
    // Teto de desconto / aprovação (D3/D46) — MESMO gate do converterEmPedido. Sem isto, o
    // aceite externo criava pedido RASCUNHO direto e BURLAVA a aprovação (o REP definia um
    // desconto acima do teto e bastava o cliente clicar Aceitar pra ir ao ERP sem aprovar).
    let tetoRep = 100;
    if (proposta.representanteId) {
      const repU = await this.prisma.usuario.findUnique({
        where: { id: proposta.representanteId },
        select: { role: true, tetoDesconto: true },
      });
      tetoRep = repU?.role === 'REP' ? (repU.tetoDesconto ?? 0) : 100;
    }
    const empresaCfg = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { descontoPixPct: true, descontoBoletoAvistaPct: true },
    });
    const { statusPedido, requerAprovacao, maxDescontoPercentual } =
      this.pedidoPricing.avaliarAprovacaoProposta({
        itens: proposta.itens.map((it) => ({
          quantidade: it.quantidade,
          precoUnitario: Number(it.precoUnitario),
          desconto: it.desconto,
        })),
        descontoGeralPct: proposta.descontoGeral,
        formaPagamento: proposta.formaPagamento,
        condicaoPagamento: proposta.condicaoPagamento,
        empresaCfg,
        comissaoPct: COMISSAO_PADRAO_PCT,
        tetoRep,
      });

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
          // De qual proposta este pedido nasceu. Sem isto, o pedido criado
          // AQUI ficava sem rastro — só o que descia do ERP tinha, e aí
          // metade dos pedidos não respondia "de onde veio essa venda?".
          propostaNumero: proposta.numero,
          clienteId: proposta.clienteId,
          representanteId: proposta.representanteId,
          origem: 'REP_APP',
          status: statusPedido,
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
      // Desconto acima do teto → AGUARDANDO_APROVACAO + AprovacaoDesconto PENDENTE (igual
      // converterEmPedido). O sink do ERP bloqueia AGUARDANDO_APROVACAO → não vaza sem aprovar.
      if (requerAprovacao && proposta.representanteId) {
        await tx.aprovacaoDesconto.create({
          data: {
            pedidoId: ped.id,
            representanteId: proposta.representanteId,
            descontoSolicitado: maxDescontoPercentual,
            motivo: `Aceite externo da proposta ${proposta.numero}`,
            status: 'PENDENTE',
          },
        });
      }
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

    // O contrato sai AGORA, e não antes: mandar documento pra assinar antes de
    // a pessoa aceitar a proposta inverte a conversa comercial.
    await this.enviarContratoParaAssinatura(propostaId, empresaId);

    return { status: 'ACEITA', pedidoNumero: numeroPedido };
  }

  /**
   * Aceitou → o contrato vai pra assinatura eletrônica.
   *
   * Só LOCAÇÃO: venda avulsa não gera contrato recorrente.
   *
   * **Best-effort de propósito.** O aceite do cliente já está gravado e é o que
   * vale; se a assinatura eletrônica estiver fora do ar, perder o aceite por
   * causa disso seria trocar um problema pequeno por um grande. A falha vira
   * log de erro e aviso pro responsável — o contrato é reenviado depois.
   */
  private async enviarContratoParaAssinatura(propostaId: string, empresaId: string): Promise<void> {
    if (!this.clicksign.configurado) return;
    try {
      const p = await this.prisma.proposta.findFirst({
        where: { id: propostaId, empresaId },
        select: {
          id: true,
          numero: true,
          valor: true,
          criadoEm: true,
          validoAte: true,
          modalidade: true,
          prazoMeses: true,
          diaVencimento: true,
          signatarioNome: true,
          signatarioEmail: true,
          signatarioTelefone: true,
          clienteId: true,
          representanteId: true,
          cliente: { select: { nome: true, email: true, cnpj: true, telefone: true } },
          itens: {
            select: {
              produtoId: true,
              produtoNome: true,
              quantidade: true,
              precoUnitario: true,
              total: true,
            },
          },
        },
      });
      if (!p || p.modalidade !== 'LOCACAO') return;

      // Signatário é PESSOA. A assinatura eletrônica recusa razão social como
      // nome ("formato inválido"), e o cadastro de Cliente só guarda a empresa —
      // por isso o nome vem da proposta, preenchido por quem montou o negócio.
      const nome = p.signatarioNome?.trim();
      const email = p.signatarioEmail?.trim() || p.cliente.email?.trim();
      // A autenticação por SMS/WhatsApp exige o número em dígitos com DDI. Cai
      // pro telefone do cliente quando a proposta não informou um específico;
      // sem nenhum, a assinatura usa token por e-mail.
      const telefoneBruto = p.signatarioTelefone?.trim() || p.cliente.telefone?.trim() || '';
      const so = telefoneBruto.replace(/\D/g, '');
      const telefoneAssinatura = so.length >= 12 ? so : so.length >= 10 ? `55${so}` : undefined;
      if (!nome || !email) {
        this.logger.warn(
          `Proposta ${p.numero} aceita, mas sem signatário (nome/e-mail) — contrato não enviado.`,
        );
        await this.avisarFalhaContrato(
          empresaId,
          p.representanteId,
          p.numero,
          'sem signatário definido',
        );
        return;
      }

      // SKU por item: é ele que vai pro contrato (MB-05), não o nome longo.
      const produtos = await this.prisma.produto.findMany({
        where: { id: { in: p.itens.map((i) => i.produtoId) } },
        select: { id: true, sku: true },
      });
      const skuDe = new Map(produtos.map((x) => [x.id, x.sku]));

      const envelope = await this.clicksign.enviarParaAssinatura({
        titulo: `Proposta-Contrato ${p.numero} — ${p.cliente.nome}`,
        cliente: { nome, email, telefone: telefoneAssinatura },
        // Volta no webhook de assinatura — rastro que não depende de id.
        metadata: { proposta: p.numero, proposta_id: p.id },
        variaveis: variaveisDoContrato({
          numero: p.numero,
          valor: p.valor,
          criadoEm: p.criadoEm,
          validoAte: p.validoAte,
          clienteNome: p.cliente.nome,
          itens: p.itens.map((i) => ({
            sku: skuDe.get(i.produtoId) ?? '',
            produtoNome: i.produtoNome,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
            total: i.total,
          })),
        }),
      });

      await this.prisma.contrato.create({
        data: {
          empresaId,
          propostaId: p.id,
          clienteId: p.clienteId,
          representanteId: p.representanteId,
          status: 'AGUARDANDO_ASSINATURA',
          valorMensal: p.valor,
          prazoMeses: p.prazoMeses ?? 36,
          diaVencimento: p.diaVencimento ?? 5,
          assinaturaId: envelope.envelopeId,
          assinaturaDocumentoId: envelope.documentoId,
        },
      });
      this.logger.log(
        `Contrato da proposta ${p.numero} enviado pra assinatura (${envelope.envelopeId})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha enviando contrato da proposta ${propostaId}: ${msg}`);
    }
  }

  private async avisarFalhaContrato(
    empresaId: string,
    usuarioId: string | null,
    numero: string,
    motivo: string,
  ): Promise<void> {
    if (!usuarioId) return;
    await this.notificacoes
      .criarParaUsuario({
        empresaId,
        usuarioId,
        tipo: 'GENERICO',
        prioridade: 'ALTA',
        titulo: `Contrato da ${numero} não foi enviado`,
        mensagem:
          `O cliente aceitou a proposta ${numero}, mas o contrato não seguiu pra assinatura: ${motivo}. ` +
          'O aceite está registrado — falta só o contrato.',
        link: '/propostas',
      })
      .catch(() => null);
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
