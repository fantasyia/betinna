import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { HttpClientService } from '@shared/http/http-client.service';
import { HttpClientError } from '@shared/http/http-client.types';
import { ShopeeOAuthService } from './shopee-oauth.service';
import { ShopeeSigner } from './shopee-signer';

/**
 * HTTP client low-level pra Shopee Open Platform.
 *
 * Aplica automaticamente:
 *  - Resolução de access_token (refresh transparente via ShopeeOAuthService)
 *  - Assinatura `?sign=<hex>` em cada request via ShopeeSigner.signShop
 *  - Query params obrigatórios (partner_id, timestamp, access_token, shop_id)
 *
 * Shopee retorna erros como `{ error: "...", message: "...", request_id }` com
 * HTTP 200 — então a gente trata error no payload, não só no status.
 */
const PARTE_VIDEO = 4 * 1024 * 1024;

@Injectable()
export class ShopeeClientService {
  private readonly logger = new Logger(ShopeeClientService.name);

  constructor(
    private readonly http: HttpClientService,
    private readonly env: EnvService,
    private readonly oauth: ShopeeOAuthService,
  ) {}

  /**
   * GET shop-scoped (com sign + access_token + shop_id automáticos).
   * @param path path relativo, ex: '/api/v2/sellerchat/get_message'
   * @param extraQuery campos adicionais da query (não inclua sign/access_token/shop_id/timestamp/partner_id)
   */
  async getShop<T>(
    empresaId: string,
    path: string,
    extraQuery: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    return this.call<T>('GET', empresaId, path, extraQuery);
  }

  /**
   * POST shop-scoped — body vai como JSON; query params idem GET.
   * `semRepetir`: criação (add_item) não pode ir duas vezes num timeout.
   */
  async postShop<T>(
    empresaId: string,
    path: string,
    body: unknown,
    extraQuery: Record<string, string | number | boolean | undefined> = {},
    opcoes: { semRepetir?: boolean } = {},
  ): Promise<T> {
    return this.call<T>('POST', empresaId, path, extraQuery, body, opcoes.semRepetir ? 0 : 1);
  }

