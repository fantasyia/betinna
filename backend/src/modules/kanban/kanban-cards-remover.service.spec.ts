import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanCardsService } from './kanban-cards.service';

const user: AuthenticatedUser = {
  id: 'u1',
  email: 'a@b.ai',
  nome: 'Admin',
  role: 'DIRECTOR',
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};

const makeDeps = () => {
  const prisma = {
    kanbanCard: {
      findUniqueOrThrow: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  const acesso = {
    verificarAcessoPorCard: vi.fn().mockResolvedValue({ board: { id: 'b1' } }),
  };
  const atividade = { registrar: vi.fn().mockResolvedValue(undefined) };
  const anexos = { purgarArquivosDosCards: vi.fn().mockResolvedValue(0) };
  const svc = new KanbanCardsService(
    prisma as never,
    acesso as never,
    atividade as never,
    {} as never, // tarefa
    anexos as never,
  );
  return { prisma, acesso, atividade, anexos, svc };
};

describe('KanbanCardsService.remover', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    d = makeDeps();
  });

  it('exclui o card, registra atividade ANTES e purga arquivos do storage', async () => {
    d.prisma.kanbanCard.findUniqueOrThrow.mockResolvedValue({
      id: 'c1',
      titulo: 'Card duplicado',
      espelhos: [],
    });
    d.anexos.purgarArquivosDosCards.mockResolvedValue(2);

    const r = await d.svc.remover(user, 'c1');

    expect(d.acesso.verificarAcessoPorCard).toHaveBeenCalledWith(user, 'c1'); // tenant/autorização
    // atividade registrada ANTES do delete (cardId não tem FK → rastro sobrevive)
    const ordemAtividade = d.atividade.registrar.mock.invocationCallOrder[0];
    const ordemDelete = d.prisma.kanbanCard.delete.mock.invocationCallOrder[0];
    expect(ordemAtividade).toBeLessThan(ordemDelete);
    expect(d.atividade.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'card_excluido', cardId: 'c1', boardId: 'b1' }),
    );
    // storage purgado ANTES do delete (senão arquivo fica órfão no bucket)
    expect(d.anexos.purgarArquivosDosCards).toHaveBeenCalledWith(['c1']);
    expect(d.prisma.kanbanCard.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(r).toEqual({
      ok: true,
      titulo: 'Card duplicado',
      espelhosRemovidos: 0,
      arquivosRemovidos: 2,
    });
  });

  it('ESPELHO: excluir a ORIGEM reporta os espelhos que o cascade leva junto', async () => {
    d.prisma.kanbanCard.findUniqueOrThrow.mockResolvedValue({
      id: 'origem',
      titulo: 'Tarefa espelhada',
      espelhos: [{ id: 'esp-1' }, { id: 'esp-2' }],
    });

    const r = await d.svc.remover(user, 'origem');

    expect(r.espelhosRemovidos).toBe(2);
    // purga o storage da origem E dos espelhos
    expect(d.anexos.purgarArquivosDosCards).toHaveBeenCalledWith(['origem', 'esp-1', 'esp-2']);
    expect(d.atividade.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ dados: expect.objectContaining({ espelhosRemovidos: 2 }) }),
    );
  });

  it('sem acesso ao board → propaga o erro e NÃO deleta', async () => {
    d.acesso.verificarAcessoPorCard.mockRejectedValue(new Error('sem acesso'));
    await expect(d.svc.remover(user, 'c1')).rejects.toThrow('sem acesso');
    expect(d.prisma.kanbanCard.delete).not.toHaveBeenCalled();
  });
});
