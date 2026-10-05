import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * Bucket PÚBLICO de propósito: são fotos de produto feitas pra serem vistas
 * por qualquer um com o link da vitrine, e o "kit pra anunciar" deixa o
 * revendedor baixar. URL pública = cache de CDN e nada de assinar URL a cada
 * abertura do feed. O path leva empresa + modelo + aleatório (não enumerável).
 */
export const BUCKET_VITRINE = 'vitrine-fotos';
/** A foto chega JÁ otimizada pelo navegador (WebP ~1080 px). */
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;
const MAX_FOTOS_POR_COR = 12;
/**
 * Vídeo do "kit pra anunciar" (Léo, 05/10). Sobe DIRETO do navegador pro
 * Storage por URL assinada de upload: passar 50 MB pela API ocuparia memória
 * do container (multer guarda em RAM) por nada.
 */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEOS_POR_MODELO = 6;

export interface ArquivoWebp {
  buffer: Buffer;
  size: number;
}

/** Magic number do WebP: "RIFF" .... "WEBP". O mimetype do cliente não vale como prova. */
export function ehWebp(buf: Buffer): boolean {
  return (
    buf.length > 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  );
}

@Injectable()
export class VitrineFotosService implements OnModuleInit {
  private readonly logger = new Logger(VitrineFotosService.name);
  private readonly storage: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /** Best-effort e NÃO bloqueante (mesma lição do bucket de logos: boot travado). */
  onModuleInit(): void {
    void this.garantirBucket();
  }

