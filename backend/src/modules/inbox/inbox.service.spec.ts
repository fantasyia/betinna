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
  // Marca de LIMPEZA por empresa+canal+DONO — consultada em TODA mensagem
  // entrante. É findMany porque duas marcas podem barrar a mesma mensagem: a da
  // empresa ('') e a do dono da conversa (WhatsApp pessoal do rep).
  // Default: nunca limpou.
  inboxLimpeza: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  },
  // Religar o bot limpa a tag `triado` do lead (regra do Léo, 11/08).
  tag: { findUnique: vi.fn().mockResolvedValue({ id: 'tag-triado' }) },
  leadTag: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
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
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  message: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
  cliente: {
    findFirst: vi.fn(),
  },
  // "Zerar conversa" cancela as execuções de fluxo vivas (a memória da IA mora
  // no contexto da execução, não nas Messages).
  fluxoExecucao: { updateMany: vi.fn(async () => ({ count: 0 })) },
  usuario: {
    findFirst: vi.fn(),
  },
  // `responder` consulta empresa.botWhatsappAtivo (handoff do bot). Sem esse
  // mock o teste de envio quebrava com "findUnique of undefined".
  empresa: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  // Match de cliente por telefone agora usa $queryRaw (índice de expressão).
  // Default [] = sem match; testes que querem match sobrescrevem com Once.
  $queryRaw: vi.fn().mockResolvedValue([]),
});

