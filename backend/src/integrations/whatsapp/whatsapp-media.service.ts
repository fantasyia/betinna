import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { downloadMediaMessage, type proto, type WAMessage } from '@whiskeysockets/baileys';
import { EnvService } from '@config/env.service';

/**
 * WhatsAppMediaService — baixa mídia recebida via Baileys e armazena no
 * Supabase Storage. Retorna o storagePath pra ser salvo em `Message.mediaUrl`.
 *
 * Bucket privado `whatsapp-media`. Acesso via signed URL gerado no fly.
 *
 * Limites:
 *  - 20 MB por arquivo (WhatsApp tem limite de 16 MB pra mídia; deixamos folga)
 *  - Falha de download é best-effort: loga warn e retorna null. A mensagem
 *    é persistida sem mediaUrl (placeholder no conteúdo continua funcionando).
 */

const BUCKET = 'whatsapp-media';
const MAX_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_TTL = 60 * 60; // 1h (era 7 dias — signed URL curta é mais segura; mídia carrega na hora e fica no cache do browser)

@Injectable()
export class WhatsAppMediaService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppMediaService.name);
  private readonly storage: SupabaseClient;

  constructor(private readonly env: EnvService) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (!buckets?.some((b) => b.name === BUCKET)) {
        const { error } = await this.storage.storage.createBucket(BUCKET, {
          public: false,
          fileSizeLimit: MAX_BYTES,
        });
        if (error && !error.message.includes('already exists')) {
          this.logger.warn(`Falha criando bucket ${BUCKET}: ${error.message}`);
        } else {
          this.logger.log(`Bucket ${BUCKET} ok`);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Não foi possível verificar bucket ${BUCKET}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Baixa a mídia da WAMessage e faz upload no Storage.
   *
   * @param message       mensagem Baileys (com imageMessage/audioMessage/etc)
   * @param empresaId     pra organizar path do storage
   * @param peerId        usado no path; ex: 5511...@s.whatsapp.net
   * @param mediaMime     mimetype detectado em `extrairConteudo`
   * @returns o storagePath dentro do bucket OU null se falhou/sem mídia
   */
  async baixarEArmazenar(params: {
    message: proto.IWebMessageInfo;
    empresaId: string;
    peerId: string;
    mediaMime: string | undefined;
    msgId: string | undefined;
  }): Promise<string | null> {
    const { message, empresaId, peerId, mediaMime, msgId } = params;

    if (!message.message) return null;
    if (!hasMediaContent(message.message)) return null;

    try {
      const buffer = (await downloadMediaMessage(message as WAMessage, 'buffer', {})) as Buffer;

      if (!buffer || buffer.length === 0) return null;
      if (buffer.length > MAX_BYTES) {
        this.logger.warn(
          `Mídia muito grande (${buffer.length} bytes) — pulando empresa=${empresaId} peer=${peerId}`,
        );
        return null;
      }

      const ext = extFromMime(mediaMime) ?? extFromMessage(message.message);
      const safePeer = peerId.replace(/[^\w]/g, '_').slice(0, 60);
      const id = msgId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const path = `${empresaId}/${safePeer}/${id}${ext ? `.${ext}` : ''}`;

      const { error } = await this.storage.storage.from(BUCKET).upload(path, buffer, {
        contentType: mediaMime ?? 'application/octet-stream',
        upsert: false,
      });

      if (error) {
        // duplicate é OK (idempotência), só loga
        if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
          return path;
        }
        this.logger.warn(
          `Falha upload mídia WhatsApp empresa=${empresaId} peer=${peerId}: ${error.message}`,
        );
        return null;
      }

      this.logger.debug(`Mídia armazenada: ${path} (${buffer.length} bytes)`);
      return path;
    } catch (err) {
      this.logger.warn(
        `Falha download/upload mídia empresa=${empresaId} peer=${peerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Gera signed URL temporária pra cliente acessar a mídia.
   * Usar no controller que retorna `Message[]` pra inbox.
   */
  /**
   * Upload de mídia OUTBOUND (enviada pela própria Betinna) no Storage.
   * Sem isso, mensagens outbound de imagem/áudio/vídeo/doc não teriam
   * mediaUrl e a UI mostraria só "[imagem]" sem renderizar o conteúdo.
   *
   * Retorna o storagePath ou null se falhar (best-effort: a mensagem
   * ainda é enviada pelo Baileys, só não fica visualizável na Betinna).
   */
  async uploadOutbound(
    empresaId: string,
    peerId: string,
    buffer: Buffer,
    mimetype: string | undefined,
    msgIdOpt?: string,
  ): Promise<string | null> {
    if (buffer.length === 0) return null;
    if (buffer.length > MAX_BYTES) {
      this.logger.warn(
        `Mídia OUTBOUND muito grande (${buffer.length} bytes) — pulando upload empresa=${empresaId} peer=${peerId}`,
      );
      return null;
    }
    try {
      const ext = extFromMime(mimetype);
      const safePeer = peerId.replace(/[^\w]/g, '_').slice(0, 60);
      const id = msgIdOpt ?? `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const path = `${empresaId}/${safePeer}/${id}${ext ? `.${ext}` : ''}`;
      const { error } = await this.storage.storage.from(BUCKET).upload(path, buffer, {
        contentType: mimetype ?? 'application/octet-stream',
        upsert: false,
      });
      if (error) {
        if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
          return path;
        }
        this.logger.warn(
          `Falha upload mídia OUTBOUND empresa=${empresaId} peer=${peerId}: ${error.message}`,
        );
        return null;
      }
      return path;
    } catch (err) {
      this.logger.warn(
        `Erro upload OUTBOUND empresa=${empresaId} peer=${peerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async signedUrl(storagePath: string, ttlSeconds = SIGNED_URL_TTL): Promise<string | null> {
    try {
      const { data, error } = await this.storage.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
      if (error || !data?.signedUrl) {
        this.logger.warn(`Falha signed URL ${storagePath}: ${error?.message ?? 'sem URL'}`);
        return null;
      }
      return data.signedUrl;
    } catch (err) {
      this.logger.warn(
        `Erro signed URL ${storagePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Baixa os bytes da mídia armazenada (pra IA transcrever áudio / ver imagem). */
  async baixar(storagePath: string): Promise<Buffer | null> {
    try {
      const { data, error } = await this.storage.storage.from(BUCKET).download(storagePath);
      if (error || !data) {
        this.logger.warn(`Falha download ${storagePath}: ${error?.message ?? 'sem dados'}`);
        return null;
      }
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      this.logger.warn(
        `Erro download ${storagePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Remove a mídia do Storage. Best-effort: loga e segue se falhar (não lança). */
  async remover(storagePath: string): Promise<void> {
    try {
      const { error } = await this.storage.storage.from(BUCKET).remove([storagePath]);
      if (error) this.logger.warn(`Falha ao remover ${storagePath}: ${error.message}`);
    } catch (err) {
      this.logger.warn(
        `Erro ao remover ${storagePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function hasMediaContent(msg: proto.IMessage): boolean {
  return Boolean(
    msg.imageMessage ||
    msg.videoMessage ||
    msg.audioMessage ||
    msg.documentMessage ||
    msg.stickerMessage,
  );
}

function extFromMime(mime: string | undefined): string | null {
  if (!mime) return null;
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('opus')) return 'opus';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('msword')) return 'doc';
  if (m.includes('wordprocessingml')) return 'docx';
  if (m.includes('spreadsheetml')) return 'xlsx';
  if (m.includes('excel')) return 'xls';
  return null;
}

function extFromMessage(msg: proto.IMessage): string | null {
  if (msg.imageMessage) return 'jpg';
  if (msg.videoMessage) return 'mp4';
  if (msg.audioMessage) return 'ogg';
  if (msg.documentMessage) return msg.documentMessage.fileName?.split('.').pop() ?? 'bin';
  if (msg.stickerMessage) return 'webp';
  return null;
}
