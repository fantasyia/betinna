import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type BotPrompt, type BotPromptVersao } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { empresaFilter, getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { CreateBotPromptDto, ListBotPromptsDto, UpdateBotPromptDto } from './bot-prompts.dto';

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

  async list(user: AuthenticatedUser, params: ListBotPromptsDto): Promise<BotPrompt[]> {
    const where: Prisma.BotPromptWhereInput = { ...empresaFilter(user) };
    if (params.search) {
      where.nome = { contains: params.search, mode: 'insensitive' };
    }
    return this.prisma.botPrompt.findMany({
      where,
      orderBy: [{ isPadrao: 'desc' }, { nome: 'asc' }],
    });
  }

  async findById(user: AuthenticatedUser, id: string): Promise<BotPrompt> {
    const row = await this.prisma.botPrompt.findFirst({ where: { id, ...empresaFilter(user) } });
    if (!row) throw new NotFoundException('Prompt', id);
    return row;
  }

  async create(user: AuthenticatedUser, dto: CreateBotPromptDto): Promise<BotPrompt> {
    const empresaId = getCallerEmpresaId(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Só 1 padrão por empresa: ao criar um novo padrão, desmarca os demais.
        if (dto.isPadrao) {
          await tx.botPrompt.updateMany({
            where: { empresaId, isPadrao: true },
            data: { isPadrao: false },
          });
        }
        return tx.botPrompt.create({ data: { ...dto, empresaId } });
      });
    } catch (err) {
      return this.rethrowUnique(err, dto.nome);
    }
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateBotPromptDto): Promise<BotPrompt> {
    const existing = await this.findById(user, id);
    // Versiona só quando o CONTEÚDO muda (texto/modelo/temperatura) — spec §7.
    const conteudoMudou =
      (dto.texto !== undefined && dto.texto !== existing.texto) ||
      (dto.modelo !== undefined && dto.modelo !== existing.modelo) ||
      (dto.temperatura !== undefined && dto.temperatura !== existing.temperatura);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.isPadrao) {
          await tx.botPrompt.updateMany({
            where: { empresaId: existing.empresaId, isPadrao: true, id: { not: id } },
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
          data: { ...dto, ...(conteudoMudou ? { versao: existing.versao + 1 } : {}) },
        });
        return tx.botPrompt.findUniqueOrThrow({ where: { id } });
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
        where: { empresaId: existing.empresaId, isPadrao: true, id: { not: id } },
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

  /** Texto do prompt padrão ATIVO da empresa, ou null se não houver. */
  async obterTextoPadrao(empresaId: string): Promise<string | null> {
    const row = await this.prisma.botPrompt.findFirst({
      where: { empresaId, isPadrao: true, ativo: true },
      select: { texto: true },
    });
    return row?.texto?.trim() || null;
  }

  /** Texto de um prompt específico da empresa (null se inexistente/inativo/de outra empresa). */
  async obterTextoPorId(empresaId: string, promptId: string): Promise<string | null> {
    const row = await this.prisma.botPrompt.findFirst({
      where: { id: promptId, empresaId, ativo: true },
      select: { texto: true },
    });
    return row?.texto?.trim() || null;
  }

  private rethrowUnique(err: unknown, nome?: string): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BusinessRuleException(`Já existe um prompt com o nome "${nome}" nesta empresa`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
