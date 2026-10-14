import { Injectable, Logger } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { BUCKET_VITRINE, ehWebp } from '@modules/vitrine/vitrine-fotos.service';

/** A foto chega JÁ otimizada pelo navegador (WebP). */
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;

export interface ArquivoFoto {
  buffer: Buffer;
  size: number;
}

/**
 * Foto do insumo (Léo, 14/10: "senti falta de local pra colocar foto"): UMA por
 * cor — o tecido naquela cor — e uma geral pro insumo sem cores. Mesmo bucket
 * público das fotos da vitrine (path com empresa + aleatório, não enumerável),
 * na pasta `insumos/`. Trocar a foto apaga a anterior.
 */
@Injectable()
export class InsumoFotosService {
  private readonly logger = new Logger(InsumoFotosService.name);
  private cliente: SupabaseClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Conexão com o Storage só no 1º uso: criar no construtor derrubava a montagem
   * do módulo onde o ambiente não tem SUPABASE_URL (teste de DI do ERP no CI).
   */
  private get storage(): SupabaseClient {
    this.cliente ??= createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    return this.cliente;
  }

  urlPublica(path: string | null | undefined): string | null {
    if (!path) return null;
    const base = this.env.get('SUPABASE_URL').replace(/\/$/, '');
    return `${base}/storage/v1/object/public/${BUCKET_VITRINE}/${path}`;
  }

  /** Onde a foto mora: na cor do insumo (`corId` = id da InsumoCor) ou no insumo. */
  private async alvo(empresaId: string, insumoId: string, corId: string | null) {
    const insumo = await this.prisma.insumo.findFirst({
      where: { id: insumoId, empresaId },
      select: { id: true, fotoPath: true, fotoThumbPath: true },
    });
    if (!insumo) throw new NotFoundException('Insumo', insumoId);
    if (!corId)
      return {
        tipo: 'insumo' as const,
        id: insumo.id,
        antigos: [insumo.fotoPath, insumo.fotoThumbPath],
      };
    const cor = await this.prisma.insumoCor.findFirst({
      where: { id: corId, insumoId, empresaId },
      select: { id: true, fotoPath: true, fotoThumbPath: true },
    });
    if (!cor) throw new NotFoundException('Cor do insumo', corId);
    return { tipo: 'cor' as const, id: cor.id, antigos: [cor.fotoPath, cor.fotoThumbPath] };
  }

  async enviar(
    empresaId: string,
    insumoId: string,
    corId: string | null,
    foto: ArquivoFoto,
    thumb: ArquivoFoto | undefined,
  ) {
    const a = await this.alvo(empresaId, insumoId, corId);
    this.validar(foto, MAX_FOTO_BYTES, 'Foto');
    if (thumb) this.validar(thumb, MAX_THUMB_BYTES, 'Miniatura');
    const base = `insumos/${empresaId}/${insumoId}/${Date.now()}_${randomBytes(6).toString('hex')}`;
    const fotoPath = `${base}.webp`;
    const thumbPath = thumb ? `${base}_thumb.webp` : null;
    await this.subir(fotoPath, foto.buffer);
    if (thumb && thumbPath) {
      try {
        await this.subir(thumbPath, thumb.buffer);
      } catch (err) {
        await this.remover([fotoPath]);
        throw err;
      }
    }
    const data = { fotoPath, fotoThumbPath: thumbPath };
    try {
      if (a.tipo === 'cor') await this.prisma.insumoCor.update({ where: { id: a.id }, data });
      else await this.prisma.insumo.update({ where: { id: a.id }, data });
    } catch (err) {
      await this.remover([fotoPath, ...(thumbPath ? [thumbPath] : [])]);
      throw err;
    }
    await this.remover(a.antigos.filter((x): x is string => !!x));
    return { fotoUrl: this.urlPublica(fotoPath), thumbUrl: this.urlPublica(thumbPath) };
  }

  async excluir(empresaId: string, insumoId: string, corId: string | null) {
    const a = await this.alvo(empresaId, insumoId, corId);
    const data = { fotoPath: null, fotoThumbPath: null };
    if (a.tipo === 'cor') await this.prisma.insumoCor.update({ where: { id: a.id }, data });
    else await this.prisma.insumo.update({ where: { id: a.id }, data });
    await this.remover(a.antigos.filter((x): x is string => !!x));
    return { ok: true };
  }

  private validar(arq: ArquivoFoto, max: number, rotulo: string) {
    if (!arq?.buffer?.length) throw new BusinessRuleException(`${rotulo} vazia`);
    if (arq.size > max) {
      throw new BusinessRuleException(`${rotulo} acima de ${Math.round(max / 1024)} KB`);
    }
    if (!ehWebp(arq.buffer)) throw new BusinessRuleException(`${rotulo} precisa ser WebP`);
  }

  private async subir(path: string, buffer: Buffer): Promise<void> {
    const { error } = await this.storage.storage
      .from(BUCKET_VITRINE)
      .upload(path, buffer, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    if (error) throw new IntegrationException(`Falha ao enviar a foto: ${error.message}`);
  }

  private async remover(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.storage.storage.from(BUCKET_VITRINE).remove(paths);
    if (error) this.logger.warn(`Foto(s) de insumo órfã(s) no bucket: ${error.message}`);
  }
}
