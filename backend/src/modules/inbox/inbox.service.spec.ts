import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CanalAdapterRegistry } from './canal-adapter.registry';
import { InboxService } from './inbox.service';

/**
 * Inbox é restrita a SAC/gerência (REP não acessa). Default usa role SAC pros
 * testes baterem com a política atual; quando o teste quer validar bloqueio,
 * passa explicitamente `role: 'REP'`.
 */
const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'sac@x.com',
  nome: 'SAC',
  role: 'SAC' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const makePrismaMock = () => ({
  conversation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(async () => 0),
    upsert: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  message: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  cliente: {
    findFirst: vi.fn(),
  },
  usuario: {
    findFirst: vi.fn(),
  },
});

describe('InboxService.processarMensagemEntrante', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let registry: CanalAdapterRegistry;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    registry = new CanalAdapterRegistry();
    svc = new InboxService(prisma as never, registry, { get: () => 24 } as never);
  });

  it('cria Conversation + Message novos quando não há nada prévio', async () => {
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    // upsertConversation virou findFirst + create (proprietarioId nullable
    // não suporta unique key direto, então fazemos lookup manual)
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.create.mockResolvedValueOnce({ id: 'conv-1' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-1' });
    prisma.conversation.update.mockResolvedValueOnce({});

    const r = await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511988887777@s.whatsapp.net',
      peerNome: 'João',
      peerTelefone: '5511988887777',
      tipo: 'TEXT',
      conteudo: 'oi',
      externalId: 'wamid-abc',
    });

    expect(r).toEqual({ conversationId: 'conv-1', messageId: 'msg-1', duplicada: false });
    expect(prisma.conversation.create).toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'INBOUND',
          conteudo: 'oi',
          status: 'RECEIVED',
          externalId: 'wamid-abc',
        }),
      }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          naoLidas: { increment: 1 },
          status: 'PENDENTE',
        }),
      }),
    );
  });

  it('é idempotente quando recebe mesmo externalId duas vezes', async () => {
    prisma.message.findFirst.mockResolvedValueOnce({ id: 'msg-1', conversationId: 'conv-1' });

    const r = await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511988887777@s.whatsapp.net',
      tipo: 'TEXT',
      conteudo: 'oi',
      externalId: 'wamid-dup',
    });

    expect(r.duplicada).toBe(true);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('resolve cliente por sufixo do telefone (8 últimos dígitos)', async () => {
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 'cli-9' });
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.create.mockResolvedValueOnce({ id: 'conv-2' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-2' });
    prisma.conversation.update.mockResolvedValueOnce({});

    await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511988887777@s.whatsapp.net',
      peerTelefone: '5511988887777',
      tipo: 'TEXT',
      conteudo: 'olá',
    });

    expect(prisma.cliente.findFirst).toHaveBeenCalledWith({
      where: {
        empresaId: 'emp-1',
        telefone: { contains: '88887777' },
      },
      select: { id: true },
    });
    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clienteId: 'cli-9' }),
      }),
    );
  });

  it('mantém clienteId null quando não há match de telefone', async () => {
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.create.mockResolvedValueOnce({ id: 'conv-3' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-3' });
    prisma.conversation.update.mockResolvedValueOnce({});

    await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511955554444@s.whatsapp.net',
      peerTelefone: '5511955554444',
      tipo: 'TEXT',
      conteudo: 'desconhecido',
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clienteId: null }),
      }),
    );
  });

  it('trunca preview pra 140 chars', async () => {
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.create.mockResolvedValueOnce({ id: 'conv-4' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-4', criadoEm: new Date() });
    prisma.conversation.update.mockResolvedValueOnce({});

    const longText = 'x'.repeat(300);
    await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '551199@s.whatsapp.net',
      tipo: 'TEXT',
      conteudo: longText,
    });

    const updateCall = prisma.conversation.update.mock.calls[0][0] as {
      data: { ultimaMsgPreview: string };
    };
    expect(updateCall.data.ultimaMsgPreview.length).toBeLessThanOrEqual(140);
    expect(updateCall.data.ultimaMsgPreview.endsWith('...')).toBe(true);
  });
});

