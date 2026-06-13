import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { empresaFilter, getCallerEmpresaId, isGlobalAdmin } from './auth-context';

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({
    id: 'u-1',
    email: 'u@e.com',
    nome: 'U',
    role: 'DIRECTOR',
    empresaIds: ['emp-A'],
    empresaIdAtiva: 'emp-A',
    ...overrides,
  }) as AuthenticatedUser;

describe('empresaFilter — isolamento por tenant', () => {
  it('escopa DIRECTOR/GERENTE/REP/SAC pela empresa ativa', () => {
    for (const role of ['DIRECTOR', 'GERENTE', 'REP', 'SAC'] as const) {
      const user = fakeUser({ role, empresaIdAtiva: 'emp-X' });
      expect(empresaFilter(user)).toEqual({ empresaId: 'emp-X' });
    }
  });

  it('ADMIN TAMBÉM é escopado pela empresa ativa (não vê todas misturadas)', () => {
    const admin = fakeUser({ role: 'ADMIN', empresaIdAtiva: 'emp-B' });
    expect(empresaFilter(admin)).toEqual({ empresaId: 'emp-B' });
  });

  it('ADMIN trocando de empresa (seletor) filtra pela nova empresa ativa', () => {
    expect(empresaFilter(fakeUser({ role: 'ADMIN', empresaIdAtiva: 'emp-1' }))).toEqual({
      empresaId: 'emp-1',
    });
    expect(empresaFilter(fakeUser({ role: 'ADMIN', empresaIdAtiva: 'emp-2' }))).toEqual({
      empresaId: 'emp-2',
    });
  });

  it('sem empresa ativa → ForbiddenException (não retorna filtro vazio)', () => {
    const semEmpresa = fakeUser({ role: 'ADMIN', empresaIdAtiva: null });
    expect(() => empresaFilter(semEmpresa)).toThrow(ForbiddenException);
  });

  it('getCallerEmpresaId e isGlobalAdmin seguem funcionando', () => {
    expect(getCallerEmpresaId(fakeUser({ empresaIdAtiva: 'emp-A' }))).toBe('emp-A');
    expect(isGlobalAdmin(fakeUser({ role: 'ADMIN' }))).toBe(true);
    expect(isGlobalAdmin(fakeUser({ role: 'DIRECTOR' }))).toBe(false);
  });
});
