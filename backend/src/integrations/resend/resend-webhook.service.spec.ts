import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { ResendWebhookService } from './resend-webhook.service';

/**
 * Engajamento de e-mail marketing.
 *
 * Dois riscos moram aqui. O primeiro é aceitar evento forjado: engajamento
 * inflado decide qual e-mail a pessoa recebe depois, então assinatura ruim tem
 * que ser recusada. O segundo é a assinatura do Resend **não** ser o HMAC cru do
 * resto do sistema — é Svix, e copiar o verificador do Meta aqui recusaria todo
 * evento legítimo.
 */
const SECRET = 'whsec_' + Buffer.from('chave-de-teste-do-svix').toString('base64');

function assinar(id: string, ts: string, corpo: string): string {
  const chave = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  return 'v1,' + createHmac('sha256', chave).update(`${id}.${ts}.${corpo}`).digest('base64');
}

function build(secret = SECRET) {
  const prisma = {
    campanhaDestinatario: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const env = { get: vi.fn(() => secret) };
  return { svc: new ResendWebhookService(env as never, prisma as never), prisma };
}

describe('webhook do Resend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aceita assinatura Svix válida (id.timestamp.body, secret em base64)', () => {
    const { svc } = build();
    const corpo = JSON.stringify({ type: 'email.opened' });
    const ts = String(Math.floor(Date.now() / 1000));

    const ok = svc.verificarAssinatura(corpo, {
      id: 'msg_1',
      timestamp: ts,
      signature: assinar('msg_1', ts, corpo),
    });

    expect(ok).toBe(true);
  });

  it('aceita quando UMA das assinaturas bate (rotação de chave manda duas)', () => {
    const { svc } = build();
    const corpo = '{"type":"email.clicked"}';
    const ts = String(Math.floor(Date.now() / 1000));

    const ok = svc.verificarAssinatura(corpo, {
      id: 'msg_2',
      timestamp: ts,
      signature: `v1,outraCoisaQualquer= ${assinar('msg_2', ts, corpo)}`,
    });

    expect(ok).toBe(true);
  });

  it('recusa corpo adulterado', () => {
    const { svc } = build();
    const ts = String(Math.floor(Date.now() / 1000));
    const assinatura = assinar('msg_3', ts, '{"type":"email.opened"}');

    const ok = svc.verificarAssinatura('{"type":"email.clicked"}', {
      id: 'msg_3',
      timestamp: ts,
      signature: assinatura,
    });

    expect(ok).toBe(false);
  });

  it('recusa evento VELHO (replay), mesmo com assinatura correta', () => {
    const { svc } = build();
    const corpo = '{"type":"email.opened"}';
    const ts = String(Math.floor(Date.now() / 1000) - 3600);

    expect(
      svc.verificarAssinatura(corpo, {
        id: 'msg_4',
        timestamp: ts,
        signature: assinar('msg_4', ts, corpo),
      }),
    ).toBe(false);
  });

  it('SEM secret configurado, recusa tudo (não aceita sem verificar)', () => {
    const { svc } = build('');
    const corpo = '{"type":"email.opened"}';
    const ts = String(Math.floor(Date.now() / 1000));

    expect(
      svc.verificarAssinatura(corpo, {
        id: 'm',
        timestamp: ts,
        signature: assinar('m', ts, corpo),
      }),
    ).toBe(false);
  });

  it('clique marca clique E abertura (quem clicou abriu; o provedor nem sempre manda os dois)', async () => {
    const { svc, prisma } = build();

    await svc.aplicar({ type: 'email.clicked', data: { email_id: 'em-1' } });

    const patch = prisma.campanhaDestinatario.updateMany.mock.calls[0][0].data;
    expect(patch.clicadoEm).toBeInstanceOf(Date);
    expect(patch.abertoEm).toBeInstanceOf(Date);
    expect(patch.cliques).toEqual({ increment: 1 });
  });

  it('abertura guarda a PRIMEIRA data e conta o volume', async () => {
    const { svc, prisma } = build();

    await svc.aplicar({ type: 'email.opened', data: { email_id: 'em-1' } });

    const patch = prisma.campanhaDestinatario.updateMany.mock.calls[0][0].data;
    expect(patch.aberturas).toEqual({ increment: 1 });
  });

  it('bounce e reclamação caem no mesmo campo — as duas dizem "não mande mais"', async () => {
    const { svc, prisma } = build();

    await svc.aplicar({ type: 'email.complained', data: { email_id: 'em-1' } });

    expect(prisma.campanhaDestinatario.updateMany.mock.calls[0][0].data.bounceEm).toBeInstanceOf(
      Date,
    );
  });

  it('evento de e-mail transacional (sem destinatário de campanha) NÃO é erro', async () => {
    // Convite e comissão também geram evento. Tratar como falha faria o Resend
    // reenviar pra sempre algo que a gente ignora de propósito.
    const { svc, prisma } = build();
    prisma.campanhaDestinatario.updateMany.mockResolvedValue({ count: 0 });

    expect(await svc.aplicar({ type: 'email.opened', data: { email_id: 'em-x' } })).toBe(
      'semDestinatario',
    );
  });

  it('evento sem email_id é ignorado (não há como casar com ninguém)', async () => {
    const { svc, prisma } = build();

    expect(await svc.aplicar({ type: 'email.opened', data: {} })).toBe('ignorado');
    expect(prisma.campanhaDestinatario.updateMany).not.toHaveBeenCalled();
  });
});