describe('InboxService.processarMensagemEntrante', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let registry: CanalAdapterRegistry;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    registry = new CanalAdapterRegistry();
    svc = new InboxService(
      prisma as never,
      registry,
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
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

  it('tombstone "zerar": NÃO recria msg de history sync anterior ao zeramento', async () => {
    // Datas RELATIVAS: além do tombstone existe um teto de IDADE na ingestão
    // (30min) — com data fixa de meses atrás, o teto barraria antes e o teste
    // passaria pelo motivo errado.
    const zeradasEm = new Date(Date.now() - 5 * 60_000);
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    // upsertConversation: acha a conversa existente (com tombstone) e a devolve.
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      mensagensZeradasEm: zeradasEm,
    });
    prisma.conversation.update.mockResolvedValueOnce({
      id: 'conv-1',
      mensagensZeradasEm: zeradasEm,
    });

    const r = await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511988887777@s.whatsapp.net',
      tipo: 'TEXT',
      conteudo: 'mensagem antiga reentregue',
      externalId: 'wamid-old',
      data: new Date(Date.now() - 10 * 60_000), // anterior ao zeramento, dentro do teto
    });

    expect(r).toEqual({ conversationId: 'conv-1', messageId: '', duplicada: true });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('tombstone "zerar": mensagem NOVA (posterior) passa normalmente', async () => {
    const zeradasEm = new Date(Date.now() - 5 * 60_000);
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      mensagensZeradasEm: zeradasEm,
    });
    prisma.conversation.update.mockResolvedValueOnce({
      id: 'conv-1',
      mensagensZeradasEm: zeradasEm,
    });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-novo', criadoEm: new Date() });
    prisma.conversation.update.mockResolvedValueOnce({});

    const r = await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511988887777@s.whatsapp.net',
      tipo: 'TEXT',
      conteudo: 'mensagem nova depois de zerar',
      externalId: 'wamid-novo',
      data: new Date(), // posterior ao zeramento
    });

    expect(r.duplicada).toBe(false);
    expect(prisma.message.create).toHaveBeenCalled();
  });

  it('é idempotente quando recebe mesmo externalId duas vezes', async () => {
    prisma.message.findFirst.mockResolvedValueOnce({
      id: 'msg-1',
      conversationId: 'conv-1',
      conteudo: 'oi',
    });

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
    // Conteúdo igual → não tenta curar
    expect(prisma.message.update).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('cura mensagem placeholder ao reprocessar (history sync traz o conteúdo real)', async () => {
    prisma.message.findFirst.mockResolvedValueOnce({
      id: 'msg-ph',
      conversationId: 'conv-1',
      conteudo: '[mensagem não suportada]',
    });
    prisma.message.update.mockResolvedValueOnce({});

    const r = await svc.processarMensagemEntrante({
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: '5511988887777@s.whatsapp.net',
      tipo: 'TEXT',
      conteudo: 'Olá, tudo bem?', // parser agora extraiu o texto de verdade
      externalId: 'wamid-heal',
    });

    expect(r.duplicada).toBe(true);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-ph' },
        data: expect.objectContaining({ conteudo: 'Olá, tudo bem?' }),
      }),
    );
  });

  it('resolve cliente por sufixo do telefone (8 últimos dígitos, via índice)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'cli-9' }]);
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

    // $queryRaw recebe (templateStrings, ...valores) — confere empresa + sufixo.
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.calls[0]).toEqual(expect.arrayContaining(['emp-1', '88887777']));
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
    svc = new InboxService(
      prisma as never,
      registry,
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
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
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
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

  it('GERENTE também é sessão pessoal — nunca o número da empresa', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([]);
    await svc.list(fakeUser({ role: 'GERENTE' as UserRole, id: 'ger-1' }), {
      page: 1,
      limit: 30,
    } as never);
    const findArgs = prisma.conversation.findMany.mock.calls[0][0] as {
      where: { canal: string; proprietarioId: string };
    };
    expect(findArgs.where.canal).toBe('WHATSAPP');
    expect(findArgs.where.proprietarioId).toBe('ger-1');
  });

  it('GESTÃO não vê o WhatsApp PESSOAL dos reps — só o número da EMPRESA', async () => {
    // B.O. de 20/08: o inbox do admin listava a vida privada do rep (assessoria
    // jurídica, condomínio, família) porque o desenho original dava à gestão
    // TODAS as sessões. Agora WhatsApp pessoal é só do dono; a gestão fica com
    // o número da empresa (proprietarioId null) e os demais canais.
    prisma.conversation.findMany.mockResolvedValueOnce([]);
    await svc.list(fakeUser({ role: 'ADMIN' as UserRole }), { page: 1, limit: 30 } as never);
    const findArgs = prisma.conversation.findMany.mock.calls[0][0] as {
      where: { OR?: Array<Record<string, unknown>> };
    };
    expect(findArgs.where.OR).toEqual([{ canal: { not: 'WHATSAPP' } }, { proprietarioId: null }]);
  });

  it('limpar da GESTÃO só apaga a caixa da EMPRESA — nunca as conversas pessoais dos reps', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([{ id: 'c1' }]);
    prisma.message.deleteMany.mockResolvedValueOnce({ count: 2 });
    prisma.conversation.deleteMany.mockResolvedValueOnce({ count: 1 });

    await svc.limparWhatsapp(fakeUser({ role: 'ADMIN' as UserRole }));

    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ proprietarioId: null }),
      }),
    );
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

  it('notifica o NOVO responsável ao atribuir (item do card de atendimento)', async () => {
    const criarParaUsuario = vi.fn().mockResolvedValue(null);
    const svcN = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      { publicar: () => Promise.resolve() } as never,
      { criarParaUsuario, criarParaRole: vi.fn() } as never,
    );
    // existing tinha atribuidoId=u1; atribui pra u2 (mudança → notifica).
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x',
      peerNome: 'Fulano',
      atribuidoId: 'u1',
    });
    prisma.usuario.findFirst.mockResolvedValueOnce({ id: 'u2' });
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.conversation.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'conv-1',
      atribuidoId: 'u2',
    });

    await svcN.atribuir(fakeUser({ role: 'ADMIN' as UserRole, id: 'admin' }), 'conv-1', {
      atribuidoId: 'u2',
    });
    expect(criarParaUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 'u2', empresaId: 'emp-1' }),
    );
  });

  it('NÃO notifica quem se auto-atribui (já sabe)', async () => {
    const criarParaUsuario = vi.fn().mockResolvedValue(null);
    const svcN = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      { publicar: () => Promise.resolve() } as never,
      { criarParaUsuario, criarParaRole: vi.fn() } as never,
    );
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      canal: 'WHATSAPP',
      peerId: 'x',
      atribuidoId: null,
    });
    prisma.usuario.findFirst.mockResolvedValueOnce({ id: 'admin' });
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.conversation.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'conv-1',
      atribuidoId: 'admin',
    });

    await svcN.atribuir(fakeUser({ role: 'ADMIN' as UserRole, id: 'admin' }), 'conv-1', {
      atribuidoId: 'admin',
    });
    expect(criarParaUsuario).not.toHaveBeenCalled();
  });
});

