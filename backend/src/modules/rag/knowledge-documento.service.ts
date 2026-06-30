import { Injectable, Logger } from '@nestjs/common';
import type { KnowledgeDocumento } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { WhatsAppMediaService } from '@integrations/whatsapp/whatsapp-media.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { dividirEmChunks, extrairTexto } from './documento-extracao.util';
import { IndexacaoService } from './indexacao.service';
import type { CreateKnowledgeDocumentoDto, UpdateKnowledgeDocumentoDto } from './knowledge.dto';

/**
 * Documentos da base de conhecimento (PDF/DOCX/TXT/…). Fluxo de ingestão:
 *   1. sobe o arquivo original no Storage (pra o bot poder ENVIAR depois, se podeEnviar);
 *   2. extrai o texto e quebra em N KnowledgeChunk (fonte=MATERIAL, documentoId=doc.id);
 *   3. enfileira a indexação semântica de cada chunk.
 *
 * Extração é best-effort: se o arquivo não tem texto (PDF escaneado), o doc fica
 * salvo com `erroExtracao` — ainda serve pra ENVIO, só não vira fonte de busca.
 */
@Injectable()
export class KnowledgeDocumentoService {
  private readonly logger = new Logger(KnowledgeDocumentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexacao: IndexacaoService,
    private readonly media: WhatsAppMediaService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  async listar(user: AuthenticatedUser): Promise<KnowledgeDocumento[]> {
    return this.prisma.knowledgeDocumento.findMany({
      where: { empresaId: this.requireEmpresa(user) },
      orderBy: { criadoEm: 'desc' },
    });
  }

  async criar(
    user: AuthenticatedUser,
    dto: CreateKnowledgeDocumentoDto,
  ): Promise<KnowledgeDocumento> {
    const empresaId = this.requireEmpresa(user);
    const buffer = Buffer.from(dto.dataBase64, 'base64');
    if (buffer.length === 0) {
      throw new BusinessRuleException('Arquivo vazio', ErrorCode.BUSINESS_RULE_VIOLATION);
    }

    const storagePath = await this.media.uploadOutbound(
      empresaId,
      'conhecimento',
      buffer,
      dto.mimetype,
    );
    if (!storagePath) {
      throw new BusinessRuleException(
        'Falha ao salvar o arquivo (tamanho acima de 20MB ou Storage indisponível)',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    const doc = await this.prisma.knowledgeDocumento.create({
      data: {
        empresaId,
        titulo: dto.titulo,
        storagePath,
        mimetype: dto.mimetype,
        fileName: dto.fileName,
        tamanhoBytes: buffer.length,
        podeEnviar: dto.podeEnviar ?? false,
      },
    });

    await this.indexarDocumento(doc, buffer);
    return this.prisma.knowledgeDocumento.findUniqueOrThrow({ where: { id: doc.id } });
  }

  /** Extrai texto → chunks → KnowledgeChunk + enfileira indexação. Erros não derrubam o doc. */
  private async indexarDocumento(doc: KnowledgeDocumento, buffer: Buffer): Promise<void> {
    try {
      const texto = await extrairTexto(buffer, doc.mimetype, doc.fileName);
      const chunks = dividirEmChunks(texto);
      if (chunks.length === 0) {
        await this.prisma.knowledgeDocumento.update({
          where: { id: doc.id },
          data: {
            totalChunks: 0,
            erroExtracao:
              'Sem texto extraível — PDF escaneado/imagem? O arquivo pode ser enviado, mas não vira fonte de busca.',
          },
        });
        return;
      }
      for (let i = 0; i < chunks.length; i++) {
        const chunk = await this.prisma.knowledgeChunk.create({
          data: {
            empresaId: doc.empresaId,
            fonte: 'MATERIAL',
            documentoId: doc.id,
            categoria: 'documento',
            titulo:
              chunks.length > 1 ? `${doc.titulo} (trecho ${i + 1}/${chunks.length})` : doc.titulo,
            conteudo: chunks[i],
            ativo: true,
          },
        });
        await this.indexacao.enfileirarChunk(chunk.id, doc.empresaId);
      }
      await this.prisma.knowledgeDocumento.update({
        where: { id: doc.id },
        data: { totalChunks: chunks.length, erroExtracao: null },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao extrair/indexar documento ${doc.id} (${doc.fileName}): ${msg}`);
      await this.prisma.knowledgeDocumento.update({
        where: { id: doc.id },
        data: { totalChunks: 0, erroExtracao: `Falha na extração: ${msg}`.slice(0, 300) },
      });
    }
  }

  async atualizar(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateKnowledgeDocumentoDto,
  ): Promise<KnowledgeDocumento> {
    const empresaId = this.requireEmpresa(user);
    const existing = await this.prisma.knowledgeDocumento.findFirst({ where: { id, empresaId } });
    if (!existing) throw new NotFoundException('Documento', id);
    await this.prisma.knowledgeDocumento.update({
      where: { id },
      data: { titulo: dto.titulo, podeEnviar: dto.podeEnviar },
    });
    // Renomear o doc renomeia os chunks (mantém o "(trecho N/M)" coerente via re-fetch).
    if (dto.titulo && dto.titulo !== existing.titulo) {
      await this.renomearChunks(id, dto.titulo);
    }
    return this.prisma.knowledgeDocumento.findUniqueOrThrow({ where: { id } });
  }

  private async renomearChunks(documentoId: string, titulo: string): Promise<void> {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { documentoId },
      select: { id: true },
      orderBy: { criadoEm: 'asc' },
    });
    const total = chunks.length;
    await Promise.all(
      chunks.map((c, i) =>
        this.prisma.knowledgeChunk.update({
          where: { id: c.id },
          data: { titulo: total > 1 ? `${titulo} (trecho ${i + 1}/${total})` : titulo },
        }),
      ),
    );
  }

  async remover(user: AuthenticatedUser, id: string): Promise<void> {
    const empresaId = this.requireEmpresa(user);
    const doc = await this.prisma.knowledgeDocumento.findFirst({ where: { id, empresaId } });
    if (!doc) throw new NotFoundException('Documento', id);
    // Cascade no schema apaga os KnowledgeChunk vinculados.
    await this.prisma.knowledgeDocumento.delete({ where: { id } });
    // Storage é best-effort (remover não lança): falha não bloqueia a remoção lógica.
    await this.media.remover(doc.storagePath);
  }
}
