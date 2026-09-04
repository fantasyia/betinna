import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { PropostaAnexo } from '@prisma/client';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PropostasService } from './propostas.service';

const BUCKET = 'proposta-anexos';
const MAX_BYTES = 20 * 1024 * 1024; // 20MB — projeto costuma ser PDF com plantas
const URL_EXPIRA_S = 60 * 60;
const MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/dxf',
  'image/vnd.dxf',
  'application/octet-stream', // DWG e afins chegam assim de vários navegadores
]);

interface ArquivoEntrada {
  filename: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * O PROJETO do cliente, anexado à proposta.
 *
 * Regra do Léo (04/09): a proposta **não sai pro cliente aprovar** sem o
 * projeto anexado. O que o cliente aprova é o projeto — onde entra cada
 * equipamento, em qual quadro —, e mandar só preço e prazo é pedir aprovação de
 * meia informação. Quem faz o projeto é o representante, e é ele quem anexa.
 *
 * Arquivo no Storage (bucket privado); aqui fica o metadado e a leitura sai por
 * link assinado, igual aos documentos de cliente.
 */
@Injectable()
export class PropostaAnexosService implements OnModuleInit {
  private readonly logger = new Logger(PropostaAnexosService.name);
  private readonly storage: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly propostas: PropostasService,
  ) {
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

  async list(user: AuthenticatedUser, propostaId: string): Promise<PropostaAnexo[]> {
    await this.propostas.findById(user, propostaId); // valida tenant + carteira
    return this.prisma.propostaAnexo.findMany({
      where: { propostaId },
      orderBy: { criadoEm: 'asc' },
    });
  }

  async upload(
    user: AuthenticatedUser,
    propostaId: string,
    arquivo: ArquivoEntrada,
  ): Promise<PropostaAnexo> {
    const proposta = await this.propostas.findById(user, propostaId);
    // Proposta já respondida é histórico: trocar o projeto depois do aceite
    // faria o app dizer que o cliente aprovou uma coisa que ele não viu.
    if (['ACEITA', 'RECUSADA'].includes(proposta.status)) {
      throw new BusinessRuleException(
        `Proposta ${proposta.status.toLowerCase()} — o projeto não pode mais ser trocado.`,
      );
    }
    if (arquivo.size > MAX_BYTES) {
      throw new BusinessRuleException(
        `Arquivo de ${(arquivo.size / 1024 / 1024).toFixed(1)}MB — o limite é 20MB.`,
      );
    }
    if (!MIMES.has(arquivo.mimetype)) {
      throw new BusinessRuleException(`Tipo de arquivo não aceito: ${arquivo.mimetype}`);
    }

    const limpo = arquivo.filename.replace(/[^\w.\-]+/g, '_').slice(-120);
    const caminho = `${proposta.empresaId}/${propostaId}/${Date.now()}-${limpo}`;
    const { error } = await this.storage.storage
      .from(BUCKET)
      .upload(caminho, arquivo.buffer, { contentType: arquivo.mimetype, upsert: false });
    if (error) throw new IntegrationException(`Falha ao subir o projeto: ${error.message}`);

    return this.prisma.propostaAnexo.create({
      data: {
        propostaId,
        nome: arquivo.filename.slice(-160),
        url: caminho,
        mime: arquivo.mimetype,
        tamanho: arquivo.size,
        criadoPor: user.id,
      },
    });
  }

  /** Link temporário — o bucket é privado (projeto é dado do cliente). */
  async download(
    user: AuthenticatedUser,
    propostaId: string,
    anexoId: string,
  ): Promise<{ url: string; nome: string; expiraEmSegundos: number }> {
    await this.propostas.findById(user, propostaId);
    const anexo = await this.prisma.propostaAnexo.findFirst({
      where: { id: anexoId, propostaId },
    });
    if (!anexo) throw new NotFoundException('Anexo', anexoId);

    const { data, error } = await this.storage.storage
      .from(BUCKET)
      .createSignedUrl(anexo.url, URL_EXPIRA_S);
    if (error || !data?.signedUrl) {
      throw new IntegrationException(`Falha ao gerar o link: ${error?.message ?? 'sem retorno'}`);
    }
    return { url: data.signedUrl, nome: anexo.nome, expiraEmSegundos: URL_EXPIRA_S };
  }

  async remove(user: AuthenticatedUser, propostaId: string, anexoId: string): Promise<void> {
    const proposta = await this.propostas.findById(user, propostaId);
    if (['ACEITA', 'RECUSADA'].includes(proposta.status)) {
      throw new BusinessRuleException(
        'Proposta já respondida — o projeto dela é histórico e não se apaga.',
      );
    }
    const anexo = await this.prisma.propostaAnexo.findFirst({ where: { id: anexoId, propostaId } });
    if (!anexo) throw new NotFoundException('Anexo', anexoId);

    const { error } = await this.storage.storage.from(BUCKET).remove([anexo.url]);
    if (error) this.logger.warn(`Arquivo não saiu do storage: ${error.message}`);
    await this.prisma.propostaAnexo.delete({ where: { id: anexoId } });
  }

  private async garantirBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.storage.storage.listBuckets();
      if (buckets?.some((b) => b.name === BUCKET)) return;
      const { error } = await this.storage.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_BYTES,
      });
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
