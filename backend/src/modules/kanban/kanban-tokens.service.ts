import { Injectable } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { NotFoundException } from '@shared/errors/app-exception';
import { getCallerEmpresaId } from '@shared/utils/auth-context';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { gerarKanbanToken, hashKanbanToken } from './kanban-token.util';
import type { CreateApiTokenDto, UpdateApiTokenDto } from './kanban.dto';

/** Shape público do token (NUNCA inclui tokenHash nem o valor). */
const TOKEN_PUBLICO = {
  id: true,
  nome: true,
  escopo: true,
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
        // Default ['kanban'] mantém tokens antigos e o comportamento atual.
        escopo: dto.escopo ?? ['kanban'],
      },
      select: TOKEN_PUBLICO,
    });
    return { ...registro, token }; // única vez que o valor sai
  }

  /** Lista os tokens do usuário na empresa ativa (sem o valor). */
  async list(user: AuthenticatedUser) {
    // Filtra por empresa ativa: usuário multi-empresa não vê na empresa A
    // os tokens que criou na B.
    return this.prisma.kanbanApiToken.findMany({
      where: { usuarioId: user.id, empresaId: getCallerEmpresaId(user) },
      orderBy: { criadoEm: 'desc' },
      select: TOKEN_PUBLICO,
    });
  }

  /**
   * Ajusta o ESCOPO de um token que já existe — sem trocar o valor.
   *
   * Escopo novo (ex: `conhecimento`) obrigava a regerar o token, e regerar
   * significa reconfigurar o MCP em toda máquina que usa. Só o dono altera, e
   * só na empresa do token.
   */
  async atualizarEscopo(user: AuthenticatedUser, id: string, dto: UpdateApiTokenDto) {
    const atualizados = await this.prisma.kanbanApiToken.updateMany({
      where: { id, usuarioId: user.id, empresaId: getCallerEmpresaId(user) },
      data: { escopo: dto.escopo },
    });
    if (atualizados.count === 0) throw new NotFoundException('Token', id);
    return this.prisma.kanbanApiToken.findUniqueOrThrow({
      where: { id },
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
