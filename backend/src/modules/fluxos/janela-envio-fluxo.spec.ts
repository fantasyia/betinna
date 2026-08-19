import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';
import { ForaDaJanelaEnvioError } from '@shared/whatsapp-pacing/whatsapp-pacing.util';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * Janela de envio no MOTOR: fora do horário, o passo volta pra fila com delay —
 * não fica dormindo no worker (a espera pode ser de 10h, e um `await` desses
 * some no primeiro redeploy, deixando a execução EM_EXECUCAO pra sempre).
 *
 * E a janela NÃO vale pra fluxo disparado por mensagem do lead: no T1 o cliente
 * acabou de escrever, então o que sai é resposta, não abordagem.
 */
// Destinatário por NÚMERO fixo de propósito: o alvo do teste é a janela, não a
// resolução de telefone do lead.
const no = (acaoTipo: string | null, tipo = 'ACAO') => ({
  id: 'no-1',
  fluxoId: 'fluxo-1',
  tipo,
  acaoTipo,
  titulo: acaoTipo ?? tipo,
  config:
    acaoTipo === 'ENVIAR_WHATSAPP'
      ? { mensagem: 'Oi', destinatarioModo: 'numero', destinatarioNumero: '5511999999999' }
      : { campo: 'lead.nome', operador: 'existe' },
});

function makeService(opts: {
  esperaMs: number;
  triggerTipo: string;
  acaoTipo?: string | null;
  tipo?: string;
  /** Há quanto tempo o lead mandou a última mensagem (min). undefined = nunca. */
  ultimoInboundMin?: number;
}) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto: { leadId: 'lead-1' },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: opts.triggerTipo }) },
    fluxoNo: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          no(opts.acaoTipo === undefined ? 'ENVIAR_WHATSAPP' : opts.acaoTipo, opts.tipo),
        ),
    },
    fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
    fluxoExecucaoLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoStepClaim: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    lead: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.ultimoInboundMin === undefined
            ? { ultimaMensagemEm: null }
            : { ultimaMensagemEm: new Date(Date.now() - opts.ultimoInboundMin * 60_000) },
        ),
    },
    cliente: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-x' }) };
  const pacing = {
    aguardarSlot: vi.fn().mockResolvedValue(undefined),
    esperaAntesDoProativoMs: vi.fn().mockResolvedValue(opts.esperaMs),
  };
  const conversarIa = { iniciar: vi.fn().mockResolvedValue({ aguardando: false }) };
  const service = new FluxoExecutorService(
    prisma as never,
    { get: vi.fn().mockReturnValue('') } as never,
    {} as never,
    { enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }) } as never,
    { enviarHtmlLivre: vi.fn() } as never,
    conversarIa as never,
    { disparar: vi.fn() } as never,
    pacing as never,
    { marcarDesconectado: vi.fn() } as never,
    queue as never,
    { criarCardsDeTarefa: vi.fn(async () => ({})) } as never,
    { suprimido: vi.fn(async () => false) } as never,
    { criar: vi.fn() } as never,
  );
  return { service, prisma, queue, pacing, conversarIa };
}

