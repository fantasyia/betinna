import { Injectable, Logger } from '@nestjs/common';
import { anexarDescricaoDoProduto } from './descricao-do-produto.util';
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { ClickSignService } from '@integrations/clicksign/clicksign.service';
import {
  SELECT_PROPOSTA_CONTRATO,
  comSkus,
  montarContratoParaAssinar,
  pendenciasDoContrato,
} from './contrato-envio.util';
import { TERMOS_DO_CONTRATO } from './contrato-documento.util';
import { resumoDaProposta, type ResumoProposta } from './proposta-resumo.util';
import { ContratoPreviaService, sha256 } from './contrato-previa.service';
import { LevantamentoPdfService } from './levantamento-pdf.service';
import {
  ModeloContratoService,
  type ModeloEmUso,
} from '@modules/modelo-contrato/modelo-contrato.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { PedidoComissoesService } from '@modules/pedidos/pedido-comissoes.service';
import { PedidoPricingService } from '@modules/pedidos/pedido-pricing.service';
import { LeadEtapaSistemaService } from '@modules/leads/lead-etapa-sistema.service';
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
  /** Locação: tudo que o cliente precisa ler antes de aprovar (null em venda ou já respondida). */
  resumo: ResumoProposta | null;
  /** O PROJETO anexado — o que ele aprova. Baixa por `aceite/:token/anexos/:id`. */
  anexos: Array<{ id: string; nome: string; mime: string; tamanho: number }>;
  /** Rodapé oficial do tenant (`config.marca.rodape`), o mesmo dos e-mails. */
  rodape: string | null;
  /** Há contrato CONGELADO pra ler (`aceite/:token/contrato`) — o mesmo que ele assina. */
  temContrato: boolean;
  /** Há o PDF do Levantamento técnico de projeto congelado (`aceite/:token/levantamento`). */
  temLevantamento: boolean;
  itens: Array<{
    produtoNome: string;
    /** Descrição vigente do produto (ERP) — o cliente lê o que está aceitando. */
    descricao: string | null;
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
    private readonly etapa: LeadEtapaSistemaService,
    private readonly comissoes: PedidoComissoesService,
    private readonly modelos: ModeloContratoService,
    private readonly previa: ContratoPreviaService,
    private readonly levantamentoPdf: LevantamentoPdfService,
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
    // Link que JÁ está valendo não é trocado (Léo, 25/09): trocar o token
    // invalidava o link que o cliente já recebeu por e-mail ou WhatsApp.
    // Link novo só quando o anterior venceu ou a proposta voltou pra rascunho.
    const vigente = await this.linkVigente(propostaId);
    if (vigente) return vigente;
    // O projeto que o cliente aprova não é mais anexo do rep (Léo, 25/09): o
    // app GERA o "Levantamento técnico de projeto" aqui embaixo, junto com o
    // contrato. A exigência de anexo saiu.
    //
    // A LOCAÇÃO não sai sem o que o contrato exige (Léo, 25/09): conferir só
    // no aceite deixava o cliente aceitar uma proposta que não vira contrato.
    // Mesma lista da montagem (`pendenciasDoContrato`) — uma checagem só.
    const paraContrato = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      select: { ...SELECT_PROPOSTA_CONTRATO, criadoEm: true },
    });
    let congelado: {
      contratoPreviaPath: string;
      contratoPreviaSha256: string;
      contratoPreviaModeloVersao: number | null;
      contratoPreviaEm: Date;
      levantamentoPdfPath: string;
      levantamentoPdfSha256: string;
    } | null = null;
    if (paraContrato?.modalidade === 'LOCACAO') {
      const completa = await comSkus(this.prisma, paraContrato);
      const falta = pendenciasDoContrato(completa);
      if (falta.length) {
        throw new BusinessRuleException(
          `A proposta ainda não pode ir pro cliente. Falta: ${falta.join('; ')}.`,
        );
      }
      // O CONTRATO que o cliente vai ler — e assinar. Montado AGORA, uma vez, e
      // guardado: no aprovar sai este arquivo, não uma montagem nova (Léo,
      // 25/09: "o contrato é o mesmo"). Falha aqui barra o link: link sem o
      // contrato congelado faria o aprovar montar outro, e aí não é o mesmo.
      const modelo = await this.modelos.emUso(empresaId);
      const montagem = montarContratoParaAssinar(completa, { modelo: modelo.arquivo });
      if (!montagem.ok || !montagem.dados.documento) {
        throw new BusinessRuleException(
          `O contrato não pôde ser montado: ${montagem.ok ? 'sem documento' : montagem.motivo}.`,
        );
      }
      // E o LEVANTAMENTO TÉCNICO DE PROJETO, gerado pelo app com os mesmos
      // dados que a página de aceite mostra — congelado junto, pela mesma regra:
      // é ele que vai anexado no envelope. Não gerou ou não guardou = sem link.
      const pdf = await this.levantamentoPdf.gerar(
        empresaId,
        resumoDaProposta(completa, paraContrato.criadoEm),
      );
      const guardado = await this.previa.salvar(
        empresaId,
        propostaId,
        montagem.dados.documento.arquivo,
      );
      const guardadoPdf = await this.previa.salvar(empresaId, propostaId, pdf, 'pdf');
      congelado = {
        contratoPreviaPath: guardado.path,
        contratoPreviaSha256: guardado.sha256,
        contratoPreviaModeloVersao: modelo.versao,
        contratoPreviaEm: new Date(),
        levantamentoPdfPath: guardadoPdf.path,
        levantamentoPdfSha256: guardadoPdf.sha256,
      };
    }
    const token = await new SignJWT({ pid: propostaId, eid: empresaId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.secret);

    const expiraEm = new Date(Date.now() + this.ttlSeconds * 1000);
    const proposta = await this.prisma.proposta.update({
      where: { id: propostaId },
      data: {
        aceiteToken: token,
        aceiteExpiraEm: expiraEm,
        status: 'AGUARDANDO_ASSINATURA',
        ...(congelado ?? {}),
      },
      select: { clienteId: true },
    });

    // Gerar o link É enviar a proposta pro cliente: é o mesmo endereço que o rep
    // manda no WhatsApp e no e-mail. Por isso o marco entra aqui, e não em cada
    // canal de envio — canal novo amanhã já nasce contando a mesma história.
    await this.etapa.mover({
      empresaId,
      clienteId: proposta.clienteId,
      marco: 'propostaEnviada',
      origem: 'webhook',
      motivo: `Proposta ${propostaId} enviada pro cliente`,
    });

    return { token, url: `${this.frontendUrl()}/proposta/aceite/${token}`, expiraEm };
  }

  /**
   * O link de aceite que JÁ está valendo: proposta aguardando o cliente e token
   * não vencido. `null` = não há (nunca gerou, venceu, ou voltou pra rascunho).
   */
  async linkVigente(
    propostaId: string,
  ): Promise<{ token: string; url: string; expiraEm: Date } | null> {
    const p = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      select: { status: true, aceiteToken: true, aceiteExpiraEm: true },
    });
    if (
      !p?.aceiteToken ||
      p.status !== 'AGUARDANDO_ASSINATURA' ||
      !p.aceiteExpiraEm ||
      p.aceiteExpiraEm.getTime() <= Date.now()
    ) {
      return null;
    }
    return {
      token: p.aceiteToken,
      url: `${this.frontendUrl()}/proposta/aceite/${p.aceiteToken}`,
      expiraEm: p.aceiteExpiraEm,
    };
  }

  /**
   * A proposta de um token de aceite AINDA aberto — o acesso do cliente ao
   * projeto anexado. Link revogado ou proposta respondida não abre arquivo.
   */
  async propostaDoTokenAberto(token: string): Promise<string> {
    const { propostaId } = await this.validarToken(token);
    const p = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      select: { aceiteToken: true, status: true },
    });
    if (!p || p.aceiteToken !== token || ['ACEITA', 'RECUSADA', 'EXPIRADA'].includes(p.status)) {
      throw new NotFoundException('Proposta', propostaId);
    }
    return propostaId;
  }

  /** O contrato congelado, pra o cliente LER na página de aceite (só com token vigente). */
  async linkDoContrato(token: string): Promise<{ url: string; nome: string }> {
    const propostaId = await this.propostaDoTokenAberto(token);
    const p = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      select: { numero: true, contratoPreviaPath: true },
    });
    if (!p?.contratoPreviaPath) throw new NotFoundException('Contrato', propostaId);
    return { url: await this.previa.linkAssinado(p.contratoPreviaPath), nome: `${p.numero}.docx` };
  }

  /**
   * O Levantamento técnico de projeto pro PAINEL do rep. Proposta que já saiu:
   * o PDF CONGELADO (o que o cliente viu e o que vai no envelope). Em rascunho:
   * uma prévia gerada agora — o congelado nasce de novo no próximo link.
   */
  async levantamentoParaPainel(
    propostaId: string,
    empresaId: string,
  ): Promise<{ filename: string; base64: string; congelado: boolean }> {
    const p = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      select: {
        ...SELECT_PROPOSTA_CONTRATO,
        criadoEm: true,
        status: true,
        levantamentoPdfPath: true,
      },
    });
    if (!p) throw new NotFoundException('Proposta', propostaId);
    if (p.modalidade !== 'LOCACAO') {
      throw new BusinessRuleException('O levantamento técnico de projeto é da locação.');
    }
    const filename = `${p.numero}-levantamento-tecnico.pdf`;
    if (p.levantamentoPdfPath && p.status !== 'RASCUNHO') {
      const pdf = await this.previa.baixar(p.levantamentoPdfPath);
      return { filename, base64: pdf.toString('base64'), congelado: true };
    }
    const pdf = await this.levantamentoPdf.gerar(
      empresaId,
      resumoDaProposta(await comSkus(this.prisma, p), p.criadoEm),
    );
    return { filename, base64: pdf.toString('base64'), congelado: false };
  }

  /** O PDF do Levantamento técnico de projeto congelado (só com token vigente). */
  async linkDoLevantamento(token: string): Promise<{ url: string; nome: string }> {
    const propostaId = await this.propostaDoTokenAberto(token);
    const p = await this.prisma.proposta.findUnique({
      where: { id: propostaId },
      select: { numero: true, levantamentoPdfPath: true },
    });
    if (!p?.levantamentoPdfPath) throw new NotFoundException('Levantamento', propostaId);
    return {
      url: await this.previa.linkAssinado(p.levantamentoPdfPath),
      nome: `${p.numero}-levantamento-tecnico.pdf`,
    };
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
        empresa: { select: { nome: true, config: true } },
      },
    });
    if (!proposta) throw new NotFoundException('Proposta', propostaId);
    // Token salvo deve bater com o token apresentado (one-time / revogação).
    // Se a proposta já foi respondida, aceiteToken vira null → mostra "já respondida".
    const respondida = ['ACEITA', 'RECUSADA', 'EXPIRADA'].includes(proposta.status);
    // Token que NÃO é o vigente numa proposta ainda aberta = link revogado
    // (regenerado). Mostrava itens/valor mesmo assim (auditoria 13/09, F-6).
    if (proposta.aceiteToken !== token && !respondida) {
      throw new NotFoundException('Proposta', propostaId);
    }
    const jaRespondida = proposta.aceiteToken !== token || respondida;

    // O que o cliente lê antes de aprovar: o levantamento, as condições e o
    // PROJETO. Só com a proposta aberta — respondida, a tela só diz isso (F-6).
    let resumo: ResumoProposta | null = null;
    let anexos: AceitePreview['anexos'] = [];
    if (!jaRespondida) {
      if (proposta.modalidade === 'LOCACAO') {
        const paraContrato = await this.prisma.proposta.findUnique({
          where: { id: propostaId },
          select: SELECT_PROPOSTA_CONTRATO,
        });
        if (paraContrato) {
          resumo = resumoDaProposta(await comSkus(this.prisma, paraContrato), proposta.criadoEm);
        }
      }
      anexos = await this.prisma.propostaAnexo.findMany({
        where: { propostaId },
        orderBy: { criadoEm: 'asc' },
        select: { id: true, nome: true, mime: true, tamanho: true },
      });
    }
    const cfg = (proposta.empresa.config ?? {}) as { marca?: { rodape?: string } };

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
      observacoes: jaRespondida ? null : proposta.observacoes,
      jaRespondida,
      resumo,
      anexos,
      rodape: cfg.marca?.rodape?.trim() || null,
      temContrato: !jaRespondida && !!proposta.contratoPreviaPath,
      temLevantamento: !jaRespondida && !!proposta.levantamentoPdfPath,
      // Já respondida: a tela só diz isso — sem os itens (F-6).
      itens: jaRespondida
        ? []
        : await anexarDescricaoDoProduto(
            this.prisma,
            proposta.itens.map((i) => ({
              produtoId: i.produtoId,
              produtoNome: i.produtoNome,
              quantidade: i.quantidade,
              precoUnitario: Number(i.precoUnitario), // #17 — Decimal→number
              desconto: i.desconto, // %
              total: Number(i.total), // #17 — Decimal→number
            })),
          ),
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

    // LOCAÇÃO nasce TRAVADA. O caminho dela pro ERP é o contrato assinado
    // virando orçamento — não o pedido. Enquanto nascia RASCUNHO, o botão
    // "enviar ao ERP" ficava disponível pro rep e a venda subia ANTES de o
    // cliente assinar (aconteceu em 04/09, pedido ERP 22). Um estado não é
    // regra: quem impede é o guard do envio, mas nascer travado deixa a tela
    // dizendo a verdade desde o primeiro segundo.
    const statusInicial =
      proposta.modalidade === 'LOCACAO' ? ('AGUARDANDO_LIBERACAO' as const) : statusPedido;

    let numeroPedido = '';
    let pedidoCriadoId = '';
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
          // A modalidade acompanha a proposta: é ela que decide COMO a venda
          // comissiona. Locação paga por MÊS (ContratoComissao), então o
          // pedido de locação não pode gerar comissão de venda sobre o total.
          modalidade: proposta.modalidade,
          status: statusInicial,
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
      pedidoCriadoId = ped.id;
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

    // A comissão do rep nasce com o pedido, amarrada a ele.
    if (pedidoCriadoId) await this.comissoes.recalcular(pedidoCriadoId);

    // O cliente assinou a PROPOSTA. Sem tarefa e sem aviso de propósito: daqui
    // a assinatura eletrônica segue sozinha, e a etapa serve só pra enxergar
    // onde o cliente está.
    await this.etapa.mover({
      empresaId,
      clienteId: proposta.clienteId,
      marco: 'propostaAssinada',
      origem: 'webhook',
      motivo: `Proposta ${proposta.numero} aceita pelo cliente`,
    });

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
    if (!(await this.clicksign.configurado(empresaId))) return;
    try {
      const p = await this.prisma.proposta.findFirst({
        where: { id: propostaId, empresaId },
        select: {
          ...SELECT_PROPOSTA_CONTRATO,
          clienteId: true,
          representanteId: true,
          contratoPreviaPath: true,
          contratoPreviaSha256: true,
          levantamentoPdfPath: true,
          levantamentoPdfSha256: true,
          contratoPreviaModeloVersao: true,
        },
      });
      if (!p) return;

      // A montagem é COMPARTILHADA com o reenvio do diretor (17/09): as duas
      // rodadas do mesmo contrato têm que sair idênticas no que ninguém pediu
      // pra mudar. Ela também é quem recusa — prazo e dia de vencimento são
      // termo comercial, e um default sairia impresso num documento que alguém
      // assina sem ninguém saber que o número veio do sistema.
      // O modelo EM USO agora. Versão ativa ilegível NÃO cai pro padrão: vira
      // motivo e aviso, como qualquer outro dado que falte.
      let modelo: ModeloEmUso;
      try {
        modelo = await this.modelos.emUso(empresaId);
      } catch (err) {
        const motivo = `o modelo de contrato ativo não pôde ser lido (${
          err instanceof Error ? err.message : String(err)
        })`;
        this.logger.warn(`Proposta ${p.numero} aceita, mas ${motivo} — contrato não enviado.`);
        await this.avisarFalhaContrato(empresaId, p.representanteId, p.numero, motivo);
        return;
      }
      const montagem = montarContratoParaAssinar(await comSkus(this.prisma, p), {
        modelo: modelo.arquivo,
      });
      if (!montagem.ok) {
        // Não é de locação: venda avulsa não gera contrato recorrente, e isso
        // não é falha — sai calado, como antes.
        if (p.modalidade !== 'LOCACAO') return;
        this.logger.warn(
          `Proposta ${p.numero} aceita, mas ${montagem.motivo} — contrato não enviado.`,
        );
        await this.avisarFalhaContrato(empresaId, p.representanteId, p.numero, montagem.motivo);
        return;
      }

      // O ARQUIVO que o cliente leu no link — não a montagem de agora (Léo,
      // 25/09: "o contrato é o mesmo"). A montagem acima segue dando os dados do
      // signatário; o documento é o guardado, conferido pelo hash. Hash que não
      // bate = não envia: mandar outro texto seria pior que não mandar.
      let versaoEnviada = modelo.versao;
      if (p.contratoPreviaPath) {
        const arquivo = await this.previa.baixar(p.contratoPreviaPath);
        if (sha256(arquivo) !== p.contratoPreviaSha256) {
          const motivo = 'o contrato guardado no link não confere (hash diferente)';
          this.logger.error(`Proposta ${p.numero} aceita, mas ${motivo} — contrato não enviado.`);
          await this.avisarFalhaContrato(empresaId, p.representanteId, p.numero, motivo);
          return;
        }
        montagem.dados.documento = { arquivo, nome: `${p.numero}.docx` };
        versaoEnviada = p.contratoPreviaModeloVersao;
      }
      // O Levantamento técnico de projeto vai ANEXADO no envelope — o PDF que o
      // cliente viu no link, conferido pelo hash, pela mesma regra do contrato.
      if (p.levantamentoPdfPath) {
        const pdf = await this.previa.baixar(p.levantamentoPdfPath);
        if (sha256(pdf) !== p.levantamentoPdfSha256) {
          const motivo = 'o levantamento técnico guardado no link não confere (hash diferente)';
          this.logger.error(`Proposta ${p.numero} aceita, mas ${motivo} — contrato não enviado.`);
          await this.avisarFalhaContrato(empresaId, p.representanteId, p.numero, motivo);
          return;
        }
        montagem.dados.anexos = [{ arquivo: pdf, nome: `${p.numero}-levantamento-tecnico.pdf` }];
      }

      const envelope = await this.clicksign.enviarParaAssinatura(empresaId, montagem.dados);

      await this.prisma.contrato.create({
        data: {
          empresaId,
          propostaId: p.id,
          clienteId: p.clienteId,
          representanteId: p.representanteId,
          status: 'AGUARDANDO_ASSINATURA',
          valorMensal: p.valor,
          // Os do TEXTO do contrato, não os da proposta (Léo, 25/09): o ERP
          // cobra por estes e o PDF assinado diz estes — têm que ser os mesmos.
          prazoMeses: TERMOS_DO_CONTRATO.prazoMeses,
          diaVencimento: TERMOS_DO_CONTRATO.diaVencimento,
          assinaturaId: envelope.envelopeId,
          assinaturaDocumentoId: envelope.documentoId,
          enviosAssinatura: [
            {
              envelopeId: envelope.envelopeId,
              documentoId: envelope.documentoId,
              url: null,
              enviadoEm: new Date().toISOString(),
              // Ninguém "mandou": saiu do aceite do cliente, automático.
              porUsuarioId: null,
              motivo: 'envio inicial (aceite da proposta)',
              desfecho: 'enviado',
              modeloVersao: versaoEnviada,
              // Hash do arquivo que saiu — o mesmo que o cliente leu no link.
              sha256: p.contratoPreviaSha256 ?? null,
              levantamentoSha256: p.levantamentoPdfSha256 ?? null,
            },
          ],
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
