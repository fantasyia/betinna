import { createHash } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { IntegrationException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

const BUCKET = 'contratos-previa';
const TIPOS = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;
const URL_EXPIRA_S = 10 * 60;

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/**
 * O contrato CONGELADO no link de aceite (Léo, 25/09: "o contrato é o mesmo").
 *
 * O cliente lê o contrato na página de aceite antes de aprovar — e o que ele lê
 * tem que ser o MESMO arquivo que vai pra ClickSign quando ele aprova. Montar de
 * novo no aprovar não serve: a data de emissão, o modelo em uso ou um dado da
 * proposta podem ter mudado no meio, e ele assinaria um texto que não leu.
 *
 * Por isso o .docx é montado UMA vez, ao gerar o link, e guardado aqui com o
 * sha256. No aprovar, sai ESTE arquivo — conferido pelo hash.
 *
 * O PDF do "Levantamento técnico de projeto" mora aqui também, pela mesma
 * regra: congela junto, e é ele que vai anexado no envelope.
 */
@Injectable()
export class ContratoPreviaService implements OnModuleInit {
  private readonly logger = new Logger(ContratoPreviaService.name);
  private readonly storage: SupabaseClient;

  constructor(private readonly env: EnvService) {
    this.storage = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /** Fire-and-forget: bucket que falta não pode travar o boot. */
  onModuleInit(): void {
    void this.garantirBucket();
  }

  async salvar(
    empresaId: string,
    propostaId: string,
    arquivo: Buffer,
    tipo: keyof typeof TIPOS = 'docx',
  ): Promise<{ path: string; sha256: string }> {
    const path = `${empresaId}/${propostaId}/${Date.now()}.${tipo}`;
    const { error } = await this.storage.storage.from(BUCKET).upload(path, arquivo, {
      contentType: TIPOS[tipo],
      upsert: false,
    });
    if (error) {
      throw new IntegrationException(
        `Não consegui guardar o contrato da proposta (${error.message})`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return { path, sha256: sha256(arquivo) };
  }

  async baixar(path: string): Promise<Buffer> {
    const { data, error } = await this.storage.storage.from(BUCKET).download(path);
    if (error || !data) {
      throw new IntegrationException(
        `Não consegui ler o contrato guardado (${error?.message ?? 'vazio'})`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /** Link temporário do arquivo — o bucket é privado (contrato é dado do cliente). */
  async linkAssinado(path: string): Promise<string> {
    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(path, URL_EXPIRA_S);
    if (error || !data?.signedUrl) {
      throw new IntegrationException(
        `Falha ao gerar o link do contrato: ${error?.message ?? 'sem retorno'}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return data.signedUrl;
  }

  private async garantirBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (buckets?.some((b) => b.name === BUCKET)) return;
      const { error } = await this.storage.storage.createBucket(BUCKET, { public: false });
      if (error && !error.message.includes('already exists')) {
        this.logger.error(`Falha ao criar bucket ${BUCKET}: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(
        `Bucket ${BUCKET} indisponível: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
