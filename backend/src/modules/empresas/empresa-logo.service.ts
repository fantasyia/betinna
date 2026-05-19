import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

interface UploadLogoInput {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const BUCKET = 'empresa-logos';
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const SIGNED_URL_EXPIRES = 60 * 60 * 24 * 7; // 7 dias — logo é renderizado em todo lugar

/**
 * Upload e gestão do logo da empresa (Supabase Storage bucket `empresa-logos`).
 *
 * Cada empresa tem 1 logo (path armazenado em `Empresa.logoUrl`). Acesso:
 * - ADMIN: pode trocar logo de qualquer empresa
 * - DIRECTOR: pode trocar logo da própria empresa
 * - Outros: apenas leitura via `getLogoSignedUrl()`
 */
@Injectable()
export class EmpresaLogoService implements OnModuleInit {
  private readonly logger = new Logger(EmpresaLogoService.name);
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
          this.logger.log(`Bucket ${BUCKET} pronto`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Não foi possível verificar/criar bucket Supabase: ${msg}`);
    }
  }

  /**
   * Faz upload do logo. Substitui o anterior se existir.
   * Retorna { logoUrl: storagePath } — o cliente chama `getSignedUrl` pra exibir.
   */
  async upload(
    user: AuthenticatedUser,
    empresaId: string,
    file: UploadLogoInput,
  ): Promise<{ logoUrl: string }> {
    this.assertCanManageLogo(user, empresaId);

    if (!file.buffer || file.size === 0) {
      throw new BusinessRuleException('Arquivo vazio');
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BusinessRuleException(
        `Arquivo muito grande (máx. ${MAX_SIZE_BYTES / 1024 / 1024}MB)`,
      );
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BusinessRuleException(
        `Formato não suportado. Use PNG, JPG, WebP ou SVG.`,
      );
    }

    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa', empresaId);

    // Remove logo anterior se existir (best-effort)
    if (empresa.logoUrl) {
      const { error: removeErr } = await this.storage.storage
        .from(BUCKET)
        .remove([empresa.logoUrl]);
      if (removeErr) {
        this.logger.warn(`Falha ao remover logo anterior: ${removeErr.message}`);
      }
    }

    const ext = this.extensionFor(file.filename, file.mimetype);
    const ts = Date.now();
    const storagePath = `${empresaId}/${ts}_logo${ext ? `.${ext}` : ''}`;

    const { error } = await this.storage.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) {
      throw new IntegrationException(`Falha ao subir logo: ${error.message}`);
    }

    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { logoUrl: storagePath },
    });

    return { logoUrl: storagePath };
  }

  /**
   * Remove o logo da empresa. Limpa o storage e o campo logoUrl.
   */
  async remove(user: AuthenticatedUser, empresaId: string): Promise<void> {
    this.assertCanManageLogo(user, empresaId);

    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa', empresaId);
    if (!empresa.logoUrl) return; // nada a fazer

    const { error } = await this.storage.storage.from(BUCKET).remove([empresa.logoUrl]);
    if (error) {
      this.logger.warn(`Falha ao remover logo do storage: ${error.message}`);
      // Mesmo se falhar no storage, limpa o ponteiro pra não ficar broken
    }

    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { logoUrl: null },
    });
  }

  /**
   * Gera signed URL pra exibir o logo. Cache 7 dias (rotaciona quando troca).
   * Qualquer usuário autenticado pode obter o logo da própria empresa.
   */
  async getSignedUrl(
    empresaId: string,
  ): Promise<{ signedUrl: string | null; expiresIn: number }> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { logoUrl: true },
    });
    if (!empresa) throw new NotFoundException('Empresa', empresaId);
    if (!empresa.logoUrl) return { signedUrl: null, expiresIn: 0 };

    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(empresa.logoUrl, SIGNED_URL_EXPIRES);
    if (error || !data?.signedUrl) {
      this.logger.warn(`Falha ao gerar signed URL: ${error?.message ?? 'sem retorno'}`);
      return { signedUrl: null, expiresIn: 0 };
    }
    return { signedUrl: data.signedUrl, expiresIn: SIGNED_URL_EXPIRES };
  }

  /**
   * Gate de permissão: ADMIN pode tudo, DIRECTOR só da própria empresa.
   */
  private assertCanManageLogo(user: AuthenticatedUser, empresaId: string): void {
    if (user.role === 'ADMIN') return;
    if (user.role === 'DIRECTOR' && user.empresaIds.includes(empresaId)) return;
    throw new ForbiddenException(
      'Apenas ADMIN ou DIRECTOR da empresa podem gerenciar o logo.',
    );
  }

  private extensionFor(filename: string, mime: string): string {
    const dot = filename.lastIndexOf('.');
    if (dot > 0 && dot < filename.length - 1) return filename.slice(dot + 1).toLowerCase();
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    return map[mime] ?? '';
  }
}
