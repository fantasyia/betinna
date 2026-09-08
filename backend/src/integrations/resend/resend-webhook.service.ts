import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { SupressaoService } from '@shared/supressao/supressao.service';
import { EmailInboundService } from '@integrations/email/email-inbound.service';

/** Eventos que dizem algo sobre o destinatário. O resto o Resend manda e ignoramos. */
export type EventoResend =
  | 'email.delivered'
  | 'email.opened'
  | 'email.clicked'
  | 'email.bounced'
  | 'email.complained';

/**
 * Tolerância do timestamp. Assinatura válida mas antiga é replay — e 5min é a
 * folga padrão do Svix, generosa o bastante pra relógio fora de sincronia.
 */
const TOLERANCIA_MS = 5 * 60 * 1000;

/**
 * Engajamento de e-mail marketing: o retorno do Resend virando dado no app.
 *
 * **A assinatura NÃO é o HMAC cru do D11.** O Resend usa Svix, cujo formato é
 * outro: assina `id.timestamp.body`, a chave é o secret **decodificado de
 * base64** depois do prefixo `whsec_`, e o header pode trazer VÁRIAS assinaturas
 * separadas por espaço (rotação de chave). Copiar o verificador do Meta/ERP aqui
 * recusaria todo evento legítimo — e o sintoma seria "o webhook não funciona",
 * sem pista do motivo.
 *
 * **Abertura é sinal fraco.** O Apple Mail pré-carrega a imagem de rastreio e
 * conta abertura que ninguém fez. Por isso abertura e clique alimentam SCORE e
 * escolhem o próximo e-mail; **só ação real** (formulário, resposta) muda o lead
 * de etapa. Esta camada só registra o fato — quem decide etapa é o fluxo.
 */
