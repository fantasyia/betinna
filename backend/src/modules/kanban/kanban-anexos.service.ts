import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { KanbanAnexo } from '@prisma/client';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import type { CreateAnexoLinkDto } from './kanban.dto';

interface UploadInput {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const BUCKET = 'kanban-anexos';
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB (mesmo teto dos documentos de cliente)
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
]);
const SIGNED_URL_EXPIRES = 60 * 60; // 1h

/**
 * Anexos de card: ARQUIVO (Supabase Storage, mesma infra dos documentos de
 * cliente — bucket próprio, path no banco, signed URL sob demanda) ou LINK.
 */
@Injectable()
export class KanbanAnexosService implements OnModuleInit {
  private readonly logger = new Logger(KanbanAnexosService.name);
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

  /** Bucket garantido em background (não trava o boot — padrão DocumentosService). */
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
          this.logger.log(`Bucket ${BUCKET} criado`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não foi possível verificar/criar bucket Supabase: ${msg}`);
    }
  }

  /** Anexo tipo ARQUIVO (multipart upload). */
  async uploadArquivo(user: AuthenticatedUser, cardId: string, file: UploadInput) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);

    if (!file.buffer || file.size === 0) throw new BusinessRuleException('Arquivo vazio');
    if (file.size > MAX_SIZE_BYTES) {
      throw new BusinessRuleException(
        `Arquivo muito grande (máx. ${MAX_SIZE_BYTES / 1024 / 1024}MB)`,
      );
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BusinessRuleException(`Tipo de arquivo não permitido: ${file.mimetype}`);
    }
    if (!this.conteudoConfereMime(file.buffer, file.mimetype)) {
      throw new BusinessRuleException('Conteúdo do arquivo não corresponde ao tipo declarado');
    }

    const ts = Date.now();
    const safeName = file.filename.replace(/[^\w.\-]/g, '_').slice(0, 80);
    const storagePath = `${board.empresaId}/${card.id}/${ts}_${safeName}`;

    const { error } = await this.storage.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) throw new IntegrationException(`Falha ao subir arquivo: ${error.message}`);

    const anexo = await this.prisma.kanbanAnexo.create({
      data: { cardId: card.id, nome: safeName, url: storagePath, tipo: 'arquivo' },
    });
    await this.registrarAtividade(board.id, card.id, user.id, anexo);
    return anexo;
  }

  /** Anexo tipo LINK (JSON). */
  async createLink(user: AuthenticatedUser, cardId: string, dto: CreateAnexoLinkDto) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const anexo = await this.prisma.kanbanAnexo.create({
      data: { cardId: card.id, nome: dto.nome, url: dto.url, tipo: 'link' },
    });
    await this.registrarAtividade(board.id, card.id, user.id, anexo);
    return anexo;
  }

  /** Signed URL (1h) pra anexo tipo arquivo; link devolve a própria URL. */
  async gerarLink(
    user: AuthenticatedUser,
    anexoId: string,
  ): Promise<{ url: string; expiresIn: number | null; nome: string }> {
    const anexo = await this.findComAcesso(user, anexoId);
    if (anexo.tipo === 'link') {
      return { url: anexo.url, expiresIn: null, nome: anexo.nome };
    }
    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(anexo.url, SIGNED_URL_EXPIRES);
    if (error || !data?.signedUrl) {
      throw new IntegrationException(`Falha ao gerar URL: ${error?.message ?? 'sem retorno'}`);
    }
    return { url: data.signedUrl, expiresIn: SIGNED_URL_EXPIRES, nome: anexo.nome };
  }

  async remove(user: AuthenticatedUser, anexoId: string): Promise<void> {
    const anexo = await this.findComAcesso(user, anexoId);

    if (anexo.tipo === 'arquivo') {
      const { error } = await this.storage.storage.from(BUCKET).remove([anexo.url]);
      if (error) {
        // Mesmo se falhar no storage, removemos o metadado pra não ficar inconsistente
        this.logger.warn(`Falha ao remover arquivo do storage: ${error.message}`);
      }
    }
    await this.prisma.kanbanAnexo.delete({ where: { id: anexoId } });

    const { board } = await this.acesso.verificarAcessoPorCard(user, anexo.cardId);
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'anexo_removido',
      cardId: anexo.cardId,
      dados: { nome: anexo.nome },
    });
  }

  private async findComAcesso(user: AuthenticatedUser, anexoId: string): Promise<KanbanAnexo> {
    const anexo = await this.prisma.kanbanAnexo.findUnique({ where: { id: anexoId } });
    if (!anexo) throw new NotFoundException('Anexo', anexoId);
    await this.acesso.verificarAcessoPorCard(user, anexo.cardId);
    return anexo;
  }

  private async registrarAtividade(
    boardId: string,
    cardId: string,
    usuarioId: string,
    anexo: KanbanAnexo,
  ): Promise<void> {
    await this.atividade.registrar({
      boardId,
      usuarioId,
      tipo: 'anexo_adicionado',
      cardId,
      dados: { nome: anexo.nome, tipo: anexo.tipo },
    });
  }

  /** Magic-number check — mesma defesa do DocumentosService (binário disfarçado). */
  private conteudoConfereMime(buf: Buffer, mimetype: string): boolean {
    const inicia = (sig: number[], offset = 0): boolean =>
      buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b);
    switch (mimetype) {
      case 'application/pdf':
        return inicia([0x25, 0x50, 0x44, 0x46]); // %PDF
      case 'image/jpeg':
        return inicia([0xff, 0xd8, 0xff]);
      case 'image/png':
        return inicia([0x89, 0x50, 0x4e, 0x47]);
      case 'image/gif':
        return inicia([0x47, 0x49, 0x46, 0x38]); // GIF8
      case 'image/webp':
        return inicia([0x52, 0x49, 0x46, 0x46]) && inicia([0x57, 0x45, 0x42, 0x50], 8);
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return (
          inicia([0x50, 0x4b, 0x03, 0x04]) ||
          inicia([0x50, 0x4b, 0x05, 0x06]) ||
          inicia([0x50, 0x4b, 0x07, 0x08])
        );
      case 'application/vnd.ms-excel':
      case 'application/msword':
        return inicia([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      case 'text/csv':
      case 'text/plain':
        return true;
      default:
        return true;
    }
  }
}
