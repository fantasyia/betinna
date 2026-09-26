import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanbanBoardsService } from './kanban-boards.service';

/**
 * BETINNA-FRONT-A: o quadro DEV devolvia 1,2 MB (338 cards) e a tela recarregava
 * tudo a cada 15s — timeout recorrente. 76% era a DESCRIÇÃO dos cards, que a
 * tela do quadro nem mostra (o modal busca o card inteiro sozinho).
 *
 * Este spec trava as duas pontas do conserto:
 *   1. a listagem não traz a descrição dos cards;
 *   2. `?desde=<assinatura>` responde "inalterado" quando nada mudou — e deixa
 *      de responder assim quando QUALQUER coisa visível muda (inclusive o
 *      badge que vem do card canônico). Assinatura que não muda quando devia
 *      congelaria o quadro na tela, que é pior que o peso.
 */

const user = { id: 'u1', empresaIdAtiva: 'emp1', role: 'DIRECTOR' } as never;

function montarBoard(overrides: { titulo?: string } = {}) {
  return {
    id: 'b1',
    nome: 'DEV',
    imagemFundo: 'fundos/b1.jpg',
    membros: [],
    etiquetas: [],
    campos: [],
    listas: [
      {
        id: 'l1',
        nome: 'Concluído',
        posicao: 1,
        cards: [
          {
            id: 'c1',
            titulo: overrides.titulo ?? 'Card 1',
            origemCardId: 'canon1',
            etiquetas: [],
            membros: [],
            checklists: [],
            _count: { comentarios: 0, anexos: 0 },
          },
        ],
      },
    ],
  };
}

function construir() {
  let board = montarBoard();
  let itensCanon = [{ concluido: false }];
  let urls = 0;
  const prisma = {
    kanbanBoard: { findUniqueOrThrow: vi.fn(async () => structuredClone(board)) },
    kanbanCard: {
      findMany: vi.fn(async () => [
        {
          id: 'canon1',
          membros: [],
          checklists: [{ itens: structuredClone(itensCanon) }],
          _count: { comentarios: 0, anexos: 0 },
        },
      ]),
    },
  };
  const acesso = { verificarAcessoBoard: vi.fn().mockResolvedValue({ id: 'b1' }) };
  // A URL assinada do fundo muda A CADA chamada, como a do Supabase.
  const fundo = { signedUrl: vi.fn(async () => `https://storage/fundo?token=${++urls}`) };
  const svc = new KanbanBoardsService(
    prisma as never,
    acesso as never,
    {} as never,
    fundo as never,
  );
  return {
    svc,
    prisma,
    mudarTitulo: (t: string) => (board = montarBoard({ titulo: t })),
    marcarItemNoCanonico: () => (itensCanon = [{ concluido: true }]),
  };
}

type Completo = { assinatura: string; listas: unknown[]; imagemFundoUrl: string };
type Inalterado = { inalterado: true; assinatura: string; imagemFundoUrl: string };

describe('listagem do quadro sem a descrição dos cards', () => {
  it('a consulta pede os cards SEM `descricao`', async () => {
    const { svc, prisma } = construir();
    await svc.findById(user, 'b1');

    const args = prisma.kanbanBoard.findUniqueOrThrow.mock.calls[0][0] as {
      include: { listas: { include: { cards: { omit?: Record<string, boolean> } } } };
    };
    expect(args.include.listas.include.cards.omit).toEqual({ descricao: true });
  });
});

describe('assinatura + desde — o polling leve', () => {
  let ctx: ReturnType<typeof construir>;
  beforeEach(() => {
    ctx = construir();
  });

  it('sem `desde`: devolve o quadro completo com a assinatura', async () => {
    const r = (await ctx.svc.findById(user, 'b1')) as Completo;
    expect(r.assinatura).toMatch(/^[0-9a-f]{40}$/);
    expect(r.listas).toHaveLength(1);
  });

  it('nada mudou: `desde` igual devolve só "inalterado", sem as listas', async () => {
    const primeiro = (await ctx.svc.findById(user, 'b1')) as Completo;
    const r = (await ctx.svc.findById(user, 'b1', primeiro.assinatura)) as Inalterado;

    expect(r.inalterado).toBe(true);
    expect(r.assinatura).toBe(primeiro.assinatura);
    expect(r).not.toHaveProperty('listas');
    // O fundo segue vindo: a URL assinada expira, e a tela precisa da nova.
    expect(r.imagemFundoUrl).toContain('https://storage/fundo');
  });

  it('a URL do fundo, que muda a cada chamada, NÃO muda a assinatura', async () => {
    const a = (await ctx.svc.findById(user, 'b1')) as Completo;
    const b = (await ctx.svc.findById(user, 'b1')) as Completo;
    expect(a.imagemFundoUrl).not.toBe(b.imagemFundoUrl);
    expect(a.assinatura).toBe(b.assinatura);
  });

  it('card mudou: a assinatura muda e volta o quadro inteiro', async () => {
    const antes = (await ctx.svc.findById(user, 'b1')) as Completo;
    ctx.mudarTitulo('Card 1 renomeado');
    const r = (await ctx.svc.findById(user, 'b1', antes.assinatura)) as Completo;

    expect(r).not.toHaveProperty('inalterado');
    expect(r.assinatura).not.toBe(antes.assinatura);
    expect(r.listas).toHaveLength(1);
  });

  it('badge do card CANÔNICO mudou (item de checklist): também troca a assinatura', async () => {
    // O badge do card-espelho vem do canônico, montado DEPOIS da consulta
    // principal. Se o hash fosse tirado antes dessa montagem, marcar um item
    // no card do rep nunca atualizaria o quadro do diretor.
    const antes = (await ctx.svc.findById(user, 'b1')) as Completo;
    ctx.marcarItemNoCanonico();
    const r = (await ctx.svc.findById(user, 'b1', antes.assinatura)) as Completo;

    expect(r).not.toHaveProperty('inalterado');
    expect(r.assinatura).not.toBe(antes.assinatura);
  });
});
