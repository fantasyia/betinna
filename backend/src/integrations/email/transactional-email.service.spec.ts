import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TransactionalEmailService } from './transactional-email.service';

/**
 * Resend é o ÚNICO provedor transacional (SendGrid removido).
 * Quando o envio falha, `send()` retorna { ok: false, motivo } (nunca lança),
 * pra que o caller surface o problema na UI em vez de "sucesso" falso.
 */

const makeResendMock = () => ({
  isConfigured: vi.fn().mockReturnValue(true),
  enviar: vi.fn().mockResolvedValue({ id: 're_1', status: 200 }),
});

const makeEnvMock = () => ({
  get: vi.fn((k: string) => (k === 'FRONTEND_URL' ? 'https://app.betinna.ai' : '')),
});

// Prisma mock: sem config de remetente por-tenant por default (cai no env).
const makePrismaMock = () => ({
  empresa: { findUnique: vi.fn().mockResolvedValue({ config: null }) },
});

describe('TransactionalEmailService — provedor único (Resend)', () => {
  let resend: ReturnType<typeof makeResendMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: TransactionalEmailService;

  beforeEach(() => {
    resend = makeResendMock();
    prisma = makePrismaMock();
    service = new TransactionalEmailService(
      resend as never,
      makeEnvMock() as never,
      prisma as never,
    );
  });

  const params = { para: 'rep@cliente.com', nome: 'Rep', empresaNome: 'Betinna' };

  it('envia via Resend quando configurado → ok:true', async () => {
    const r = await service.enviarBoasVindas(params);

    expect(r.ok).toBe(true);
    expect(resend.enviar).toHaveBeenCalledTimes(1);
  });

  it('Resend não configurado → ok:false com motivo', async () => {
    resend.isConfigured.mockReturnValue(false);

    const r = await service.enviarBoasVindas(params);

    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/RESEND_API_KEY|RESEND_FROM_EMAIL/);
  });

  it('Resend lança → ok:false com o motivo do erro (best-effort, sem throw)', async () => {
    resend.enviar.mockRejectedValue(new Error('Resend HTTP 422: domínio não verificado'));

    const r = await service.enviarBoasVindas(params);

    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('422');
  });

  it('Resend retorna status não-2xx → ok:false', async () => {
    resend.enviar.mockResolvedValue({ id: null, status: 500 });

    const r = await service.enviarBoasVindas(params);

    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('500');
  });

  it('remetente por-tenant: usa fromNome/replyTo da Empresa.config quando há empresaId', async () => {
    prisma.empresa.findUnique.mockResolvedValue({
      config: { emailTransacional: { fromNome: 'Somatec', replyTo: 'contato@somatec.com.br' } },
    });

    await service.enviarHtmlLivre({
      para: 'cliente@x.com',
      assunto: 'Campanha',
      html: '<p>oi</p>',
      empresaId: 'emp-1',
    });

    expect(resend.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ fromNome: 'Somatec', replyTo: 'contato@somatec.com.br' }),
    );
  });

  it('sem empresaId → remetente vazio (cai no default do env)', async () => {
    await service.enviarHtmlLivre({ para: 'a@x.com', assunto: 'x', html: '<p>x</p>' });
    expect(resend.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ fromNome: undefined, replyTo: undefined }),
    );
    expect(prisma.empresa.findUnique).not.toHaveBeenCalled();
  });
});
