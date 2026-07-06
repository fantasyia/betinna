import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MetasService } from './metas.service';

// ─── Mocks ───────────────────────────────────────────────────

const makePrismaMock = () => ({
  meta: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  usuario: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  },
  pedido: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { total: null } }),
  },
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

/**
 * Helper pra montar uma meta crua (como o Prisma devolveria do banco).
 * valorAlvo vem como Prisma.Decimal — o service faz Number() em cima.
 * Por padrão a janela é [ontem, amanhã] pra não cair em risco por tempo.
 */
const ONE_DAY = 24 * 60 * 60 * 1000;
const makeMetaRow = (overrides: Partial<Record<string, unknown>> = {}) => {
  const now = Date.now();
  return {
    id: 'meta-1',
    titulo: 'Meta Faturamento',
    descricao: null,
    tipo: 'FATURAMENTO',
    valorAlvo: new Prisma.Decimal('10000'),
    alvoTipo: 'EMPRESA',
    alvoId: null,
    periodicidade: 'MES',
    inicio: new Date(now - ONE_DAY),
    fim: new Date(now + ONE_DAY),
    ativo: true,
    ...overrides,
  };
};

describe('MetasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: MetasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new MetasService(prisma as never);
  });

  // ─── Multi-tenant guard ────────────────────────────────────

  describe('requireEmpresa (via list)', () => {
    it('lança Forbidden quando o usuário não tem empresa ativa', async () => {
      await expect(svc.list(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('filtra metas pela empresa ativa do usuário', async () => {
      prisma.meta.findMany.mockResolvedValue([]);
      await svc.list(fakeUser({ empresaIdAtiva: 'emp-9' }));
      const where = prisma.meta.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-9');
    });
  });

  // ─── CÁLCULO DE PROGRESSO (o número da diretoria) ──────────

  describe('cálculo de progresso (realizado vs meta)', () => {
    it('FATURAMENTO: progresso = atingido / valorAlvo * 100', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ valorAlvo: new Prisma.Decimal('10000') }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('2500') } });

      const [m] = await svc.list(fakeUser());
      expect(m.atingido).toBe(2500);
      expect(m.progresso).toBe(25);
    });

    it('progresso 100% quando realizado == meta', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ valorAlvo: new Prisma.Decimal('10000') }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('10000') } });

      const [m] = await svc.list(fakeUser());
      expect(m.progresso).toBe(100);
    });

    it('realizado > meta: progresso passa de 100 (não satura)', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ valorAlvo: new Prisma.Decimal('10000') }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('15000') } });

      const [m] = await svc.list(fakeUser());
      expect(m.atingido).toBe(15000);
      expect(m.progresso).toBe(150);
    });

    it('EDGE: meta zero → progresso 0 (não divide por zero, não vira NaN/Infinity)', async () => {
      prisma.meta.findMany.mockResolvedValue([makeMetaRow({ valorAlvo: new Prisma.Decimal('0') })]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('500') } });

      const [m] = await svc.list(fakeUser());
      expect(m.valorAlvo).toBe(0);
      expect(m.progresso).toBe(0);
      expect(Number.isFinite(m.progresso)).toBe(true);
    });

    it('EDGE: sem dados (aggregate _sum.total null) → atingido 0, progresso 0', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ valorAlvo: new Prisma.Decimal('10000') }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: null } });

      const [m] = await svc.list(fakeUser());
      expect(m.atingido).toBe(0);
      expect(m.progresso).toBe(0);
    });

    it('PEDIDOS: atingido é a CONTAGEM de pedidos (count), não soma de valor', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ tipo: 'PEDIDOS', valorAlvo: new Prisma.Decimal('20') }),
      ]);
      prisma.pedido.count.mockResolvedValue(8);

      const [m] = await svc.list(fakeUser());
      expect(prisma.pedido.count).toHaveBeenCalled();
      expect(prisma.pedido.aggregate).not.toHaveBeenCalled();
      expect(m.atingido).toBe(8);
      expect(m.progresso).toBe(40); // 8/20 * 100
    });

    it('atingido sempre vem como number (não Decimal/string) — #17 Decimal', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ valorAlvo: new Prisma.Decimal('1000.00') }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal('333.33') },
      });

      const [m] = await svc.list(fakeUser());
      expect(typeof m.atingido).toBe('number');
      expect(m.atingido).toBe(333.33);
      expect(typeof m.valorAlvo).toBe('number');
    });
  });

  // ─── Filtro de pedidos do cálculo ──────────────────────────

  describe('janela e status considerados no atingimento', () => {
    it('só conta pedidos válidos (não cancelado/rascunho) dentro da janela inicio..fim', async () => {
      const inicio = new Date('2026-01-01T00:00:00.000Z');
      const fim = new Date('2026-01-31T23:59:59.000Z');
      prisma.meta.findMany.mockResolvedValue([makeMetaRow({ inicio, fim })]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('1') } });

      await svc.list(fakeUser());
      const where = prisma.pedido.aggregate.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-1');
      expect(where.criadoEm).toEqual({ gte: inicio, lte: fim });
      expect(where.status.in).toEqual([
        'ENVIADO_OMIE',
        'PAGO',
        'EM_SEPARACAO',
        'ENVIADO',
        'ENTREGUE',
      ]);
    });

    it('alvo REP: filtra atingimento pelo representanteId do alvo', async () => {
      prisma.meta.findMany.mockResolvedValue([makeMetaRow({ alvoTipo: 'REP', alvoId: 'rep-7' })]);
      prisma.usuario.findUnique.mockResolvedValue({ nome: 'Rep Sete' });
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('100') } });

      const [m] = await svc.list(fakeUser());
      const where = prisma.pedido.aggregate.mock.calls[0][0].where;
      expect(where.representanteId).toBe('rep-7');
      expect(m.alvoNome).toBe('Rep Sete');
    });

    it('alvo GERENTE: agrega pedidos de TODOS os reps sob a gerência (representanteId in [...])', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ alvoTipo: 'GERENTE', alvoId: 'ger-1' }),
      ]);
      // findUnique resolve o nome do gerente; findMany lista os reps dele
      prisma.usuario.findUnique.mockResolvedValue({ nome: 'Gerente Um' });
      prisma.usuario.findMany.mockResolvedValue([{ id: 'rep-a' }, { id: 'rep-b' }]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('100') } });

      const [m] = await svc.list(fakeUser());
      const where = prisma.pedido.aggregate.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-a', 'rep-b'] });
      expect(m.alvoNome).toBe('Gerente Um');
    });
  });

  // ─── Risco ─────────────────────────────────────────────────

  describe('flag de risco (passou 70% do tempo mas <70% do alvo)', () => {
    it('marca risco quando >70% do tempo decorreu e progresso < 70%', async () => {
      const now = Date.now();
      // janela de 100 dias, começou há 90 dias → 90% do tempo
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({
          inicio: new Date(now - 90 * ONE_DAY),
          fim: new Date(now + 10 * ONE_DAY),
          valorAlvo: new Prisma.Decimal('10000'),
        }),
      ]);
      // só 30% atingido
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('3000') } });

      const [m] = await svc.list(fakeUser());
      expect(m.risco).toBe(true);
    });

    it('NÃO marca risco quando o progresso acompanha o tempo (>=70%)', async () => {
      const now = Date.now();
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({
          inicio: new Date(now - 90 * ONE_DAY),
          fim: new Date(now + 10 * ONE_DAY),
          valorAlvo: new Prisma.Decimal('10000'),
        }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('8000') } });

      const [m] = await svc.list(fakeUser());
      expect(m.risco).toBe(false);
    });

    it('NÃO marca risco no início do período (pouco tempo decorrido)', async () => {
      const now = Date.now();
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({
          inicio: new Date(now - 5 * ONE_DAY),
          fim: new Date(now + 95 * ONE_DAY),
          valorAlvo: new Prisma.Decimal('10000'),
        }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: null } }); // 0% atingido

      const [m] = await svc.list(fakeUser());
      expect(m.risco).toBe(false);
    });

    it('NÃO marca risco depois do prazo encerrado (pctTempo > 100)', async () => {
      const now = Date.now();
      // janela já terminou ontem
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({
          inicio: new Date(now - 30 * ONE_DAY),
          fim: new Date(now - ONE_DAY),
          valorAlvo: new Prisma.Decimal('10000'),
        }),
      ]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('1000') } });

      const [m] = await svc.list(fakeUser());
      expect(m.risco).toBe(false);
    });
  });

  // ─── Resolução do nome do alvo ─────────────────────────────

  describe('alvoNome', () => {
    it('alvo EMPRESA → "Empresa" (sem lookup de usuário)', async () => {
      prisma.meta.findMany.mockResolvedValue([makeMetaRow({ alvoTipo: 'EMPRESA', alvoId: null })]);
      const [m] = await svc.list(fakeUser());
      expect(m.alvoNome).toBe('Empresa');
      expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    });

    it('alvo REP com usuário removido → "Usuário removido"', async () => {
      prisma.meta.findMany.mockResolvedValue([
        makeMetaRow({ alvoTipo: 'REP', alvoId: 'rep-ghost' }),
      ]);
      prisma.usuario.findUnique.mockResolvedValue(null);
      const [m] = await svc.list(fakeUser());
      expect(m.alvoNome).toBe('Usuário removido');
    });
  });

  // ─── getById ───────────────────────────────────────────────

  describe('getById', () => {
    it('retorna a meta com progresso quando existe na empresa', async () => {
      const row = makeMetaRow({ id: 'meta-x' });
      prisma.meta.findFirst.mockResolvedValue(row);
      prisma.meta.findMany.mockResolvedValue([row]);
      prisma.pedido.aggregate.mockResolvedValue({ _sum: { total: new Prisma.Decimal('5000') } });

      const m = await svc.getById(fakeUser(), 'meta-x');
      expect(m.id).toBe('meta-x');
      expect(m.progresso).toBe(50); // 5000/10000
    });

    it('lança NotFound quando a meta não pertence à empresa', async () => {
      prisma.meta.findFirst.mockResolvedValue(null);
      await expect(svc.getById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── upsert (cria / atualiza) ──────────────────────────────

  describe('upsert', () => {
    const baseDto = {
      titulo: 'Nova meta',
      descricao: 'desc',
      tipo: 'FATURAMENTO' as const,
      valorAlvo: 50000,
      alvoTipo: 'REP' as const,
      alvoId: 'rep-1',
      periodicidade: 'MES' as const,
      inicio: '2026-01-01T00:00:00.000Z',
      fim: '2026-01-31T23:59:59.000Z',
      ativo: true,
    };

    it('cria meta nova (id null) com empresaId do usuário e valorAlvo como Decimal', async () => {
      prisma.meta.create.mockImplementation((args: { data: unknown }) =>
        Promise.resolve(args.data),
      );
      await svc.upsert(fakeUser(), null, baseDto);

      expect(prisma.meta.create).toHaveBeenCalledTimes(1);
      expect(prisma.meta.update).not.toHaveBeenCalled();
      const data = prisma.meta.create.mock.calls[0][0].data;
      expect(data.empresaId).toBe('emp-1');
      expect(data.titulo).toBe('Nova meta');
      expect(data.valorAlvo).toBeInstanceOf(Prisma.Decimal);
      expect(data.valorAlvo.toString()).toBe('50000');
      expect(data.inicio).toBeInstanceOf(Date);
      expect(data.fim).toBeInstanceOf(Date);
    });

    it('atualiza meta existente (id presente) via update no id correto', async () => {
      prisma.meta.findFirst.mockResolvedValue({ id: 'meta-9' }); // guard IDOR: meta é da empresa
      prisma.meta.update.mockResolvedValue({ id: 'meta-9' });
      await svc.upsert(fakeUser(), 'meta-9', baseDto);

      expect(prisma.meta.update).toHaveBeenCalledTimes(1);
      expect(prisma.meta.create).not.toHaveBeenCalled();
      const call = prisma.meta.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'meta-9' });
    });

    it('alvoTipo EMPRESA zera o alvoId (não vincula a um usuário)', async () => {
      prisma.meta.create.mockImplementation((args: { data: unknown }) =>
        Promise.resolve(args.data),
      );
      await svc.upsert(fakeUser(), null, {
        ...baseDto,
        alvoTipo: 'EMPRESA',
        alvoId: 'rep-1', // mesmo passando, deve ser ignorado
      });
      const data = prisma.meta.create.mock.calls[0][0].data;
      expect(data.alvoId).toBeNull();
    });

    it('descricao ausente vira null', async () => {
      prisma.meta.create.mockImplementation((args: { data: unknown }) =>
        Promise.resolve(args.data),
      );
      const { descricao: _omit, ...semDescricao } = baseDto;
      void _omit;
      await svc.upsert(fakeUser(), null, semDescricao as never);
      const data = prisma.meta.create.mock.calls[0][0].data;
      expect(data.descricao).toBeNull();
    });

    it('exige empresa ativa (Forbidden sem empresa)', async () => {
      await expect(
        svc.upsert(fakeUser({ empresaIdAtiva: null }), null, baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ─── delete ────────────────────────────────────────────────

  describe('delete', () => {
    it('apaga a meta da própria empresa e retorna { deleted: true }', async () => {
      prisma.meta.findFirst.mockResolvedValue({ id: 'meta-1' });
      prisma.meta.delete.mockResolvedValue({ id: 'meta-1' });
      const out = await svc.delete(fakeUser(), 'meta-1');
      expect(out).toEqual({ deleted: true });
      expect(prisma.meta.delete).toHaveBeenCalledWith({ where: { id: 'meta-1' } });
    });

    it('NotFound quando a meta não é da empresa (não chama delete)', async () => {
      prisma.meta.findFirst.mockResolvedValue(null);
      await expect(svc.delete(fakeUser(), 'outra-emp')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.meta.delete).not.toHaveBeenCalled();
    });
  });

  describe('upsert — IDOR guard na edição por id', () => {
    const dto = {
      titulo: 'Meta X',
      tipo: 'FATURAMENTO',
      valorAlvo: 1000,
      alvoTipo: 'EMPRESA',
      periodicidade: 'MES',
      inicio: '2026-07-01T00:00:00.000Z',
      fim: '2026-07-31T00:00:00.000Z',
      ativo: true,
    } as never;

    it('editar meta de OUTRA empresa → NotFound e NÃO chama update', async () => {
      prisma.meta.findFirst.mockResolvedValue(null); // não pertence à empresa do caller
      await expect(
        svc.upsert(fakeUser({ empresaIdAtiva: 'emp-1' }), 'meta-de-outro-tenant', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.meta.update).not.toHaveBeenCalled();
    });

    it('editar meta da PRÓPRIA empresa → confere dono (findFirst por empresaId) e atualiza', async () => {
      prisma.meta.findFirst.mockResolvedValue({ id: 'meta-1' });
      prisma.meta.update.mockResolvedValue({ id: 'meta-1' });
      await svc.upsert(fakeUser({ empresaIdAtiva: 'emp-1' }), 'meta-1', dto);
      expect(prisma.meta.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'meta-1', empresaId: 'emp-1' } }),
      );
      expect(prisma.meta.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'meta-1' } }),
      );
    });

    it('criar (sem id) NÃO passa pelo guard de edição', async () => {
      prisma.meta.create.mockResolvedValue({ id: 'nova' });
      await svc.upsert(fakeUser(), null, dto);
      expect(prisma.meta.findFirst).not.toHaveBeenCalled();
      expect(prisma.meta.create).toHaveBeenCalled();
    });
  });
});