describe('InboxService.limparConversa', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
  });

  it('zera atribuidoId/status/categoria/botPausadoAte/incidentId — não só as mensagens', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      peerId: '5511999990000@s.whatsapp.net',
      leadId: null,
    });
    prisma.message.deleteMany.mockResolvedValueOnce({ count: 5 });
    prisma.conversation.update.mockResolvedValueOnce({});

    await svc.limparConversa(fakeUser(), 'conv-1');

    const data = prisma.conversation.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.atribuidoId).toBeNull();
    expect(data.status).toBe('ABERTA');
    expect(data.categoria).toBe('GERAL');
    expect(data.botPausadoAte).toBeNull();
    expect(data.incidentId).toBeNull();
    expect(data.precisaHumano).toBe(false);
    expect(data.naoLidas).toBe(0);
  });

  it('#11: avisa por SSE — quem está com a thread aberta não fica vendo msg apagada', async () => {
    const publicar = vi.fn().mockResolvedValue(undefined);
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      { publicar } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      peerId: '5511999990000@s.whatsapp.net',
      leadId: null,
    });
    prisma.message.deleteMany.mockResolvedValueOnce({ count: 5 });
    prisma.conversation.update.mockResolvedValueOnce({});
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'conv-1',
        empresaId: 'emp-1',
        proprietarioId: null,
        atribuidoId: null,
        canal: 'WHATSAPP',
      },
    ]);

    await svc.limparConversa(fakeUser(), 'conv-1');

    const tipos = publicar.mock.calls.map((c) => (c[0] as { tipo: string }).tipo);
    expect(tipos).toEqual(expect.arrayContaining(['mensagem', 'status']));
  });

  it('CANCELA as execuções de fluxo vivas — senão a IA retoma de onde parou', async () => {
    // O reset apagava só as Messages. A memória da conversa vive em
    // FluxoExecucao.contexto._iaHistorico: no próximo "oi" a IA continuava a
    // entrevista anterior, e o "zerei" do usuário era mentira.
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      peerId: '5511999990000@s.whatsapp.net',
      leadId: 'lead-1',
    });
    prisma.message.deleteMany.mockResolvedValueOnce({ count: 3 });
    prisma.conversation.update.mockResolvedValueOnce({});
    prisma.fluxoExecucao.updateMany.mockResolvedValueOnce({ count: 2 });

    await svc.limparConversa(fakeUser(), 'conv-1');

    const args = prisma.fluxoExecucao.updateMany.mock.calls[0][0];
    expect(args.where.status.in).toEqual(['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO']);
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { contexto: { path: ['conversationId'], equals: 'conv-1' } },
        { contexto: { path: ['leadId'], equals: 'lead-1' } },
      ]),
    );
    expect(args.data.status).toBe('CANCELADO');
  });

  it('falha ao cancelar execução NÃO impede o zeramento das mensagens', async () => {
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      empresaId: 'emp-1',
      peerId: '5511999990000@s.whatsapp.net',
      leadId: 'lead-1',
    });
    prisma.message.deleteMany.mockResolvedValueOnce({ count: 7 });
    prisma.conversation.update.mockResolvedValueOnce({});
    prisma.fluxoExecucao.updateMany.mockRejectedValueOnce(new Error('DB fora'));

    const r = await svc.limparConversa(fakeUser(), 'conv-1');

    expect(r.mensagens).toBe(7);
    expect(prisma.conversation.update).toHaveBeenCalled();
  });
});

