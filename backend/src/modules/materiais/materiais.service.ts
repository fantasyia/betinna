import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { MaterialVenda, Prisma } from '@prisma/client';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
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
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type { CreateMaterialDto, ListMateriaisDto, UpdateMaterialDto } from './materiais.dto';

interface UploadInput {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const BUCKET = 'materiais-venda';
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB (vídeos/apresentações)
const SIGNED_URL_EXPIRES = 60 * 60; // 1h — o link expirável de compartilhamento
/** Tipos aceitos no material de venda (anti upload arbitrário; content-type vem do cliente). */
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'text/plain',
]);

/**
 * Biblioteca de materiais de venda da empresa (marketing). Admin/diretor publica,
 * rep visualiza e compartilha via link expirável. Arquivos no Supabase Storage.
 */
@Injectable()
export class MateriaisService implements OnModuleInit {
  private readonly logger = new Logger(MateriaisService.name);
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
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não foi possível verificar/criar bucket ${BUCKET}: ${msg}`);
    }
  }

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  async list(user: AuthenticatedUser, params: ListMateriaisDto): Promise<Paginated<MaterialVenda>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.MaterialVendaWhereInput = { empresaId };
    if (params.tipo) where.tipo = params.tipo;
    if (params.produtoId) where.produtoId = params.produtoId;
    if (params.search) where.titulo = { contains: params.search, mode: 'insensitive' };

    const [total, data] = await Promise.all([
      this.prisma.materialVenda.count({ where }),
      this.prisma.materialVenda.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<MaterialVenda> {
    const material = await this.prisma.materialVenda.findFirst({
      where: { id, empresaId: this.requireEmpresa(user) },
    });
    if (!material) throw new NotFoundException('Material', id);
    return material;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateMaterialDto,
    file: UploadInput,
  ): Promise<MaterialVenda> {
    const empresaId = this.requireEmpresa(user);
    if (!file.buffer || file.size === 0) throw new BusinessRuleException('Arquivo vazio');
    if (file.size > MAX_SIZE_BYTES) {
      throw new BusinessRuleException(
        `Arquivo muito grande (máx. ${MAX_SIZE_BYTES / 1024 / 1024}MB)`,
      );
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BusinessRuleException(`Tipo de arquivo não permitido: ${file.mimetype}`);
    }
    if (dto.produtoId) await this.assertProdutoDaEmpresa(empresaId, dto.produtoId);

    const ts = Date.now();
    const safeName = file.filename.replace(/[^\w.\-]/g, '_').slice(0, 100);
    const storagePath = `${empresaId}/${ts}_${safeName}`;

    const { error } = await this.storage.storage.from(BUCKET).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) throw new IntegrationException(`Falha ao subir arquivo: ${error.message}`);

    try {
      return await this.prisma.materialVenda.create({
        data: {
          empresaId,
          tipo: dto.tipo,
          titulo: dto.titulo,
          descricao: dto.descricao,
          produtoId: dto.produtoId,
          categoria: dto.categoria,
          confidencial: dto.confidencial ?? false,
          arquivoPath: storagePath,
          arquivoNome: safeName,
          mimeType: file.mimetype,
          tamanho: file.size,
          criadoPorId: user.id,
          criadoPorNome: user.nome,
        },
      });
    } catch (err) {
      // DB falhou DEPOIS do upload → remove o arquivo órfão do Storage (best-effort).
      await this.storage.storage
        .from(BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
      throw err;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateMaterialDto,
  ): Promise<MaterialVenda> {
    const existing = await this.findById(user, id);
    if (dto.produtoId) await this.assertProdutoDaEmpresa(existing.empresaId, dto.produtoId);
    await this.prisma.materialVenda.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    return this.prisma.materialVenda.findUniqueOrThrow({ where: { id } });
  }

  /** Valida que o produto vinculado pertence ao tenant (anti referência cruzada). */
  private async assertProdutoDaEmpresa(empresaId: string, produtoId: string): Promise<void> {
    const p = await this.prisma.produto.findFirst({
      where: { id: produtoId, empresaId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Produto', produtoId);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    const { error } = await this.storage.storage.from(BUCKET).remove([existing.arquivoPath]);
    if (error) this.logger.warn(`Falha ao remover arquivo do storage: ${error.message}`);
    await this.prisma.materialVenda.delete({ where: { id } });
  }

  /** Gera o link expirável (URL assinada, 1h) pra visualizar/compartilhar. */
  async gerarLink(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ url: string; expiresIn: number; nome: string; confidencial: boolean }> {
    const material = await this.findById(user, id);
    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(material.arquivoPath, SIGNED_URL_EXPIRES);
    if (error || !data?.signedUrl) {
      throw new IntegrationException(`Falha ao gerar link: ${error?.message ?? 'sem retorno'}`);
    }
    return {
      url: data.signedUrl,
      expiresIn: SIGNED_URL_EXPIRES,
      nome: material.arquivoNome,
      confidencial: material.confidencial,
    };
  }
}
