import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { posicaoNoFim } from './kanban-posicao.util';

/**
 * Provisão automática dos quadros de tarefas (rep + Diretor) e a ponte
 * CRIAR_TAREFA (fluxos) → card no Diretor com espelho bidirecional pro rep.
 *
 * Regras (decididas com o Léo, 2026-07-13):
 * - REP já nasce com o quadro dele ("Minhas Tarefas", colunas padrão).
 * - CRIAR_TAREFA continua criando o AgendaItem (dual-write); o card é a camada
 *   de VISIBILIDADE, best-effort — falha aqui NÃO derruba o fluxo.
 * - Quadro do Diretor é a ORIGEM: a tarefa nasce lá e ESPELHA pro quadro do rep.
 * - Espelho é BIDIRECIONAL (é o mesmo card): ajuste feito pelo Diretor ou pelo
 *   rep (mover coluna, concluir, editar título/descrição) reflete no outro.
 *
 * Depende só de PrismaService (sem acoplar com os services de board/card),
 * então pode ser importado por Users e Fluxos sem ciclo de DI.
 */
@Injectable()
export class KanbanTarefaService {
  private readonly logger = new Logger(KanbanTarefaService.name);

  /** Colunas padrão dos quadros de tarefas — a sincronia do espelho casa POR NOME. */
  static readonly COLUNAS = ['📋 A fazer', '🔨 Fazendo', '✅ Feito'] as const;
  private static readonly COL_INICIAL = KanbanTarefaService.COLUNAS[0];

  constructor(private readonly prisma: PrismaService) {}

  // ─── Provisão de quadros ────────────────────────────────────────────────

  /**
   * Garante o quadro pessoal do REP (1 por rep, limite existente). Se o rep já
   * tem um quadro, reaproveita (etiqueta como sistema + garante as colunas
   * padrão); senão cria. Retorna o boardId + mapa nome→listaId das colunas.
   */
  async garantirQuadroRep(
    empresaId: string,
    repId: string,
    repNome?: string,
  ): Promise<{ boardId: string; listas: Map<string, string> }> {
    // Prefere um quadro já marcado como de sistema; senão o quadro que o rep já tenha.
    const existente = await this.prisma.kanbanBoard.findFirst({
      where: { empresaId, criadoPorId: repId, arquivado: false },
      orderBy: { tipoSistema: 'desc' }, // 'rep_tarefas' vem antes de null
      select: { id: true, tipoSistema: true },
    });

    if (existente) {
      if (existente.tipoSistema !== 'rep_tarefas') {
        await this.prisma.kanbanBoard.update({
          where: { id: existente.id },
          data: { tipoSistema: 'rep_tarefas' },
        });
      }
      const listas = await this.garantirColunas(existente.id);
      return { boardId: existente.id, listas };
    }

    const board = await this.prisma.kanbanBoard.create({
      data: {
        nome: repNome ? `Tarefas de ${repNome}` : 'Minhas Tarefas',
        descricao: 'Quadro pessoal de tarefas (gerado automaticamente pelos fluxos).',
        empresaId,
        criadoPorId: repId,
        tipoSistema: 'rep_tarefas',
        membros: { create: { usuarioId: repId, papel: 'dono' } },
      },
      select: { id: true },
    });
    const listas = await this.garantirColunas(board.id);
    return { boardId: board.id, listas };
  }

