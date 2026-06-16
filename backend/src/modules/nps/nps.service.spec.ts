import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { NpsService } from './nps.service';
import { categorizarNota, submitNpsSchema } from './nps.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrisma = () => ({
  pesquisaNPS: { findFirst: vi.fn(), findMany: vi.fn() },
  respostaNPS: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  cliente: { findFirst: vi.fn() },
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin Teste',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const PESQUISA = {
  id: 'pesq-1',
  empresaId: 'emp-1',
  mensagemAgradecimento: 'Valeu!',
  expiraEm: null,
};

/** Cria uma resposta com a categoria JÁ persistida (é assim que o dashboard lê). */
const resp = (nota: number, categoria: 'DETRATOR' | 'PASSIVO' | 'PROMOTOR') => ({
  nota,
  categoria,
  criadoEm: new Date(),
});

// ===========================================================================
// 1) CLASSIFICAÇÃO — categorizarNota (regra de negócio do NPS)
//    Detrator 0-6 / Passivo (neutro) 7-8 / Promotor 9-10
// ===========================================================================

describe('categorizarNota — classificação NPS (detrator/neutro/promotor)', () => {
  it('notas 0-6 são DETRATOR (inclui as bordas 0 e 6)', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6]) {
      expect(categorizarNota(n)).toBe('DETRATOR');
    }
  });

  it('notas 7-8 são PASSIVO/neutro (inclui as bordas 7 e 8)', () => {
    expect(categorizarNota(7)).toBe('PASSIVO');
    expect(categorizarNota(8)).toBe('PASSIVO');
  });

  it('notas 9-10 são PROMOTOR (inclui as bordas 9 e 10)', () => {
    expect(categorizarNota(9)).toBe('PROMOTOR');
    expect(categorizarNota(10)).toBe('PROMOTOR');
  });

  // Edge case: a função em si NÃO tem guarda de range (a validação 0-10 mora no
  // schema Zod, testado abaixo). Documentamos o comportamento REAL: nota negativa
  // cai em DETRATOR (n<=6) e nota >10 cai em PROMOTOR. Não inventa exceção.
  it('comportamento real fora do range: <0 vira DETRATOR, >10 vira PROMOTOR', () => {
    expect(categorizarNota(-5)).toBe('DETRATOR');
    expect(categorizarNota(11)).toBe('PROMOTOR');
    expect(categorizarNota(999)).toBe('PROMOTOR');
  });
});

// ===========================================================================
// 2) VALIDAÇÃO DE RANGE — submitNpsSchema (0-10, inteiro)
//    É AQUI que "nota fora do range" é barrada antes de chegar no service.
// ===========================================================================

describe('submitNpsSchema — guarda de range da nota (0-10 inteiro)', () => {
  it('aceita notas válidas nas bordas (0 e 10)', () => {
    expect(submitNpsSchema.safeParse({ nota: 0 }).success).toBe(true);
    expect(submitNpsSchema.safeParse({ nota: 10 }).success).toBe(true);
  });

  it('rejeita nota acima de 10', () => {
    expect(submitNpsSchema.safeParse({ nota: 11 }).success).toBe(false);
  });

  it('rejeita nota negativa', () => {
    expect(submitNpsSchema.safeParse({ nota: -1 }).success).toBe(false);
  });

  it('rejeita nota não-inteira', () => {
    expect(submitNpsSchema.safeParse({ nota: 7.5 }).success).toBe(false);
  });

  it('rejeita ausência de nota', () => {
    expect(submitNpsSchema.safeParse({}).success).toBe(false);
  });
});

// ===========================================================================
// 3) REGISTRO de resposta — submitPublico
//    Inclui: persiste com a categoria correta + anti-duplicata/flood + expiração
// ===========================================================================

