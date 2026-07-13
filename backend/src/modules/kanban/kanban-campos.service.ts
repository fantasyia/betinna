import { Injectable } from '@nestjs/common';
import type { KanbanCampoPersonalizado } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanAcessoService } from './kanban-acesso.service';
import { KanbanAtividadeService } from './kanban-atividade.service';
import type { CreateCampoDto, SetCampoValorDto, UpdateCampoDto } from './kanban.dto';

@Injectable()
export class KanbanCamposService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acesso: KanbanAcessoService,
    private readonly atividade: KanbanAtividadeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    boardId: string,
    dto: CreateCampoDto,
  ): Promise<KanbanCampoPersonalizado> {
    const board = await this.acesso.verificarAcessoBoard(user, boardId);
    const campo = await this.prisma.kanbanCampoPersonalizado.create({
      data: {
        boardId: board.id,
        nome: dto.nome,
        tipo: dto.tipo,
        opcoes: dto.tipo === 'lista_opcoes' ? dto.opcoes : undefined,
      },
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'campo_criado',
      dados: { campoId: campo.id, nome: campo.nome, tipo: campo.tipo },
    });
    return campo;
  }

  async update(
    user: AuthenticatedUser,
    campoId: string,
    dto: UpdateCampoDto,
  ): Promise<KanbanCampoPersonalizado> {
    const board = await this.acesso.verificarAcessoPorCampo(user, campoId);
    const antes = await this.prisma.kanbanCampoPersonalizado.findUniqueOrThrow({
      where: { id: campoId },
    });
    if (dto.opcoes && antes.tipo !== 'lista_opcoes') {
      throw new BusinessRuleException('Apenas campos do tipo lista_opcoes têm "opcoes"');
    }
    const campo = await this.prisma.kanbanCampoPersonalizado.update({
      where: { id: campoId },
      data: dto,
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'campo_atualizado',
      dados: { campoId, campos: Object.keys(dto) },
    });
    return campo;
  }

  async remove(user: AuthenticatedUser, campoId: string): Promise<void> {
    const board = await this.acesso.verificarAcessoPorCampo(user, campoId);
    const campo = await this.prisma.kanbanCampoPersonalizado.delete({ where: { id: campoId } });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'campo_removido',
      dados: { nome: campo.nome },
    });
  }

  /**
   * Define (upsert) o valor do campo num card. `valor: null` limpa o valor.
   * Valida o valor conforme o tipo do campo.
   */
  async setValor(user: AuthenticatedUser, cardId: string, campoId: string, dto: SetCampoValorDto) {
    const { board, card } = await this.acesso.verificarAcessoPorCard(user, cardId);
    const campo = await this.prisma.kanbanCampoPersonalizado.findFirst({
      where: { id: campoId, boardId: board.id },
    });
    if (!campo) throw new NotFoundException('Campo personalizado', campoId);

    if (dto.valor === null) {
      await this.prisma.kanbanCampoValor.deleteMany({ where: { campoId, cardId: card.id } });
      await this.atividade.registrar({
        boardId: board.id,
        usuarioId: user.id,
        tipo: 'campo_valor_removido',
        cardId,
        dados: { campoNome: campo.nome },
      });
      await this.espelharCampoValor(cardId, campo, null);
      return { campoId, cardId: card.id, valor: null };
    }

    const valor = this.validarValor(campo, dto.valor);
    const registro = await this.prisma.kanbanCampoValor.upsert({
      where: { campoId_cardId: { campoId, cardId: card.id } },
      create: { campoId, cardId: card.id, valor },
      update: { valor },
      include: { campo: true },
    });
    await this.atividade.registrar({
      boardId: board.id,
      usuarioId: user.id,
      tipo: 'campo_valor_definido',
      cardId,
      dados: { campoNome: campo.nome, valor },
    });
    await this.espelharCampoValor(cardId, campo, valor);
    return registro;
  }

  /**
   * Espelha o valor de um campo personalizado nos DEMAIS cards do par de espelho.
   * Campo pertence ao quadro, então casa por (nome, tipo): reaproveita/cria um
   * campo equivalente no quadro do outro card e replica (ou limpa) o valor.
   * Best-effort — não derruba a operação principal.
   */
  private async espelharCampoValor(
    cardIdAtual: string,
    campo: KanbanCampoPersonalizado,
    valor: string | number | boolean | null,
  ): Promise<void> {
    try {
      const grupo = await this.acesso.cardsDoGrupo(cardIdAtual);
      const outros = await this.prisma.kanbanCard.findMany({
        where: { id: { in: grupo.filter((id) => id !== cardIdAtual) } },
        select: { id: true, lista: { select: { boardId: true } } },
      });
      for (const outro of outros) {
        const boardId = outro.lista.boardId;
        let equivalente = await this.prisma.kanbanCampoPersonalizado.findFirst({
          where: { boardId, nome: campo.nome, tipo: campo.tipo },
          select: { id: true },
        });
        if (!equivalente) {
          if (valor === null) continue; // nada a limpar se o campo nem existe lá
          equivalente = await this.prisma.kanbanCampoPersonalizado.create({
            data: {
              boardId,
              nome: campo.nome,
              tipo: campo.tipo,
              opcoes: campo.tipo === 'lista_opcoes' ? (campo.opcoes ?? undefined) : undefined,
            },
            select: { id: true },
          });
        }
        if (valor === null) {
          await this.prisma.kanbanCampoValor.deleteMany({
            where: { campoId: equivalente.id, cardId: outro.id },
          });
        } else {
          await this.prisma.kanbanCampoValor.upsert({
            where: { campoId_cardId: { campoId: equivalente.id, cardId: outro.id } },
            create: { campoId: equivalente.id, cardId: outro.id, valor },
            update: { valor },
          });
        }
      }
    } catch {
      /* best-effort */
    }
  }

  /** Valida o valor conforme o tipo do campo (erro em pt-BR acionável). */
  private validarValor(
    campo: KanbanCampoPersonalizado,
    valor: string | number | boolean,
  ): string | number | boolean {
    switch (campo.tipo) {
      case 'texto':
        if (typeof valor !== 'string') {
          throw new BusinessRuleException(`Campo "${campo.nome}" espera texto`);
        }
        return valor;
      case 'numero': {
        // Number() aceita "" → 0, "   " → 0, true → 1 (todos isFinite): rejeita antes.
        if (typeof valor === 'boolean' || (typeof valor === 'string' && valor.trim() === '')) {
          throw new BusinessRuleException(`Campo "${campo.nome}" espera número`);
        }
        const n = typeof valor === 'number' ? valor : Number(valor);
        if (!Number.isFinite(n)) {
          throw new BusinessRuleException(`Campo "${campo.nome}" espera número`);
        }
        return n;
      }
      case 'data': {
        const d = new Date(String(valor));
        if (Number.isNaN(d.getTime())) {
          throw new BusinessRuleException(
            `Campo "${campo.nome}" espera data válida (ISO, ex: 2026-07-15)`,
          );
        }
        return d.toISOString();
      }
      case 'checkbox':
        if (typeof valor !== 'boolean') {
          throw new BusinessRuleException(`Campo "${campo.nome}" espera true/false`);
        }
        return valor;
      case 'lista_opcoes': {
        const opcoes = (campo.opcoes as string[] | null) ?? [];
        if (typeof valor !== 'string' || !opcoes.includes(valor)) {
          throw new BusinessRuleException(
            `Campo "${campo.nome}" aceita apenas: ${opcoes.join(', ')}`,
          );
        }
        return valor;
      }
      default:
        throw new BusinessRuleException(`Tipo de campo desconhecido: ${campo.tipo}`);
    }
  }
}