  private async garantirBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (!buckets?.some((b) => b.name === BUCKET_VITRINE)) {
        const { error } = await this.storage.storage.createBucket(BUCKET_VITRINE, {
          public: true,
          // O teto do bucket é o do VÍDEO; a foto tem o teto dela no service.
          fileSizeLimit: MAX_VIDEO_BYTES,
          allowedMimeTypes: ['image/webp', 'video/mp4'],
        });
        if (error && !error.message.includes('already exists')) {
          this.logger.error(`Falha ao criar bucket ${BUCKET_VITRINE}: ${error.message}`);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Não foi possível verificar o bucket ${BUCKET_VITRINE}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** URL pública de um path do bucket. */
  urlPublica(path: string | null | undefined): string | null {
    if (!path) return null;
    const base = this.env.get('SUPABASE_URL').replace(/\/$/, '');
    return `${base}/storage/v1/object/public/${BUCKET_VITRINE}/${path}`;
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  /** A cor do modelo é desta empresa E a empresa tem vitrine ligada. */
  private async corDoModelo(user: AuthenticatedUser, modeloCorId: string) {
    const empresaId = this.requireEmpresa(user);
    const v = await this.prisma.vitrine.findUnique({ where: { empresaId }, select: { id: true } });
    if (!v) {
      throw new BusinessRuleException('A vitrine de atacado não está ligada nesta empresa');
    }
    const mc = await this.prisma.catalogoModeloCor.findFirst({
      where: { id: modeloCorId, modelo: { empresaId } },
      select: { id: true, modeloId: true },
    });
    if (!mc) throw new NotFoundException('Cor do modelo', modeloCorId);
    return { empresaId, ...mc };
  }

  async enviar(
    user: AuthenticatedUser,
    modeloCorId: string,
    foto: ArquivoWebp,
    thumb: ArquivoWebp | undefined,
    dims: { largura?: number; altura?: number },
  ) {
    const mc = await this.corDoModelo(user, modeloCorId);
    this.validar(foto, MAX_FOTO_BYTES, 'Foto');
    if (thumb) this.validar(thumb, MAX_THUMB_BYTES, 'Miniatura');

    const qtd = await this.prisma.catalogoFoto.count({ where: { modeloCorId } });
    if (qtd >= MAX_FOTOS_POR_COR) {
      throw new BusinessRuleException(`No máximo ${MAX_FOTOS_POR_COR} fotos por cor`);
    }

    const base = `${mc.empresaId}/${mc.modeloId}/${Date.now()}_${randomBytes(6).toString('hex')}`;
    const storagePath = `${base}.webp`;
    const thumbPath = thumb ? `${base}_thumb.webp` : null;
    await this.subir(storagePath, foto.buffer);
    if (thumb && thumbPath) {
      try {
        await this.subir(thumbPath, thumb.buffer);
      } catch (err) {
        await this.remover([storagePath]);
        throw err;
      }
    }

    try {
      const criada = await this.prisma.catalogoFoto.create({
        data: {
          modeloCorId,
          storagePath,
          thumbPath,
          largura: dims.largura ?? null,
          altura: dims.altura ?? null,
          // Entra no FIM: a 1ª foto da cor é a capa até alguém reordenar.
          ordem: qtd,
        },
      });
      return this.comUrls(criada);
    } catch (err) {
      // Sem registro, o arquivo vira lixo invisível no bucket.
      await this.remover([storagePath, ...(thumbPath ? [thumbPath] : [])]);
      throw err;
    }
  }

  async reordenar(user: AuthenticatedUser, modeloCorId: string, fotoIds: string[]) {
    await this.corDoModelo(user, modeloCorId);
    const fotos = await this.prisma.catalogoFoto.findMany({
      where: { modeloCorId },
      select: { id: true },
    });
    const daCor = new Set(fotos.map((f) => f.id));
    if (fotoIds.length !== daCor.size || !fotoIds.every((id) => daCor.has(id))) {
      throw new BusinessRuleException('A nova ordem tem que ter exatamente as fotos desta cor');
    }
    await this.prisma.$transaction(
      fotoIds.map((id, ordem) =>
        this.prisma.catalogoFoto.update({ where: { id }, data: { ordem } }),
      ),
    );
    return this.listar(user, modeloCorId);
  }

  async listar(user: AuthenticatedUser, modeloCorId: string) {
    await this.corDoModelo(user, modeloCorId);
    const fotos = await this.prisma.catalogoFoto.findMany({
      where: { modeloCorId },
      orderBy: { ordem: 'asc' },
    });
    return fotos.map((f) => this.comUrls(f));
  }

  async excluir(user: AuthenticatedUser, fotoId: string) {
    const empresaId = this.requireEmpresa(user);
    const foto = await this.prisma.catalogoFoto.findFirst({
      where: { id: fotoId, modeloCor: { modelo: { empresaId } } },
    });
    if (!foto) throw new NotFoundException('Foto', fotoId);
    await this.prisma.catalogoFoto.delete({ where: { id: fotoId } });
    // Banco primeiro: se o storage falhar, sobra arquivo órfão (inofensivo),
    // nunca foto no banco apontando pra arquivo que não existe.
    await this.remover([foto.storagePath, ...(foto.thumbPath ? [foto.thumbPath] : [])]);
    return { ok: true };
  }

  // ─── Vídeos (por MODELO, não por cor) ───────────────────────────────────

  /** Modelo desta empresa, com a vitrine ligada. */
  private async modeloDaEmpresa(user: AuthenticatedUser, modeloId: string) {
    const empresaId = this.requireEmpresa(user);
    const v = await this.prisma.vitrine.findUnique({ where: { empresaId }, select: { id: true } });
    if (!v) {
      throw new BusinessRuleException('A vitrine de atacado não está ligada nesta empresa');
    }
    const m = await this.prisma.catalogoModelo.findFirst({
      where: { id: modeloId, empresaId },
      select: { id: true },
    });
    if (!m) throw new NotFoundException('Modelo', modeloId);
    return { empresaId, modeloId };
  }

  /**
   * Passo 1: devolve uma URL assinada pro navegador subir o MP4 direto pro
   * Storage. O path é decidido AQUI (o cliente não escolhe onde grava).
   */
  async prepararVideo(user: AuthenticatedUser, modeloId: string, tamanhoBytes: number) {
    const { empresaId } = await this.modeloDaEmpresa(user, modeloId);
    if (tamanhoBytes > MAX_VIDEO_BYTES) {
      throw new BusinessRuleException(
        `Vídeo grande demais (máx. ${MAX_VIDEO_BYTES / 1024 / 1024} MB)`,
      );
    }
    const qtd = await this.prisma.catalogoVideo.count({ where: { modeloId } });
    if (qtd >= MAX_VIDEOS_POR_MODELO) {
      throw new BusinessRuleException(`No máximo ${MAX_VIDEOS_POR_MODELO} vídeos por modelo`);
    }
    const storagePath = `${empresaId}/${modeloId}/video_${Date.now()}_${randomBytes(6).toString('hex')}.mp4`;
    const { data, error } = await this.storage.storage
      .from(BUCKET_VITRINE)
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      throw new IntegrationException(`Falha ao preparar o envio do vídeo: ${error?.message}`);
    }
    return { storagePath, uploadUrl: data.signedUrl, token: data.token };
  }

  /**
   * Passo 2: o navegador terminou o upload. Confere que o arquivo EXISTE no
   * path que nós mesmos geramos (desta empresa/modelo) antes de registrar.
   */
  async confirmarVideo(
    user: AuthenticatedUser,
    modeloId: string,
    dados: { storagePath: string; nomeArquivo?: string; tamanhoBytes?: number },
  ) {
    const { empresaId } = await this.modeloDaEmpresa(user, modeloId);
    const prefixo = `${empresaId}/${modeloId}/video_`;
    if (!dados.storagePath.startsWith(prefixo) || dados.storagePath.includes('..')) {
      throw new BusinessRuleException('Caminho de vídeo inválido');
    }
    const pasta = `${empresaId}/${modeloId}`;
    const nome = dados.storagePath.slice(pasta.length + 1);
    const { data } = await this.storage.storage.from(BUCKET_VITRINE).list(pasta, { search: nome });
    if (!data?.some((o) => o.name === nome)) {
      throw new BusinessRuleException('O vídeo não chegou ao armazenamento — envie de novo');
    }
    const qtd = await this.prisma.catalogoVideo.count({ where: { modeloId } });
    const criado = await this.prisma.catalogoVideo.create({
      data: {
        modeloId,
        storagePath: dados.storagePath,
        nomeArquivo: dados.nomeArquivo ?? null,
        tamanhoBytes: dados.tamanhoBytes ?? null,
        ordem: qtd,
      },
    });
    return { ...criado, url: this.urlPublica(criado.storagePath) };
  }

  async excluirVideo(user: AuthenticatedUser, videoId: string) {
    const empresaId = this.requireEmpresa(user);
    const video = await this.prisma.catalogoVideo.findFirst({
      where: { id: videoId, modelo: { empresaId } },
    });
    if (!video) throw new NotFoundException('Vídeo', videoId);
    await this.prisma.catalogoVideo.delete({ where: { id: videoId } });
    await this.remover([video.storagePath]);
    return { ok: true };
  }

  comUrls<T extends { storagePath: string; thumbPath: string | null }>(f: T) {
    return { ...f, url: this.urlPublica(f.storagePath), thumbUrl: this.urlPublica(f.thumbPath) };
  }

  private validar(arq: ArquivoWebp, max: number, rotulo: string): void {
    if (!arq.buffer || arq.size === 0) throw new BusinessRuleException(`${rotulo} vazia`);
    if (arq.size > max) {
      throw new BusinessRuleException(
        `${rotulo} grande demais (máx. ${Math.round(max / 1024)} KB)`,
      );
    }
    if (!ehWebp(arq.buffer)) throw new BusinessRuleException(`${rotulo} precisa ser WebP`);
  }

  private async subir(path: string, buffer: Buffer): Promise<void> {
    const { error } = await this.storage.storage
      .from(BUCKET_VITRINE)
      .upload(path, buffer, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    if (error) {
      throw new IntegrationException(`Falha ao enviar a foto: ${error.message}`);
    }
  }

  private async remover(paths: string[]): Promise<void> {
    const { error } = await this.storage.storage.from(BUCKET_VITRINE).remove(paths);
    if (error)
      this.logger.warn(`Arquivo(s) órfão(s) no bucket ${BUCKET_VITRINE}: ${error.message}`);
  }
}
