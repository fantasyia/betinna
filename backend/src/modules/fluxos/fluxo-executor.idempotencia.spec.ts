import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { FluxoExecutorService } from './fluxo-executor.service';

// SSRF guard mock (não usado aqui, mas o service importa). Padrão vi.hoisted como nos
// demais specs do módulo — factory inline pode falhar no hoist.
const { mockSafeRequest } = vi.hoisted(() => ({
  mockSafeRequest: vi.fn().mockResolvedValue({ status: 200 }),
}));

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: mockSafeRequest,
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

const P2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: '6.0.0',
  });

const fakeExec = (o: Record<string, unknown> = {}) => ({
  id: 'exec-1',
  fluxoId: 'fluxo-1',
  empresaId: 'emp-1',
  status: 'EM_EXECUCAO',
  contexto: { clienteId: 'cli-1', cliente: { nome: 'Carlos' } },
  ...o,
});

const waNo = () => ({
  id: 'no-wa',
  fluxoId: 'fluxo-1',
  tipo: 'ACAO',
  acaoTipo: 'ENVIAR_WHATSAPP',
  titulo: 'Enviar WhatsApp',
  config: { mensagem: 'Olá {{cliente.nome}}!' },
});

const iaNo = () => ({
  id: 'no-ia',
  fluxoId: 'fluxo-1',
  tipo: 'ACAO',
  acaoTipo: 'CONVERSAR_IA',
  titulo: 'Conversar com IA',
  config: { promptId: 'p1' },
});

function makeService() {
  const claim = {
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  };
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue(fakeExec()),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fluxoNo: { findUnique: vi.fn().mockResolvedValue(waNo()) },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'LEAD_CRIADO' }) },
    fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
    fluxoExecucaoLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoStepClaim: claim,
    cliente: { findFirst: vi.fn().mockResolvedValue({ telefone: '11987654321', nome: 'Carlos' }) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const whatsapp = {
    // Gate anterior ao envio: instância fora do ar não pode fechar o passo
    // como CONCLUIDO. Default conectado — os testes que exercitam a queda
    // sobrescrevem.
    estaDisponivel: vi.fn().mockResolvedValue(true),
    enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }),
  };
  const conversarIa = { iniciar: vi.fn().mockResolvedValue({ aguardando: false }) };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-x' }) };
  const service = new FluxoExecutorService(
    prisma as never,
    { get: vi.fn().mockReturnValue('') } as never,
    {} as never,
    whatsapp as never,
    { enviarHtmlLivre: vi.fn() } as never,
    conversarIa as never,
    { disparar: vi.fn() } as never,
    { aguardarSlot: vi.fn(), esperaAntesDoProativoMs: vi.fn().mockResolvedValue(0) } as never,
    { marcarDesconectado: vi.fn() } as never,
    queue as never,
    { criarCardsDeTarefa: vi.fn(async () => ({})) } as never, // kanbanTarefa
    { suprimido: vi.fn(async () => false) } as never, // supressao
    { criarParaUsuario: vi.fn(), criarParaRole: vi.fn() } as never, // notificacoes
    { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never, // inbox
  );
  return { service, prisma, claim, whatsapp, conversarIa, queue };
}