  private async call<T>(
    method: 'GET' | 'POST',
    empresaId: string,
    path: string,
    extraQuery: Record<string, string | number | boolean | undefined>,
    body?: unknown,
    retries = 1,
  ): Promise<T> {
    const creds = await this.oauth.getCredenciais(empresaId);
    const partnerId = this.env.get('SHOPEE_PARTNER_ID');
    const partnerKey = this.env.get('SHOPEE_PARTNER_KEY');
    const signer = new ShopeeSigner(partnerId, partnerKey);
    const { sign, timestamp } = signer.signShop(path, creds.accessToken, creds.shopId);

    const baseUrl = this.oauth.baseUrl();
    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      access_token: creds.accessToken,
      shop_id: creds.shopId,
      sign,
    });
    for (const [k, v] of Object.entries(extraQuery)) {
      if (v !== undefined) params.append(k, String(v));
    }
    const url = `${baseUrl}${path}?${params}`;

    try {
      const res = await this.http.request<T & { error?: string; message?: string }>(method, url, {
        body,
        integration: 'shopee',
        redactKeys: ['access_token', 'partner_id', 'sign'],
        retries,
        timeoutMs: 30_000,
      });
      // Shopee usa HTTP 200 mesmo com erro no payload
      const data = res.data as { error?: string; message?: string } | undefined;
      if (data && data.error) {
        throw new IntegrationException(
          `Shopee ${method} ${path} (${data.error}): ${data.message ?? '?'}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      return res.data;
    } catch (err) {
      if (err instanceof IntegrationException) throw err;
      if (err instanceof HttpClientError) {
        const detail =
          typeof err.body === 'object' && err.body !== null
            ? JSON.stringify(err.body).slice(0, 400)
            : String(err.body ?? '').slice(0, 400);
        throw new IntegrationException(
          `Shopee ${method} ${path} HTTP ${err.status}: ${detail}`,
          ErrorCode.INTEGRATION_ERROR,
        );
      }
      throw err;
    }
  }

  /**
   * Sobe imagem no media space. API pública: assina sem token e vai em multipart,
   * que o HttpClient não serializa. Não toca em anúncio nenhum.
   */
  async subirImagem(
    arquivo: { buffer: Buffer; nome: string; tipo: string },
    cena: 'normal' | 'desc',
  ): Promise<string> {
    const path = '/api/v2/media_space/upload_image';
    const partnerId = this.env.get('SHOPEE_PARTNER_ID');
    const signer = new ShopeeSigner(partnerId, this.env.get('SHOPEE_PARTNER_KEY'));
    const { sign, timestamp } = signer.signPublic(path);
    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign,
    });
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(arquivo.buffer)], { type: arquivo.tipo }),
      arquivo.nome,
    );
    form.append('scene', cena);
    const res = await fetch(`${this.oauth.baseUrl()}${path}?${params}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const texto = await res.text();
    let data: {
      error?: string;
      message?: string;
      response?: { image_info?: { image_id?: string } };
    };
    try {
      data = JSON.parse(texto) as typeof data;
    } catch {
      throw new IntegrationException(
        `Shopee upload_image HTTP ${res.status}: ${texto.slice(0, 200)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const imageId = data.response?.image_info?.image_id;
    if (data.error || !imageId) {
      throw new IntegrationException(
        `Shopee upload_image (${data.error ?? 'sem image_id'}): ${data.message ?? '?'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return imageId;
  }

  /** Parte e fim do vídeo são públicos: assinam sem token, como a imagem. */
  private async postPublico(path: string, body: FormData | string) {
    const partnerId = this.env.get('SHOPEE_PARTNER_ID');
    const signer = new ShopeeSigner(partnerId, this.env.get('SHOPEE_PARTNER_KEY'));
    const { sign, timestamp } = signer.signPublic(path);
    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign,
    });
    const res = await fetch(`${this.oauth.baseUrl()}${path}?${params}`, {
      method: 'POST',
      body,
      headers: typeof body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    const texto = await res.text();
    let data: { error?: string; message?: string };
    try {
      data = JSON.parse(texto) as typeof data;
    } catch {
      throw new IntegrationException(
        `Shopee ${path} HTTP ${res.status}: ${texto.slice(0, 200)}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    if (data.error) {
      throw new IntegrationException(
        `Shopee ${path} (${data.error}): ${data.message ?? '?'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
  }

  /** Sobe vídeo em partes de 4 MB. Devolve o id; nenhum anúncio muda. */
  async subirVideo(empresaId: string, video: Buffer): Promise<string> {
    const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
    const ini = await this.postShop<{ response?: { video_upload_id?: string } }>(
      empresaId,
      '/api/v2/media_space/init_video_upload',
      { file_md5: md5(video), file_size: video.length },
    );
    const id = ini.response?.video_upload_id;
    if (!id) {
      throw new IntegrationException(
        'Shopee init_video_upload sem video_upload_id',
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    const inicio = Date.now();
    const partes: number[] = [];
    for (let i = 0; i * PARTE_VIDEO < video.length; i++) {
      const parte = video.subarray(i * PARTE_VIDEO, (i + 1) * PARTE_VIDEO);
      const form = new FormData();
      form.append('video_upload_id', id);
      form.append('part_seq', String(i));
      form.append('content_md5', md5(parte));
      form.append('part_content', new Blob([new Uint8Array(parte)]), 'parte');
      await this.postPublico('/api/v2/media_space/upload_video_part', form);
      partes.push(i);
    }
    await this.postPublico(
      '/api/v2/media_space/complete_video_upload',
      JSON.stringify({
        video_upload_id: id,
        part_seq_list: partes,
        report_data: { upload_cost: Date.now() - inicio },
      }),
    );
    return id;
  }

  /** Expose pra services consultarem shopId/accessToken sem chamar API. */
  async getCredenciais(empresaId: string) {
    return this.oauth.getCredenciais(empresaId);
  }
}
