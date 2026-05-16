import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { UsuarioIntegracoesService } from '@modules/integracoes/usuario-integracoes.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import type {
  SendGridCredenciais,
  SendGridDestinatario,
  SendGridEnviarParams,
  SendGridEnviarResult,
  SendGridRequest,
} from './sendgrid.types';

/**
 * Wrapper do SendGrid v3 Mail Send API.
 *
 * - Credenciais resolvidas por usuário (cada rep tem sua chave + from)
 * - Fallback opcional pro env (SENDGRID_API_KEY/SENDGRID_FROM_EMAIL) usado por
 *   notificações sistêmicas (ex: convite de novo usuário)
 * - Suporta HTML/texto plano e templates dinâmicos (d-...)
 * - Retorna `messageId` extraído do header `x-message-id`
 */
@Injectable()
export class SendGridService {
  private readonly logger = new Logger(SendGridService.name);
  private static readonly BASE_URL = 'https://api.sendgrid.com/v3';

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly userIntegracoes: UsuarioIntegracoesService,
  ) {}

  /**
   * Envia e-mail usando as credenciais do usuário.
   * Lança IntegrationException com SENDGRID_ERROR se algo falhar.
   */
  async enviar(usuarioId: string, params: SendGridEnviarParams): Promise<SendGridEnviarResult> {
    const creds = await this.resolverCredenciais(usuarioId);
    return this.executar(creds, params);
  }

  /**
   * Envia usando credenciais do env (notificações sistêmicas — convites, etc.).
   * Falha se SENDGRID_API_KEY não estiver configurado.
   */
  async enviarSistemico(params: SendGridEnviarParams): Promise<SendGridEnviarResult> {
    const apiKey = this.env.get('SENDGRID_API_KEY');
    if (!apiKey) {
      throw new IntegrationException(
        'SENDGRID_API_KEY não configurado — envio sistêmico indisponível',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const creds: SendGridCredenciais = {
      apiKey,
      fromEmail: this.env.get('SENDGRID_FROM_EMAIL'),
      fromName: this.env.get('SENDGRID_FROM_NAME'),
    };
    return this.executar(creds, params);
  }

  private async resolverCredenciais(usuarioId: string): Promise<SendGridCredenciais> {
    const conn = await this.userIntegracoes.obterCredenciaisInternas(usuarioId, 'sendgrid');
    const c = conn.credenciais as Partial<SendGridCredenciais>;
    if (!c.apiKey || !c.fromEmail) {
      throw new IntegrationException(
        'Credenciais SendGrid incompletas — exige apiKey e fromEmail',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return { apiKey: c.apiKey, fromEmail: c.fromEmail, fromName: c.fromName };
  }

  private async executar(
    creds: SendGridCredenciais,
    params: SendGridEnviarParams,
  ): Promise<SendGridEnviarResult> {
    const body = this.buildRequest(creds, params);
    try {
      const res = await this.http.post<unknown>(`${SendGridService.BASE_URL}/mail/send`, {
        body,
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        integration: 'sendgrid',
        redactKeys: ['authorization', 'api_key', 'apikey'],
        retries: 2,
      });
      const messageId = res.headers['x-message-id'] ?? null;
      this.logger.log(
        `SendGrid → ${this.summary(params.para)} (status ${res.status}, msg ${messageId ?? '?'})`,
      );
      return { messageId, status: res.status };
    } catch (err) {
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 300)
            : String(err.body ?? '').slice(0, 300);
        throw new IntegrationException(
          `SendGrid HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new IntegrationException(`SendGrid falhou: ${msg}`, ErrorCode.INTEGRATION_ERROR);
    }
  }

  private buildRequest(
    creds: SendGridCredenciais,
    params: SendGridEnviarParams,
  ): SendGridRequest {
    const para = this.normalizaPara(params.para);
    const from = params.from ?? { email: creds.fromEmail, name: creds.fromName };

    const req: SendGridRequest = {
      personalizations: [{ to: para }],
      from,
    };
    if (params.replyTo) req.reply_to = params.replyTo;

    if (params.templateId) {
      req.template_id = params.templateId;
      if (params.variaveis) {
        req.personalizations[0].dynamic_template_data = params.variaveis;
      }
      // Subject no template normalmente vem do próprio template; mas pode override
      if (params.assunto) req.personalizations[0].subject = params.assunto;
    } else {
      if (!params.assunto) {
        throw new IntegrationException(
          'SendGrid: assunto obrigatório quando não usa templateId',
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      req.subject = params.assunto;
      req.content = [];
      if (params.texto) req.content.push({ type: 'text/plain', value: params.texto });
      if (params.html) req.content.push({ type: 'text/html', value: params.html });
      if (req.content.length === 0) {
        throw new IntegrationException(
          'SendGrid: corpo obrigatório (html ou texto) quando não usa template',
          ErrorCode.INTEGRATION_ERROR,
        );
      }
    }
    return req;
  }

  private normalizaPara(
    para: SendGridEnviarParams['para'],
  ): SendGridDestinatario[] {
    if (typeof para === 'string') return [{ email: para }];
    if (Array.isArray(para)) return para;
    return [para];
  }

  private summary(para: SendGridEnviarParams['para']): string {
    const arr = this.normalizaPara(para);
    if (arr.length === 1) return arr[0].email;
    return `${arr.length} destinatários`;
  }
}
