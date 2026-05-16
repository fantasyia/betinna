import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Documento } from '@prisma/client';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ClientesService } from './clientes.service';

interface UploadInput {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const BUCKET = 'cliente-documentos';
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
]);
const SIGNED_URL_EXPIRES = 60 * 60; // 1h

/**
 * Documentos anexados a clientes (contratos, fichas, fotos, etc).
 * Arquivos ficam no Supabase Storage (bucket `cliente-documentos`).
 * No banco guardamos só o metadado + storage path.
 */
@Injectable()
export class DocumentosService implements OnModuleInit {
  private readonly logger = new Logger(DocumentosService.name);
  private readonly storage: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly clientes: ClientesService,
  ) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /**
   * Garante que o bucket exista (criado privado, sem acesso público).
   * Roda 1x na inicialização do módulo.
   */
  async onModuleInit(): Promise<void> {
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

  async list(user: AuthenticatedUser, clienteId: string): Promise<Documento[]> {
    await this.clientes.findById(user, clienteId);
    return this.prisma.documento.findMany({
      where: { clienteId },
      orderBy: { criadoEm: 'desc' },
    });
  }

  async upload(user: AuthenticatedUser, clienteId: string, file: UploadInput): Promise<Documento> {
    if (!file.buffer || file.size === 0) {
      throw new BusinessRuleException('Arquivo vazio');
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BusinessRuleException(
        `Arquivo muito grande (máx. ${MAX_SIZE_BYTES / 1024 / 1024}MB)`,
      );
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BusinessRuleException(`Tipo de arquivo não permitido: ${file.mimetype}`);
    }

    const cliente = await this.clientes.findById(user, clienteId);

    const ext = this.extensionFor(file.filename, file.mimetype);
    const tipo = this.tipoFor(file.mimetype);
    const ts = Date.now();
    const safeName = file.filename.replace(/[^\w.\-]/g, '_').slice(0, 80);
    const storagePath = `${cliente.empresaId}/${clienteId}/${ts}_${safeName}${ext ? `.${ext}` : ''}`;

    const { error } = await this.storage.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) {
      throw new IntegrationException(`Falha ao subir arquivo: ${error.message}`);
    }

    return this.prisma.documento.create({
      data: {
        clienteId,
        nome: safeName,
        tipo,
        url: storagePath, // armazenamos só o path; URL é gerada signed sob demanda
        tamanho: file.size,
      },
    });
  }

  async download(
    user: AuthenticatedUser,
    clienteId: string,
    docId: string,
  ): Promise<{ signedUrl: string; expiresIn: number; nome: string }> {
    await this.clientes.findById(user, clienteId);
    const doc = await this.prisma.documento.findFirst({
      where: { id: docId, clienteId },
    });
    if (!doc) throw new NotFoundException('Documento', docId);

    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(doc.url, SIGNED_URL_EXPIRES);
    if (error || !data?.signedUrl) {
      throw new IntegrationException(`Falha ao gerar URL: ${error?.message ?? 'sem retorno'}`);
    }
    return { signedUrl: data.signedUrl, expiresIn: SIGNED_URL_EXPIRES, nome: doc.nome };
  }

  async remove(user: AuthenticatedUser, clienteId: string, docId: string): Promise<void> {
    await this.clientes.findById(user, clienteId);
    const doc = await this.prisma.documento.findFirst({
      where: { id: docId, clienteId },
    });
    if (!doc) throw new NotFoundException('Documento', docId);

    const { error } = await this.storage.storage.from(BUCKET).remove([doc.url]);
    if (error) {
      this.logger.warn(`Falha ao remover arquivo do storage: ${error.message}`);
      // Mesmo se falhar no storage, removemos o metadado pra não ficar inconsistente
    }
    await this.prisma.documento.delete({ where: { id: docId } });
  }

  private extensionFor(filename: string, mime: string): string {
    const dot = filename.lastIndexOf('.');
    if (dot > 0 && dot < filename.length - 1) return filename.slice(dot + 1).toLowerCase();
    // Fallback por MIME
    const map: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'text/csv': 'csv',
      'text/plain': 'txt',
    };
    return map[mime] ?? '';
  }

  private tipoFor(mime: string): string {
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('image/')) return 'img';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'xls';
    if (mime.includes('word')) return 'doc';
    if (mime === 'text/csv') return 'csv';
    return 'other';
  }
}
