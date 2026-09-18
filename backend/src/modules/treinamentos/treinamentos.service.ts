import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type {
  CreateTreinamentoDto,
  ListTreinamentosDto,
  UpdateTreinamentoDto,
  UploadUrlDto,
} from './treinamentos.dto';
import { urlDaMiniatura, urlDeEmbed } from './youtube-id.util';
import { TreinamentoArquivoService } from './treinamento-arquivo.service';

/**
 * Treinamentos internos — os vídeos que a empresa deixa pro funcionário.
 *
 * 📌 O vídeo não passa por aqui. Guardamos o ID do YouTube e montamos o embed;
 * o arquivo é servido por eles. Nosso servidor não carrega byte de vídeo, que é
 * exatamente o motivo da escolha.
 */
@Injectable()
export class TreinamentosService {
  private readonly logger = new Logger(TreinamentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly arquivos: TreinamentoArquivoService,
  ) {}

  private empresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  /**
   * A lista que a tela mostra, já com as URLs montadas.
   *
   * Montar aqui e não no front é de propósito: o dia em que a hospedagem mudar
   * (Storage com link assinado, por exemplo), a tela não muda junto.
   */
  async list(user: AuthenticatedUser, query: ListTreinamentosDto) {
    const empresaId = this.empresa(user);
    const where: Prisma.TreinamentoWhereInput = { empresaId };
    // Só a gestão enxerga o que está fora do ar — pro funcionário, treinamento
    // desativado simplesmente não existe.
    if (!query.incluirInativos || !this.podeGerenciar(user)) where.ativo = true;
    if (query.categoria) where.categoria = query.categoria;

    const itens = await this.prisma.treinamento.findMany({
      where,
      orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
      select: {
        id: true,
        titulo: true,
        descricao: true,
        fonte: true,
        youtubeId: true,
        arquivoPath: true,
        arquivoTamanho: true,
        categoria: true,
        ordem: true,
        ativo: true,
        criadoEm: true,
      },
    });

    // O link do arquivo é assinado e expira, então precisa ser gerado a cada
    // listagem — não dá pra guardar pronto no banco sem desfazer o motivo de a
    // fonte ARQUIVO existir.
    return Promise.all(
      itens.map(async (t) => ({
        ...t,
        urlEmbed: t.youtubeId ? urlDeEmbed(t.youtubeId) : null,
        // Arquivo próprio não tem miniatura: gerar uma exigiria decodificar o
        // vídeo no servidor, que é justamente o trabalho que não queremos.
        urlMiniatura: t.youtubeId ? urlDaMiniatura(t.youtubeId) : null,
        urlArquivo: t.arquivoPath ? await this.arquivos.urlParaAssistir(t.arquivoPath) : null,
      })),
    );
  }

  /** A permissão pro navegador subir o arquivo direto no Storage. */
  async permitirUpload(user: AuthenticatedUser, dados: UploadUrlDto) {
    return this.arquivos.permitirUpload(this.empresa(user), dados);
  }

  async create(user: AuthenticatedUser, dto: CreateTreinamentoDto) {
    const empresaId = this.empresa(user);
    // O DTO já garantiu que vem UMA das duas fontes, nunca as duas nem nenhuma.
    const doYoutube = !!dto.video;
    const criado = await this.prisma.treinamento.create({
      data: {
        empresaId,
        titulo: dto.titulo,
        descricao: dto.descricao,
        fonte: doYoutube ? 'YOUTUBE' : 'ARQUIVO',
        // O DTO já normalizou o link colado pro ID de 11 caracteres.
        youtubeId: dto.video ?? null,
        arquivoPath: dto.arquivoPath ?? null,
        arquivoTamanho: dto.arquivoTamanho ?? null,
        arquivoTipo: dto.arquivoTipo ?? null,
        categoria: dto.categoria,
        ordem: dto.ordem,
        criadoPorId: user.id,
      },
    });
    this.logger.log(
      `Treinamento "${criado.titulo}" cadastrado (${criado.fonte}: ${criado.youtubeId ?? criado.arquivoPath})`,
    );
    return {
      ...criado,
      urlEmbed: criado.youtubeId ? urlDeEmbed(criado.youtubeId) : null,
    };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTreinamentoDto) {
    const empresaId = this.empresa(user);
    await this.acharOuFalhar(empresaId, id);

    const data: Prisma.TreinamentoUpdateInput = {};
    if (dto.titulo !== undefined) data.titulo = dto.titulo;
    if (dto.descricao !== undefined) data.descricao = dto.descricao;
    if (dto.video !== undefined) data.youtubeId = dto.video;
    if (dto.categoria !== undefined) data.categoria = dto.categoria;
    if (dto.ordem !== undefined) data.ordem = dto.ordem;
    if (dto.ativo !== undefined) data.ativo = dto.ativo;

    const atualizado = await this.prisma.treinamento.update({ where: { id }, data });
    return {
      ...atualizado,
      urlEmbed: atualizado.youtubeId ? urlDeEmbed(atualizado.youtubeId) : null,
    };
  }

  /**
   * Remove de vez.
   *
   * Existe junto do `ativo: false` porque são coisas diferentes: desativar tira
   * da vista e mantém o registro; apagar é pra quando o vídeo foi cadastrado
   * errado e não deveria existir.
   */
  async remove(user: AuthenticatedUser, id: string) {
    const empresaId = this.empresa(user);
    const alvo = await this.acharOuFalhar(empresaId, id);
    await this.prisma.treinamento.delete({ where: { id } });
    // O registro sai primeiro: o arquivo é best-effort, e um órfão no bucket é
    // melhor que um treinamento que não some porque o Storage está fora do ar.
    if (alvo.arquivoPath) await this.arquivos.remover(alvo.arquivoPath);
    return { ok: true };
  }

  /** Busca SEMPRE filtrando por empresa — id sozinho atravessaria o tenant. */
  private async acharOuFalhar(empresaId: string, id: string) {
    const t = await this.prisma.treinamento.findFirst({
      where: { id, empresaId },
      select: { id: true, arquivoPath: true },
    });
    if (!t) throw new NotFoundException('Treinamento não encontrado', ErrorCode.NOT_FOUND);
    return t;
  }

  private podeGerenciar(user: AuthenticatedUser): boolean {
    return user.role === 'ADMIN' || user.role === 'DIRECTOR';
  }
}
