import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { RepScopeService } from './rep-scope.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  usuario: {
    findMany: vi.fn(),
  },
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'user@betinna.ai',
  nome: 'User',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RepScopeService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: RepScopeService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new RepScopeService(prisma as never);
  });

  it('ADMIN retorna null (sem restrição)', async () => {
    const result = await service.getRepIds(fakeUser({ role: 'ADMIN' }));
    expect(result).toBeNull();
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });

  it('DIRECTOR retorna null (sem restrição)', async () => {
    const result = await service.getRepIds(fakeUser({ role: 'DIRECTOR' as UserRole }));
    expect(result).toBeNull();
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });

  it('SAC retorna null (sem restrição de carteira)', async () => {
    const result = await service.getRepIds(fakeUser({ role: 'SAC' }));
    expect(result).toBeNull();
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });

  it('REP retorna [user.id] (apenas a própria carteira)', async () => {
    const result = await service.getRepIds(fakeUser({ role: 'REP', id: 'rep-77' }));
    expect(result).toEqual(['rep-77']);
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });

  it('GERENTE consulta o banco e retorna ids dos REPs sob sua gerência', async () => {
    prisma.usuario.findMany.mockResolvedValue([{ id: 'rep-1' }, { id: 'rep-2' }]);

    const result = await service.getRepIds(fakeUser({ role: 'GERENTE', id: 'ger-1' }));

    expect(result).toEqual(['rep-1', 'rep-2']);
    expect(prisma.usuario.findMany).toHaveBeenCalledWith({
      where: { gerenteId: 'ger-1', role: 'REP' },
      select: { id: true },
    });
  });

  it('GERENTE sem REPs retorna array vazio (nega tudo)', async () => {
    prisma.usuario.findMany.mockResolvedValue([]);

    const result = await service.getRepIds(fakeUser({ role: 'GERENTE', id: 'ger-sem-reps' }));

    expect(result).toEqual([]);
  });
});