@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);

  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly supressao: SupressaoService,
    private readonly inbound: EmailInboundService,
  ) {}

  get configurado(): boolean {
    return Boolean(this.env.get('RESEND_WEBHOOK_SECRET'));
  }

  /**
   * Confere a assinatura Svix do corpo CRU.
   *
   * Sem secret configurado devolve `false`: aceitar sem verificar deixaria
   * qualquer um inflar o engajamento de uma campanha — e engajamento inflado
   * decide qual e-mail a pessoa recebe depois.
   */
  verificarAssinatura(
    corpoCru: Buffer | string | undefined,
    headers: { id?: string; timestamp?: string; signature?: string },
  ): boolean {
    const secret = this.env.get('RESEND_WEBHOOK_SECRET');
    if (!secret || !corpoCru || !headers.id || !headers.timestamp || !headers.signature) {
      return false;
    }

    const ts = Number(headers.timestamp) * 1000;
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOLERANCIA_MS) {
      this.logger.warn('[resend] webhook fora da janela de tempo — descartado');
      return false;
    }

    const corpo = Buffer.isBuffer(corpoCru) ? corpoCru.toString('utf8') : corpoCru;
    const chave = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const esperada = createHmac('sha256', chave)
      .update(`${headers.id}.${headers.timestamp}.${corpo}`)
      .digest('base64');

    // O header traz "v1,base64 v1,outra" — mais de uma durante rotação de chave.
    // Basta UMA bater.
    return headers.signature
      .split(' ')
      .map((parte) => parte.split(',')[1] ?? '')
      .some((assinatura) => this.igualEmTempoConstante(assinatura, esperada));
  }

  /**
   * Aplica o evento ao destinatário. Devolve o que fez, pro log do controller.
   *
   * Casa pelo `resendEmailId` — e é só isso: sem o id, ou com id de e-mail que
   * não é de campanha (transacional, convite), ignora em silêncio. Tentar casar
   * por e-mail do destinatário pegaria a pessoa errada quando ela está em duas
   * campanhas.
   */
  async aplicar(evento: {
    type?: string;
    data?: { email_id?: string; to?: string[] };
  }): Promise<'aplicado' | 'ignorado' | 'semDestinatario' | 'emailSuprimido' | string> {
    const tipo = evento.type ?? '';

    // E-MAIL RECEBIDO (o "Enable Receiving" do domínio no Resend). Chega pelo
    // MESMO webhook, já assinado — então a resposta do lead vira evento sem
    // precisar de rota nova nem de segredo separado. A ingestão em si mora no
    // `EmailInboundService`, que é agnóstico de provedor: se um dia a entrada
    // vier por outro caminho, só o transporte muda.
    if (/received|inbound/i.test(tipo)) {
      const r = await this.inbound.registrar(evento as unknown as Record<string, unknown>);
      return `entrada:${r.efeito}`;
    }
    const emailId = evento.data?.email_id;
    if (!emailId) return 'ignorado';

    const agora = new Date();
    const patch = this.patchDoEvento(tipo, agora);
    if (!patch) return 'ignorado';

    const r = await this.prisma.campanhaDestinatario.updateMany({
      where: { resendEmailId: emailId },
      data: patch,
    });
    if (r.count === 0) {
      // E-mail de FLUXO não tem linha em `campanhaDestinatario` — e era aqui que
      // o evento morria. Pra bounce e reclamação isso não é "normal": o endereço
      // está morto e continuava sendo alvo, régua após régua. Provedor lê
      // "insiste em caixa inexistente" como marca de lista comprada, e é o sinal
      // que mais rápido queima um domínio de envio.
      if (tipo === 'email.bounced' || tipo === 'email.complained') {
        return (await this.suprimirDestinatarios(evento.data?.to, tipo))
          ? 'emailSuprimido'
          : 'semDestinatario';
      }
      // Aí sim é normal: transacional (convite, comissão) gera entrega e
      // abertura, e não tem destinatário de campanha.
      return 'semDestinatario';
    }
    return 'aplicado';
  }

  /**
   * Marca o endereço como queimado nos leads que o usam — em QUALQUER tenant.
   *
   * O webhook é global e não diz de quem é o e-mail; quem sabe é a base. Caixa
   * inexistente é inexistente pra todo mundo, então a marca vale por endereço,
   * em cada empresa onde ele aparece. A tag é a de E-MAIL, não a de LGPD: caixa
   * morta não diz nada sobre o telefone da pessoa.
   */
  private async suprimirDestinatarios(para: string[] | undefined, tipo: string): Promise<boolean> {
    const enderecos = (para ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (enderecos.length === 0) return false;
    const motivo = tipo === 'email.complained' ? 'reclamacao' : 'bounce';
    let marcou = 0;
    for (const email of enderecos) {
      const leads = await this.prisma.lead
        .findMany({
          where: { contatoEmail: { equals: email, mode: 'insensitive' } },
          select: { empresaId: true },
          distinct: ['empresaId'],
        })
        .catch(() => [] as Array<{ empresaId: string }>);
      for (const { empresaId } of leads) {
        marcou += await this.supressao
          .marcarEmailInvalido(empresaId, email, motivo)
          .catch((err) => {
            this.logger.warn(`[resend] falha ao suprimir ${email}: ${String(err)}`);
            return 0;
          });
      }
    }
    return marcou > 0;
  }

  /** O que cada evento muda. `null` = evento que não nos diz nada. */
  private patchDoEvento(tipo: string, agora: Date): Record<string, unknown> | null {
    switch (tipo) {
      case 'email.delivered':
        return { entregueEm: agora };
      case 'email.opened':
        // A data guarda o PRIMEIRO toque; o contador guarda o volume. São duas
        // perguntas diferentes ("quando viu" e "quantas vezes voltou").
        return { abertoEm: agora, aberturas: { increment: 1 } };
      case 'email.clicked':
        // Clique é o sinal confiável (abertura infla com pré-carregamento de
        // imagem). Marca abertura junto: quem clicou obviamente abriu, e o
        // provedor nem sempre manda os dois.
        return { clicadoEm: agora, cliques: { increment: 1 }, abertoEm: agora };
      case 'email.bounced':
      case 'email.complained':
        // Reclamação entra no mesmo campo de propósito: as duas significam "não
        // mande mais", e separar em duas colunas complicaria a única decisão que
        // importa (parar de enviar).
        return { bounceEm: agora };
      default:
        return null;
    }
  }

  private igualEmTempoConstante(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