  /**
   * Garante o quadro central do Diretor (1 por tenant). Reaproveita um já
   * existente marcado como sistema; senão cria com dono = 1º ADMIN/DIRECTOR ativo.
   */
  async garantirQuadroDiretor(
    empresaId: string,
  ): Promise<{ boardId: string; listas: Map<string, string> } | null> {
    const existente = await this.prisma.kanbanBoard.findFirst({
      where: { empresaId, tipoSistema: 'diretor_tarefas', arquivado: false },
      select: { id: true },
    });
    if (existente) {
      const listas = await this.garantirColunas(existente.id);
      return { boardId: existente.id, listas };
    }

    const dono = await this.prisma.usuario.findFirst({
      where: {
        empresas: { some: { empresaId } },
        role: { in: ['ADMIN', 'DIRECTOR'] },
        status: 'ATIVO',
      },
      select: { id: true },
    });
    if (!dono) {
      this.logger.warn(
        `Sem ADMIN/DIRECTOR ativo na empresa ${empresaId} — quadro do Diretor não criado.`,
      );
      return null;
    }

    const board = await this.prisma.kanbanBoard.create({
      data: {
        nome: 'Acompanhamento de Tarefas (reps)',
        descricao: 'Espelho central das tarefas geradas nos quadros dos reps.',
        empresaId,
        criadoPorId: dono.id,
        tipoSistema: 'diretor_tarefas',
        membros: { create: { usuarioId: dono.id, papel: 'dono' } },
      },
      select: { id: true },
    });
    const listas = await this.garantirColunas(board.id);
    return { boardId: board.id, listas };
  }

  /** Garante que as 3 colunas padrão existam no board; retorna nome→listaId. */
  private async garantirColunas(boardId: string): Promise<Map<string, string>> {
    const atuais = await this.prisma.kanbanLista.findMany({
      where: { boardId },
      select: { id: true, nome: true, posicao: true },
    });
    const porNome = new Map(atuais.map((l) => [l.nome, l.id]));
    let posicao = atuais.reduce((max, l) => Math.max(max, l.posicao), 0);

    for (const nome of KanbanTarefaService.COLUNAS) {
      if (!porNome.has(nome)) {
        posicao = posicaoNoFim(posicao);
        const lista = await this.prisma.kanbanLista.create({
          data: { boardId, nome, posicao },
          select: { id: true },
        });
        porNome.set(nome, lista.id);
      }
    }
    return porNome;
  }

  // ─── CRIAR_TAREFA → card(s) ─────────────────────────────────────────────

  /**
   * Cria o(s) card(s) da tarefa. O **quadro do Diretor é a ORIGEM** (o Diretor
   * acompanha se o lead que caiu pro rep está sendo tratado): cria primeiro no
   * Diretor e, se o responsável é REP, ESPELHA no quadro do rep (mesmo card).
   * Se não há rep (ADMIN/DIRECTOR), fica só no Diretor. Idempotente por
   * `origemJobId`. Best-effort — o caller deve engolir exceções (não derruba o fluxo).
   */
  async criarCardsDeTarefa(params: {
    empresaId: string;
    responsavelId: string;
    titulo: string;
    descricao?: string;
    dataEntrega?: Date;
    origemJobId: string;
  }): Promise<{ repCardId?: string; diretorCardId?: string; idempotente?: boolean }> {
    const { empresaId, responsavelId, titulo, descricao, dataEntrega, origemJobId } = params;

    // Idempotência: se já criamos card pra este passo, não recria.
    const jaExiste = await this.prisma.kanbanCard.findFirst({
      where: { origemJobId, lista: { board: { empresaId } } },
      select: { id: true },
    });
    if (jaExiste) return { idempotente: true };

    const responsavel = await this.prisma.usuario.findFirst({
      where: { id: responsavelId, empresas: { some: { empresaId } } },
      select: { role: true },
    });

    // 1) ORIGEM = quadro do Diretor (sempre).
    const diretor = await this.garantirQuadroDiretor(empresaId);
    let diretorCardId: string | undefined;
    if (diretor) {
      const listaId = diretor.listas.get(KanbanTarefaService.COL_INICIAL);
      if (listaId) {
        const card = await this.criarCard(listaId, { titulo, descricao, dataEntrega, origemJobId });
        diretorCardId = card.id;
      }
    }

    // 2) ESPELHO no quadro do rep (aponta pra origem do Diretor).
    let repCardId: string | undefined;
    if (responsavel?.role === 'REP') {
      const rep = await this.garantirQuadroRep(empresaId, responsavelId);
      const listaId = rep.listas.get(KanbanTarefaService.COL_INICIAL);
      if (listaId) {
        const card = await this.criarCard(listaId, {
          titulo,
          descricao,
          dataEntrega,
          origemJobId,
          origemCardId: diretorCardId,
        });
        repCardId = card.id;
      }
    }

    return { repCardId, diretorCardId };
  }