describe('Janela de envio no motor de fluxos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fora da janela: reagenda o MESMO nó com o delay e não envia', async () => {
    const { service, queue, prisma } = makeService({
      esperaMs: 9 * 3600_000,
      triggerTipo: 'CRON_AGENDADO',
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(queue.add).toHaveBeenCalledWith(
      'step',
      { execucaoId: 'exec-1', noId: 'no-1' },
      expect.objectContaining({ delay: 9 * 3600_000 }),
    );
    // Nada de efeito: o passo nem chegou a ser logado como executado.
    expect(prisma.fluxoExecucaoLog.create).not.toHaveBeenCalled();
    // Claim solto pra não deixar lixo EXECUTANDO pro reaper.
    expect(prisma.fluxoStepClaim.delete).toHaveBeenCalledWith({ where: { jobId: 'job-1' } });
  });

  it('fluxo disparado por MENSAGEM_CANAL não é segurado (é resposta, não abordagem)', async () => {
    const { service, pacing, prisma } = makeService({
      esperaMs: 9 * 3600_000,
      triggerTipo: 'MENSAGEM_CANAL',
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    // Nem consulta a janela: o gatilho já resolve.
    expect(pacing.esperaAntesDoProativoMs).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalled();
  });

  it('dentro da janela: executa normalmente', async () => {
    const { service, queue, prisma } = makeService({ esperaMs: 0, triggerTipo: 'CRON_AGENDADO' });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalledWith(
      'step',
      expect.anything(),
      expect.objectContaining({ delay: expect.any(Number) as number }),
    );
  });

  it('CONVERSAR_IA proativo também é segurado (o opener é abordagem)', async () => {
    const { service, queue, conversarIa } = makeService({
      esperaMs: 5 * 3600_000,
      triggerTipo: 'LEAD_RECEBEU_TAG',
      acaoTipo: 'CONVERSAR_IA',
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(conversarIa.iniciar).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'step',
      { execucaoId: 'exec-1', noId: 'no-1' },
      expect.objectContaining({ delay: 5 * 3600_000 }),
    );
  });

  it('nó que não fala WhatsApp (CONDICAO) roda a qualquer hora', async () => {
    const { service, pacing, prisma } = makeService({
      esperaMs: 9 * 3600_000,
      triggerTipo: 'CRON_AGENDADO',
      acaoTipo: null,
      tipo: 'CONDICAO',
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(pacing.esperaAntesDoProativoMs).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalled();
  });

  it('teto/janela batendo NA BORDA (corrida) reagenda em vez de marcar FALHOU', async () => {
    // A consulta lá em cima passou (0), mas entre ela e o envio a cota do dia
    // acabou numa corrida com outro worker. Isso não é falha do nó: se virasse
    // erro, o BullMQ tentaria 3× em 2s e a execução morreria FALHOU — perdendo
    // uma mensagem legítima por causa de uma trava que só queria adiar.
    const { service, queue, prisma, pacing } = makeService({
      esperaMs: 0,
      triggerTipo: 'CRON_AGENDADO',
    });
    pacing.aguardarSlot.mockRejectedValue(
      new ForaDaJanelaEnvioError(6 * 3600_000, new Date(), 'teto_diario'),
    );

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(queue.add).toHaveBeenCalledWith(
      'step',
      { execucaoId: 'exec-1', noId: 'no-1' },
      expect.objectContaining({ delay: 6 * 3600_000 }),
    );
    // Não virou passo falhado no histórico.
    expect(prisma.fluxoExecucaoLog.create).not.toHaveBeenCalled();
  });

  // ── Handoff entre fluxos: o furo que a primeira versão tinha ────────────
  //
  // T1 responde por MENSAGEM_CANAL, classifica e move o lead de etapa. O C1
  // dispara por LEAD_ETAPA_MUDOU — pelo gatilho, "abordagem". Mas é a mesma
  // conversa continuando: segurar até as 8h deixaria quem acabou de responder
  // a triagem às 22h com 10 horas de silêncio.

  it('LEAD_ETAPA_MUDOU com o lead tendo escrito agora: NÃO segura (é a mesma conversa)', async () => {
    const { service, queue, prisma } = makeService({
      esperaMs: 9 * 3600_000,
      triggerTipo: 'LEAD_ETAPA_MUDOU',
      acaoTipo: 'CONVERSAR_IA',
      ultimoInboundMin: 1,
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(queue.add).not.toHaveBeenCalledWith(
      'step',
      expect.anything(),
      expect.objectContaining({ delay: expect.any(Number) as number }),
    );
    expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalled();
  });

  it('mesmo gatilho, mas o lead escreveu há 10h: SEGURA (não está do outro lado)', async () => {
    const { service, queue } = makeService({
      esperaMs: 9 * 3600_000,
      triggerTipo: 'LEAD_ETAPA_MUDOU',
      acaoTipo: 'CONVERSAR_IA',
      ultimoInboundMin: 600,
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(queue.add).toHaveBeenCalledWith(
      'step',
      { execucaoId: 'exec-1', noId: 'no-1' },
      expect.objectContaining({ delay: 9 * 3600_000 }),
    );
  });

  it('lead que NUNCA escreveu (família S, veio de formulário): SEGURA', async () => {
    const { service, queue } = makeService({
      esperaMs: 9 * 3600_000,
      triggerTipo: 'LEAD_RECEBEU_TAG',
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(queue.add).toHaveBeenCalledWith(
      'step',
      { execucaoId: 'exec-1', noId: 'no-1' },
      expect.objectContaining({ delay: 9 * 3600_000 }),
    );
  });
});
