import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { NotificacoesService } from './notificacoes.service';

/** Mock leve do PrismaService */
const makePrisma = () => ({
  notificacao: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  usuario: {
    findMany: vi.fn(),
  },
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'u@betinna.ai',
  nome: 'User Teste',
  role: 'REP' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

describe('NotificacoesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: NotificacoesService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new NotificacoesService(prisma as never);
  });

  it('list — retorna paginação + contagem de não-lidas', async () => {
    prisma.notificacao.findMany.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);
    prisma.notificacao.count
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(1); // não-lidas

    const r = await svc.list(fakeUser(), {
      page: 1,
      limit: 20,
      apenasNaoLidas: false,
    });

    expect(r.data).toHaveLength(2);
    expect(r.pagination.total).toBe(2);
    expect(r.naoLidas).toBe(1);
  });

  it('list — filtro apenasNaoLidas aplica where lidaEm=null', async () => {
    prisma.notificacao.findMany.mockResolvedValue([]);
    prisma.notificacao.count.mockResolvedValue(0);

    await svc.list(fakeUser(), { page: 1, limit: 20, apenasNaoLidas: true });
    const whereArg = prisma.notificacao.findMany.mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ lidaEm: null });
  });

  it('naoLidas — retorna apenas count barato', async () => {
    prisma.notificacao.count.mockResolvedValue(5);
    const r = await svc.naoLidas(fakeUser());
    expect(r).toEqual({ naoLidas: 5 });
  });

  it('marcarLida — atualiza lidaEm quando existe e não estava lida', async () => {
    prisma.notificacao.findFirst.mockResolvedValue({ id: 'n1', lidaEm: null });
    prisma.notificacao.update.mockResolvedValue({ id: 'n1', lidaEm: new Date() });

    const r = await svc.marcarLida(fakeUser(), 'n1');
    expect(prisma.notificacao.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { lidaEm: expect.any(Date) },
    });
    expect(r.id).toBe('n1');
  });

  it('marcarLida — idempotente quando já estava lida', async () => {
    const ja = { id: 'n1', lidaEm: new Date() };
    prisma.notificacao.findFirst.mockResolvedValue(ja);

    const r = await svc.marcarLida(fakeUser(), 'n1');
    expect(prisma.notificacao.update).not.toHaveBeenCalled();
    expect(r).toBe(ja);
  });

  it('marcarLida — NotFoundException se não pertence ao usuário', async () => {
    prisma.notificacao.findFirst.mockResolvedValue(null);
    await expect(svc.marcarLida(fakeUser(), 'n-alheia')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marcarTodasLidas — updateMany retorna count', async () => {
    prisma.notificacao.updateMany.mockResolvedValue({ count: 3 });
    const r = await svc.marcarTodasLidas(fakeUser());
    expect(r).toEqual({ atualizadas: 3 });
  });

  it('deletar — só apaga se pertencer ao usuário', async () => {
    prisma.notificacao.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.notificacao.delete.mockResolvedValue({ id: 'n1' });
    await svc.deletar(fakeUser(), 'n1');
    expect(prisma.notificacao.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
  });

  it('deletar — NotFoundException se não pertence', async () => {
    prisma.notificacao.findFirst.mockResolvedValue(null);
    await expect(svc.deletar(fakeUser(), 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ForbiddenException quando empresaIdAtiva está vazio', async () => {
    await expect(
      svc.list(fakeUser({ empresaIdAtiva: undefined, empresaIds: [] }), {
        page: 1,
        limit: 20,
        apenasNaoLidas: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ─── Trigger / best-effort ──────────────────────────────────────────

  it('criarParaUsuario — cria com defaults', async () => {
    prisma.notificacao.create.mockResolvedValue({ id: 'n1' });
    const r = await svc.criarParaUsuario({
      empresaId: 'emp-1',
      usuarioId: 'user-1',
      tipo: 'APROVACAO_PENDENTE',
      titulo: 'Aprovação pendente',
      mensagem: 'Pedido X aguarda',
    });
    expect(r?.id).toBe('n1');
    const args = prisma.notificacao.create.mock.calls[0][0];
    expect(args.data.prioridade).toBe('NORMAL');
  });

  it('criarParaUsuario — best-effort: retorna null em erro de DB', async () => {
    prisma.notificacao.create.mockRejectedValue(new Error('DB down'));
    const r = await svc.criarParaUsuario({
      empresaId: 'emp-1',
      usuarioId: 'user-1',
      tipo: 'GENERICO',
      titulo: 'X',
      mensagem: 'y',
    });
    expect(r).toBeNull();
  });

  it('criarParaUsuario — trunca títulos/mensagens longos', async () => {
    prisma.notificacao.create.mockResolvedValue({ id: 'n1' });
    await svc.criarParaUsuario({
      empresaId: 'emp-1',
      usuarioId: 'user-1',
      tipo: 'GENERICO',
      titulo: 'A'.repeat(300),
      mensagem: 'B'.repeat(1000),
    });
    const args = prisma.notificacao.create.mock.calls[0][0];
    expect(args.data.titulo.length).toBe(160);
    expect(args.data.mensagem.length).toBe(500);
  });

  it('criarParaRole — cria N notificações via createMany', async () => {
    prisma.usuario.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
    prisma.notificacao.createMany.mockResolvedValue({ count: 3 });
    const count = await svc.criarParaRole({
      empresaId: 'emp-1',
      roles: ['GERENTE', 'DIRECTOR'],
      tipo: 'OCORRENCIA_ABERTA',
      titulo: 'Nova ocorrência crítica',
      mensagem: '...',
    });
    expect(count).toBe(3);
  });

  it('criarParaRole — não chama createMany se não há usuários', async () => {
    prisma.usuario.findMany.mockResolvedValue([]);
    const count = await svc.criarParaRole({
      empresaId: 'emp-1',
      roles: ['SAC'],
      tipo: 'MENSAGEM_INBOX',
      titulo: 'x',
      mensagem: 'y',
    });
    expect(count).toBe(0);
    expect(prisma.notificacao.createMany).not.toHaveBeenCalled();
  });

  it('criarParaRole — best-effort retorna 0 em erro', async () => {
    prisma.usuario.findMany.mockRejectedValue(new Error('boom'));
    const count = await svc.criarParaRole({
      empresaId: 'emp-1',
      roles: ['GERENTE'],
      tipo: 'GENERICO',
      titulo: 'x',
      mensagem: 'y',
    });
    expect(count).toBe(0);
  });
});
