import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, IntegrationException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';

interface UploadInput {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const BUCKET = 'kanban-fundos';
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB (fundos são fotos grandes)
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SIGNED_URL_EXPIRES = 60 * 60 * 24; // 24h — mesmo padrão do logo da empresa

/**
 * Imagem de fundo do quadro (estilo Trello). Bucket privado + signed URL
 * 24h resolvida junto com o board — mesmo padrão do EmpresaLogoService.
 */
@Injectable()
export class KanbanFundoService implements OnModuleInit {
  private readonly logger = new Logger(KanbanFundoService.name);
  private readonly storage: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  onModuleInit(): void {
    void this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (!buckets?.some((b) => b.name === BUCKET)) {
        const { error } = await this.storage.storage.createBucket(BUCKET, {
          public: false,
          fileSizeLimit: MAX_SIZE_BYTES,
        });
        if (error && !error.message.includes('already exists')) {
          this.logger.error(`Falha ao criar bucket ${BUCKET}: ${error.message}`);
        } else {
          this.logger.log(`Bucket ${BUCKET} pronto`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não foi possível verificar/criar bucket Supabase: ${msg}`);
    }
  }

  /** Sobe/troca a imagem de fundo. Só dono do quadro (ou DIRECTOR/ADMIN). */
  async upload(user: AuthenticatedUser, boardId: string, file: UploadInput) {
    const board = await this.acesso.verificarAcessoBoard(user, boardId, { exigirDono: true });

    if (!file.buffer || file.size === 0) throw new BusinessRuleException('Arquivo vazio');
    if (file.size > MAX_SIZE_BYTES) {
      throw new BusinessRuleException(
        `Imagem muito grande (máx. ${MAX_SIZE_BYTES / 1024 / 1024}MB)`,
      );
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BusinessRuleException('Formato não suportado. Use JPG, PNG ou WebP.');
    }
    if (!this.conteudoConfereMime(file.buffer, file.mimetype)) {
      throw new BusinessRuleException('Conteúdo do arquivo não corresponde ao tipo declarado');
    }

    // Guarda o path anterior; só remove DEPOIS de subir a nova e atualizar o DB
    // (se o upload falhasse antes, o board ficava sem imagem = referência pendurada).
    const pathAnterior = board.imagemFundo;

    const ext =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    // Path novo tem Date.now() → nunca colide com o anterior.
    const storagePath = `${board.empresaId}/${board.id}/${Date.now()}_fundo.${ext}`;
    const { error } = await this.storage.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });
    if (error) throw new IntegrationException(`Falha ao subir imagem: ${error.message}`);

    await this.prisma.kanbanBoard.update({
      where: { id: board.id },
      data: { imagemFundo: storagePath },
    });

    // Remove a anterior só agora (best-effort — falha aqui não desfaz a troca)
    if (pathAnterior && pathAnterior !== storagePath) {
      const { error: errRemove } = await this.storage.storage.from(BUCKET).remove([pathAnterior]);
      if (errRemove) this.logger.warn(`Falha ao remover fundo anterior: ${errRemove.message}`);
    }
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'fundo_alterado',
      dados: { tipo: 'imagem' },
    });
    return { imagemFundo: storagePath, imagemFundoUrl: await this.signedUrl(storagePath) };
  }

  /** Remove a imagem (o quadro volta pra cor de fundo). */
  async remove(user: AuthenticatedUser, boardId: string): Promise<void> {
    const board = await this.acesso.verificarAcessoBoard(user, boardId, { exigirDono: true });
    if (!board.imagemFundo) return;

    const { error } = await this.storage.storage.from(BUCKET).remove([board.imagemFundo]);
    if (error) this.logger.warn(`Falha ao remover fundo do storage: ${error.message}`);

    await this.prisma.kanbanBoard.update({
      where: { id: board.id },
      data: { imagemFundo: null },
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'fundo_removido',
      dados: {},
    });
  }

  /** Signed URL de um path (null-safe). */
  async signedUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRES);
    if (error || !data?.signedUrl) {
      this.logger.warn(`Falha ao gerar signed URL do fundo: ${error?.message ?? 'sem retorno'}`);
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Resolve signed URLs em LOTE pra lista de boards (1 chamada ao storage).
   * Retorna Map path → url.
   */
  async signedUrlsEmLote(paths: string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(paths.filter(Boolean))];
    const mapa = new Map<string, string>();
    if (unicos.length === 0) return mapa;
    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrls(unicos, SIGNED_URL_EXPIRES);
    if (error || !data) {
      this.logger.warn(`Falha ao gerar signed URLs em lote: ${error?.message ?? 'sem retorno'}`);
      return mapa;
    }
    for (const item of data) {
      if (item.signedUrl && item.path) mapa.set(item.path, item.signedUrl);
    }
    return mapa;
  }

  private conteudoConfereMime(buf: Buffer, mimetype: string): boolean {
    const inicia = (sig: number[], offset = 0): boolean =>
      buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b);
    switch (mimetype) {
      case 'image/jpeg':
        return inicia([0xff, 0xd8, 0xff]);
      case 'image/png':
        return inicia([0x89, 0x50, 0x4e, 0x47]);
      case 'image/webp':
        return inicia([0x52, 0x49, 0x46, 0x46]) && inicia([0x57, 0x45, 0x42, 0x50], 8);
      default:
        return false;
    }
  }
}
