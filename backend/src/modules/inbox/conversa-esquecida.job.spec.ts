import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversaEsquecidaJob } from './conversa-esquecida.job';

/**
 * Card 🔔, item 4 — a rede de proteção do "esqueci de religar o bot".
 * Depois da transferência o bot fica desligado; se ninguém religar nem
 * responder, a conversa fica MUDA e não há erro em lugar nenhum.
 */
const brt = (iso: string) => new Date(`${iso}-03:00`);

const makePrisma = () => ({
  empresa: {
    findMany: vi.fn().mockResolvedValue([{ id: 'emp-1', config: {} }]),
  },
  conversation: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  message: { findFirst: vi.fn().mockResolvedValue({ direction: 'INBOUND' }) },
  agendaItem: { create: vi.fn().mockResolvedValue({ id: 'ag-1' }) },
});

const makeNotificacoes = () => ({ criarParaUsuario: vi.fn().mockResolvedValue(null) });

const conversa = (over: Record<string, unknown> = {}) => ({
  id: 'conv-1',
  peerNome: 'Padaria do Zé',
  peerId: '5511999990000@s.whatsapp.net',
  atribuidoId: 'atendente-1',
  clienteId: null,
  // Quarta 09h; "agora" nos testes é quarta 14h → 5h de expediente.
  ultimaMsgEm: brt('2026-08-12T09:00:00'),
  ...over,
});

describe('ConversaEsquecidaJob', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let notificacoes: ReturnType<typeof makeNotificacoes>;
  let job: ConversaEsquecidaJob;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(brt('2026-08-12T14:00:00')); // quarta, 14h
    prisma = makePrisma();
    notificacoes = makeNotificacoes();
    job = new ConversaEsquecidaJob(
      prisma as never,
      { get: () => 'production' } as never,
      { acquire: vi.fn().mockResolvedValue(true) } as never,
      notificacoes as never,
    );
  });

  it('abre tarefa PRO ATENDENTE que recebeu a transferência', async () => {
    prisma.conversation.findMany.mockResolvedValue([conversa()]);

    await job.varrer();

    const tarefa = prisma.agendaItem.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(tarefa.usuarioId).toBe('atendente-1'); // ← não vai pra diretoria
    expect(tarefa.origemJobId).toBe('conversa-esquecida:conv-1');
    expect(String(tarefa.observacao)).toContain('/inbox?conversa=conv-1'); // link da conversa
    expect(notificacoes.criarParaUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 'atendente-1', link: '/inbox?conversa=conv-1' }),
    );
  });

  it('carimba a conversa (destaque no Inbox + trava o alerta repetido)', async () => {
    prisma.conversation.findMany.mockResolvedValue([conversa()]);

    await job.varrer();

    const upd = prisma.conversation.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // O `alertaEsquecidaEm: null` no WHERE é a guarda de corrida: duas
    // instâncias do worker varrendo junto, só uma abre a tarefa.
    expect(upd.where).toEqual({ id: 'conv-1', alertaEsquecidaEm: null });
    expect(upd.data.alertaEsquecidaEm).toBeInstanceOf(Date);
  });

  it('NÃO alerta quando a última mensagem foi NOSSA (atendente respondeu)', async () => {
    prisma.conversation.findMany.mockResolvedValue([conversa()]);
    prisma.message.findFirst.mockResolvedValue({ direction: 'OUTBOUND' });

    await job.varrer();

    expect(prisma.agendaItem.create).not.toHaveBeenCalled();
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('NÃO alerta antes das 4h de expediente (ainda é atendimento em andamento)', async () => {
    // Última mensagem às 12h, agora 14h = 2h de expediente.
    prisma.conversation.findMany.mockResolvedValue([
      conversa({ ultimaMsgEm: brt('2026-08-12T12:00:00') }),
    ]);

    await job.varrer();

    expect(prisma.agendaItem.create).not.toHaveBeenCalled();
  });

  it('mensagem de sexta 17h NÃO vira alerta no sábado (o alarme falso)', async () => {
    vi.setSystemTime(brt('2026-08-15T12:00:00')); // sábado
    prisma.conversation.findMany.mockResolvedValue([
      conversa({ ultimaMsgEm: brt('2026-08-14T17:00:00') }),
    ]);

    await job.varrer();

    expect(prisma.agendaItem.create).not.toHaveBeenCalled();
  });

  it('sem atendente atribuído: destaca no Inbox mas NÃO escala pra ninguém', async () => {
    prisma.conversation.findMany.mockResolvedValue([conversa({ atribuidoId: null })]);

    await job.varrer();

    expect(prisma.conversation.updateMany).toHaveBeenCalled(); // destaque fica
    expect(prisma.agendaItem.create).not.toHaveBeenCalled(); // ninguém é acordado à toa
    expect(notificacoes.criarParaUsuario).not.toHaveBeenCalled();
  });

  it('tenant com o alerta DESLIGADO é pulado', async () => {
    prisma.empresa.findMany.mockResolvedValue([
      { id: 'emp-1', config: { alertaConversaEsquecida: { ativo: false } } },
    ]);

    await job.varrer();

    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it('tenant pode encurtar o prazo (2h) — a config manda', async () => {
    prisma.empresa.findMany.mockResolvedValue([
      { id: 'emp-1', config: { alertaConversaEsquecida: { horas: 2 } } },
    ]);
    // 12h → 14h = 2h de expediente: com o default (4h) não alertaria.
    prisma.conversation.findMany.mockResolvedValue([
      conversa({ ultimaMsgEm: brt('2026-08-12T12:00:00') }),
    ]);

    await job.varrer();

    expect(prisma.agendaItem.create).toHaveBeenCalled();
  });

  it('só olha conversa ABERTA com o bot DESLIGADO nela e ainda não alertada', async () => {
    prisma.conversation.findMany.mockResolvedValue([]);

    await job.varrer();

    const where = prisma.conversation.findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBe('ABERTA');
    expect(where.botLigado).toBe(false);
    expect(where.alertaEsquecidaEm).toBeNull();
  });

  it('erro no meio não derruba a varredura', async () => {
    prisma.empresa.findMany.mockRejectedValue(new Error('banco fora'));
    await expect(job.varrer()).resolves.toBeUndefined();
  });
});
