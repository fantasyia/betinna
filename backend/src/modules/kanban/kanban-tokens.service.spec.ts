import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@shared/errors/app-exception';
import { KanbanTokensService } from './kanban-tokens.service';

/**
 * Ajuste de ESCOPO de um token existente.
 *
 * Sem isto, cada escopo novo (ex: `conhecimento`) obrigava a REGERAR o token — e
 * regerar significa reconfigurar o MCP em toda máquina que usa. O valor do token
 * não muda aqui; só o que ele alcança.
 */
const makePrisma = () => ({
  kanbanApiToken: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't1', escopo: ['kanban', 'conhecimento'] }),
  },
});

const user = { id: 'u1', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] } as never;

describe('KanbanTokensService.atualizarEscopo', () => {
  it('grava o escopo novo sem trocar o valor do token', async () => {
    const prisma = makePrisma();

    const r = await new KanbanTokensService(prisma as never).atualizarEscopo(user, 't1', {
      escopo: ['kanban', 'conhecimento'],
    });

    expect(prisma.kanbanApiToken.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', usuarioId: 'u1', empresaId: 'emp-1' },
      data: { escopo: ['kanban', 'conhecimento'] },
    });
    // A resposta NUNCA carrega o valor/hash do token.
    expect(r).not.toHaveProperty('token');
    expect(r).not.toHaveProperty('tokenHash');
  });

  it('token de OUTRO dono (ou outra empresa) não é alterável', async () => {
    const prisma = makePrisma();
    prisma.kanbanApiToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new KanbanTokensService(prisma as never).atualizarEscopo(user, 'de-outro', {
        escopo: ['kanban'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.kanbanApiToken.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