describe('InboxService bulk operations', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
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
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
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

describe('InboxService.listarContatosWhatsapp', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      {
        publicar: () => Promise.resolve(),
      } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
  });

  it('inclui grupo (@g.us) com tipo GRUPO (id = jid) e contato individual com tipo CONTATO', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([
      {
        peerId: '5511999998888@s.whatsapp.net',
        peerNome: 'Cliente A',
        metadata: null,
        cliente: { nome: 'Cliente A', telefone: '5511999998888' },
      },
      {
        peerId: '120363000000000000@g.us',
        peerNome: 'Time Comercial',
        metadata: null,
        cliente: null,
      },
    ]);

    const out = await svc.listarContatosWhatsapp(fakeUser());

    expect(out.find((c) => c.tipo === 'GRUPO')).toEqual({
      id: '120363000000000000@g.us',
      nome: 'Time Comercial',
      tipo: 'GRUPO',
    });
    expect(out.find((c) => c.tipo === 'CONTATO')).toMatchObject({
      id: '5511999998888',
      nome: 'Cliente A',
      tipo: 'CONTATO',
    });
  });

  it('grupo sem subject (peerNome null) cai no fallback "Grupo"', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([
      { peerId: '120363000000000001@g.us', peerNome: null, metadata: null, cliente: null },
    ]);

    const out = await svc.listarContatosWhatsapp(fakeUser());

    expect(out).toEqual([{ id: '120363000000000001@g.us', nome: 'Grupo', tipo: 'GRUPO' }]);
  });

  it('dedup de grupo pelo jid — não repete o mesmo grupo', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([
      { peerId: '120363000000000002@g.us', peerNome: 'G', metadata: null, cliente: null },
      { peerId: '120363000000000002@g.us', peerNome: 'G', metadata: null, cliente: null },
    ]);

    const out = await svc.listarContatosWhatsapp(fakeUser());

    expect(out.filter((c) => c.tipo === 'GRUPO')).toHaveLength(1);
  });

  it('LID (@lid) sem telefone real é descartado (número oculto não vira contato)', async () => {
    prisma.conversation.findMany.mockResolvedValueOnce([
      { peerId: '99999999@lid', peerNome: 'Oculto', metadata: null, cliente: null },
    ]);

    const out = await svc.listarContatosWhatsapp(fakeUser());

    expect(out).toEqual([]);
  });
});

describe('InboxService — religar o bot limpa a tag `triado`', () => {
  // O ramo Financeiro/Suporte da triagem termina marcando `triado`, que é a
  // guarda do 1º nó. Cliente que pediu 2ª via e volta meses depois querendo
  // COMPRAR morria no primeiro nó, sem virar lead comercial e sem ninguém ver.
  const montar = () => {
    const prisma = makePrismaMock();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      empresaId: 'emp-1',
      leadId: 'lead-1',
      canal: 'WHATSAPP',
      proprietarioId: null,
      atribuidoId: null,
    });
    prisma.conversation.findUniqueOrThrow.mockResolvedValue({ id: 'conv-1' });
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    const svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      { publicar: () => Promise.resolve() } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
    return { prisma, svc };
  };

  it('religarBot remove a tag triado do lead da conversa', async () => {
    const { prisma, svc } = montar();

    await svc.religarBot(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1');

    expect(prisma.leadTag.deleteMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', tagId: 'tag-triado' },
    });
  });

  it('setBotLigado(true) também limpa — é o mesmo gesto na UI', async () => {
    const { prisma, svc } = montar();

    await svc.setBotLigado(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', true);

    expect(prisma.leadTag.deleteMany).toHaveBeenCalled();
  });

  it('setBotLigado(false) NÃO limpa — desligar não é "encerrei o atendimento"', async () => {
    const { prisma, svc } = montar();

    await svc.setBotLigado(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1', false);

    expect(prisma.leadTag.deleteMany).not.toHaveBeenCalled();
  });

  it('conversa SEM lead vinculado: ignora sem erro', async () => {
    const { prisma, svc } = montar();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      empresaId: 'emp-1',
      leadId: null,
      canal: 'WHATSAPP',
      proprietarioId: null,
      atribuidoId: null,
    });

    await expect(
      svc.religarBot(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1'),
    ).resolves.toBeDefined();
    expect(prisma.leadTag.deleteMany).not.toHaveBeenCalled();
  });

  it('empresa sem a tag `triado` criada: não quebra', async () => {
    const { prisma, svc } = montar();
    prisma.tag.findUnique.mockResolvedValue(null);

    await expect(
      svc.religarBot(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1'),
    ).resolves.toBeDefined();
    expect(prisma.leadTag.deleteMany).not.toHaveBeenCalled();
  });

  it('falha ao limpar a tag NÃO derruba o religar (best-effort)', async () => {
    const { prisma, svc } = montar();
    prisma.leadTag.deleteMany.mockRejectedValue(new Error('banco fora'));

    await expect(
      svc.religarBot(fakeUser({ role: 'ADMIN' as UserRole }), 'conv-1'),
    ).resolves.toBeDefined();
  });
});

