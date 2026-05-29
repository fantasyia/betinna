import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';

/**
 * Wrapper do Resend (https://resend.com) — provider de e-mail
 * transacional alternativo ao SendGrid.
 *
 * Decisão Leo (2026-05-24): trocar SendGrid por Resend pros e-mails
 * sistêmicos (convites, boas-vindas, notificações). Mais simples, API
 * mais limpa e free tier mais generoso pra MVP.
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
    /** Anexos opcionais (ex: PDF de proposta). content em base64 puro. */
    attachments?: Array<{ filename: string; content: string }>;
  }): Promise<{ id: string | null; status: number }> {
    const apiKey = this.env.get('RESEND_API_KEY');
    const fromEmail = this.env.get('RESEND_FROM_EMAIL');
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

    const fromName = this.env.get('RESEND_FROM_NAME') ?? 'Betinna.ai';
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    const body = {
      from,
      to: [params.para],
      subject: params.assunto,
      ...(params.html ? { html: params.html } : {}),
      ...(params.texto ? { text: params.texto } : {}),
      ...(params.attachments && params.attachments.length > 0
        ? { attachments: params.attachments }
        : {}),
    };

    try {
      const res = await this.http.post<{ id?: string }>(ResendService.BASE_URL, {
        body,
        headers: { Authorization: `Bearer ${apiKey}` },
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
}
