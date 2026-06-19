import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';

/**
 * MetaMediaService — baixa attachments de Messenger/Instagram via CDN URL
 * pública e persiste no Supabase Storage (bucket `meta-media`).
 *
 * Por quê? URLs do Facebook CDN têm assinatura limitada por tempo. Mensagem
 * antiga referenciando a URL original quebra. Persistindo, garantimos
 * disponibilidade do histórico.
 *
 * Best-effort: falha do download não derruba a persistência da Message —
 * `mediaUrl` fica null (com placeholder no conteúdo).
 */

const BUCKET = 'meta-media';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const SIGNED_URL_TTL = 60 * 60; // 1h (era 7 dias — signed URL curta é mais segura)
const DOWNLOAD_TIMEOUT_MS = 30_000;

@Injectable()
export class MetaMediaService implements OnModuleInit {
  private readonly logger = new Logger(MetaMediaService.name);
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
   * Baixa attachment via fetch e faz upload no Storage.
   *
   * @returns storagePath ou null se falhou
   */
  async baixarEArmazenar(params: {
    cdnUrl: string;
    empresaId: string;
    canal: 'FACEBOOK' | 'INSTAGRAM';
    peerId: string;
    msgId: string | undefined;
  }): Promise<{ storagePath: string; mime: string | null } | null> {
    const { cdnUrl, empresaId, canal, peerId, msgId } = params;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(cdnUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        this.logger.warn(
          `Falha download attachment (${response.status}) canal=${canal} peer=${peerId}`,
        );
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) return null;
      if (buffer.length > MAX_BYTES) {
        this.logger.warn(
          `Attachment muito grande (${buffer.length} bytes) — pulando canal=${canal} peer=${peerId}`,
        );
        return null;
      }

      const mime = response.headers.get('content-type') ?? 'application/octet-stream';
      const ext = extFromMime(mime) ?? extFromUrl(cdnUrl);
      const safePeer = peerId.replace(/[^\w]/g, '_').slice(0, 60);
      const safeCanal = canal.toLowerCase();
      const id = msgId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const path = `${empresaId}/${safeCanal}/${safePeer}/${id}${ext ? `.${ext}` : ''}`;

      const { error } = await this.storage.storage.from(BUCKET).upload(path, buffer, {
        contentType: mime,
        upsert: false,
      });

      if (error) {
        if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
          return { storagePath: path, mime };
        }
        this.logger.warn(
          `Falha upload Meta media empresa=${empresaId} canal=${canal}: ${error.message}`,
        );
        return null;
      }

      this.logger.debug(`Meta media armazenada: ${path} (${buffer.length} bytes)`);
      return { storagePath: path, mime };
    } catch (err) {
      this.logger.warn(
        `Falha download/upload Meta empresa=${empresaId} canal=${canal} peer=${peerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /** Gera signed URL temporária (default 7 dias). */
  async signedUrl(storagePath: string, ttlSeconds = SIGNED_URL_TTL): Promise<string | null> {
    try {
      const { data, error } = await this.storage.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
      if (error || !data?.signedUrl) {
        this.logger.warn(`Falha signed URL Meta ${storagePath}: ${error?.message ?? 'sem URL'}`);
        return null;
      }
      return data.signedUrl;
    } catch (err) {
      this.logger.warn(
        `Erro signed URL Meta ${storagePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extFromMime(mime: string): string | null {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('webp')) return 'webp';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('pdf')) return 'pdf';
  return null;
}

function extFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const dot = path.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = path.slice(dot + 1).toLowerCase();
    // Sanity check — só extensões conhecidas
    const ok = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mp3', 'ogg', 'wav', 'pdf'];
    return ok.includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : null;
  } catch {
    return null;
  }
}
