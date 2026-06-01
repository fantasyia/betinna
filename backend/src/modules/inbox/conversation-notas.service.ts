import { Injectable } from '@nestjs/common';
import type { ConversationNota } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { InboxService } from './inbox.service';

const autorSelect = { usuario: { select: { id: true, nome: true } } };

/**
 * #25 — Notas internas + tags de triagem por conversa.
 *
 * Regras (espelham NotaPrivada do cliente):
 * - Acesso à conversa é validado por `InboxService.findById` (tenant + carteira REP).
 * - Notas pertencem ao autor; só o autor (ou ADMIN) edita/exclui a própria.
 * - Tags internas são livres (triagem), visíveis só pra equipe — nunca vão pro cliente.
 */
@Injectable()
export class ConversationNotasService {
  private static readonly MAX_TAGS = 12;
  private static readonly MAX_TAG_LEN = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  async listar(user: AuthenticatedUser, conversationId: string): Promise<ConversationNota[]> {
    await this.inbox.findById(user, conversationId); // valida acesso (lança se fora de escopo)
    return this.prisma.conversationNota.findMany({
      where: { conversationId },
      orderBy: { criadoEm: 'desc' },
      include: autorSelect,
    });
  }

  async criar(
    user: AuthenticatedUser,
    conversationId: string,
    texto: string,
  ): Promise<ConversationNota> {
    await this.inbox.findById(user, conversationId);
    return this.prisma.conversationNota.create({
      data: { conversationId, usuarioId: user.id, texto },
      include: autorSelect,
    });
  }

  async editar(
    user: AuthenticatedUser,
    conversationId: string,
    notaId: string,
    texto: string,
  ): Promise<ConversationNota> {
    await this.inbox.findById(user, conversationId);
    const nota = await this.prisma.conversationNota.findFirst({
      where: { id: notaId, conversationId },
    });
    if (!nota) throw new NotFoundException('Nota', notaId);
    this.assertAutorOuAdmin(user, nota.usuarioId, 'editar');
    return this.prisma.conversationNota.update({
      where: { id: notaId },
      data: { texto },
      include: autorSelect,
    });
  }

  async remover(
    user: AuthenticatedUser,
    conversationId: string,
    notaId: string,
  ): Promise<{ ok: true }> {
    await this.inbox.findById(user, conversationId);
    const nota = await this.prisma.conversationNota.findFirst({
      where: { id: notaId, conversationId },
    });
    if (!nota) throw new NotFoundException('Nota', notaId);
    this.assertAutorOuAdmin(user, nota.usuarioId, 'excluir');
    await this.prisma.conversationNota.delete({ where: { id: notaId } });
    return { ok: true };
  }

  /** Substitui as tags internas da conversa pelo conjunto normalizado. */
  async definirTags(
    user: AuthenticatedUser,
    conversationId: string,
    tags: string[],
  ): Promise<{ tagsInternas: string[] }> {
    await this.inbox.findById(user, conversationId);
    const normalizadas = this.normalizarTags(tags);
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { tagsInternas: normalizadas },
      select: { tagsInternas: true },
    });
    return { tagsInternas: conv.tagsInternas };
  }

  private assertAutorOuAdmin(user: AuthenticatedUser, autorId: string, acao: string): void {
    if (autorId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException(`Você só pode ${acao} suas próprias notas`, ErrorCode.FORBIDDEN);
    }
  }

  /** trim + remove vazias + corta tamanho + dedupe case-insensitive + teto de quantidade. */
  private normalizarTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
      const t = raw.trim().slice(0, ConversationNotasService.MAX_TAG_LEN);
      if (!t) continue;
      const chave = t.toLowerCase();
      if (seen.has(chave)) continue;
      seen.add(chave);
      out.push(t);
      if (out.length >= ConversationNotasService.MAX_TAGS) break;
    }
    return out;
  }
}
