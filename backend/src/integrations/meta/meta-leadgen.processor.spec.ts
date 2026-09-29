import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { MetaLeadgenProcessor } from './meta-leadgen.processor';

/** 29/09: lead de anúncio que esgota a busca vai pro dead-letter (Sentry + aviso), não some. */
function montar() {
  const deadLetter = { record: vi.fn().mockResolvedValue(undefined) };
  const p = new MetaLeadgenProcessor({} as never, deadLetter as never);
  const job = (attemptsMade: number) =>
    ({
      opts: { attempts: 6 },
      attemptsMade,
      data: { empresaId: 'emp-1', leadgenId: 'lg-1' },
    }) as never;
  return { p, deadLetter, job };
}

describe('MetaLeadgenProcessor.onFailed', () => {
  it('ainda com tentativa sobrando: não manda pro dead-letter', async () => {
    const m = montar();
    await m.p.onFailed(m.job(3), new Error('Meta Graph HTTP 500'));
    expect(m.deadLetter.record).not.toHaveBeenCalled();
  });

  it('tentativas esgotadas: dead-letter com a fila de origem', async () => {
    const m = montar();
    await m.p.onFailed(m.job(6), new Error('Meta Graph HTTP 500'));
    expect(m.deadLetter.record).toHaveBeenCalledWith(
      expect.objectContaining({ originalQueue: 'meta-leadgen' }),
    );
  });

  it('erro sem conserto (Página sem conexão) vai direto, na 1ª tentativa', async () => {
    const m = montar();
    await m.p.onFailed(m.job(1), new UnrecoverableError('página sem conexão'));
    expect(m.deadLetter.record).toHaveBeenCalledTimes(1);
  });
});
