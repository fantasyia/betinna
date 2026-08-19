import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { CampanhaEnvioProcessor } from './campanha-envio.processor';
import type { CampanhaEnvioJobData } from './campanha-envio.types';

// Foco: onFailed só marca ERRO + dead-letter na falha FINAL (retries esgotados).
const makeDeps = () => ({
  prisma: {
    campanhaDestinatario: { update: vi.fn().mockResolvedValue({}) },
    campanha: { findUnique: vi.fn().mockResolvedValue({ empresaId: 'emp-1' }) },
  },
  campanhasService: { tentarFinalizarCampanha: vi.fn().mockResolvedValue(undefined) },
  deadLetter: { record: vi.fn().mockResolvedValue(undefined) },
});

const makeJob = (attemptsMade: number, attempts: number): Job<CampanhaEnvioJobData> =>
  ({
    data: { campanhaId: 'camp-1', destinatarioId: 'dest-1' },
    opts: { attempts },
    attemptsMade,
  }) as unknown as Job<CampanhaEnvioJobData>;

describe('CampanhaEnvioProcessor.onFailed — #erro-retry', () => {
  let deps: ReturnType<typeof makeDeps>;
  let proc: CampanhaEnvioProcessor;

  beforeEach(() => {
    deps = makeDeps();
    proc = new CampanhaEnvioProcessor(
      deps.prisma as never,
      deps.campanhasService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      deps.deadLetter as never,
      {} as never,
      { suprimido: vi.fn(async () => false) } as never, // supressao
    );
  });

  it('falha INTERMEDIÁRIA (ainda há retries) NÃO marca ERRO nem dead-letter (fica PENDENTE)', async () => {
    await proc.onFailed(makeJob(1, 3), new Error('timeout transitório'));

    expect(deps.prisma.campanhaDestinatario.update).not.toHaveBeenCalled();
    expect(deps.deadLetter.record).not.toHaveBeenCalled();
    expect(deps.campanhasService.tentarFinalizarCampanha).not.toHaveBeenCalled();
  });

  it('falha FINAL (retries esgotados) marca destinatário ERRO + dead-letter + tenta finalizar', async () => {
    await proc.onFailed(makeJob(3, 3), new Error('falhou de vez'));

    expect(deps.prisma.campanhaDestinatario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dest-1' },
        data: expect.objectContaining({ status: 'ERRO' }),
      }),
    );
    expect(deps.deadLetter.record).toHaveBeenCalledTimes(1);
    expect(deps.campanhasService.tentarFinalizarCampanha).toHaveBeenCalledWith('camp-1');
  });
});

/**
 * Janela de envio na CAMPANHA — o disparo proativo por excelência: bate no
 * celular de gente que não pediu nada naquele momento. Fora do horário o
 * destinatário volta pra fila com delay, em vez de sair de madrugada.
 */
const makeDest = (canal: string) => ({
  id: 'dest-1',
  telefone: '5511999999999',
  email: 'a@b.com',
  campanha: {
    id: 'camp-1',
    canal,
    status: 'ENVIANDO',
    empresaId: 'emp-1',
    nome: 'Camp',
    objetivo: null,
    mensagemWa: 'Oi',
    mensagemEmail: null,
    assunto: null,
    usarIa: false,
    empresa: { id: 'emp-1', nome: 'Somatec' },
  },
  cliente: {
    id: 'cli-1',
    nome: 'Carlos',
    email: 'a@b.com',
    segmento: null,
    cidade: null,
    uf: null,
  },
});

function makeProc(canal: string, esperaMs: number) {
  const prisma = {
    campanhaDestinatario: {
      findUnique: vi.fn().mockResolvedValue(makeDest(canal)),
      update: vi.fn().mockResolvedValue({}),
    },
    campanha: { findUnique: vi.fn().mockResolvedValue({ empresaId: 'emp-1' }) },
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'j' }) };
  const whatsapp = { enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }) };
  const pacing = {
    aguardarSlot: vi.fn().mockResolvedValue(undefined),
    esperaPorJanelaMs: vi.fn().mockResolvedValue(esperaMs),
  };
  const idempotency = { claimStrict: vi.fn().mockResolvedValue(true), release: vi.fn() };
  const proc = new CampanhaEnvioProcessor(
    prisma as never,
    { tentarFinalizarCampanha: vi.fn() } as never,
    whatsapp as never,
    { enviarHtmlLivre: vi.fn().mockResolvedValue({}) } as never,
    {} as never,
    idempotency as never,
    { record: vi.fn() } as never,
    pacing as never,
    { suprimido: vi.fn(async () => false) } as never,
    queue as never,
  );
  return { proc, prisma, queue, whatsapp, pacing };
}

describe('CampanhaEnvioProcessor.process — janela de envio', () => {
  it('fora da janela: devolve o destinatário pra fila com delay e NÃO envia', async () => {
    const { proc, queue, whatsapp } = makeProc('WHATSAPP', 9 * 3600_000);

    await proc.process(makeJob(0, 3));

    expect(queue.add).toHaveBeenCalledWith(
      'enviar',
      { campanhaId: 'camp-1', destinatarioId: 'dest-1' },
      expect.objectContaining({ delay: 9 * 3600_000 }),
    );
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('campanha de E-MAIL não é segurada — e-mail às 3h não acorda ninguém', async () => {
    const { proc, queue, pacing } = makeProc('EMAIL', 9 * 3600_000);

    await proc.process(makeJob(0, 3));

    expect(pacing.esperaPorJanelaMs).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('dentro da janela: segue o envio normalmente', async () => {
    const { proc, queue, whatsapp } = makeProc('WHATSAPP', 0);

    await proc.process(makeJob(0, 3));

    expect(queue.add).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });
});
