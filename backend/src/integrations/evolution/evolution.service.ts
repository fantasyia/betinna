import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { BusinessRuleException } from '@shared/errors/app-exception';

/** O QR pode vir em vários campos dependendo da resposta do Evolution. */
type RespostaQr = {
  base64?: string;
  code?: string;
  qrcode?: { base64?: string; code?: string };
};

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
  async criarInstancia(
    instance: string,
    webhookUrl?: string,
  ): Promise<{ hash?: string } & RespostaQr> {
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
  async conectar(instance: string): Promise<RespostaQr> {
    return this.req('get', `/instance/connect/${encodeURIComponent(instance)}`);
  }

  /** Extrai o QR (base64) de qualquer formato de resposta do Evolution. */
  private extrairQr(resp: unknown): string | undefined {
    const r = (resp ?? {}) as RespostaQr;
    return r.qrcode?.base64 ?? r.base64 ?? r.qrcode?.code ?? r.code;
  }

  /** Detalha um erro HTTP incluindo o CORPO da resposta (o motivo real do Evolution). */
  private detalheErro(err: unknown): string {
    if (err instanceof HttpClientError) {
      const corpo = err.body ? ` — ${JSON.stringify(err.body).slice(0, 300)}` : '';
      return `HTTP ${err.status}${corpo}`;
    }
    return err instanceof Error ? err.message : String(err);
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
   * Falhas viram erro VISÍVEL (não engole em silêncio) pra a tela mostrar o que
   * está errado. Diagnóstico no campo `erro` quando conecta mas não vem QR.
   */
  async conectarOuEstado(instance: string): Promise<{
    status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
    qrDataUrl?: string;
    erro?: string;
  }> {
    if (!this.env.get('EVOLUTION_API_URL') || !this.env.get('EVOLUTION_API_KEY')) {
      throw new BusinessRuleException(
        'Evolution não configurado no backend: faltam EVOLUTION_API_URL e/ou EVOLUTION_API_KEY no env (api + worker).',
      );
    }

    // 1. Já conectado? (estado pode falhar se a instância ainda não existe)
    const estado = await this.estado(instance)
      .then((s) => s?.instance?.state)
      .catch(() => undefined);
    if (estado === 'open') return { status: 'CONNECTED' };

    // 2. Garante a instância (com webhook). A criação pode já trazer o QR.
    //    Falha aqui NÃO é fatal: se a instância já existe (403 "already in use"
    //    do primeiro clique), seguimos pro connect — que pega o QR da existente.
    let qr: string | undefined;
    try {
      qr = this.extrairQr(await this.criarInstancia(instance, this.webhookUrl()));
    } catch (err) {
      this.logger.warn(
        `[evolution] criarInstancia ${instance}: ${this.detalheErro(err)} (segue pro connect)`,
      );
    }
    if (qr) return { status: 'CONNECTING', qrDataUrl: qr };

    // 3. Pega o QR pelo connect (serve pra instância nova OU já existente).
    let resp: unknown;
    try {
      resp = await this.conectar(instance);
    } catch (err) {
      throw new BusinessRuleException(`Falha ao conectar no Evolution: ${this.detalheErro(err)}.`);
    }
    qr = this.extrairQr(resp);
    if (qr) return { status: 'CONNECTING', qrDataUrl: qr };

    // 4. Conectou mas SEM QR → instância travada (criada mas pareamento não saiu).
    //    Reseta (deleta) e recria do ZERO — instância nova devolve QR na criação.
    this.logger.warn(`[evolution] ${instance} sem QR no connect — resetando p/ forçar QR novo`);
    await this.deletar(instance).catch(() => undefined);
    const recriada = await this.criarInstancia(instance, this.webhookUrl()).catch(() => null);
    qr =
      this.extrairQr(recriada) ?? this.extrairQr(await this.conectar(instance).catch(() => null));
    if (qr) return { status: 'CONNECTING', qrDataUrl: qr };

    // 5. Ainda nada → diagnóstico (chaves da resposta) pra a gente ver o formato.
    const chaves =
      resp && typeof resp === 'object'
        ? Object.keys(resp as object).join(',')
        : String(typeof resp);
    this.logger.warn(
      `[evolution] connect ${instance} sem QR mesmo após reset — resposta: ${chaves}`,
    );
    return {
      status: 'CONNECTING',
      erro: `Evolution não devolveu QR (resposta: ${chaves}). Tente de novo em ~5s.`,
    };
  }

  /**
   * SÓ LEITURA — pro polling de status. Estado + QR atual, SEM criar/resetar
   * (senão o poll do front ficaria recriando a instância sem parar).
   */
  async estadoComQr(instance: string): Promise<{
    status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
    qrDataUrl?: string;
  }> {
    const estado = await this.estado(instance)
      .then((s) => s?.instance?.state)
      .catch(() => undefined);
    if (estado === 'open') return { status: 'CONNECTED' };
    const qr = this.extrairQr(await this.conectar(instance).catch(() => null));
    return { status: 'CONNECTING', qrDataUrl: qr };
  }

  private soDigitos(numero: string): string {
    return numero.replace(/\D/g, '');
  }
}
