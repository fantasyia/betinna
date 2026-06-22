import { describe, it, expect, vi } from 'vitest';
import { ResendService } from './resend.service';

function makeSvc() {
  const http = { post: vi.fn().mockResolvedValue({ status: 200, data: { id: 're-1' } }) };
  const env = {
    get: vi.fn(
      (k: string) =>
        ({ RESEND_API_KEY: 're_k', RESEND_FROM_EMAIL: 'no-reply@betinna.ai' })[k] ?? '',
    ),
  };
  return { svc: new ResendService(http as never, env as never), http };
}

describe('ResendService — Idempotency-Key', () => {
  it('com idempotencyKey: injeta o header Idempotency-Key', async () => {
    const { svc, http } = makeSvc();
    await svc.enviar({
      para: 'a@x.com',
      assunto: 'oi',
      html: '<p>oi</p>',
      idempotencyKey: 'fx:job-1:a@x.com',
    });
    const opts = http.post.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers['Idempotency-Key']).toBe('fx:job-1:a@x.com');
    expect(opts.headers.Authorization).toBe('Bearer re_k');
  });

  it('sem idempotencyKey: NÃO inclui o header', async () => {
    const { svc, http } = makeSvc();
    await svc.enviar({ para: 'a@x.com', assunto: 'oi', html: '<p>oi</p>' });
    const opts = http.post.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers['Idempotency-Key']).toBeUndefined();
  });
});
