import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';

/**
 * Wrapper do Resend (https://resend.com) — provider de e-mail
 * transacional ÚNICO do sistema.
 *
 * Decisão Leo (2026-05-24): adotar Resend pros e-mails sistêmicos (convites,
 * boas-vindas, notificações). Mais simples, API mais limpa e free tier mais
 * generoso pra MVP. SendGrid foi removido por completo.
 *
 * Configuração via env:
 *   RESEND_API_KEY      — `re_...` da conta Resend
 *   RESEND_FROM_EMAIL   — e-mail remetente verificado no painel Resend
 *   RESEND_FROM_NAME    — nome amigável (opcional, default 'Betinna.ai')
 *
 * Quando RESEND_API_KEY está vazio, o método `enviar` lança
 * IntegrationException. O `TransactionalEmailService` checa via
 * `isConfigured()` antes de chamar.
 */
@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private static readonly BASE_URL = 'https://api.resend.com/emails';

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
  ) {}

  /** Verifica se o Resend está configurado (API key + from email presentes). */
  isConfigured(): boolean {
    const key = this.env.get('RESEND_API_KEY');
    const from = this.env.get('RESEND_FROM_EMAIL');
    return !!key && !!from;
  }

  /**
   * Envia e-mail transacional via Resend.
   *
   * @param params.para    e-mail do destinatário (string única)
   * @param params.assunto subject
   * @param params.html    corpo HTML (recomendado pra templates)
   * @param params.texto   corpo plain-text (fallback opcional)
   */
  async enviar(params: {
    para: string;
    assunto: string;
    html?: string;
    texto?: string;
    /** Nome de exibição do remetente (override por-tenant). Default env/'Betinna.ai'. */
    fromNome?: string;
    /**
     * ENDEREÇO de envio (override por fluxo). Default `RESEND_FROM_EMAIL`.
     *
     * Serve pra separar reputação: régua fria sai de um subdomínio próprio, e o
     * transacional fica no domínio raiz. Reclamação de spam na prospecção pra
     * uma base de 30 mil não pode derrubar a entrega da confirmação de pedido
     * de quem já pagou.
     *
     * ⚠️ O domínio precisa estar VERIFICADO no Resend — endereço de domínio não
     * verificado é recusado pelo provedor, e o envio inteiro falha.
     */
    fromEmail?: string;
    /** Reply-To por-tenant (respostas caem no e-mail da empresa). */
    replyTo?: string;
    /** Anexos opcionais (ex: PDF de proposta). content em base64 puro. */
    attachments?: Array<{ filename: string; content: string }>;
    /**
     * Chave de idempotência (Resend deduplica nativamente por 24h). OBRIGATÓRIA pra
     * exactly-once: o próprio wrapper já reenvia 2× (retries:2) em 5xx/rede, então sem
     * a chave esses reenvios poderiam duplicar mesmo sem crash.
     */
    idempotencyKey?: string;
    /**
     * Cabeçalhos extras da MENSAGEM (não da requisição). Existe pro
     * `List-Unsubscribe` + `List-Unsubscribe-Post`: é o que faz Gmail/Outlook
     * mostrarem o botão nativo de cancelar inscrição. Sem ele, o caminho de quem
     * se irrita é o botão de SPAM — e aí o domínio inteiro paga, inclusive a
     * confirmação de pedido.
     */
    headers?: Record<string, string>;
  }): Promise<{ id: string | null; status: number }> {
    const apiKey = this.env.get('RESEND_API_KEY');
    const fromEmail = params.fromEmail?.trim() || this.env.get('RESEND_FROM_EMAIL');
    if (!apiKey || !fromEmail) {
      throw new IntegrationException(
        'Resend não configurado — defina RESEND_API_KEY e RESEND_FROM_EMAIL',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (!params.html && !params.texto) {
      throw new IntegrationException(
        'Resend: corpo obrigatório (html ou texto)',
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // Remetente: override por-tenant (fromNome) > env RESEND_FROM_NAME > 'Betinna.ai'.
    // Quebra de linha em header é injeção de header (auditoria 13/09, C-12):
    // assunto/fromNome vêm de config do tenant e de template interpolado.
    const semQuebra = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();
    const fromName = semQuebra(
      params.fromNome?.trim() || this.env.get('RESEND_FROM_NAME') || 'Betinna.ai',
    );
    const from = `${fromName} <${fromEmail}>`;

    const body = {
      from,
      to: [params.para],
      subject: semQuebra(params.assunto),
      ...(params.replyTo ? { reply_to: semQuebra(params.replyTo) } : {}),
      ...(params.html ? { html: params.html } : {}),
      ...(params.texto ? { text: params.texto } : {}),
      ...(params.attachments && params.attachments.length > 0
        ? { attachments: params.attachments }
        : {}),
      ...(params.headers && Object.keys(params.headers).length > 0
        ? { headers: params.headers }
        : {}),
    };

    try {
      const res = await this.http.post<{ id?: string }>(ResendService.BASE_URL, {
        body,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
        },
        integration: 'resend',
        redactKeys: ['authorization'],
        retries: 2,
      });
      const id = res.data?.id ?? null;
      this.logger.log(
        `Resend → ${params.para} (status ${res.status}, id ${id ?? '?'}): ${params.assunto.slice(0, 60)}`,
      );
      return { id, status: res.status };
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `Resend HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new IntegrationException(`Resend falhou: ${msg}`, ErrorCode.INTEGRATION_ERROR);
    }
  }

  /**
   * Corpo de um e-mail RECEBIDO (Enable Receiving). O webhook `email.received`
   * traz só metadata — a doc do Resend é explícita: "Webhooks do not include
   * the email body, headers, or attachments". Sem esta chamada a resposta do
   * lead entrava na Inbox só com o assunto (auditoria 13/09/2026, C-7).
   * Best-effort: devolve null em falha e quem chama registra o que tiver.
   */
  async obterRecebido(emailId: string): Promise<{
    text: string | null;
    html: string | null;
    subject: string | null;
    from: string | null;
    to: string[];
    messageId: string | null;
    createdAt: string | null;
  } | null> {
    const apiKey = this.env.get('RESEND_API_KEY');
    if (!apiKey || !emailId) return null;
    try {
      const res = await this.http.get<{
        text?: string;
        html?: string;
        subject?: string;
        from?: string;
        to?: string[] | string;
        message_id?: string;
        created_at?: string;
      }>(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        integration: 'resend',
        redactKeys: ['authorization'],
        retries: 2,
      });
      const d = res.data ?? {};
      return {
        text: d.text ?? null,
        html: d.html ?? null,
        subject: d.subject ?? null,
        from: d.from ?? null,
        to: Array.isArray(d.to) ? d.to : d.to ? [d.to] : [],
        messageId: d.message_id ?? null,
        createdAt: d.created_at ?? null,
      };
    } catch (err) {
      this.logger.warn(
        `Resend: não consegui buscar o corpo do e-mail recebido ${emailId} — ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
