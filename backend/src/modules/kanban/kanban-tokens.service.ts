import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { gerarKanbanToken, hashKanbanToken } from './kanban-token.util';
import type { CreateApiTokenDto } from './kanban.dto';

/** Shape público do token (NUNCA inclui tokenHash nem o valor). */
const TOKEN_PUBLICO = {
  id: true,
  nome: true,
  ultimoUso: true,
  revogado: true,
  criadoEm: true,
} as const;

@Injectable()
export class KanbanTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera token de API. O VALOR aparece UMA única vez nesta resposta;
   * persistimos apenas o hash sha256 (spec Batch 6).
   */
  async create(user: AuthenticatedUser, dto: CreateApiTokenDto) {
    const empresaId = getCallerEmpresaId(user);
    const token = gerarKanbanToken();
    const registro = await this.prisma.kanbanApiToken.create({
      data: {
        usuarioId: user.id,
        empresaId,
        nome: dto.nome,
        tokenHash: hashKanbanToken(token),
      },
      select: TOKEN_PUBLICO,
    });
    return { ...registro, token }; // única vez que o valor sai
  }

  /** Lista os tokens do usuário (sem o valor). */
  async list(user: AuthenticatedUser) {
    return this.prisma.kanbanApiToken.findMany({
      where: { usuarioId: user.id },
      orderBy: { criadoEm: 'desc' },
      select: TOKEN_PUBLICO,
    });
  }

  /** Revoga (não apaga — mantém rastro de auditoria). Só o próprio dono. */
  async revogar(user: AuthenticatedUser, id: string): Promise<void> {
    const atualizados = await this.prisma.kanbanApiToken.updateMany({
      where: { id, usuarioId: user.id },
      data: { revogado: true },
    });
    if (atualizados.count === 0) throw new NotFoundException('Token', id);
  }
}
