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

/**
 * Espelho de card criado À MÃO.
 *
 * Achado do Léo em produção: card criado na tela ficava sozinho. O rep anotava
 * uma tarefa no quadro dele e o Diretor nunca via; o Diretor abria um card e
 * não tinha como mandar pro rep. Os dois quadros pareciam espelho e não eram —
 * o espelho só existia no caminho de FLUXO.
 */
describe('KanbanTarefaService.espelharCardManual', () => {
  const cardNoQuadroDoRep = {
    id: 'card-rep',
    titulo: 'Ligar pro cliente',
    descricao: null,
    dataInicio: null,
    dataEntrega: null,
    origemCardId: null,
    lista: {
      nome: '📋 A fazer',
      board: {
        id: 'board-rep',
        empresaId: 'emp-1',
        tipoSistema: 'rep_tarefas',
        criadoPorId: 'rep-1',
      },
    },
  };

  const montar = () => {
    const prisma = makePrisma();
    prisma.kanbanCard.findUnique = vi.fn().mockResolvedValue(cardNoQuadroDoRep);
    prisma.kanbanCard.update = vi.fn().mockResolvedValue({});
    prisma.kanbanCard.findFirst = vi.fn().mockResolvedValue(null); // sem espelho ainda
    prisma.kanbanBoard.findFirst.mockResolvedValue({ id: 'board-diretor' });
    prisma.usuario.findFirst.mockResolvedValue({ role: 'REP', nome: 'Marcelo Harada' });
    prisma.usuario.findUnique = vi.fn().mockResolvedValue({ role: 'REP', nome: 'Marcelo Harada' });
    prisma.kanbanCardMembro = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    } as never;
    prisma.kanbanComentario = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } as never;
    prisma.kanbanChecklist = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } as never;
    prisma.kanbanAnexo = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } as never;
    return { prisma, svc: new KanbanTarefaService(prisma as never) };
  };

  it('card do REP cria a ORIGEM no quadro do Diretor e amarra o par', async () => {
    const { prisma, svc } = montar();

    const r = await svc.espelharCardManual('card-rep');

    expect(r?.espelhoId).toBe('card-novo');
    // O card do Diretor é o CANÔNICO — é onde moram comentário/checklist/membro.
    expect(prisma.kanbanCard.update).toHaveBeenCalledWith({
      where: { id: 'card-rep' },
      data: { origemCardId: 'card-novo' },
    });
  });

  it('a contraparte cai na coluna de MESMO NOME', async () => {
    const { prisma, svc } = montar();

    await svc.espelharCardManual('card-rep');

    const criado = prisma.kanbanCard.create.mock.calls[0][0].data as { listaId: string };
    expect(criado.listaId).toBe('l1'); // '📋 A fazer' nos dois quadros
  });

  it('card do Diretor atribuído a um REP cria o espelho no quadro dele', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCard.findUnique = vi.fn().mockResolvedValue({
      ...cardNoQuadroDoRep,
      id: 'card-diretor',
      lista: {
        nome: '📋 A fazer',
        board: {
          id: 'board-diretor',
          empresaId: 'emp-1',
          tipoSistema: 'diretor_tarefas',
          criadoPorId: 'leo',
        },
      },
    });

    const r = await svc.espelharCardManual('card-diretor', { repId: 'rep-1' });

    expect(r?.espelhoId).toBeTruthy();
    const criado = prisma.kanbanCard.create.mock.calls[0][0].data as { origemCardId: string };
    // Aqui o card do Diretor JÁ é a origem — o novo é que aponta pra ele.
    expect(criado.origemCardId).toBe('card-diretor');
    // E o cartão do Diretor ganha a etiqueta do rep (card 🏷️).
    expect(prisma.kanbanCardEtiqueta.create).toHaveBeenCalled();
  });

  it('card que JÁ faz parte de um par não duplica', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCard.findUnique = vi
      .fn()
      .mockResolvedValue({ ...cardNoQuadroDoRep, origemCardId: 'ja-tem' });

    expect(await svc.espelharCardManual('card-rep')).toBeNull();
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('rodar duas vezes não cria dois espelhos (idempotente)', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCard.findFirst = vi.fn().mockResolvedValue({ id: 'espelho-existente' });

    const r = await svc.espelharCardManual('card-rep');

    expect(r).toEqual({ espelhoId: 'espelho-existente' });
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('quadro COMUM não vira espelho de nada', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCard.findUnique = vi.fn().mockResolvedValue({
      ...cardNoQuadroDoRep,
      lista: {
        nome: 'A fazer',
        board: { id: 'b', empresaId: 'emp-1', tipoSistema: null, criadoPorId: 'x' },
      },
    });

    expect(await svc.espelharCardManual('card-rep')).toBeNull();
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('atribuir alguém que NÃO é rep no quadro do Diretor não cria quadro nenhum', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCard.findUnique = vi.fn().mockResolvedValue({
      ...cardNoQuadroDoRep,
      id: 'card-diretor',
      lista: {
        nome: '📋 A fazer',
        board: {
          id: 'board-diretor',
          empresaId: 'emp-1',
          tipoSistema: 'diretor_tarefas',
          criadoPorId: 'leo',
        },
      },
    });
    prisma.usuario.findFirst.mockResolvedValue({ role: 'SAC', nome: 'Atendente' });

    expect(await svc.espelharCardManual('card-diretor', { repId: 'sac-1' })).toBeNull();
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('falha no espelho NÃO propaga (não pode derrubar a criação do card)', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCard.findUnique = vi.fn().mockRejectedValue(new Error('banco fora'));

    await expect(svc.espelharCardManual('card-rep')).resolves.toBeNull();
  });
});

/**
 * CURA de card órfão — o que o Léo achou testando: card criado antes do espelho
 * manual existir ficava sem par pra sempre, e assinar/desassinar rep nele não
 * refletia no Diretor. "1:1" que só vale pros cards novos não é 1:1.
 */
describe('KanbanTarefaService.espelharCardManual — cura de órfão', () => {
  const orfaoNoDiretor = {
    id: 'card-orfao',
    titulo: 'teste44444',
    descricao: null,
    dataInicio: null,
    dataEntrega: null,
    origemCardId: null,
    lista: {
      nome: '📋 A fazer',
      board: {
        id: 'board-diretor',
        empresaId: 'emp-1',
        tipoSistema: 'diretor_tarefas',
        criadoPorId: 'leo',
      },
    },
  };

  const montar = () => {
    const prisma = makePrisma();
    prisma.kanbanCard.findUnique = vi.fn().mockResolvedValue(orfaoNoDiretor);
    prisma.kanbanCard.update = vi.fn().mockResolvedValue({});
    prisma.kanbanCard.findFirst = vi.fn().mockResolvedValue(null);
    prisma.kanbanCardMembro = { findFirst: vi.fn().mockResolvedValue(null) } as never;
    prisma.kanbanBoard.findFirst.mockResolvedValue({ id: 'board-rep', tipoSistema: 'rep_tarefas' });
    prisma.usuario.findFirst.mockResolvedValue({ role: 'REP', nome: 'Marcelo Harada' });
    return { prisma, svc: new KanbanTarefaService(prisma as never) };
  };

  it('deduz o rep pelos MEMBROS quando o repId não vem explícito', async () => {
    const { prisma, svc } = montar();
    // Card antigo do Diretor que alguém atribuiu ao rep depois.
    prisma.kanbanCardMembro.findFirst = vi.fn().mockResolvedValue({ usuarioId: 'rep-1' });

    const r = await svc.espelharCardManual('card-orfao');

    expect(r?.espelhoId).toBeTruthy();
    const criado = prisma.kanbanCard.create.mock.calls[0][0].data as { origemCardId: string };
    expect(criado.origemCardId).toBe('card-orfao');
  });

  it('card do Diretor SEM rep atribuído não vira card de ninguém', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCardMembro.findFirst = vi.fn().mockResolvedValue(null);

    expect(await svc.espelharCardManual('card-orfao')).toBeNull();
    expect(prisma.kanbanCard.create).not.toHaveBeenCalled();
  });

  it('o repId explícito tem precedência sobre a dedução', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCardMembro.findFirst = vi.fn().mockResolvedValue({ usuarioId: 'rep-dos-membros' });

    await svc.espelharCardManual('card-orfao', { repId: 'rep-escolhido' });

    const buscaDoRep = prisma.usuario.findFirst.mock.calls.at(-1)?.[0] as {
      where: { id: string };
    };
    expect(buscaDoRep.where.id).toBe('rep-escolhido');
  });
});

