import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type BotPrompt, type BotPromptVersao } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { empresaFilter, getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { CreateBotPromptDto, ListBotPromptsDto, UpdateBotPromptDto } from './bot-prompts.dto';
import { SubstituicaoInvalidaError, aplicarSubstituicoes } from './substituir-texto.util';

/**
 * Biblioteca de prompts do bot, por empresa (orquestração Fase A).
 *
 * Multi-tenant por design (tenant vem do JWT, nunca do body). Garante no
 * máximo 1 prompt `isPadrao` por empresa em código (não no schema, pra permitir
 * a troca atômica). O prompt padrão é o "prompt global" usado pelo bot quando
 * nenhum fluxo especifica outro (retrocompat da persona única — ver persona.service).
 */
@Injectable()
export class BotPromptsService {
  private readonly logger = new Logger(BotPromptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dono da biblioteca que ESTE usuario opera: REP = a dele (prompts do bot
   * pessoal); gestao = a da empresa (''). Derivado do papel, nunca de parametro
   * do request — o rep nao alcanca a biblioteca da empresa por aqui.
   */
  private escopoDe(user: AuthenticatedUser): string {
    return user.role === 'REP' ? user.id : '';
  }

  async list(user: AuthenticatedUser, params: ListBotPromptsDto): Promise<BotPrompt[]> {
    const where: Prisma.BotPromptWhereInput = {
      ...empresaFilter(user),
      usuarioId: this.escopoDe(user),
    };
    if (params.search) {
      where.nome = { contains: params.search, mode: 'insensitive' };
    }
    return this.prisma.botPrompt.findMany({
      where,
      orderBy: [{ isPadrao: 'desc' }, { nome: 'asc' }],
    });
  }

  /**
   * Detalhe do prompt + ONDE ele é usado.
   *
   * `usadoEm` não é enfeite: prompt compartilhado por mais de um fluxo muda o
   * comportamento dos DOIS quando alguém edita o texto. Sem essa lista, a única
   * forma de descobrir era abrir fluxo por fluxo procurando o `promptId`.
   */
  async findById(
    user: AuthenticatedUser,
    id: string,
  ): Promise<
    BotPrompt & {
      usadoEm: Array<{ fluxoId: string; fluxoNome: string; noTitulo: string; fluxoStatus: string }>;
    }
  > {
    const row = await this.prisma.botPrompt.findFirst({
      where: { id, ...empresaFilter(user), usuarioId: this.escopoDe(user) },
    });
    if (!row) throw new NotFoundException('Prompt', id);
    const nos = await this.prisma.fluxoNo
      .findMany({
        where: {
          config: { path: ['promptId'], equals: id },
          fluxo: { empresaId: row.empresaId },
        },
        select: {
          titulo: true,
          fluxo: { select: { id: true, nome: true, status: true } },
        },
      })
      .catch(() => []);
    return {
      ...row,
      usadoEm: nos.map((n) => ({
        fluxoId: n.fluxo.id,
        fluxoNome: n.fluxo.nome,
        fluxoStatus: n.fluxo.status,
        noTitulo: n.titulo,
      })),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateBotPromptDto): Promise<BotPrompt> {
    const empresaId = getCallerEmpresaId(user);
    const usuarioId = this.escopoDe(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Só 1 padrão por BIBLIOTECA (empresa OU bot pessoal de cada rep): ao
        // criar um novo padrão, desmarca os demais DO MESMO dono.
        if (dto.isPadrao) {
          await tx.botPrompt.updateMany({
            where: { empresaId, usuarioId, isPadrao: true },
            data: { isPadrao: false },
          });
        }
        return tx.botPrompt.create({ data: { ...dto, empresaId, usuarioId } });
      });
    } catch (err) {
      return this.rethrowUnique(err, dto.nome);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateBotPromptDto,
  ): Promise<BotPrompt & { tamanhoAntes?: number; tamanhoDepois?: number }> {
    const existing = await this.findById(user, id);

    // Edição por trecho: resolve pro texto final ANTES de qualquer escrita. Se
    // alguma substituição não casar exatamente uma vez, lança aqui e nada é
    // gravado — nem as substituições anteriores da mesma chamada.
    const { substituir, ...campos } = dto;
    let dados: Omit<UpdateBotPromptDto, 'substituir'> = campos;
    if (substituir?.length) {
      if (campos.texto !== undefined) {
        throw new BusinessRuleException(
          'Mande `texto` (substituição completa) OU `substituir` (edição por trecho), não os dois.',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      try {
        dados = { ...campos, texto: aplicarSubstituicoes(existing.texto, substituir) };
      } catch (err) {
        if (err instanceof SubstituicaoInvalidaError) {
          throw new BusinessRuleException(err.message, ErrorCode.BUSINESS_RULE_VIOLATION);
        }
        throw err;
      }
    }

    // Versiona só quando o CONTEÚDO muda (texto/modelo/temperatura) — spec §7.
    const conteudoMudou =
      (dados.texto !== undefined && dados.texto !== existing.texto) ||
      (dados.modelo !== undefined && dados.modelo !== existing.modelo) ||
      (dados.temperatura !== undefined && dados.temperatura !== existing.temperatura);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dados.isPadrao) {
          await tx.botPrompt.updateMany({
            where: {
              empresaId: existing.empresaId,
              usuarioId: existing.usuarioId,
              isPadrao: true,
              id: { not: id },
            },
            data: { isPadrao: false },
          });
        }
        if (conteudoMudou) {
          // Snapshot da versão ATUAL antes de sobrescrever (histórico/rollback).
          await tx.botPromptVersao.create({
            data: {
              promptId: id,
              versao: existing.versao,
              nome: existing.nome,
              texto: existing.texto,
              modelo: existing.modelo,
              temperatura: existing.temperatura,
            },
          });
        }
        await tx.botPrompt.update({
          where: { id },
          data: { ...dados, ...(conteudoMudou ? { versao: existing.versao + 1 } : {}) },
        });
        const salvo = await tx.botPrompt.findUniqueOrThrow({ where: { id } });
        // Tamanho antes/depois quando a edição foi por trecho: é como quem
        // editou confere que trocou o que queria sem baixar o prompt inteiro.
        return substituir?.length
          ? { ...salvo, tamanhoAntes: existing.texto.length, tamanhoDepois: salvo.texto.length }
          : salvo;
      });
    } catch (err) {
      return this.rethrowUnique(err, dto.nome);
    }
  }

  /** Histórico de versões de um prompt (mais recente primeiro). */
  async listarVersoes(user: AuthenticatedUser, id: string): Promise<BotPromptVersao[]> {
    await this.findById(user, id); // valida tenant
    return this.prisma.botPromptVersao.findMany({
      where: { promptId: id },
      orderBy: { versao: 'desc' },
    });
  }

  /** Restaura uma versão antiga (snapshota a atual antes de voltar). */
  async rollback(user: AuthenticatedUser, id: string, versao: number): Promise<BotPrompt> {
    const existing = await this.findById(user, id);
    const snap = await this.prisma.botPromptVersao.findUnique({
      where: { promptId_versao: { promptId: id, versao } },
    });
    if (!snap) throw new NotFoundException('Versão do prompt', String(versao));
    return this.prisma.$transaction(async (tx) => {
      await tx.botPromptVersao.create({
        data: {
          promptId: id,
          versao: existing.versao,
          nome: existing.nome,
          texto: existing.texto,
          modelo: existing.modelo,
          temperatura: existing.temperatura,
        },
      });
      await tx.botPrompt.update({
        where: { id },
        data: {
          texto: snap.texto,
          modelo: snap.modelo,
          temperatura: snap.temperatura,
          versao: existing.versao + 1,
        },
      });
      return tx.botPrompt.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Marca este prompt como o padrão da empresa (desmarcando o anterior). */
  async definirPadrao(user: AuthenticatedUser, id: string): Promise<BotPrompt> {
    const existing = await this.findById(user, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.botPrompt.updateMany({
        where: {
          empresaId: existing.empresaId,
          usuarioId: existing.usuarioId,
          isPadrao: true,
          id: { not: id },
        },
        data: { isPadrao: false },
      });
      await tx.botPrompt.update({ where: { id }, data: { isPadrao: true } });
      return tx.botPrompt.findUniqueOrThrow({ where: { id } });
    });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    await this.prisma.botPrompt.deleteMany({ where: { id, empresaId: existing.empresaId } });
  }

  // ─── Helpers internos (usados pelo bot / Fase B) ──────────────────────────

  /** Texto do prompt padrão ATIVO do dono ('' = biblioteca da empresa), ou null. */
  async obterTextoPadrao(empresaId: string, usuarioId = ''): Promise<string | null> {
    const row = await this.prisma.botPrompt.findFirst({
      where: { empresaId, usuarioId, isPadrao: true, ativo: true },
      select: { texto: true },
    });
    return row?.texto?.trim() || null;
  }

  /**
   * Texto de um prompt específico (null se inexistente/inativo/de outra empresa).
   * Não filtra por dono de propósito: quem chama por ID (nó de fluxo) escolheu o
   * prompt numa lista já escopada — e o id é opaco, não enumerável.
   */
  async obterTextoPorId(empresaId: string, promptId: string): Promise<string | null> {
    const row = await this.prisma.botPrompt.findFirst({
      where: { id: promptId, empresaId, ativo: true },
      select: { texto: true },
    });
    return row?.texto?.trim() || null;
  }

  private rethrowUnique(err: unknown, nome?: string): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BusinessRuleException(`Já existe um prompt com o nome "${nome}" nesta biblioteca`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
