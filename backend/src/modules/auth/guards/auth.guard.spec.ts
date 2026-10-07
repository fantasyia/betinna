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

describe('AuthGuard — token de API deixa rastro de QUAL token entrou', () => {
  it('bkt_ marca req.apiToken com id e nome — o user é o DONO, e sem isto a auditoria não separa tela de MCP', async () => {
    const prisma = {
      kanbanApiToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tok-9',
          nome: 'Claude Code - sessão master',
          empresaId: 'emp-1',
          usuarioId: 'u1',
          escopo: ['fluxos'],
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
    const guard = new AuthGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {} as never,
      prisma as never,
      redis as never,
      { get: () => 300 } as never,
    );
    const ctx = fakeContext({
      method: 'PUT',
      path: '/fluxos/f1',
      headers: { authorization: 'Bearer bkt_abc' },
    });
    await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest<{ apiToken?: unknown; user?: { id: string } }>();
    expect(req.apiToken).toEqual({ id: 'tok-9', nome: 'Claude Code - sessão master' });
    expect(req.user?.id).toBe('u1');
  });
});

describe('AuthGuard — token de API (bkt_) em /funis', () => {
  let guard: AuthGuard;
  let prisma: {
    kanbanApiToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    usuario: { findUnique: ReturnType<typeof vi.fn> };
  };
  let redis: {
    get: ReturnType<typeof vi.fn>;
    setNxEx: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
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
      eval: vi.fn().mockResolvedValue(1),
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

  // ── /inbox: leitura, com UMA exceção de verbo ──────────────────────
  const comEscopoInbox = () => {
    prisma.kanbanApiToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      empresaId: 'emp-1',
      usuarioId: 'u1',
      escopo: ['inbox'],
      revogado: false,
    });
  };

  it('DELETE em /inbox/:id/mensagens PASSA — é o "Zerar conversa" (reset entre casos de teste)', async () => {
    comEscopoInbox();
    const ctx = fakeContext({
      method: 'DELETE',
      path: '/inbox/conv-1/mensagens',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('POST em /inbox/:id/responder CONTINUA bloqueado — mandar mensagem não é papel de agente', async () => {
    // A exceção é por ROTA EXATA + verbo, não "escrita liberada em /inbox".
    comEscopoInbox();
    const ctx = fakeContext({
      method: 'POST',
      path: '/inbox/conv-1/responder',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(/só faz leitura/);
  });

  it('DELETE em /inbox/whatsapp/limpar CONTINUA bloqueado — o nuke da empresa não é por token', async () => {
    comEscopoInbox();
    const ctx = fakeContext({
      method: 'DELETE',
      path: '/inbox/whatsapp/limpar',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(/só faz leitura/);
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

describe('AuthGuard — token de API (bkt_) em /campanhas', () => {
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
          escopo: ['campanhas'],
          revogado: false,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      usuario: { findUnique: vi.fn().mockResolvedValue(bktUser) },
    };
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNxEx: vi.fn().mockResolvedValue(true),
      eval: vi.fn().mockResolvedValue(1),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new AuthGuard(
      reflector,
      {} as never, // SupabaseAuthService — não usado no caminho bkt_
      prisma as never,
      redis as never,
      { get: () => 300 } as never,
    );
  });

  it('POST em /campanha-templates PASSA — é o e-mail que o agente escreve', async () => {
    // O template tem controller PRÓPRIO (/campanha-templates): dentro de
    // /campanhas o @Get(":id") capturava "templates". Casar só /campanhas
    // deixaria o escopo sem acesso ao que o agente vem escrever.
    const ctx = fakeContext({
      method: 'POST',
      path: '/campanha-templates',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('POST em /campanhas/:id/disparar é BLOQUEADO — sai e-mail pra base real', async () => {
    const ctx = fakeContext({
      method: 'POST',
      path: '/campanhas/c1/disparar',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AGENDAR também é bloqueado — dispara depois, sem ninguém apertar nada', async () => {
    const ctx = fakeContext({
      method: 'POST',
      path: '/campanhas/c1/agendar',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('REENVIAR-ERROS também — manda de novo pra quem falhou', async () => {
    const ctx = fakeContext({
      method: 'POST',
      path: '/campanhas/c1/reenviar-erros',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('token SEM o escopo "campanhas" não entra em /campanhas', async () => {
    prisma.kanbanApiToken.findUnique.mockResolvedValue({
      id: 'tok-2',
      empresaId: 'emp-1',
      usuarioId: 'u1',
      escopo: ['kanban'],
      revogado: false,
    });
    const ctx = fakeContext({
      method: 'GET',
      path: '/campanhas',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // Auditoria 13/09/2026 (D-4): o PAT alcançava POST /fluxos/:id/ativar e
  // DELETE /fluxos/:id/permanente — e um id injetado no path do MCP chegava
  // lá. Mesma regra das campanhas: apertar o botão é decisão de gente.
  it('POST /fluxos/:id/ativar é BLOQUEADO — ativar é decisão de gente', async () => {
    const ctx = fakeContext({
      method: 'POST',
      path: '/fluxos/f1/ativar',
      headers: { authorization: 'Bearer bkt_abc' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DELETE /fluxos/:id/permanente é BLOQUEADO — apaga fluxo e histórico', async () => {
    const ctx = fakeContext({
      method: 'DELETE',
      path: '/fluxos/f1/permanente',
      headers: { authorization: 'Bearer bkt_abc' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuthGuard — token de API (bkt_) em /integracoes/email', () => {
  let guard: AuthGuard;
  let prisma: {
    kanbanApiToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    usuario: { findUnique: ReturnType<typeof vi.fn> };
  };

  const comEscopo = (escopo: string[]) => {
    prisma.kanbanApiToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      empresaId: 'emp-1',
      usuarioId: 'u1',
      escopo,
      revogado: false,
    });
  };

  beforeEach(() => {
    prisma = {
      kanbanApiToken: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      usuario: { findUnique: vi.fn().mockResolvedValue(bktUser) },
    };
    comEscopo(['email']);
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNxEx: vi.fn().mockResolvedValue(true),
      eval: vi.fn().mockResolvedValue(1),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new AuthGuard(
      reflector,
      {} as never,
      prisma as never,
      redis as never,
      { get: () => 300 } as never,
    );
  });

  it('as DUAS rotas de e-mail passam, com e sem prefixo da API', async () => {
    const rotas: Array<[string, string]> = [
      ['GET', '/integracoes/email/status'],
      ['POST', '/integracoes/email/teste'],
      ['POST', '/api/v1/integracoes/email/teste'],
    ];
    for (const [method, path] of rotas) {
      const ctx = fakeContext({ method, path, headers: { authorization: 'Bearer bkt_abc' } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  it('o RESTO de /integracoes continua fechado — é DIRECTOR-only por D45', async () => {
    // OAuth de marketplace, WhatsApp da empresa e redes sociais carregam
    // responsabilidade contratual e risco de ban do número. Liberar o módulo
    // inteiro pra pegar duas rotas seria pagar caro por conveniência.
    for (const path of [
      '/integracoes',
      '/integracoes/conectar',
      '/integracoes/whatsapp/qr',
      '/integracoes/email',
      '/integracoes/email/teste/extra',
    ]) {
      const ctx = fakeContext({
        method: 'POST',
        path,
        headers: { authorization: 'Bearer bkt_abc' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('token sem o escopo "email" não entra nem no status', async () => {
    // O escopo fica GRAVADO no token: quem já tem um precisa gerar outro. Foi
    // o que aconteceu quando `campanhas` entrou.
    comEscopo(['kanban', 'campanhas']);
    const ctx = fakeContext({
      method: 'GET',
      path: '/integracoes/email/status',
      headers: { authorization: 'Bearer bkt_abc' },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuthGuard — token de API (bkt_) na vitrine', () => {
  let guard: AuthGuard;
  let prisma: {
    kanbanApiToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    usuario: { findUnique: ReturnType<typeof vi.fn> };
  };

  const comEscopo = (escopo: string[]) => {
    prisma.kanbanApiToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      empresaId: 'emp-1',
      usuarioId: 'u1',
      escopo,
      revogado: false,
    });
  };
  const chamar = (method: string, path: string) =>
    guard.canActivate(fakeContext({ method, path, headers: { authorization: 'Bearer bkt_abc' } }));

  beforeEach(() => {
    prisma = {
      kanbanApiToken: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      usuario: { findUnique: vi.fn().mockResolvedValue(bktUser) },
    };
    comEscopo(['kanban', 'vitrine']);
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNxEx: vi.fn().mockResolvedValue(true),
      eval: vi.fn().mockResolvedValue(1),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new AuthGuard(
      reflector,
      {} as never,
      prisma as never,
      redis as never,
      { get: () => 300 } as never,
    );
  });

  it('cadastro da vitrine e precificação passam (leitura e escrita), com e sem prefixo', async () => {
    const rotas: Array<[string, string]> = [
      ['GET', '/vitrine/admin/modelos'],
      ['POST', '/api/v1/vitrine/admin/modelos'],
      ['POST', '/vitrine/admin/cores-modelo/mc-1/fotos'],
      ['DELETE', '/vitrine/admin/fotos/f-1'],
      ['GET', '/precificacao'],
      ['PUT', '/api/v1/precificacao/linhas/l-1'],
    ];
    for (const [method, path] of rotas) await expect(chamar(method, path)).resolves.toBe(true);
  });

  it('sem o escopo vitrine → 403, mesmo com outros escopos', async () => {
    comEscopo(['kanban', 'fluxos']);
    await expect(chamar('GET', '/vitrine/admin/modelos')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(chamar('GET', '/precificacao')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o escopo não vaza: só /vitrine/admin (não /vitrine/outra) nem /erp', async () => {
    await expect(chamar('GET', '/vitrine/configuracao')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(chamar('GET', '/erp/estoque/saldos')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(chamar('GET', '/leads/vitrine/admin')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuthGuard — escopo encaixe (agente local da GPU)', () => {
  // Reaproveita a montagem do bloco da vitrine: token PAT, só muda o escopo.
  let guard: AuthGuard;
  let prisma: {
    kanbanApiToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    usuario: { findUnique: ReturnType<typeof vi.fn> };
  };
  const chamar = (method: string, path: string) =>
    guard.canActivate({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          path,
          url: path,
          headers: { authorization: 'Bearer bkt_' + 'e'.repeat(40) },
          ip: '1.1.1.1',
        }),
      }),
    } as never);

  beforeEach(() => {
    prisma = {
      kanbanApiToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: 't-enc',
          nome: 'Agente encaixe — PC Léo',
          usuarioId: 'u-1',
          empresaId: 'emp-1',
          revogado: false,
          escopo: ['encaixe'],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      usuario: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u-1',
          email: 'leo@x.com',
          nome: 'Léo',
          role: 'DIRECTOR',
          status: 'ATIVO',
          empresas: [{ empresaId: 'emp-1' }],
        }),
      },
    };
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      setNxEx: vi.fn().mockResolvedValue(true),
      eval: vi.fn().mockResolvedValue(1),
      setEx: vi.fn().mockResolvedValue(undefined),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    guard = new AuthGuard(
      reflector,
      {} as never,
      prisma as never,
      redis as never,
      { get: () => 300 } as never,
    );
  });

  it('as rotas do agente passam', async () => {
    for (const [m, p] of [
      ['POST', '/erp/encaixe/agente/proximo'],
      ['GET', '/api/v1/erp/encaixe/agente/job-1'],
      ['POST', '/erp/encaixe/agente/job-1/progresso'],
      ['POST', '/erp/encaixe/agente/job-1/resultado'],
    ] as const) {
      await expect(chamar(m, p)).resolves.toBe(true);
    }
  });

  it('o escopo não vaza pro resto do ERP (OP, estoque, financeiro, baixar .plt pela tela)', async () => {
    for (const p of [
      '/erp/ops',
      '/erp/estoque/saldos',
      '/financeiro/titulos',
      '/erp/encaixes/job-1/arquivos/PLT',
    ]) {
      await expect(chamar('GET', p)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