/**
 * O card que vira espelho não pode PERDER o que já tinha.
 *
 * A leitura busca membro/comentário/checklist/anexo no canônico. Um card que
 * existia sozinho — com membro atribuído, comentário escrito — e ganha par
 * agora apareceria VAZIO se as relações ficassem pra trás. O usuário veria as
 * coisas dele sumirem no instante em que o espelho foi criado.
 */
describe('KanbanTarefaService — migração das relações ao virar espelho', () => {
  const cardDoRepComMembro = {
    id: 'card-rep',
    titulo: 'teste44444',
    descricao: null,
    dataInicio: null,
    dataEntrega: null,
    origemCardId: null,
    lista: {
      nome: '📋 A fazer',
      board: {
        id: 'board-rep',
        empresaId: 'emp-1',
        tipoSistema: 'rep_tarefas',
        criadoPorId: 'rep-1',
      },
    },
  };

  const montar = () => {
    const prisma = makePrisma();
    prisma.kanbanCard.findUnique = vi.fn().mockResolvedValue(cardDoRepComMembro);
    prisma.kanbanCard.update = vi.fn().mockResolvedValue({});
    prisma.kanbanCard.findFirst = vi.fn().mockResolvedValue(null);
    prisma.kanbanBoard.findFirst.mockResolvedValue({ id: 'board-diretor' });
    prisma.usuario.findUnique = vi.fn().mockResolvedValue({ role: 'REP', nome: 'Marcelo Harada' });
    prisma.kanbanCardMembro = {
      findMany: vi.fn().mockResolvedValue([{ usuarioId: 'rep-1' }]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(null),
    } as never;
    prisma.kanbanComentario = { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } as never;
    prisma.kanbanChecklist = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } as never;
    prisma.kanbanAnexo = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } as never;
    return { prisma, svc: new KanbanTarefaService(prisma as never) };
  };

  it('membro atribuído ANTES do par migra pro canônico (senão some da tela)', async () => {
    const { prisma, svc } = montar();

    await svc.espelharCardManual('card-rep');

    expect(prisma.kanbanCardMembro.create).toHaveBeenCalledWith({
      data: { cardId: 'card-novo', usuarioId: 'rep-1' },
    });
    expect(prisma.kanbanCardMembro.deleteMany).toHaveBeenCalledWith({
      where: { cardId: 'card-rep' },
    });
  });

  it('comentário, checklist e anexo migram junto', async () => {
    const { prisma, svc } = montar();

    await svc.espelharCardManual('card-rep');

    for (const rel of [prisma.kanbanComentario, prisma.kanbanChecklist, prisma.kanbanAnexo]) {
      expect(rel.updateMany).toHaveBeenCalledWith({
        where: { cardId: 'card-rep' },
        data: { cardId: 'card-novo' },
      });
    }
  });

  it('membro que já existe do outro lado não quebra a migração', async () => {
    const { prisma, svc } = montar();
    prisma.kanbanCardMembro.create = vi.fn().mockRejectedValue({ code: 'P2002' });

    await expect(svc.espelharCardManual('card-rep')).resolves.toBeTruthy();
    expect(prisma.kanbanCardMembro.deleteMany).toHaveBeenCalled();
  });
});
