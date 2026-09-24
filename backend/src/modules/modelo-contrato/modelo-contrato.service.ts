import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import {
  AppException,
  ForbiddenException,
  IntegrationException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { carregarModelo } from '@modules/propostas/contrato-documento.util';
import { validarModelo } from './modelo-contrato.util';

const BUCKET = 'contratos-modelos';

/** Recusa com a LISTA de problemas em `details` — a tela mostra um por linha. */
function recusado(titulo: string, problemas: string[]): AppException {
  return new AppException(
    ErrorCode.BUSINESS_RULE_VIOLATION,
    `${titulo}: ${problemas.join('; ')}`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    problemas.map((message) => ({ message })),
  );
}
const NOME_PADRAO = 'proposta-contrato-anexo-i.docx';

/** Um arquivo pra baixar — o .docx cabe no JSON (≤ 14 MB, ação rara). */
export interface ArquivoModelo {
  nome: string;
  conteudoBase64: string;
}

/** O modelo que um contrato vai usar AGORA, e de onde ele veio. */
export interface ModeloEmUso {
  arquivo: Buffer;
  /** `null` = o modelo do repositório (nenhuma versão ativa). */
  versao: number | null;
}

/**
 * Modelos do contrato subidos pela tela (Léo, 24/09) — sem deploy.
 *
 * Três regras que seguram tudo:
 * 1. Só entra versão que PASSA na validação (`validarModelo`) — recusada, não
 *    vira opção. E ela é refeita na ATIVAÇÃO: regra que mudou depois do upload
 *    não deixa passar um modelo antigo.
 * 2. Nada é apagado: toda versão fica, porque o contrato registra qual usou.
 * 3. Sem versão ativa vale o modelo do repositório — nunca fica sem contrato.
 *    Mas se HÁ versão ativa e ela não pode ser lida, o envio FALHA: cair pro
 *    padrão em silêncio mandaria um texto diferente do que o diretor ativou.
 */
@Injectable()
export class ModeloContratoService implements OnModuleInit {
  private readonly logger = new Logger(ModeloContratoService.name);
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

  /** Fire-and-forget: bucket que falta não pode travar o boot da API. */
  onModuleInit(): void {
    void this.garantirBucket();
  }

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  async listar(user: AuthenticatedUser) {
    const empresaId = this.empresa(user);
    const versoes = await this.prisma.modeloContrato.findMany({
      where: { empresaId },
      orderBy: { versao: 'desc' },
      select: {
        id: true,
        versao: true,
        nomeArquivo: true,
        tamanhoBytes: true,
        ativo: true,
        observacao: true,
        criadoEm: true,
        ativadoEm: true,
        enviadoPorId: true,
        ativadoPorId: true,
      },
    });
    const ids = [
      ...new Set(versoes.flatMap((v) => [v.enviadoPorId, v.ativadoPorId]).filter(Boolean)),
    ] as string[];
    const nomes = new Map(
      (ids.length
        ? await this.prisma.usuario.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true },
          })
        : []
      ).map((u) => [u.id, u.nome]),
    );
    return {
      // Qual está valendo AGORA — a pergunta que a tela responde primeiro.
      emUso: versoes.find((v) => v.ativo)?.versao ?? null,
      padrao: { nome: NOME_PADRAO, tamanhoBytes: carregarModelo().length },
      versoes: versoes.map((v) => ({
        ...v,
        enviadoPor: v.enviadoPorId ? (nomes.get(v.enviadoPorId) ?? null) : null,
        ativadoPor: v.ativadoPorId ? (nomes.get(v.ativadoPorId) ?? null) : null,
      })),
    };
  }

  /**
   * Sobe uma versão NOVA (inativa). Recusa com a lista de problemas se o
   * arquivo estragaria o contrato — ver `validarModelo`.
   */
  async enviar(
    user: AuthenticatedUser,
    dto: { nomeArquivo: string; conteudoBase64: string; observacao?: string },
  ) {
    const empresaId = this.empresa(user);
    const arquivo = Buffer.from(dto.conteudoBase64, 'base64');
    const v = validarModelo(arquivo);
    if (!v.ok) {
      throw recusado('O modelo não foi aceito', v.problemas);
    }

    const sha256 = createHash('sha256').update(arquivo).digest('hex');
    const ultima = await this.prisma.modeloContrato.findFirst({
      where: { empresaId },
      orderBy: { versao: 'desc' },
      select: { versao: true },
    });
    const versao = (ultima?.versao ?? 0) + 1;
    const storagePath = `${empresaId}/v${versao}-${sha256.slice(0, 12)}.docx`;

    const { error } = await this.storage.storage.from(BUCKET).upload(storagePath, arquivo, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false,
    });
    if (error) {
      throw new IntegrationException(
        `Não consegui guardar o modelo: ${error.message}`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }

    // Corrida de dois uploads na mesma empresa: o unique (empresaId, versao)
    // recusa o segundo — melhor um erro claro que duas "versão 3".
    return this.prisma.modeloContrato.create({
      data: {
        empresaId,
        versao,
        nomeArquivo: dto.nomeArquivo.slice(0, 200),
        storagePath,
        tamanhoBytes: arquivo.length,
        sha256,
        observacao: dto.observacao?.trim() || null,
        enviadoPorId: user.id,
      },
    });
  }

  /** Passa a valer ESTA versão (e só ela). Revalida antes. */
  async ativar(user: AuthenticatedUser, id: string) {
    const empresaId = this.empresa(user);
    const modelo = await this.prisma.modeloContrato.findFirst({ where: { id, empresaId } });
    if (!modelo) throw new NotFoundException('Modelo de contrato', id);

    const v = validarModelo(await this.baixar(modelo.storagePath));
    if (!v.ok) {
      throw recusado('Esta versão não passa mais na validação', v.problemas);
    }

    await this.prisma.$transaction([
      this.prisma.modeloContrato.updateMany({
        where: { empresaId, ativo: true },
        data: { ativo: false },
      }),
      this.prisma.modeloContrato.update({
        where: { id },
        data: { ativo: true, ativadoPorId: user.id, ativadoEm: new Date() },
      }),
    ]);
    return { emUso: modelo.versao };
  }

  /** Volta pro modelo do repositório (nenhuma versão ativa). Não apaga nada. */
  async voltarAoPadrao(user: AuthenticatedUser) {
    const empresaId = this.empresa(user);
    await this.prisma.modeloContrato.updateMany({
      where: { empresaId, ativo: true },
      data: { ativo: false },
    });
    return { emUso: null };
  }

  /** O .docx de uma versão (ou do padrão), pra editar no Word. */
  async arquivo(user: AuthenticatedUser, id: string | 'padrao'): Promise<ArquivoModelo> {
    if (id === 'padrao') {
      return { nome: NOME_PADRAO, conteudoBase64: carregarModelo().toString('base64') };
    }
    const modelo = await this.daEmpresa(user, id);
    return {
      nome: `contrato-v${modelo.versao}.docx`,
      conteudoBase64: (await this.baixar(modelo.storagePath)).toString('base64'),
    };
  }

  /** A versão preenchida com a proposta de exemplo (40 quadros) — pra conferir. */
  async exemplo(user: AuthenticatedUser, id: string | 'padrao'): Promise<ArquivoModelo> {
    const arquivo =
      id === 'padrao'
        ? carregarModelo()
        : await this.baixar((await this.daEmpresa(user, id)).storagePath);
    const v = validarModelo(arquivo);
    if (!v.ok) {
      throw recusado('Não dá pra gerar o exemplo', v.problemas);
    }
    const nome = id === 'padrao' ? 'exemplo-padrao.docx' : `exemplo-${id}.docx`;
    return { nome, conteudoBase64: v.exemplo.toString('base64') };
  }

  /**
   * O modelo que o contrato desta empresa usa AGORA.
   *
   * ⛔ Versão ativa ilegível ESTOURA — não cai pro padrão. Quem chama (aceite,
   * reenvio) transforma o erro em motivo e avisa o responsável.
   */
  async emUso(empresaId: string): Promise<ModeloEmUso> {
    const ativo = await this.prisma.modeloContrato.findFirst({
      where: { empresaId, ativo: true },
      select: { versao: true, storagePath: true },
    });
    if (!ativo) return { arquivo: carregarModelo(), versao: null };
    return { arquivo: await this.baixar(ativo.storagePath), versao: ativo.versao };
  }

  private async daEmpresa(user: AuthenticatedUser, id: string) {
    const modelo = await this.prisma.modeloContrato.findFirst({
      where: { id, empresaId: this.empresa(user) },
    });
    if (!modelo) throw new NotFoundException('Modelo de contrato', id);
    return modelo;
  }

  private async baixar(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.storage.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      throw new IntegrationException(
        `Não consegui ler o modelo guardado (${error?.message ?? 'vazio'})`,
        ErrorCode.INTEGRATION_ERROR,
      );
    }
    return Buffer.from(await data.arrayBuffer());
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
