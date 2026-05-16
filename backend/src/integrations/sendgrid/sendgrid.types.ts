/**
 * Tipos do SendGrid v3 Mail Send API.
 * Documentação: https://docs.sendgrid.com/api-reference/mail-send/mail-send
 */

export interface SendGridCredenciais {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

export interface SendGridDestinatario {
  email: string;
  name?: string;
}

export interface SendGridContent {
  type: 'text/plain' | 'text/html';
  value: string;
}

export interface SendGridPersonalization {
  to: SendGridDestinatario[];
  cc?: SendGridDestinatario[];
  bcc?: SendGridDestinatario[];
  subject?: string;
  dynamic_template_data?: Record<string, unknown>;
}

export interface SendGridRequest {
  personalizations: SendGridPersonalization[];
  from: SendGridDestinatario;
  reply_to?: SendGridDestinatario;
  subject?: string;
  content?: SendGridContent[];
  template_id?: string;
}

export interface SendGridEnviarParams {
  para: string | SendGridDestinatario | SendGridDestinatario[];
  assunto?: string;
  /** HTML (preferido) ou texto plano. Ignorado se `templateId` informado. */
  html?: string;
  texto?: string;
  /** Quando informado, usa template dinâmico do SendGrid (id `d-...`). */
  templateId?: string;
  /** Variáveis pra template dinâmico. */
  variaveis?: Record<string, unknown>;
  /** Reply-to opcional. */
  replyTo?: SendGridDestinatario;
  /** Override do from (default usa o que está nas credenciais). */
  from?: SendGridDestinatario;
}

export interface SendGridEnviarResult {
  messageId: string | null;
  status: number;
}
