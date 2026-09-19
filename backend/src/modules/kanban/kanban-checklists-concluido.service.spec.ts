import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { KanbanChecklistsService } from './kanban-checklists.service';
import { createChecklistSchema, createChecklistItemSchema } from './kanban.dto';

/**
 * Criar item de checklist JÁ concluído.
 *
 * O defeito: `concluido` não estava declarado no schema de CRIAÇÃO (só no de
 * update). Zod remove chave não declarada em silêncio, então a API respondia
 * 201 com o item desmarcado — quem importava um checklist de coisas já feitas
 * recebia sucesso e um quadro errado, sem nada acusando.
 *
 * Por isso o teste tem DUAS pontas: o schema precisa DEIXAR PASSAR e o serviço
 * precisa GRAVAR. Testar só uma deixa a outra livre pra regredir sozinha — e
 * foi exatamente assim que o campo se perdeu.
 */
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
    kanbanChecklist: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ck1', titulo: 'T', itens: [] }),
    },
    kanbanChecklistItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'i1', texto: 'Feito', responsavelId: null }),
    },
  };
  const acesso = {
    verificarAcessoPorCard: vi.fn().mockResolvedValue({ board: { id: 'b1' }, canonicoId: 'c1' }),
    verificarAcessoPorChecklist: vi.fn().mockResolvedValue({ board: { id: 'b1' }, cardId: 'c1' }),
    exigirMembroDoBoard: vi.fn().mockResolvedValue(undefined),
  };
  const atividade = { registrar: vi.fn().mockResolvedValue(undefined) };
  const svc = new KanbanChecklistsService(prisma as never, acesso as never, atividade as never);
  return { prisma, acesso, atividade, svc };
};

describe('checklist nasce JÁ marcado', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    d = makeDeps();
  });

  // ── ponta 1: o schema deixa o campo CHEGAR ────────────────────────────
  it('o schema de criar item NÃO descarta `concluido`', () => {
    const r = createChecklistItemSchema.parse({ texto: 'Feito', concluido: true });
    expect(r.concluido).toBe(true);
  });

  it('o schema de criar checklist com itens NÃO descarta `concluido`', () => {
    const r = createChecklistSchema.parse({
      titulo: 'Importado',
      itens: [{ texto: 'Feito', concluido: true }, { texto: 'A fazer' }],
    });
    expect(r.itens?.[0].concluido).toBe(true);
    expect(r.itens?.[1].concluido).toBeUndefined();
  });

  // ── ponta 2: o serviço GRAVA o que chegou ─────────────────────────────
  it('createItem grava concluido: true', async () => {
    await d.svc.createItem(user, 'ck1', { texto: 'Feito', concluido: true });

    expect(d.prisma.kanbanChecklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ texto: 'Feito', concluido: true }),
      }),
    );
  });

  it('createItem sem `concluido` continua nascendo desmarcado', async () => {
    await d.svc.createItem(user, 'ck1', { texto: 'A fazer' });

    expect(d.prisma.kanbanChecklistItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ concluido: false }) }),
    );
  });

  it('create com itens grava o marcado marcado e o resto desmarcado', async () => {
    await d.svc.create(user, 'c1', {
      titulo: 'Importado',
      itens: [{ texto: 'Feito', concluido: true }, { texto: 'A fazer' }],
    });

    const data = d.prisma.kanbanChecklist.create.mock.calls[0][0].data as {
      itens: { create: Array<{ texto: string; concluido: boolean }> };
    };
    expect(data.itens.create[0]).toMatchObject({ texto: 'Feito', concluido: true });
    expect(data.itens.create[1]).toMatchObject({ texto: 'A fazer', concluido: false });
  });
});
