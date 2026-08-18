import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanbanTarefaService } from './kanban-tarefa.service';

/**
 * Etiqueta com o NOME DO REP no cartão do Diretor.
 *
 * O quadro do Diretor junta as tarefas de TODOS os reps numa coluna só. Com 1
 * rep dá pra deduzir de quem é; com 5 vira uma pilha sem dono — e o quadro
 * existe justamente pra ele saber quem está tratando o quê.
 */
const makePrisma = () => ({
  kanbanCard: {
    findFirst: vi.fn().mockResolvedValue(null), // idempotência: nada criado ainda
    create: vi.fn().mockResolvedValue({ id: 'card-novo' }),
  },
  kanbanBoard: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  kanbanLista: {
    findMany: vi.fn().mockResolvedValue([
      { id: 'l1', nome: '📋 A fazer', posicao: 1 },
      { id: 'l2', nome: '🔨 Fazendo', posicao: 2 },
      { id: 'l3', nome: '✅ Feito', posicao: 3 },
    ]),
    create: vi.fn(),
  },
  usuario: { findFirst: vi.fn() },
  kanbanEtiqueta: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'et-1',
      usuarioId: data.usuarioId,
    })),
    update: vi.fn().mockResolvedValue({}),
  },
  kanbanCardEtiqueta: { create: vi.fn().mockResolvedValue({}) },
});

const params = {
  empresaId: 'emp-1',
  responsavelId: 'rep-1',
  titulo: 'Ligar pro cliente',
  origemJobId: 'job-1',
};

describe('KanbanTarefaService — etiqueta do rep no cartão do Diretor', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: KanbanTarefaService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new KanbanTarefaService(prisma as never);
    // Quadro do Diretor e do rep já existem.
    prisma.kanbanBoard.findFirst
      .mockResolvedValueOnce({ id: 'board-diretor' }) // garantirQuadroDiretor
      .mockResolvedValueOnce({ id: 'board-rep', tipoSistema: 'rep_tarefas' }); // garantirQuadroRep
    prisma.usuario.findFirst.mockResolvedValue({ role: 'REP', nome: 'Marcelo Harada' });
  });

  it('cria a etiqueta com o NOME do rep e vincula ao usuário', async () => {
    await svc.criarCardsDeTarefa(params);

    const criada = prisma.kanbanEtiqueta.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(criada.nome).toBe('Marcelo Harada');
    expect(criada.usuarioId).toBe('rep-1'); // é o vínculo que faz o clique funcionar
    expect(criada.boardId).toBe('board-diretor');
  });

  it('aplica SÓ no cartão do Diretor — no quadro do rep todo cartão é dele', async () => {
    await svc.criarCardsDeTarefa(params);

    // 1º card criado = Diretor (origem); 2º = espelho do rep.
    const diretorCardId = 'card-novo';
    expect(prisma.kanbanCardEtiqueta.create).toHaveBeenCalledTimes(1);
    expect(prisma.kanbanCardEtiqueta.create).toHaveBeenCalledWith({
      data: { cardId: diretorCardId, etiquetaId: 'et-1' },
    });
  });

  it('a cor é ESTÁVEL por rep (mesmo id → mesma cor, sempre)', async () => {
    await svc.criarCardsDeTarefa(params);
    const cor1 = (prisma.kanbanEtiqueta.create.mock.calls[0][0].data as { cor: string }).cor;

    const prisma2 = makePrisma();
    prisma2.kanbanBoard.findFirst
      .mockResolvedValueOnce({ id: 'board-diretor' })
      .mockResolvedValueOnce({ id: 'board-rep', tipoSistema: 'rep_tarefas' });
    prisma2.usuario.findFirst.mockResolvedValue({ role: 'REP', nome: 'Marcelo Harada' });
    await new KanbanTarefaService(prisma2 as never).criarCardsDeTarefa({
      ...params,
      origemJobId: 'job-2',
    });
    const cor2 = (prisma2.kanbanEtiqueta.create.mock.calls[0][0].data as { cor: string }).cor;

    expect(cor1).toBe(cor2);
  });

  it('reps DIFERENTES saem em cores diferentes (é o que faz bater o olho)', async () => {
    await svc.criarCardsDeTarefa(params);
    const corA = (prisma.kanbanEtiqueta.create.mock.calls[0][0].data as { cor: string }).cor;

    const prisma2 = makePrisma();
    prisma2.kanbanBoard.findFirst
      .mockResolvedValueOnce({ id: 'board-diretor' })
      .mockResolvedValueOnce({ id: 'board-rep-2', tipoSistema: 'rep_tarefas' });
    prisma2.usuario.findFirst.mockResolvedValue({ role: 'REP', nome: 'Outro Rep' });
    await new KanbanTarefaService(prisma2 as never).criarCardsDeTarefa({
      ...params,
      responsavelId: 'rep-2',
      origemJobId: 'job-3',
    });
    const corB = (prisma2.kanbanEtiqueta.create.mock.calls[0][0].data as { cor: string }).cor;

    expect(corA).not.toBe(corB);
  });

  it('responsável ADMIN/DIRECTOR: SEM etiqueta (a ausência já diz "não é de rep")', async () => {
    prisma.usuario.findFirst.mockResolvedValue({ role: 'DIRECTOR', nome: 'Léo' });

    await svc.criarCardsDeTarefa(params);

    expect(prisma.kanbanEtiqueta.create).not.toHaveBeenCalled();
    expect(prisma.kanbanCardEtiqueta.create).not.toHaveBeenCalled();
  });

  it('reaproveita etiqueta já existente e carimba o dono nela', async () => {
    // Etiqueta "Marcelo Harada" criada à mão antes desta feature: sem usuarioId,
    // o clique não teria pra onde ir.
    prisma.kanbanEtiqueta.findFirst.mockResolvedValue({ id: 'et-manual', usuarioId: null });

    await svc.criarCardsDeTarefa(params);

    expect(prisma.kanbanEtiqueta.create).not.toHaveBeenCalled();
    expect(prisma.kanbanEtiqueta.update).toHaveBeenCalledWith({
      where: { id: 'et-manual' },
      data: { usuarioId: 'rep-1' },
    });
  });

  it('falha ao etiquetar NÃO derruba a criação da tarefa', async () => {
    prisma.kanbanEtiqueta.findFirst.mockRejectedValue(new Error('banco fora'));

    const r = await svc.criarCardsDeTarefa(params);

    expect(r.diretorCardId).toBeTruthy();
    expect(r.repCardId).toBeTruthy();
  });

  it('o quadro pessoal nasce com o NOME do rep (senão vira "Minhas Tarefas")', async () => {
    prisma.kanbanBoard.findFirst.mockReset();
    prisma.kanbanBoard.findFirst
      .mockResolvedValueOnce({ id: 'board-diretor' })
      .mockResolvedValueOnce(null); // rep ainda não tem quadro
    prisma.kanbanBoard.create.mockResolvedValue({ id: 'board-rep-novo' });

    await svc.criarCardsDeTarefa(params);

    const criado = prisma.kanbanBoard.create.mock.calls[0][0].data as { nome: string };
    expect(criado.nome).toBe('Tarefas de Marcelo Harada');
  });
});
