import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@shared/errors/app-exception';
import { AuthGuard } from './auth.guard';

/** Contexto NestJS mínimo pra um request HTTP — MESMA instância de request em
 *  toda chamada a getRequest() (senão mutar .method depois não tem efeito, já
 *  que o guard chama getRequest() de novo internamente). */
const fakeContext = (opts: { method: string; path: string; headers: Record<string, string> }) => {
  const request = { method: opts.method, path: opts.path, headers: opts.headers };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

const bktUser = {
  id: 'u1',
  email: 'master@betinna.ai',
  nome: 'Master',
  role: 'DIRECTOR',
  status: 'ATIVO',
  empresas: [{ empresaId: 'emp-1' }],
};

describe('AuthGuard — token de API (bkt_) em /funis', () => {
  let guard: AuthGuard;
  let prisma: {
    kanbanApiToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    usuario: { findUnique: ReturnType<typeof vi.fn> };
  };
  let redis: {
    get: ReturnType<typeof vi.fn>;
    setNxEx: ReturnType<typeof vi.fn>;
    setEx: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      kanbanApiToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tok-1',
          empresaId: 'emp-1',
          usuarioId: 'u1',
          escopo: ['funis'],
          revogado: false,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      usuario: { findUnique: vi.fn().mockResolvedValue(bktUser) },
    };
    redis = {
      get: vi.fn().mockResolvedValue(null), // sempre cache-miss → força ir no Prisma
      setNxEx: vi.fn().mockResolvedValue(true),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new AuthGuard(
      reflector,
      {} as never, // SupabaseAuthService — não usado no caminho bkt_
      prisma as never,
      redis as never,
      { get: () => 300 } as never, // EnvService.get('AUTH_CACHE_TTL_SECONDS')
    );
  });

  it('PATCH em /funis PASSA com escopo "funis" (escrita liberada — card MCP funil/etapa)', async () => {
    const ctx = fakeContext({
      method: 'PATCH',
      path: '/funis/f1/etapas/et-1',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('DELETE em /funis/:id/etapas/:etapaId PASSA (etapas_remover via MCP)', async () => {
    const ctx = fakeContext({
      method: 'DELETE',
      path: '/funis/f1/etapas/et-1',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('POST em /contatos CONTINUA bloqueado (PII — regra não mudou)', async () => {
    prisma.kanbanApiToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      empresaId: 'emp-1',
      usuarioId: 'u1',
      escopo: ['contatos'],
      revogado: false,
    });
    const ctx = fakeContext({
      method: 'POST',
      path: '/contatos/criar-leads',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PATCH em /funis é REJEITADO se o token não tem escopo "funis"', async () => {
    prisma.kanbanApiToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      empresaId: 'emp-1',
      usuarioId: 'u1',
      escopo: ['kanban'], // sem "funis"
      revogado: false,
    });
    const ctx = fakeContext({
      method: 'PATCH',
      path: '/funis/f1',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ─── Auditoria 2026-08: escopo do PAT ancorado no 1º segmento ─────────

describe('AuthGuard — escopo do bkt_ não vaza por rota que CONTÉM o nome', () => {
  let guard: AuthGuard;
  let prisma: {
    kanbanApiToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    usuario: { findUnique: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = {
      kanbanApiToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tok-1',
          empresaId: 'emp-1',
          usuarioId: 'u1',
          escopo: ['kanban'],
          revogado: false,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      usuario: { findUnique: vi.fn().mockResolvedValue(bktUser) },
    };
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNxEx: vi.fn().mockResolvedValue(true),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    guard = new AuthGuard(
      reflector as unknown as Reflector,
      {} as never,
      prisma as never,
      redis as never,
      { get: () => 300 } as never,
    );
  });

  it('token de escopo "kanban" NÃO acessa /leads/kanban (pipeline de leads, PII)', async () => {
    // O regex de "contém" casava /leads/kanban: um token vendido como acesso aos
    // QUADROS lia o funil de leads inteiro.
    const ctx = fakeContext({
      method: 'GET',
      path: '/api/v1/leads/kanban',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o quadro de verdade (/kanban) segue passando, com ou sem prefixo da API', async () => {
    for (const path of ['/kanban/boards', '/api/v1/kanban/boards']) {
      const ctx = fakeContext({
        method: 'GET',
        path,
        headers: { authorization: 'Bearer bkt_abc' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });
});