  private async criarCard(
    listaId: string,
    dados: {
      titulo: string;
      descricao?: string;
      dataEntrega?: Date;
      origemJobId: string;
      origemCardId?: string;
    },
  ) {
    const ultimo = await this.prisma.kanbanCard.findFirst({
      where: { listaId },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });
    return this.prisma.kanbanCard.create({
      data: {
        listaId,
        titulo: dados.titulo,
        descricao: dados.descricao,
        dataEntrega: dados.dataEntrega ?? null,
        posicao: posicaoNoFim(ultimo?.posicao),
        origemJobId: dados.origemJobId,
        origemCardId: dados.origemCardId ?? null,
      },
      select: { id: true },
    });
  }

  // ─── Sincronização bidirecional (Diretor ↔ rep — é o MESMO card) ─────────

  /**
   * Propaga a alteração de um card pra sua CONTRAPARTE espelhada — nos DOIS
   * sentidos, porque conceitualmente é o mesmo card:
   * - Diretor (origem) alterado → reflete no card do rep (espelho);
   * - rep (espelho) alterado → reflete no card do Diretor (origem).
   * Copia coluna (casada por NOME), concluído/arquivado e os campos de conteúdo
   * (título, descrição, datas, capa). Best-effort — chamado após mover/atualizar
   * qualquer card. Sem loop: a contraparte é atualizada via Prisma direto (não
   * passa pelo service que dispara este sync).
   */
  async sincronizarContraparte(cardId: string): Promise<void> {
    const card = await this.prisma.kanbanCard.findUnique({
      where: { id: cardId },
      select: {
        titulo: true,
        descricao: true,
        concluido: true,
        arquivado: true,
        dataInicio: true,
        dataEntrega: true,
        corCapa: true,
        origemCardId: true,
        lista: { select: { nome: true } },
      },
    });
    if (!card) return;

    // Contrapartes: os espelhos deste card (origem→espelhos) E a origem, se este
    // card for um espelho (espelho→origem).
    const contrapartes = await this.prisma.kanbanCard.findMany({
      where: {
        OR: [{ origemCardId: cardId }, ...(card.origemCardId ? [{ id: card.origemCardId }] : [])],
      },
      select: { id: true, lista: { select: { boardId: true } } },
    });
    if (contrapartes.length === 0) return;

    for (const alvo of contrapartes) {
      const data: {
        titulo: string;
        descricao: string | null;
        concluido: boolean;
        arquivado: boolean;
        dataInicio: Date | null;
        dataEntrega: Date | null;
        corCapa: string | null;
        listaId?: string;
        posicao?: number;
      } = {
        titulo: card.titulo,
        descricao: card.descricao,
        concluido: card.concluido,
        arquivado: card.arquivado,
        dataInicio: card.dataInicio,
        dataEntrega: card.dataEntrega,
        corCapa: card.corCapa,
      };
      // Casa a coluna da contraparte pela mesma NOME da coluna do card alterado.
      const listaDestino = await this.prisma.kanbanLista.findFirst({
        where: { boardId: alvo.lista.boardId, nome: card.lista.nome, arquivada: false },
        select: { id: true },
      });
      if (listaDestino) {
        const ultimo = await this.prisma.kanbanCard.findFirst({
          where: { listaId: listaDestino.id },
          orderBy: { posicao: 'desc' },
          select: { posicao: true },
        });
        data.listaId = listaDestino.id;
        data.posicao = posicaoNoFim(ultimo?.posicao);
      }
      await this.prisma.kanbanCard.update({ where: { id: alvo.id }, data });
    }
  }
}