describe('InboxService.responder', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let registry: CanalAdapterRegistry;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    registry = new CanalAdapterRegistry();
    svc = new InboxService(prisma as never, registry, { get: () => 24 } as never);
  });

  it('falha quando canal não tem adapter registrado', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x@s.whatsapp.net',
      status: 'ABERTA',
    });
    await expect(
      svc.responder(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', { texto: 'oi' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('falha quando adapter indica indisponível (sessão não conectada)', async () => {
    registry.registrar({
      canal: 'WHATSAPP',
      enviarTexto: vi.fn(),
      estaDisponivel: vi.fn(async () => false),
    });
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x',
      status: 'ABERTA',
    });
    await expect(
      svc.responder(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', { texto: 'oi' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('cria mensagem SENT quando adapter envia com sucesso', async () => {
    const enviar = vi.fn(async () => ({ externalId: 'wamid-out-1' }));
    registry.registrar({
      canal: 'WHATSAPP',
      enviarTexto: enviar,
      estaDisponivel: vi.fn(async () => true),
    });
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'jid-cliente',
      status: 'PENDENTE',
    });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-out', criadoEm: new Date() });
    prisma.message.update.mockResolvedValueOnce({
      id: 'msg-out',
      status: 'SENT',
      externalId: 'wamid-out-1',
      criadoEm: new Date(),
    });
    prisma.conversation.update.mockResolvedValueOnce({});

    const r = await svc.responder(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', {
      texto: 'resposta',
    });
    expect(r.status).toBe('SENT');
    // Adapter agora recebe `ctx` (proprietarioId + metadata) como 4º argumento
    expect(enviar).toHaveBeenCalledWith(
      'emp-1',
      'jid-cliente',
      'resposta',
      expect.objectContaining({ proprietarioId: undefined }),
    );
    // Status da conversa: PENDENTE → ABERTA (resposta nossa "abre" a conversa)
    const convUpdate = prisma.conversation.update.mock.calls[0][0] as {
      data: { status: string };
    };
    expect(convUpdate.data.status).toBe('ABERTA');
  });

  it('marca mensagem FAILED quando adapter lança erro', async () => {
    registry.registrar({
      canal: 'WHATSAPP',
      enviarTexto: vi.fn(async () => {
        throw new Error('socket fechado');
      }),
      estaDisponivel: vi.fn(async () => true),
    });
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x',
      status: 'ABERTA',
    });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-x', criadoEm: new Date() });
    prisma.message.update.mockResolvedValueOnce({});

    await expect(
      svc.responder(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', { texto: 'x' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);

    const failedUpdate = prisma.message.update.mock.calls[0][0] as {
      data: { status: string; meta: { erro: string } };
    };
    expect(failedUpdate.data.status).toBe('FAILED');
    expect(failedUpdate.data.meta.erro).toContain('socket fechado');
  });
});

describe('InboxService.atribuir', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(prisma as never, new CanalAdapterRegistry());
  });

  it('REP é bloqueado de reatribuir (função gerencial)', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x',
    });
    await expect(
      svc.atribuir(fakeUser({ role: 'REP' as UserRole }), 'conv-1', { atribuidoId: 'u2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('REP no list aplica filtro canal=WHATSAPP + proprietarioId=user.id (sessão pessoal)', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([]);
    await svc.list(fakeUser({ role: 'REP' as UserRole, id: 'rep-x' }), {
      page: 1,
      limit: 30,
    } as never);
    const findArgs = prisma.conversation.findMany.mock.calls[0][0] as {
      where: { canal: string; proprietarioId: string };
    };
    expect(findArgs.where.canal).toBe('WHATSAPP');
    expect(findArgs.where.proprietarioId).toBe('rep-x');
  });

  it('ADMIN consegue atribuir quando usuário alvo existe', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x',
    });
    prisma.usuario.findFirst.mockResolvedValueOnce({ id: 'u2' });
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.conversation.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'conv-1',
      atribuidoId: 'u2',
    });

    const r = await svc.atribuir(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', {
      atribuidoId: 'u2',
    });
    expect(r.atribuidoId).toBe('u2');
  });
});

