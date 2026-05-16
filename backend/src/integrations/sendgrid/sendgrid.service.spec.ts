import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { SendGridService } from './sendgrid.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeHttpMock = (status = 202, messageId = 'abc123'): { post: any } => ({
  post: vi.fn(async (_url: string, _opts: unknown) => ({
    status,
    ok: true,
    headers: { 'x-message-id': messageId },
    data: '',
    attempts: 1,
    durationMs: 10,
  })),
});

const envMock = {
  get: vi.fn((k: string) => {
    if (k === 'SENDGRID_API_KEY') return 'env-key';
    if (k === 'SENDGRID_FROM_EMAIL') return 'sys@betinna.ai';
    if (k === 'SENDGRID_FROM_NAME') return 'Betinna';
    return '';
  }),
};

const userIntegracoesMock = {
  obterCredenciaisInternas: vi.fn(async () => ({
    id: 'c1',
    usuarioId: 'u1',
    servico: 'sendgrid',
    ativo: true,
    credenciais: { apiKey: 'SG-user-key', fromEmail: 'rep@empresa.com', fromName: 'Rep' },
    ultimoSync: null,
    errosRecentes: 0,
  })),
};

describe('SendGridService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let svc: SendGridService;

  beforeEach(() => {
    http = makeHttpMock();
    svc = new SendGridService(http as never, envMock as never, userIntegracoesMock as never);
  });

  it('envia HTML com assunto usando credenciais do usuário', async () => {
    const r = await svc.enviar('u1', {
      para: 'destino@x.com',
      assunto: 'Olá',
      html: '<p>oi</p>',
    });
    expect(r).toEqual({ status: 202, messageId: 'abc123' });
    const [url, opts] = http.post.mock.calls[0];
    expect(url).toContain('/v3/mail/send');
    const body = (opts as { body: { from: { email: string }; subject: string; content: unknown[] } })
      .body;
    expect(body.from.email).toBe('rep@empresa.com');
    expect(body.subject).toBe('Olá');
    expect(body.content).toContainEqual({ type: 'text/html', value: '<p>oi</p>' });
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer SG-user-key');
  });

  it('aceita destinatário como objeto e como array', async () => {
    await svc.enviar('u1', { para: { email: 'a@x.com', name: 'A' }, assunto: 's', texto: 't' });
    let body = http.post.mock.calls[0][1].body as { personalizations: Array<{ to: unknown[] }> };
    expect(body.personalizations[0].to).toEqual([{ email: 'a@x.com', name: 'A' }]);

    http.post.mockClear();
    await svc.enviar('u1', {
      para: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
      assunto: 's',
      texto: 't',
    });
    body = http.post.mock.calls[0][1].body as { personalizations: Array<{ to: unknown[] }> };
    expect(body.personalizations[0].to).toHaveLength(2);
  });

  it('usa template_id e dynamic_template_data quando templateId informado', async () => {
    await svc.enviar('u1', {
      para: 'x@y.com',
      templateId: 'd-12345',
      variaveis: { nome: 'João', total: 99.9 },
    });
    const body = http.post.mock.calls[0][1].body as {
      template_id: string;
      personalizations: Array<{ dynamic_template_data: Record<string, unknown> }>;
      subject?: string;
      content?: unknown;
    };
    expect(body.template_id).toBe('d-12345');
    expect(body.personalizations[0].dynamic_template_data).toEqual({ nome: 'João', total: 99.9 });
    expect(body.subject).toBeUndefined();
    expect(body.content).toBeUndefined();
  });

  it('rejeita quando não tem assunto nem template', async () => {
    await expect(
      svc.enviar('u1', { para: 'a@b.com', texto: 't' } as never),
    ).rejects.toBeInstanceOf(IntegrationException);
  });

  it('rejeita quando não tem corpo nem template', async () => {
    await expect(
      svc.enviar('u1', { para: 'a@b.com', assunto: 'x' } as never),
    ).rejects.toBeInstanceOf(IntegrationException);
  });

  it('rejeita credenciais incompletas (sem apiKey)', async () => {
    const badUI = {
      obterCredenciaisInternas: vi.fn(async () => ({
        credenciais: { fromEmail: 'a@b.com' },
      })),
    };
    const s = new SendGridService(http as never, envMock as never, badUI as never);
    await expect(
      s.enviar('u1', { para: 'a@b.com', assunto: 's', texto: 't' }),
    ).rejects.toBeInstanceOf(IntegrationException);
  });

  it('converte HttpClientError em IntegrationException com detalhe', async () => {
    http.post.mockRejectedValueOnce(
      new HttpClientError(401, { errors: [{ message: 'auth fail' }] }, 'u', 'POST', 1),
    );
    await expect(
      svc.enviar('u1', { para: 'a@b.com', assunto: 's', texto: 't' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('SendGrid HTTP 401') });
  });

  describe('enviarSistemico', () => {
    it('usa SENDGRID_API_KEY do env', async () => {
      await svc.enviarSistemico({ para: 'sys@dest.com', assunto: 'x', texto: 'y' });
      const opts = http.post.mock.calls[0][1] as { headers: Record<string, string>; body: { from: { email: string } } };
      expect(opts.headers.Authorization).toBe('Bearer env-key');
      expect(opts.body.from.email).toBe('sys@betinna.ai');
    });

    it('falha quando SENDGRID_API_KEY ausente', async () => {
      const env2 = { get: vi.fn(() => '') };
      const s = new SendGridService(http as never, env2 as never, userIntegracoesMock as never);
      await expect(
        s.enviarSistemico({ para: 'a@b.com', assunto: 's', texto: 't' }),
      ).rejects.toBeInstanceOf(IntegrationException);
    });
  });
});
