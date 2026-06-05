import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';

/**
 * Cliente HTTP do **Evolution API v2** — WhatsApp não-oficial rodando como
 * serviço SEPARADO (Railway). O app deixa de hospedar o socket Baileys e vira
 * cliente: ENVIA por HTTP e RECEBE por webhook. Assim, deploy do app não derruba
 * mais o WhatsApp (a conexão vive no container do Evolution, com sessão no
 * Postgres dele → reconecta sem novo QR).
 *
 * Auth: header `apikey` com a AUTHENTICATION_API_KEY global do Evolution.
 * Uma "instância" por dono (`emp_<id>` / `user_<id>`), espelhando o dual-owner.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
  ) {}

  /** True quando o provider está em 'evolution' E a URL/chave estão configuradas. */
  ativo(): boolean {
    return (
      this.env.get('WHATSAPP_PROVIDER') === 'evolution' &&
      !!this.env.get('EVOLUTION_API_URL') &&
      !!this.env.get('EVOLUTION_API_KEY')
    );
  }

  private get baseUrl(): string {
    return (this.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { apikey: this.env.get('EVOLUTION_API_KEY') || '' };
  }

  private async req<T>(
    method: 'get' | 'post' | 'delete',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts = {
      headers: this.headers(),
      integration: 'evolution',
      redactKeys: ['apikey'],
      retries: 1,
      timeoutMs: 30_000,
      ...(body ? { body } : {}),
    };
    const res =
      method === 'get'
        ? await this.http.get<T>(url, opts)
        : method === 'delete'
          ? await this.http.delete<T>(url, opts)
          : await this.http.post<T>(url, opts);
    return res.data;
  }

  // ─── Instâncias ───────────────────────────────────────────────────────────

  /** Cria a instância (idempotente do lado nosso — se já existe, o Evolution avisa). */
  async criarInstancia(instance: string, webhookUrl?: string): Promise<{ hash?: string }> {
    return this.req('post', '/instance/create', {
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      ...(webhookUrl
        ? {
            webhook: {
              url: webhookUrl,
              byEvents: false,
              base64: true,
              events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
            },
          }
        : {}),
    });
  }

  /** QR code (base64) pra parear. Também (re)conecta uma instância existente. */
  async conectar(
    instance: string,
  ): Promise<{ base64?: string; code?: string; pairingCode?: string }> {
    return this.req('get', `/instance/connect/${encodeURIComponent(instance)}`);
  }

  /** Estado: 'open' (conectado) | 'connecting' | 'close'. */
  async estado(instance: string): Promise<{ instance?: { state?: string } }> {
    return this.req('get', `/instance/connectionState/${encodeURIComponent(instance)}`);
  }

  async logout(instance: string): Promise<unknown> {
    return this.req('delete', `/instance/logout/${encodeURIComponent(instance)}`);
  }

  async deletar(instance: string): Promise<unknown> {
    return this.req('delete', `/instance/delete/${encodeURIComponent(instance)}`);
  }

  // ─── Envio ─────────────────────────────────────────────────────────────────

  /** Texto. `delayMs` simula "digitando" antes de enviar (presença nativa). */
  async enviarTexto(
    instance: string,
    numero: string,
    texto: string,
    delayMs = 0,
  ): Promise<{ key?: { id?: string } }> {
    return this.req('post', `/message/sendText/${encodeURIComponent(instance)}`, {
      number: this.soDigitos(numero),
      text: texto,
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    });
  }

  /** Mídia (imagem/vídeo/documento). `media` = base64 puro (sem prefixo) ou URL. */
  async enviarMidia(
    instance: string,
    numero: string,
    m: {
      mediatype: 'image' | 'video' | 'document';
      mimetype?: string;
      media: string;
      fileName?: string;
      caption?: string;
    },
  ): Promise<{ key?: { id?: string } }> {
    return this.req('post', `/message/sendMedia/${encodeURIComponent(instance)}`, {
      number: this.soDigitos(numero),
      ...m,
    });
  }

  /** Áudio de voz (PTT). `audio` = base64 puro ou URL. */
  async enviarAudio(
    instance: string,
    numero: string,
    audio: string,
  ): Promise<{ key?: { id?: string } }> {
    return this.req('post', `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`, {
      number: this.soDigitos(numero),
      audio,
    });
  }

  /** Presença "composing" (digitando) / "paused" — best-effort. */
  async enviarPresenca(
    instance: string,
    numero: string,
    presence: 'composing' | 'paused',
  ): Promise<void> {
    await this.req('post', `/chat/sendPresence/${encodeURIComponent(instance)}`, {
      number: this.soDigitos(numero),
      presence,
    }).catch(() => undefined);
  }

  /** Nome da instância a partir do dono (espelha o ownerKey do Baileys). */
  static instanceName(owner: { type: 'EMPRESA' | 'USUARIO'; id: string }): string {
    return `${owner.type === 'EMPRESA' ? 'emp' : 'user'}_${owner.id}`;
  }

  /** Token do webhook derivado da API key (não expõe a key crua na URL). */
  static webhookToken(apiKey: string): string {
    if (!apiKey) return '';
    return createHash('sha256').update(`evolution-webhook:${apiKey}`).digest('hex').slice(0, 32);
  }

  /** URL completa do webhook (API pública + /webhooks/evolution/<token>). */
  webhookUrl(): string {
    const base = (this.env.get('API_PUBLIC_URL') || '').replace(/\/+$/, '');
    const token = EvolutionService.webhookToken(this.env.get('EVOLUTION_API_KEY') || '');
    return base && token ? `${base}/webhooks/evolution/${token}` : '';
  }

  /**
   * Garante a instância criada (com webhook) e retorna o estado + QR.
   * Usado pela tela de conectar — idempotente (recriar é best-effort).
   */
  async conectarOuEstado(
    instance: string,
  ): Promise<{ status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED'; qrDataUrl?: string }> {
    const st = await this.estado(instance).catch(() => null);
    if (st?.instance?.state === 'open') return { status: 'CONNECTED' };
    // Não conectado → garante instância + webhook, pega o QR.
    await this.criarInstancia(instance, this.webhookUrl()).catch(() => undefined);
    const qr = await this.conectar(instance).catch(() => null);
    return { status: 'CONNECTING', qrDataUrl: qr?.base64 ?? undefined };
  }

  private soDigitos(numero: string): string {
    return numero.replace(/\D/g, '');
  }
}