describe('InboxService bulk operations', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(prisma as never, new CanalAdapterRegistry());
  });

  it('bulkAtribuir — REP bloqueado', async () => {
    await expect(
      svc.bulkAtribuir(fakeUser({ role: 'REP' as UserRole }), ['c1', 'c2'], 'u2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bulkAtribuir — NotFoundException quando alvo não existe', async () => {
    prisma.usuario.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.bulkAtribuir(fakeUser({ role: 'ADMIN' as UserRole }), ['c1'], 'inexistente'),
    ).rejects.toThrow();
  });

  it('bulkAtribuir — passa atribuidoId=null pra desatribuir sem checar usuário', async () => {
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 5 });
    const r = await svc.bulkAtribuir(
      fakeUser({ role: 'ADMIN' as UserRole }),
      ['c1', 'c2', 'c3', 'c4', 'c5'],
      null,
    );
    expect(r.atualizados).toBe(5);
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
  });

  it('bulkAtribuir — updateMany aplica where do escopo do usuário', async () => {
    prisma.usuario.findFirst.mockResolvedValueOnce({ id: 'u2' });
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 2 });
    await svc.bulkAtribuir(fakeUser({ role: 'ADMIN' as UserRole }), ['c1', 'c2'], 'u2');
    const args = prisma.conversation.updateMany.mock.calls[0][0] as {
      where: { id: { in: string[] } };
      data: { atribuidoId: string };
    };
    expect(args.where.id).toEqual({ in: ['c1', 'c2'] });
    expect(args.data.atribuidoId).toBe('u2');
  });

  it('bulkAlterarStatus — atualiza status em lote', async () => {
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 3 });
    const r = await svc.bulkAlterarStatus(
      fakeUser({ role: 'GERENTE' as UserRole }),
      ['c1', 'c2', 'c3'],
      'RESOLVIDA',
    );
    expect(r.atualizados).toBe(3);
    const args = prisma.conversation.updateMany.mock.calls[0][0] as { data: { status: string } };
    expect(args.data.status).toBe('RESOLVIDA');
  });

  it('bulkArquivar — atalho que aplica status ARQUIVADA', async () => {
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 10 });
    const r = await svc.bulkArquivar(fakeUser({ role: 'SAC' as UserRole }), ['c1']);
    expect(r.atualizados).toBe(10);
    const args = prisma.conversation.updateMany.mock.calls[0][0] as { data: { status: string } };
    expect(args.data.status).toBe('ARQUIVADA');
  });

  it('bulkMarcarLidas — só atualiza mensagens INBOUND não-READ', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]);
    prisma.message.updateMany.mockResolvedValueOnce({ count: 12 });
    const r = await svc.bulkMarcarLidas(fakeUser({ role: 'SAC' as UserRole }), ['c1', 'c2']);
    expect(r.atualizados).toBe(12);
    const args = prisma.message.updateMany.mock.calls[0][0] as {
      where: { direction: string };
      data: { status: string };
    };
    expect(args.where.direction).toBe('INBOUND');
    expect(args.data.status).toBe('READ');
  });

  it('bulkMarcarLidas — retorna 0 quando user não tem acesso a nenhuma conversation', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([]);
    const r = await svc.bulkMarcarLidas(fakeUser({ role: 'SAC' as UserRole }), ['c1', 'c2']);
    expect(r.atualizados).toBe(0);
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });
});

describe('CanalAdapterRegistry', () => {
  it('register/obter funciona', () => {
    const r = new CanalAdapterRegistry();
    const adapter = {
      canal: 'WHATSAPP' as const,
      enviarTexto: vi.fn(),
      estaDisponivel: vi.fn(),
    };
    r.registrar(adapter);
    expect(r.obter('WHATSAPP')).toBe(adapter);
    expect(r.obter('INSTAGRAM')).toBeNull();
  });

  it('disponivel retorna false quando adapter ausente', async () => {
    const r = new CanalAdapterRegistry();
    expect(await r.disponivel('emp-1', 'WHATSAPP')).toBe(false);
  });

  it('disponivel propaga resultado do adapter', async () => {
    const r = new CanalAdapterRegistry();
    r.registrar({
      canal: 'WHATSAPP',
      enviarTexto: vi.fn(),
      estaDisponivel: vi.fn(async () => true),
    });
    expect(await r.disponivel('emp-1', 'WHATSAPP')).toBe(true);
  });
});

describe('InboxService.list — SLA (aguardandoDesde)', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(prisma as never, new CanalAdapterRegistry(), { get: () => 24 } as never);
  });

  const baseConv = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    empresaId: 'emp-1',
    status: 'ABERTA',
    ultimaMsgEm: new Date('2026-06-01T10:00:00Z'),
    cliente: null,
    atribuido: null,
    mensagens: [{ direction: 'INBOUND' }],
    ...over,
  });

  it('última msg do cliente em conversa aberta → aguardandoDesde = ultimaMsgEm', async () => {
    prisma.conversation.count.mockResolvedValueOnce(1);
    prisma.conversation.findMany.mockResolvedValueOnce([baseConv()]);

    const r = await svc.list(fakeUser(), { page: 1, limit: 30 } as never);

    expect(r.data[0].aguardandoDesde).toEqual(new Date('2026-06-01T10:00:00Z'));
    // o array auxiliar de mensagens não vaza no retorno
    expect((r.data[0] as Record<string, unknown>).mensagens).toBeUndefined();
  });

  it('última msg nossa (OUTBOUND) → aguardandoDesde null', async () => {
    prisma.conversation.count.mockResolvedValueOnce(1);
    prisma.conversation.findMany.mockResolvedValueOnce([
      baseConv({ mensagens: [{ direction: 'OUTBOUND' }] }),
    ]);

    const r = await svc.list(fakeUser(), { page: 1, limit: 30 } as never);
    expect(r.data[0].aguardandoDesde).toBeNull();
  });

  it('conversa resolvida não conta como aguardando (mesmo com última INBOUND)', async () => {
    prisma.conversation.count.mockResolvedValueOnce(1);
    prisma.conversation.findMany.mockResolvedValueOnce([baseConv({ status: 'RESOLVIDA' })]);

    const r = await svc.list(fakeUser(), { page: 1, limit: 30 } as never);
    expect(r.data[0].aguardandoDesde).toBeNull();
  });
});
