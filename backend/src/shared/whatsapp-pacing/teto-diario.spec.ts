import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsappPacingService } from './whatsapp-pacing.service';
import {
  ForaDaJanelaEnvioError,
  JANELA_ENVIO_DEFAULT,
  TETO_DIARIO_DEFAULT,
  chaveTetoDiario,
  esperaAteProximoDiaMs,
  resolveTetoDiario,
} from './whatsapp-pacing.util';

/**
 * Teto DIÁRIO de envio proativo.
 *
 * Ritmo e janela não limitam volume: 12/min numa janela de 12h dá 8.640
 * mensagens num dia. O teto existe pro acidente — fluxo em laço, campanha mal
 * filtrada — e a regra é a mesma da janela: ADIA, não descarta.
 */
const brt = (dia: string, hora: number, min = 0) =>
  new Date(Date.parse(`${dia}T00:00:00.000Z`) + (hora + 3) * 3600_000 + min * 60_000);

const QUARTA = '2026-08-19';
const SEXTA = '2026-08-21';

describe('resolveTetoDiario', () => {
  it('sem config = teto ativo (protege sem ninguém configurar)', () => {
    expect(resolveTetoDiario(undefined)).toEqual(TETO_DIARIO_DEFAULT);
    expect(TETO_DIARIO_DEFAULT.maxPorDia).toBe(500);
  });

  it('aceita valor do tenant e recusa lixo', () => {
    expect(resolveTetoDiario({ maxPorDia: 1200 }).maxPorDia).toBe(1200);
    expect(resolveTetoDiario({ maxPorDia: 0 }).maxPorDia).toBe(500);
    expect(resolveTetoDiario({ maxPorDia: 'muitos' }).maxPorDia).toBe(500);
  });

  it('dá pra desligar', () => {
    expect(resolveTetoDiario({ ativo: false }).ativo).toBe(false);
  });
});

describe('chaveTetoDiario — a data é a de Brasília, não a UTC', () => {
  it('23h de quarta ainda conta no dia de QUARTA (é 02h UTC de quinta)', () => {
    expect(chaveTetoDiario('emp-1', brt(QUARTA, 23))).toBe('wa:dia:emp-1:2026-08-19');
  });

  it('00h30 de quinta já é o dia seguinte — contador zera na virada BRT', () => {
    expect(chaveTetoDiario('emp-1', brt('2026-08-20', 0, 30))).toBe('wa:dia:emp-1:2026-08-20');
  });
});

describe('esperaAteProximoDiaMs — pra onde o excedente é adiado', () => {
  it('estourou às 14h de quarta → espera até as 8h de quinta (18h)', () => {
    expect(esperaAteProximoDiaMs(JANELA_ENVIO_DEFAULT, brt(QUARTA, 14))).toBe(18 * 3600_000);
  });

  it('com janela desligada, espera só a virada do dia (meia-noite BRT)', () => {
    const cfg = { ...JANELA_ENVIO_DEFAULT, ativa: false };
    expect(esperaAteProximoDiaMs(cfg, brt(QUARTA, 14))).toBe(10 * 3600_000);
  });

  it('sexta sem fim de semana → pula pra segunda (não perde o excedente no sábado)', () => {
    const cfg = { ...JANELA_ENVIO_DEFAULT, dias: [1, 2, 3, 4, 5] };
    // Sexta 14h → segunda 8h = 66h.
    expect(esperaAteProximoDiaMs(cfg, brt(SEXTA, 14))).toBe(66 * 3600_000);
  });
});

// ─── Reserva atômica no Redis ────────────────────────────────────────────

function makeService(opts: { evalRet: unknown; teto?: unknown; janelaAtiva?: boolean }) {
  const prisma = {
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        config: {
          envioWhatsapp: {
            janela: { ativa: opts.janelaAtiva ?? false },
            tetoDiario: opts.teto ?? { ativo: true, maxPorDia: 500 },
          },
        },
      }),
    },
  };
  const redis = {
    eval: vi.fn().mockResolvedValue(opts.evalRet),
    get: vi.fn().mockResolvedValue(null),
  };
  return { service: new WhatsappPacingService(prisma as never, redis as never), redis };
}

describe('WhatsappPacingService — reserva da cota diária', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dentro do teto: reserva e segue o envio', async () => {
    // 1º eval = teto (retorna a posição), 2º = cursor de pacing.
    const { service, redis } = makeService({ evalRet: 7 });
    redis.eval.mockResolvedValueOnce(7).mockResolvedValueOnce(Date.now());

    await expect(service.aguardarSlot('emp-1')).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it('estourou o teto: LANÇA com motivo teto_diario e não chega a paçar o cursor', async () => {
    const { service, redis } = makeService({ evalRet: -1 });

    await expect(service.aguardarSlot('emp-1')).rejects.toThrow(ForaDaJanelaEnvioError);
    // Só o eval do teto — o envio nem chegou na reserva de slot.
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('o erro carrega quanto esperar e o motivo (quem chama reagenda)', async () => {
    const { service } = makeService({ evalRet: -1 });

    const err = await service.aguardarSlot('emp-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForaDaJanelaEnvioError);
    const e = err as ForaDaJanelaEnvioError;
    expect(e.motivo).toBe('teto_diario');
    expect(e.esperaMs).toBeGreaterThan(0);
  });

  it('REATIVO não gasta cota — responder quem escreveu não é abordagem', async () => {
    const { service, redis } = makeService({ evalRet: -1 });
    redis.eval.mockResolvedValue(Date.now());

    await expect(service.aguardarSlot('emp-1', true)).resolves.toBeUndefined();
    // Único eval é o do cursor de pacing: nenhuma reserva de cota.
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('teto desligado: não consulta cota nenhuma', async () => {
    const { service, redis } = makeService({ evalRet: Date.now(), teto: { ativo: false } });

    await service.aguardarSlot('emp-1');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('Redis fora NÃO bloqueia envio — teto que cai vira apagão, não proteção', async () => {
    const { service, redis } = makeService({ evalRet: -1 });
    redis.eval.mockRejectedValue(new Error('redis down'));

    await expect(service.aguardarSlot('emp-1')).resolves.toBeUndefined();
  });
});

describe('esperaAntesDoProativoMs — consulta que o motor faz antes de trabalhar', () => {
  it('cota cheia devolve a espera até o próximo dia', async () => {
    const { service } = makeService({ evalRet: 0 });
    (service as unknown as { redis: { get: ReturnType<typeof vi.fn> } }).redis.get = vi
      .fn()
      .mockResolvedValue('500');

    expect(await service.esperaAntesDoProativoMs('emp-1')).toBeGreaterThan(0);
  });

  it('cota livre devolve 0', async () => {
    const { service } = makeService({ evalRet: 0 });
    expect(await service.esperaAntesDoProativoMs('emp-1')).toBe(0);
  });
});
