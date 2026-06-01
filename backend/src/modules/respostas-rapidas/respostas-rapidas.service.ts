import { Injectable } from '@nestjs/common';
import type { RespostaRapida } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { UpsertRespostaDto } from './respostas-rapidas.dto';

/**
 * Sprint 2.3 — Respostas rápidas / templates da Inbox.
 *
 * Cada usuário vê os templates GLOBAIS da empresa + os PRÓPRIOS privados.
 * Só ADMIN/DIRECTOR criam/editam templates globais; os demais criam privados.
 */
@Injectable()
export class RespostasRapidasService {
  constructor(private readonly prisma: PrismaService) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    const id = user.empresaIdAtiva ?? user.empresaIds?.[0];
    if (!id) throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    return id;
  }

  private podeGlobal(user: AuthenticatedUser): boolean {
    return user.role === 'ADMIN' || user.role === 'DIRECTOR';
  }

  /** Globais da empresa + privados do próprio usuário. */
  async list(user: AuthenticatedUser): Promise<RespostaRapida[]> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.respostaRapida.findMany({
      where: { empresaId, OR: [{ global: true }, { criadoPorId: user.id }] },
      orderBy: [{ global: 'desc' }, { titulo: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: UpsertRespostaDto): Promise<RespostaRapida> {
    const empresaId = this.requireEmpresa(user);
    return this.prisma.respostaRapida.create({
      data: {
        empresaId,
        criadoPorId: user.id,
        titulo: dto.titulo,
        atalho: this.normalizarAtalho(dto.atalho),
        conteudo: dto.conteudo,
        categoria: dto.categoria ?? null,
        // GERENTE/SAC/REP que pedem global → forçado privado.
        global: dto.global && this.podeGlobal(user),
      },
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpsertRespostaDto,
  ): Promise<RespostaRapida> {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.respostaRapida.findFirst({ where: { id, empresaId } });
    if (!row) throw new NotFoundException('Resposta rápida', id);
    this.assertPodeEditar(user, row);
    return this.prisma.respostaRapida.update({
      where: { id },
      data: {
        titulo: dto.titulo,
        atalho: this.normalizarAtalho(dto.atalho),
        conteudo: dto.conteudo,
        categoria: dto.categoria ?? null,
        global: dto.global && this.podeGlobal(user),
      },
    });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<{ ok: true }> {
    const empresaId = this.requireEmpresa(user);
    const row = await this.prisma.respostaRapida.findFirst({ where: { id, empresaId } });
    if (!row) throw new NotFoundException('Resposta rápida', id);
    this.assertPodeEditar(user, row);
    await this.prisma.respostaRapida.delete({ where: { id } });
    return { ok: true };
  }

  /** Quem pode editar/apagar: dono do template, ou ADMIN/DIRECTOR (pros globais). */
  private assertPodeEditar(user: AuthenticatedUser, row: RespostaRapida): void {
    const ehDono = row.criadoPorId === user.id;
    if (row.global && !this.podeGlobal(user)) {
      throw new ForbiddenException(
        'Só DIRETOR/ADMIN edita templates da empresa',
        ErrorCode.FORBIDDEN,
      );
    }
    if (!row.global && !ehDono && !this.podeGlobal(user)) {
      throw new ForbiddenException(
        'Você só pode editar os seus próprios templates',
        ErrorCode.FORBIDDEN,
      );
    }
  }

  /** Garante que o atalho começa com "/" (ex: "obrigado" → "/obrigado"). */
  private normalizarAtalho(atalho: string): string {
    const t = atalho.trim().replace(/\s+/g, '');
    return t.startsWith('/') ? t : `/${t}`;
  }
}