/**
 * INCIDENTE 18/08 — "apaguei todas as conversas do WhatsApp e elas voltaram".
 *
 * A trilha do banco: limpeza às 21:53:24, conversas recriadas às 21:54:00 — 36
 * segundos depois, com as mensagens de 21:45–21:47 dentro.
 *
 * Causa: o tombstone que impede reimportação mora na PRÓPRIA Conversation, e a
 * limpeza geral APAGA a Conversation. O tombstone ia junto. O poll de fallback
 * do Evolution (a cada minuto, janela de 45s a 12min) reimportou tudo em
 * conversas novas — sem tombstone, prontas pra ressuscitar de novo.
 */
describe('InboxService — marca de limpeza e teto de histórico', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: InboxService;

  const entrante = (over: Record<string, unknown> = {}) => ({
    empresaId: 'emp-1',
    canal: 'WHATSAPP' as const,
    peerId: '5511988887777@s.whatsapp.net',
    tipo: 'TEXT' as const,
    conteudo: 'oi',
    externalId: `wamid-${Math.random()}`,
    data: new Date(),
    ...over,
  });

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new InboxService(
      prisma as never,
      new CanalAdapterRegistry(),
      { get: () => 24 } as never,
      { publicar: () => Promise.resolve() } as never,
      {
        criarParaUsuario: () => Promise.resolve(null),
        criarParaRole: () => Promise.resolve(0),
      } as never,
    );
  });

  it('mensagem ANTERIOR à limpeza é descartada — mesmo sem conversa existir', async () => {
    // O cenário exato do incidente: a conversa foi apagada, então não há
    // tombstone nenhum pra consultar. A marca por EMPRESA é o que segura.
    prisma.inboxLimpeza.findMany.mockResolvedValue([{ em: new Date(Date.now() - 60_000) }]);

    const r = await svc.processarMensagemEntrante(
      entrante({ data: new Date(Date.now() - 8 * 60_000) }) as never,
    );

    expect(r.duplicada).toBe(true);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('mensagem POSTERIOR à limpeza entra normalmente (não trava o número)', async () => {
    prisma.inboxLimpeza.findMany.mockResolvedValue([{ em: new Date(Date.now() - 10 * 60_000) }]);
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1' });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-1', criadoEm: new Date() });

    const r = await svc.processarMensagemEntrante(entrante() as never);

    expect(r.duplicada).toBe(false);
    expect(prisma.message.create).toHaveBeenCalled();
  });

  it('mensagem VELHA é descartada mesmo sem nunca ter havido limpeza (history sync)', async () => {
    prisma.inboxLimpeza.findMany.mockResolvedValue([]);

    const r = await svc.processarMensagemEntrante(
      entrante({ data: new Date(Date.now() - 3 * 60 * 60_000) }) as never, // 3h atrás
    );

    expect(r.duplicada).toBe(true);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('o teto NÃO atrapalha a recuperação do poll (janela de 45s a 12min)', async () => {
    prisma.inboxLimpeza.findMany.mockResolvedValue([]);
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1' });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-1', criadoEm: new Date() });

    const r = await svc.processarMensagemEntrante(
      entrante({ data: new Date(Date.now() - 11 * 60_000) }) as never,
    );

    expect(r.duplicada).toBe(false);
  });

  it('limpar WhatsApp GRAVA a marca — é o que faz a exclusão colar', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    prisma.message.deleteMany.mockResolvedValue({ count: 9 });
    prisma.conversation.deleteMany.mockResolvedValue({ count: 2 });

    await svc.limparWhatsapp(fakeUser());

    expect(prisma.inboxLimpeza.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          empresaId_canal_proprietarioId: {
            empresaId: 'emp-1',
            canal: 'WHATSAPP',
            // '' = a marca da EMPRESA. Gestão zera a caixa toda; REP/GERENTE
            // gravam a marca com o próprio id e só limpam o WhatsApp deles.
            proprietarioId: '',
          },
        },
      }),
    );
  });

  it('REP limpa SÓ o WhatsApp dele — não encosta na caixa da empresa', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.message.deleteMany.mockResolvedValue({ count: 4 });
    prisma.conversation.deleteMany.mockResolvedValue({ count: 1 });

    await svc.limparWhatsapp(fakeUser({ id: 'rep-9', role: 'REP' as UserRole }));

    // A busca das conversas é filtrada pelo dono...
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ proprietarioId: 'rep-9' }),
      }),
    );
    // ...e a marca vai no nome dele, não na da empresa ('') — senão a limpeza
    // do rep barraria o histórico de todo mundo na ingestão.
    expect(prisma.inboxLimpeza.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          empresaId_canal_proprietarioId: {
            empresaId: 'emp-1',
            canal: 'WHATSAPP',
            proprietarioId: 'rep-9',
          },
        },
      }),
    );
  });

  it('mensagem sem timestamp não é barrada (tempo real sem data confiável)', async () => {
    prisma.inboxLimpeza.findMany.mockResolvedValue([{ em: new Date() }]);
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1' });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-1' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-1', criadoEm: new Date() });

    const r = await svc.processarMensagemEntrante(entrante({ data: undefined }) as never);

    expect(r.duplicada).toBe(false);
  });

  it('o teto NÃO vale pra MARKETPLACE — pergunta antiga do ML é SAC legítimo', async () => {
    // Marketplaces ingerem por PULL com o timestamp de ORIGEM: uma pergunta do
    // ML aberta há 3 horas e ainda sem resposta é justamente o que o cron de
    // 10min existe pra trazer. Aplicar o teto lá descartaria atendimento em
    // silêncio — o oposto do problema que o teto resolve.
    prisma.inboxLimpeza.findMany.mockResolvedValue([]);
    prisma.cliente.findFirst.mockResolvedValueOnce(null);
    prisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-ml' });
    prisma.conversation.update.mockResolvedValue({ id: 'conv-ml' });
    prisma.message.create.mockResolvedValueOnce({ id: 'msg-1', criadoEm: new Date() });

    const r = await svc.processarMensagemEntrante(
      entrante({
        canal: 'MARKETPLACE_ML',
        data: new Date(Date.now() - 3 * 60 * 60_000),
      }) as never,
    );

    expect(r.duplicada).toBe(false);
    expect(prisma.message.create).toHaveBeenCalled();
  });

  it('mas a MARCA DE LIMPEZA vale pra qualquer canal', async () => {
    prisma.inboxLimpeza.findMany.mockResolvedValue([{ em: new Date(Date.now() - 60_000) }]);

    const r = await svc.processarMensagemEntrante(
      entrante({ canal: 'MARKETPLACE_ML', data: new Date(Date.now() - 5 * 60_000) }) as never,
    );

    expect(r.duplicada).toBe(true);
  });
});
