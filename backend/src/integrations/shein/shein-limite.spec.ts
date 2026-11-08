import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '@shared/errors/app-exception';
import { SheinClientService } from './shein.client';

/** Sentry 07/11 (BETINNA-BACKEND-12): 429 da Shein desistia na 1ª e virava 502. */
const integracoes = {
  obterCredenciaisInternas: vi.fn().mockResolvedValue({
    credenciais: { appId: 'app', appSecret: 'seg', openKeyId: 'ok', secretKey: 'sk' },
  }),
};
const LIMITE = { status: 429, body: { code: 'openapi00006', msg: 'Limite de taxa acionado' } };
const OK = { status: 200, body: { code: '0', info: { ok: true } } };

function respostas(...rs: Array<{ status: number; body: unknown }>) {
  const f = vi.fn();
  for (const r of rs) {
    f.mockResolvedValueOnce(
      new Response(JSON.stringify(r.body), { status: r.status }) as unknown as Response,
    );
  }
  vi.stubGlobal('fetch', f);
  return f;
}

describe('Shein: limite de taxa (429)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('espera e tenta de novo, assinando de novo a cada tentativa', async () => {
    const f = respostas(LIMITE, LIMITE, OK);
    const svc = new SheinClientService(integracoes as never);
    const p = svc.post('emp1', '/open-api/campaigns/campaign-detail', {});
    await vi.advanceTimersByTimeAsync(2_000 + 4_000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    const ts = f.mock.calls.map((c) => (c[1] as RequestInit).headers as Record<string, string>);
    expect(ts[0]['x-lt-signature']).toBeTruthy();
    expect(ts[2]['x-lt-timestamp']).not.toBe(ts[0]['x-lt-timestamp']);
  });

  it('esgotou: devolve 429 de limite (não 502), que não vai como erro pro Sentry', async () => {
    const f = respostas(LIMITE, LIMITE, LIMITE, LIMITE);
    const svc = new SheinClientService(integracoes as never);
    const p = svc.post('emp1', '/x', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000);
    const e = (await p) as AppException;
    expect(f).toHaveBeenCalledTimes(4);
    expect(e).toBeInstanceOf(AppException);
    expect(e.getStatus()).toBe(429);
    expect(e.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('outro erro da Shein não é repetido', async () => {
    const f = respostas({ status: 200, body: { code: '500', msg: 'falhou' } });
    const svc = new SheinClientService(integracoes as never);
    await expect(svc.post('emp1', '/x', {})).rejects.toThrow(/HTTP 200: 500 falhou/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
