import { Injectable } from '@nestjs/common';
import type { NotaPrivada } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ClientesService } from './clientes.service';
import type { CreateNotaDto, UpdateNotaDto } from './notas-privadas.dto';

/**
 * Notas privadas por cliente.
 *
 * Regras:
 * - Cada nota pertence a um Usuario (autor) e a um Cliente.
 * - Apenas o autor pode editar/excluir sua própria nota.
 * - ADMIN/GERENTE podem listar todas as notas do cliente.
 * - REP só vê notas do cliente que esteja na sua carteira.
 */
@Injectable()
export class NotasPrivadasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientes: ClientesService,
  ) {}

  async list(user: AuthenticatedUser, clienteId: string): Promise<NotaPrivada[]> {
    // Garante acesso ao cliente (já valida tenant + rep filtering)
    await this.clientes.findById(user, clienteId);
    return this.prisma.notaPrivada.findMany({
      where: { clienteId },
      orderBy: { criadoEm: 'desc' },
    });
  }

  async create(
    user: AuthenticatedUser,
    clienteId: string,
    dto: CreateNotaDto,
  ): Promise<NotaPrivada> {
    await this.clientes.findById(user, clienteId);
    return this.prisma.notaPrivada.create({
      data: { clienteId, usuarioId: user.id, texto: dto.texto },
    });
  }

  async update(
    user: AuthenticatedUser,
    clienteId: string,
    notaId: string,
    dto: UpdateNotaDto,
  ): Promise<NotaPrivada> {
    await this.clientes.findById(user, clienteId);
    const nota = await this.prisma.notaPrivada.findFirst({
      where: { id: notaId, clienteId },
    });
    if (!nota) throw new NotFoundException('Nota', notaId);
    if (nota.usuarioId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Você só pode editar suas próprias notas',
        ErrorCode.FORBIDDEN,
      );
    }
    return this.prisma.notaPrivada.update({
      where: { id: notaId },
      data: { texto: dto.texto },
    });
  }

  async remove(user: AuthenticatedUser, clienteId: string, notaId: string): Promise<void> {
    await this.clientes.findById(user, clienteId);
    const nota = await this.prisma.notaPrivada.findFirst({
      where: { id: notaId, clienteId },
    });
    if (!nota) throw new NotFoundException('Nota', notaId);
    if (nota.usuarioId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Você só pode excluir suas próprias notas',
        ErrorCode.FORBIDDEN,
      );
    }
    await this.prisma.notaPrivada.delete({ where: { id: notaId } });
  }
}
