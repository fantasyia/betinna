import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsappPacingService } from './whatsapp-pacing.service';
import {
  ForaDaJanelaEnvioError,
  chaveTetoDiarioEmail,
  resolveTetoDiarioEmail,
} from './whatsapp-pacing.util';

/**
 * Canal de E-MAIL: janela de horário + teto diário próprio.
 *
 * Os dois achados vieram da Bateria 3 (14/09/2026):
 *  - **P4**: a guarda de janela do executor testava só `ENVIAR_WHATSAPP`/
 *    `CONVERSAR_IA` — nenhum e-mail era adiado, nunca.
 *  - **P5**: não existia teto diário no canal de e-mail; o único era o de
 *    WhatsApp, e o caminho de e-mail não o lia.
 *
 * A JANELA é compartilhada (é o horário comercial da empresa). A COTA é
 * separada de propósito: cota comum faria uma campanha de WhatsApp calar a
 * régua de e-mail, e vice-versa.
 */

/** Quinta-feira, 10h BRT = 13h UTC — dentro de qualquer janela comercial. */
const QUINTA_10H_BRT = new Date('2026-09-17T13:00:00Z');

function makeService(opts: {
  tetoEmail?: unknown;
  janelaAtiva?: boolean;
  evalRet?: unknown;
  usadoHoje?: string | null;
}) {
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        config: {
          envioWhatsapp: { janela: { ativa: opts.janelaAtiva ?? false } },
          emailTransacional: { tetoDiario: opts.tetoEmail },
        },
      }),
    },
  };
  const redis = {
    eval: vi.fn().mockResolvedValue(opts.evalRet ?? 1),
    get: vi.fn().mockResolvedValue(opts.usadoHoje ?? null),
  };
  return { service: new WhatsappPacingService(prisma as never, redis as never), redis, prisma };
}

describe('resolveTetoDiarioEmail — nasce INATIVO (o número é decisão do Léo)', () => {
  it('sem config: inativo — nada muda até alguém escolher o teto', () => {
    expect(resolveTetoDiarioEmail(undefined)).toEqual({ ativo: false, maxPorDia: 500 });
  });

  it('config torta não liga o teto por acidente', () => {
    expect(resolveTetoDiarioEmail({ maxPorDia: 'muitos' })).toEqual({
      ativo: false,
      maxPorDia: 500,
    });
  });

  it('ligado explicitamente, respeita o número', () => {
    expect(resolveTetoDiarioEmail({ ativo: true, maxPorDia: 1200 })).toEqual({
      ativo: true,
      maxPorDia: 1200,
    });
  });
});

describe('chaveTetoDiarioEmail — cota SEPARADA da do WhatsApp', () => {
  it('prefixo próprio: campanha de WhatsApp não consome a cota de e-mail', () => {
    const k = chaveTetoDiarioEmail('emp-1', QUINTA_10H_BRT);
    expect(k).toBe('email:dia:emp-1:2026-09-17');
    expect(k.startsWith('wa:dia:')).toBe(false);
  });

  it('a data é a de BRASÍLIA: 00:30 UTC ainda é o dia anterior aqui', () => {
    // 2026-09-18T00:30Z = 17/09 21:30 BRT → a cota do dia 17 ainda vale.
    expect(chaveTetoDiarioEmail('emp-1', new Date('2026-09-18T00:30:00Z'))).toBe(
      'email:dia:emp-1:2026-09-17',
    );
  });
});

describe('esperaAntesDoEmailMs — P4: a janela passa a governar o e-mail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dentro da janela e sem teto ligado: manda agora (0)', async () => {
    const { service } = makeService({ janelaAtiva: false });
    expect(await service.esperaAntesDoEmailMs('emp-1')).toBe(0);
  });

  it('teto DESLIGADO não consulta contador nenhum — comportamento de hoje, intacto', async () => {
    const { service, redis } = makeService({ tetoEmail: undefined });
    await service.esperaAntesDoEmailMs('emp-1');
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('teto ligado e ESTOURADO: adia (não descarta) — o executor reagenda', async () => {
    const { service } = makeService({
      tetoEmail: { ativo: true, maxPorDia: 300 },
      usadoHoje: '300',
      janelaAtiva: true,
    });
    expect(await service.esperaAntesDoEmailMs('emp-1')).toBeGreaterThan(0);
  });

  it('teto ligado e ainda com folga: 0', async () => {
    const { service } = makeService({
      tetoEmail: { ativo: true, maxPorDia: 300 },
      usadoHoje: '299',
    });
    expect(await service.esperaAntesDoEmailMs('emp-1')).toBe(0);
  });

  it('Redis fora NÃO segura e-mail (mesma postura do resto do pacing)', async () => {
    const { service, redis } = makeService({ tetoEmail: { ativo: true, maxPorDia: 1 } });
    redis.get.mockRejectedValue(new Error('redis fora'));
    expect(await service.esperaAntesDoEmailMs('emp-1')).toBe(0);
  });
});

describe('reservarCotaEmailDoDia — P5: consome a cota imediatamente antes do envio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('teto desligado: no-op, sem tocar no Redis', async () => {
    const { service, redis } = makeService({ tetoEmail: { ativo: false } });
    await expect(service.reservarCotaEmailDoDia('emp-1')).resolves.toBeUndefined();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('dentro do teto: reserva na chave de E-MAIL e deixa seguir', async () => {
    const { service, redis } = makeService({
      tetoEmail: { ativo: true, maxPorDia: 500 },
      evalRet: 12,
    });
    await expect(service.reservarCotaEmailDoDia('emp-1')).resolves.toBeUndefined();
    const [, chaves] = redis.eval.mock.calls[0] as [string, string[], unknown[]];
    expect(chaves[0]).toMatch(/^email:dia:emp-1:/);
  });

  it('estourou: lança ForaDaJanelaEnvioError com motivo teto_diario', async () => {
    const { service } = makeService({ tetoEmail: { ativo: true, maxPorDia: 500 }, evalRet: -1 });
    const err = await service.reservarCotaEmailDoDia('emp-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForaDaJanelaEnvioError);
    expect((err as ForaDaJanelaEnvioError).motivo).toBe('teto_diario');
    expect((err as ForaDaJanelaEnvioError).esperaMs).toBeGreaterThan(0);
  });

  it('Redis fora: não trava o envio (degrada como o WhatsApp)', async () => {
    const { service, redis } = makeService({ tetoEmail: { ativo: true, maxPorDia: 500 } });
    redis.eval.mockRejectedValue(new Error('redis fora'));
    await expect(service.reservarCotaEmailDoDia('emp-1')).resolves.toBeUndefined();
  });
});
