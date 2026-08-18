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

  /**
   * Paleta das etiquetas de rep. Mesma do seletor de cores do kanban, pra a
   * etiqueta automática não destoar das criadas à mão.
   */
  private static readonly CORES_REP = [
    '#0079BF',
    '#201554',
    '#bd1fbf',
    '#5C88DA',
    '#519839',
    '#B04632',
    '#89609E',
    '#CD5A91',
    '#00AECC',
  ] as const;

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
      select: { role: true, nome: true },
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
      // Etiqueta com o nome do rep NO CARTÃO DO DIRETOR — é lá que os cartões de
      // todos os reps se misturam.
      if (diretor && diretorCardId) {
        await this.aplicarEtiquetaDoRep(diretor.boardId, diretorCardId, {
          id: responsavelId,
          nome: responsavel.nome,
        });
      }
      // Passa o nome: sem ele o quadro pessoal nasce como "Minhas Tarefas" e o
      // Diretor, que enxerga todos, não sabe de quem é o quadro.
      const rep = await this.garantirQuadroRep(empresaId, responsavelId, responsavel.nome);
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

  /**
   * Aplica no cartão do DIRETOR uma etiqueta com o NOME DO REP.
   *
   * O quadro do Diretor junta as tarefas de todos os reps numa coluna só: com 1
   * rep dá pra deduzir de quem é, com 5 vira uma pilha sem dono — e o quadro
   * existe justamente pra ele saber QUEM está tratando O QUÊ.
   *
   * Cor DERIVADA do id do usuário (hash simples): o mesmo rep sai sempre na
   * mesma cor, em qualquer empresa e entre deploys, sem ninguém precisar
   * cadastrar cor nenhuma. É o que faz bater o olho e reconhecer.
   *
   * Só no cartão do Diretor de propósito: no quadro do rep TODO cartão é dele,
   * então a etiqueta lá seria ruído. Como aplicamos direto pelo Prisma (e não
   * pelo service de etiquetas), o espelhamento automático não roda — o que aqui
   * é exatamente o comportamento desejado.
   */
  private async aplicarEtiquetaDoRep(
    boardId: string,
    cardId: string,
    rep: { id: string; nome: string },
  ): Promise<void> {
    try {
      const nome = rep.nome.trim();
      if (!nome) return;
      const cor = KanbanTarefaService.corDoRep(rep.id);
      // Casa por usuarioId (o vínculo de verdade) e cai pro nome pra adotar uma
      // etiqueta que já exista no quadro, criada à mão antes desta feature.
      let etiqueta = await this.prisma.kanbanEtiqueta.findFirst({
        where: { boardId, OR: [{ usuarioId: rep.id }, { nome }] },
        select: { id: true, usuarioId: true },
      });
      if (!etiqueta) {
        etiqueta = await this.prisma.kanbanEtiqueta.create({
          data: { boardId, nome, cor, usuarioId: rep.id },
          select: { id: true, usuarioId: true },
        });
      } else if (!etiqueta.usuarioId) {
        // Adotou a etiqueta criada à mão: carimba o dono pra o clique funcionar.
        await this.prisma.kanbanEtiqueta.update({
          where: { id: etiqueta.id },
          data: { usuarioId: rep.id },
        });
      }
      await this.prisma.kanbanCardEtiqueta
        .create({ data: { cardId, etiquetaId: etiqueta.id } })
        .catch(() => undefined); // P2002 = já tem
    } catch (err) {
      // Best-effort: etiqueta é camada de visibilidade, não pode derrubar a
      // criação da tarefa.
      this.logger.warn(`Falha ao etiquetar cartão com o rep: ${String(err)}`);
    }
  }

  /** Cor estável por usuário — mesmo rep, mesma cor, sempre. */
  private static corDoRep(usuarioId: string): string {
    let h = 0;
    for (let i = 0; i < usuarioId.length; i++) {
      h = (h * 31 + usuarioId.charCodeAt(i)) >>> 0;
    }
    return KanbanTarefaService.CORES_REP[h % KanbanTarefaService.CORES_REP.length];
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

  // ─── Espelho de card criado À MÃO ────────────────────────────────────────

  /**
   * Cria a contraparte de um card que nasceu À MÃO num dos dois quadros.
   *
   * O espelho até aqui só existia pro caminho de FLUXO (`criarCardsDeTarefa`).
   * Card criado na tela ficava sozinho: o rep anotava uma tarefa no quadro dele
   * e o Diretor nunca via; o Diretor abria um card e não tinha como mandar pro
   * rep. Os dois quadros pareciam espelho e não eram.
   *
   * O card do DIRETOR é sempre o CANÔNICO (é onde moram comentário, checklist,
   * anexo e membro — ver 74a39f6). Então:
   * - nasceu no quadro do rep → cria a origem no Diretor e aponta o card do rep
   *   pra ela (o de cá vira espelho, sem perder nada: ainda não tem relação
   *   nenhuma pendurada, acabou de nascer);
   * - nasceu no Diretor e foi atribuído a um rep → cria o espelho lá.
   *
   * Idempotente e best-effort: já espelhado não duplica, e falhar aqui não pode
   * derrubar a criação do card.
   */
  async espelharCardManual(
    cardId: string,
    opts: { repId?: string } = {},
  ): Promise<{ espelhoId?: string } | null> {
    try {
      const card = await this.prisma.kanbanCard.findUnique({
        where: { id: cardId },
        select: {
          id: true,
          titulo: true,
          descricao: true,
          dataInicio: true,
          dataEntrega: true,
          origemCardId: true,
          lista: {
            select: {
              nome: true,
              board: {
                select: { id: true, empresaId: true, tipoSistema: true, criadoPorId: true },
              },
            },
          },
        },
      });
      if (!card) return null;
      // Já faz parte de um par (veio de fluxo ou já espelhado) — nada a fazer.
      if (card.origemCardId) return null;
      const jaTemEspelho = await this.prisma.kanbanCard.findFirst({
        where: { origemCardId: card.id },
        select: { id: true },
      });
      if (jaTemEspelho) return { espelhoId: jaTemEspelho.id };

      const board = card.lista.board;
      const dados = {
        titulo: card.titulo,
        descricao: card.descricao ?? undefined,
        dataInicio: card.dataInicio ?? undefined,
        dataEntrega: card.dataEntrega ?? undefined,
      };
      // Coluna casada por NOME (mesma regra do sync) — cai na inicial se o
      // quadro de destino não tiver uma coluna com o mesmo nome.
      const colunaDestino = (listas: Map<string, string>) =>
        listas.get(card.lista.nome) ?? listas.get(KanbanTarefaService.COL_INICIAL);

      if (board.tipoSistema === 'rep_tarefas') {
        const diretor = await this.garantirQuadroDiretor(board.empresaId);
        const listaId = diretor && colunaDestino(diretor.listas);
        if (!diretor || !listaId) return null;
        const origem = await this.criarCardSimples(listaId, dados);
        // O card do rep passa a apontar pra origem: daqui pra frente os dois são
        // o mesmo card (comentário/checklist/membro moram no canônico).
        await this.prisma.kanbanCard.update({
          where: { id: card.id },
          data: { origemCardId: origem.id },
        });
        if (board.criadoPorId) {
          const rep = await this.prisma.usuario.findUnique({
            where: { id: board.criadoPorId },
            select: { nome: true, role: true },
          });
          if (rep?.role === 'REP') {
            await this.aplicarEtiquetaDoRep(diretor.boardId, origem.id, {
              id: board.criadoPorId,
              nome: rep.nome,
            });
          }
        }
        return { espelhoId: origem.id };
      }

      if (board.tipoSistema === 'diretor_tarefas' && opts.repId) {
        const rep = await this.prisma.usuario.findFirst({
          where: { id: opts.repId, empresas: { some: { empresaId: board.empresaId } } },
          select: { nome: true, role: true },
        });
        if (rep?.role !== 'REP') return null;
        const quadroRep = await this.garantirQuadroRep(board.empresaId, opts.repId, rep.nome);
        const listaId = colunaDestino(quadroRep.listas);
        if (!listaId) return null;
        const espelho = await this.criarCardSimples(listaId, { ...dados, origemCardId: card.id });
        await this.aplicarEtiquetaDoRep(board.id, card.id, { id: opts.repId, nome: rep.nome });
        return { espelhoId: espelho.id };
      }

      return null;
    } catch (err) {
      this.logger.warn(`Falha ao espelhar card criado à mão (${cardId}): ${String(err)}`);
      return null;
    }
  }

  /** Card sem `origemJobId` — é criação manual, não passo de fluxo. */
  private async criarCardSimples(
    listaId: string,
    dados: {
      titulo: string;
      descricao?: string;
      dataInicio?: Date;
      dataEntrega?: Date;
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
        descricao: dados.descricao ?? null,
        dataInicio: dados.dataInicio ?? null,
        dataEntrega: dados.dataEntrega ?? null,
        posicao: posicaoNoFim(ultimo?.posicao),
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
      select: { id: true, listaId: true, lista: { select: { boardId: true } } },
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
      // Só re-posiciona quando a contraparte MUDA de coluna — antes, qualquer
      // edição de título/descrição jogava a contraparte pro FIM da coluna dela,
      // embaralhando a ordenação manual do outro lado.
      if (listaDestino && listaDestino.id !== alvo.listaId) {
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
