import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { CampanhaEnvioProcessor } from './campanha-envio.processor';
import { WhatsappIndisponivelError } from '@integrations/evolution/whatsapp-indisponivel.error';
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
      {
        suprimido: vi.fn(async () => false),
        emailSuprimido: vi.fn(async () => false),
        whatsappInvalido: vi.fn(async () => false),
        marcarWhatsappInvalido: vi.fn(async () => 0),
      } as never, // supressao
      undefined as never, // queue
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
  const whatsapp = {
    enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }),
    estaDisponivel: vi.fn().mockResolvedValue(true),
  };
  const pacing = {
    aguardarSlot: vi.fn().mockResolvedValue(undefined),
    esperaAntesDoProativoMs: vi.fn().mockResolvedValue(esperaMs),
  };
  const idempotency = { claimStrict: vi.fn().mockResolvedValue(true), release: vi.fn() };
  const supressao = {
    suprimido: vi.fn(async () => false),
    emailSuprimido: vi.fn(async () => false),
    whatsappInvalido: vi.fn(async () => false),
    marcarWhatsappInvalido: vi.fn(async () => 0),
  };
  const emailSvc = { enviarHtmlLivre: vi.fn().mockResolvedValue({ ok: true, id: 'em-1' }) };
  const proc = new CampanhaEnvioProcessor(
    prisma as never,
    { tentarFinalizarCampanha: vi.fn() } as never,
    whatsapp as never,
    emailSvc as never,
    {} as never,
    idempotency as never,
    { record: vi.fn() } as never,
    pacing as never,
    supressao as never,
    queue as never,
  );
  return { proc, prisma, queue, whatsapp, pacing, supressao, emailSvc };
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

    expect(pacing.esperaAntesDoProativoMs).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('dentro da janela: segue o envio normalmente', async () => {
    const { proc, queue, whatsapp } = makeProc('WHATSAPP', 0);

    await proc.process(makeJob(0, 3));

    expect(queue.add).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });
});

/**
 * Auditoria 13/09/2026 (B-3): com a instância fora do ar o Evolution ACEITA o
 * POST e devolve id — a campanha inteira fechava ENVIADO sem nada chegar. Agora
 * o processor gateia por `estaDisponivel` como o ENVIAR_WHATSAPP dos fluxos.
 */
describe('CampanhaEnvioProcessor — não envia com o WhatsApp fora do ar', () => {
  it('instância indisponível → WhatsappIndisponivelError (retry do BullMQ), sem chamar enviarTexto', async () => {
    const { proc, whatsapp } = makeProc('WHATSAPP', 0);
    whatsapp.estaDisponivel.mockResolvedValue(false);

    await expect(proc.process(makeJob(0, 3))).rejects.toBeInstanceOf(WhatsappIndisponivelError);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });
});

/**
 * Auditoria 13/09/2026 (C-4): o processor só checava LGPD — quem tinha clicado
 * "spam" (tag "E-mail inválido ⛔" no Cliente) recebia a campanha seguinte.
 */
describe('CampanhaEnvioProcessor — caixa queimada não recebe campanha', () => {
  it('canal EMAIL + emailSuprimido → SUPRIMIDO, sem chamar o Resend', async () => {
    const { proc, prisma, supressao, emailSvc } = makeProc('EMAIL', 0);
    supressao.emailSuprimido.mockResolvedValue(true);

    await proc.process(makeJob(0, 3));

    expect(emailSvc.enviarHtmlLivre).not.toHaveBeenCalled();
    expect(prisma.campanhaDestinatario.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUPRIMIDO' }) }),
    );
  });
});
