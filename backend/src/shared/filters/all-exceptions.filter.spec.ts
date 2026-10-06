import { Logger, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/observability/sentry', () => ({ captureException: vi.fn() }));

import { captureException } from '@shared/observability/sentry';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Erro de banco sem mapeamento chegava na tela como "Erro de banco (P2022)" —
 * código interno do Prisma na cara de quem usa (BETINNA-FRONT-T, 06/10). O
 * código continua no log e no Sentry; o usuário recebe uma frase que diz o que fazer.
 */

function rodar(exception: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  const req = { method: 'GET', url: '/api/v1/vitrine/admin/modelos', id: 'req-1' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return {
    status: (res.status.mock.calls[0] as unknown[])[0] as number,
    body: (json.mock.calls[0] as unknown[])[0] as {
      error: { code: string; message: string };
      meta: { requestId?: string };
    },
  };
}

const p2022 = () =>
  new Prisma.PrismaClientKnownRequestError(
    'The column `CatalogoModelo.categoria` does not exist in the current database.',
    { code: 'P2022', clientVersion: 'teste' },
  );

let logErro: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logErro = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.mocked(captureException).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('erro de banco sem mapeamento', () => {
  it('a mensagem pro usuário não traz código do Prisma nem nome de coluna', () => {
    const { status, body } = rodar(p2022());
    expect(status).toBe(500);
    expect(body.error.code).toBe('DATABASE_ERROR');
    expect(body.error.message).not.toMatch(/P\d{4}|banco|categoria|CatalogoModelo/i);
    expect(body.error.message).toMatch(/tente de novo/i);
    expect(body.meta.requestId).toBe('req-1');
  });

  it('o código real continua no log e no Sentry', () => {
    const erro = p2022();
    rodar(erro);
    expect(captureException).toHaveBeenCalledWith(erro, expect.anything());
    const pilha = String(logErro.mock.calls[0]?.[1]);
    expect(pilha).toContain('CatalogoModelo.categoria');
  });

  it('os mapeamentos conhecidos seguem iguais (P2025 → 404)', () => {
    const { status } = rodar(
      new Prisma.PrismaClientKnownRequestError('não achou', {
        code: 'P2025',
        clientVersion: 'teste',
      }),
    );
    expect(status).toBe(404);
  });
});