describe('NpsService.submitPublico — registro de resposta', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: NpsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new NpsService(prisma as never);
    prisma.pesquisaNPS.findFirst.mockResolvedValue(PESQUISA);
    prisma.respostaNPS.create.mockResolvedValue({ id: 'resp-1' });
  });

  it('persiste a resposta com a categoria DERIVADA da nota (promotor)', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue(null);

    await svc.submitPublico('slug', { nota: 10 } as never, { ip: '203.0.113.1' });

    expect(prisma.respostaNPS.create).toHaveBeenCalledTimes(1);
    const arg = prisma.respostaNPS.create.mock.calls[0][0];
    expect(arg.data.categoria).toBe('PROMOTOR');
    expect(arg.data.nota).toBe(10);
    expect(arg.data.pesquisaId).toBe('pesq-1');
  });

  it('persiste categoria DETRATOR para nota baixa', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue(null);

    await svc.submitPublico('slug', { nota: 3 } as never, { ip: '203.0.113.2' });

    expect(prisma.respostaNPS.create.mock.calls[0][0].data.categoria).toBe('DETRATOR');
  });

  it('persiste categoria PASSIVO para nota neutra', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue(null);

    await svc.submitPublico('slug', { nota: 8 } as never, { ip: '203.0.113.3' });

    expect(prisma.respostaNPS.create.mock.calls[0][0].data.categoria).toBe('PASSIVO');
  });

  it('trunca o userAgent em 500 chars (defesa contra payload gigante)', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue(null);

    await svc.submitPublico('slug', { nota: 9 } as never, {
      ip: '203.0.113.4',
      userAgent: 'x'.repeat(5000),
    });

    expect(prisma.respostaNPS.create.mock.calls[0][0].data.userAgent).toHaveLength(500);
  });

  it('pesquisa inexistente/inativa → NotFoundException (não registra)', async () => {
    prisma.pesquisaNPS.findFirst.mockResolvedValue(null);

    await expect(svc.submitPublico('slug', { nota: 9 } as never, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.respostaNPS.create).not.toHaveBeenCalled();
  });

  it('pesquisa expirada → BusinessRuleException (não registra)', async () => {
    prisma.pesquisaNPS.findFirst.mockResolvedValue({
      ...PESQUISA,
      expiraEm: new Date(Date.now() - 60_000), // expirou há 1 min
    });

    await expect(svc.submitPublico('slug', { nota: 9 } as never, {})).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.respostaNPS.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3b) Anti-duplicata / flood — preservado do spec original
// ===========================================================================

describe('NpsService.submitPublico — anti-duplicata/flood', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: NpsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new NpsService(prisma as never);
    prisma.pesquisaNPS.findFirst.mockResolvedValue(PESQUISA);
    prisma.respostaNPS.create.mockResolvedValue({ id: 'resp-1' });
  });

  it('1ª resposta de um IP é registrada', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue(null); // ninguém respondeu ainda

    const r = await svc.submitPublico('slug', { nota: 9 } as never, { ip: '203.0.113.9' });

    expect(prisma.respostaNPS.create).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  it('2ª resposta do MESMO IP NÃO cria nova (idempotente — não infla a métrica)', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue({ id: 'resp-existente' }); // já respondeu

    const r = await svc.submitPublico('slug', { nota: 1 } as never, { ip: '203.0.113.9' });

    expect(prisma.respostaNPS.create).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, message: 'Valeu!' });
    // a dedup foi consultada com (pesquisa, ip)
    expect(prisma.respostaNPS.findFirst).toHaveBeenCalledWith({
      where: { pesquisaId: 'pesq-1', ip: '203.0.113.9' },
      select: { id: true },
    });
  });

  it('sem IP não deduplica (best-effort) — registra normalmente', async () => {
    const r = await svc.submitPublico('slug', { nota: 7 } as never, {});

    expect(prisma.respostaNPS.findFirst).not.toHaveBeenCalled();
    expect(prisma.respostaNPS.create).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// 4) CÁLCULO do score NPS — dashboard
//    score = round((%promotores - %detratores)) = round(((P - D)/total)*100)
// ===========================================================================

describe('NpsService.dashboard — cálculo do score NPS', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: NpsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new NpsService(prisma as never);
    // getById (via dashboard) busca a pesquisa por (id, empresaId)
    prisma.pesquisaNPS.findFirst.mockResolvedValue({ id: 'pesq-1', empresaId: 'emp-1' });
  });

  const runDashboard = (respostas: ReturnType<typeof resp>[]) => {
    prisma.respostaNPS.findMany.mockResolvedValue(respostas);
    return svc.dashboard(fakeUser(), 'pesq-1');
  };

  it('score = %promotores - %detratores (60 prom, 20 det → 40)', async () => {
    // 10 respostas: 6 promotores, 2 detratores, 2 passivos → 60% - 20% = 40
    const respostas = [
      ...Array(6)
        .fill(null)
        .map(() => resp(10, 'PROMOTOR')),
      ...Array(2)
        .fill(null)
        .map(() => resp(2, 'DETRATOR')),
      ...Array(2)
        .fill(null)
        .map(() => resp(7, 'PASSIVO')),
    ];
    const out = await runDashboard(respostas);

    expect(out.stats.total).toBe(10);
    expect(out.stats.promotores).toBe(6);
    expect(out.stats.detratores).toBe(2);
    expect(out.stats.passivos).toBe(2);
    expect(out.stats.score).toBe(40);
  });

  it('score pode ser NEGATIVO quando há mais detratores que promotores', async () => {
    // 1 promotor, 3 detratores → 25% - 75% = -50
    const respostas = [
      resp(9, 'PROMOTOR'),
      resp(1, 'DETRATOR'),
      resp(2, 'DETRATOR'),
      resp(0, 'DETRATOR'),
    ];
    const out = await runDashboard(respostas);

    expect(out.stats.score).toBe(-50);
  });

  it('score é ARREDONDADO (Math.round) — 1 de 3 promotores → 33', async () => {
    // 1 promotor, 0 detratores, 2 passivos → (1/3)*100 = 33.33 → 33
    const respostas = [resp(10, 'PROMOTOR'), resp(7, 'PASSIVO'), resp(8, 'PASSIVO')];
    const out = await runDashboard(respostas);

    expect(out.stats.score).toBe(33);
  });

  it('só passivos → score 0 (nem promotor nem detrator move a agulha)', async () => {
    const respostas = [resp(7, 'PASSIVO'), resp(8, 'PASSIVO')];
    const out = await runDashboard(respostas);

    expect(out.stats.score).toBe(0);
  });

  it('EDGE: sem respostas → score 0, mediaNota 0, não divide por zero', async () => {
    const out = await runDashboard([]);

    expect(out.stats.total).toBe(0);
    expect(out.stats.score).toBe(0);
    expect(out.stats.mediaNota).toBe(0);
  });

  it('média da nota é calculada e arredondada a 1 casa', async () => {
    // notas 9 e 10 → média 9.5
    const respostas = [resp(9, 'PROMOTOR'), resp(10, 'PROMOTOR')];
    const out = await runDashboard(respostas);

    expect(out.stats.mediaNota).toBe(9.5);
  });

  it('distribuição conta por nota (índices 0-10)', async () => {
    const respostas = [resp(10, 'PROMOTOR'), resp(10, 'PROMOTOR'), resp(0, 'DETRATOR')];
    const out = await runDashboard(respostas);

    expect(out.distribuicao).toHaveLength(11);
    expect(out.distribuicao[10]).toBe(2);
    expect(out.distribuicao[0]).toBe(1);
    expect(out.distribuicao[5]).toBe(0);
  });

  it('pesquisa inexistente (ou de outra empresa) → NotFoundException', async () => {
    prisma.pesquisaNPS.findFirst.mockResolvedValue(null);

    await expect(svc.dashboard(fakeUser(), 'pesq-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