describe('FluxoExecutor — idempotência por job.id', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    vi.clearAllMocks();
    ctx = makeService();
  });

  it('claim novo → cria EXECUTANDO e o efeito roda', async () => {
    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-1');
    expect(ctx.claim.create).toHaveBeenCalledWith({
      data: { jobId: 'job-1', execucaoId: 'exec-1', noId: 'no-wa' },
    });
    expect(ctx.whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('retry pós-efeito (claim CONCLUIDO) → SKIP, não re-executa nem enfileira', async () => {
    ctx.claim.create.mockRejectedValueOnce(P2002());
    ctx.claim.findUnique.mockResolvedValueOnce({ estado: 'CONCLUIDO' });

    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-1');

    expect(ctx.whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(ctx.queue.add).not.toHaveBeenCalled();
  });

  it('retry de falha real (claim EXECUTANDO) → re-executa o efeito', async () => {
    ctx.claim.create.mockRejectedValueOnce(P2002());
    ctx.claim.findUnique.mockResolvedValueOnce({ estado: 'EXECUTANDO' });

    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-1');

    expect(ctx.whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('erro não-P2002 no claim (Postgres fora) → propaga sem efeito', async () => {
    ctx.claim.create.mockRejectedValueOnce(new Error('connection refused'));

    await expect(ctx.service.executarPasso('exec-1', 'no-wa', 'job-1')).rejects.toThrow();
    expect(ctx.whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('sucesso real → marca claim CONCLUIDO na mesma transação', async () => {
    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-1');
    expect(ctx.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-1' },
        data: expect.objectContaining({ estado: 'CONCLUIDO' }),
      }),
    );
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('falha real do efeito → claim NÃO vira CONCLUIDO e o passo relança (retry)', async () => {
    ctx.whatsapp.enviarTexto.mockRejectedValueOnce(new Error('falha de rede'));

    await expect(ctx.service.executarPasso('exec-1', 'no-wa', 'job-1')).rejects.toThrow();
    expect(ctx.claim.update).not.toHaveBeenCalled();
  });

  it('opener do CONVERSAR_IA (aguardando) → claim CONCLUIDO; retry não re-envia', async () => {
    ctx.prisma.fluxoNo.findUnique.mockResolvedValue(iaNo());
    ctx.conversarIa.iniciar.mockResolvedValue({ aguardando: true });

    await ctx.service.executarPasso('exec-1', 'no-ia', 'job-1');
    expect(ctx.conversarIa.iniciar).toHaveBeenCalledTimes(1);
    expect(ctx.claim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'CONCLUIDO' }) }),
    );

    // retry do MESMO job: claim CONCLUIDO → iniciar NÃO roda de novo
    ctx.claim.create.mockRejectedValueOnce(P2002());
    ctx.claim.findUnique.mockResolvedValueOnce({ estado: 'CONCLUIDO' });
    await ctx.service.executarPasso('exec-1', 'no-ia', 'job-1');
    expect(ctx.conversarIa.iniciar).toHaveBeenCalledTimes(1); // continua 1×
  });

  it('loop A→B→A: 2ª visita com job.id novo NÃO é suprimida', async () => {
    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-A1');
    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-A2'); // mesma execução/nó, job novo
    expect(ctx.claim.create).toHaveBeenCalledTimes(2);
    expect(ctx.whatsapp.enviarTexto).toHaveBeenCalledTimes(2);
  });

  it('#0: a 2ª passada leva idempotencyKey DIFERENTE (senão o gate do provider suprime)', async () => {
    // O claim (banco) já deixava a 2ª volta executar — mas o idemBase era o mesmo,
    // e o gate do adapter (TTL 24h) engolia o envio: passo verde, mensagem não sai.
    // O discriminador é quantas vezes o nó JÁ CONCLUIU nesta execução.
    // O mock de `count` é compartilhado com o contador anti-loop (#18), que roda
    // no mesmo passo — por isso diferencia pelo ARGUMENTO em vez de por ordem.
    let concluidos = 0;
    ctx.prisma.fluxoExecucaoLog.count.mockImplementation((args: { where?: { status?: string } }) =>
      Promise.resolve(args?.where?.status === 'CONCLUIDO' ? concluidos : 0),
    );

    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-A1');
    concluidos = 1; // a 1ª passada concluiu
    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-A2');

    const chaves = ctx.whatsapp.enviarTexto.mock.calls.map(
      (c: unknown[]) => (c[c.length - 1] as { idempotencyKey?: string })?.idempotencyKey,
    );
    expect(chaves[0]).toBe('fx:exec-1:no-wa:p0');
    expect(chaves[1]).toBe('fx:exec-1:no-wa:p1');
    expect(new Set(chaves).size).toBe(2);
  });

  it('#0: RETRY da mesma passada mantém a chave (a dedup do retry depende disso)', async () => {
    // Log de FALHA não é CONCLUIDO → o contador não avança → mesma chave.
    // Nenhuma passada CONCLUIU (a 1ª falhou) → contador fica em 0 nas duas.
    ctx.prisma.fluxoExecucaoLog.count.mockResolvedValue(0);
    ctx.whatsapp.enviarTexto.mockRejectedValueOnce(new Error('timeout'));

    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-A1').catch(() => undefined);
    await ctx.service.executarPasso('exec-1', 'no-wa', 'job-A1-retry');

    const chaves = ctx.whatsapp.enviarTexto.mock.calls.map(
      (c: unknown[]) => (c[c.length - 1] as { idempotencyKey?: string })?.idempotencyKey,
    );
    expect(new Set(chaves).size).toBe(1);
  });
});
