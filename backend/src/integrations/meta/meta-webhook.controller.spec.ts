import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { MetaWebhookController } from './meta-webhook.controller';
import type { MetaWebhookEnvelope } from './meta.types';

const APP_SECRET = 'app-secret-meta';

const sign = (body: string) =>
  `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;

const makeEnv = (overrides: Record<string, string> = {}) => {
  const map: Record<string, string> = {
    META_GRAPH_APP_SECRET: APP_SECRET,
    META_GRAPH_VERIFY_TOKEN: 'verify-123',
    NODE_ENV: 'test',
    ...overrides,
  };
  return {
    get: vi.fn((k: string): string => map[k] ?? ''),
    // EnvService.isProduction usado pelo controller pra decidir fail-closed
    get isProduction() {
      return map['NODE_ENV'] === 'production';
    },
  };
};

const makeInbox = () => ({
  processarMensagemEntrante: vi.fn(async () => ({
    conversationId: 'conv-1',
    messageId: 'msg-1',
    duplicada: false,
  })),
});

const makeOAuth = (resolveResult?: { empresaId: string }) => ({
  resolverPorAccount: vi.fn(async () => resolveResult ?? null),
});

// Sprint 3 FIX 1: mock do anti-replay service — sempre fresh em testes
const makeAntiReplay = () => ({
  checkAndMarkWebhook: vi.fn(async () => ({ fresh: true, signatureHash: 'h' })),
});

const fakeReq = (raw: string): Request =>
  ({ rawBody: Buffer.from(raw, 'utf8') }) as unknown as Request;

describe('MetaWebhookController.verify (GET handshake)', () => {
  it('retorna challenge quando mode + token batem', () => {
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
    );
    expect(ctrl.verify('subscribe', 'verify-123', 'desafio-xyz')).toBe('desafio-xyz');
  });

  it('rejeita quando verify_token não bate', () => {
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
    );
    expect(() => ctrl.verify('subscribe', 'errado', 'x')).toThrow(ForbiddenException);
  });

  it('rejeita quando mode != subscribe', () => {
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
    );
    expect(() => ctrl.verify('unsubscribe', 'verify-123', 'x')).toThrow(ForbiddenException);
  });

  it('rejeita quando verify token não está configurado no env', () => {
    const ctrl = new MetaWebhookController(
      makeEnv({ META_GRAPH_VERIFY_TOKEN: '' }) as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
    );
    expect(() => ctrl.verify('subscribe', 'qualquer', 'x')).toThrow(ForbiddenException);
  });
});

describe('MetaWebhookController.receive (POST events)', () => {
  const envelope: MetaWebhookEnvelope = {
    object: 'page',
    entry: [
      {
        id: 'page-1',
        time: 1_700_000_000_000,
        messaging: [
          {
            sender: { id: 'psid-aaa' },
            recipient: { id: 'page-1' },
            timestamp: 1_700_000_000_000,
            message: { mid: 'mid-1', text: 'olá' },
          },
        ],
      },
    ],
  };
  const rawBody = JSON.stringify(envelope);

  it('rejeita HMAC inválido com UnauthorizedException (auditoria 2026-05-15)', async () => {
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      makeInbox() as never,
      makeOAuth({ empresaId: 'emp-1' }) as never,
      makeAntiReplay() as never,
    );
    await expect(
      ctrl.receive(fakeReq(rawBody), 'sha256=deadbeef', envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('em produção rejeita quando META_GRAPH_APP_SECRET vazio (fail-closed)', async () => {
    const ctrl = new MetaWebhookController(
      makeEnv({ META_GRAPH_APP_SECRET: '', NODE_ENV: 'production' }) as never,
      makeInbox() as never,
      makeOAuth({ empresaId: 'emp-1' }) as never,
      makeAntiReplay() as never,
    );
    await expect(ctrl.receive(fakeReq(rawBody), undefined, envelope)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('aceita HMAC válido e despacha pra InboxService', async () => {
    const inbox = makeInbox();
    const oauth = makeOAuth({ empresaId: 'emp-1' });
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      inbox as never,
      oauth as never,
      makeAntiReplay() as never,
    );
    const r = await ctrl.receive(fakeReq(rawBody), sign(rawBody), envelope);
    expect(r.ok).toBe(true);
    expect(oauth.resolverPorAccount).toHaveBeenCalledWith('facebook', 'page-1');
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 'emp-1',
        canal: 'FACEBOOK',
        peerId: 'psid-aaa',
        conteudo: 'olá',
        externalId: 'mid-1',
      }),
    );
  });

  it('ignora entry quando empresa não encontrada (account sem IntegracaoConexao)', async () => {
    const inbox = makeInbox();
    const oauth = makeOAuth(undefined);
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      inbox as never,
      oauth as never,
      makeAntiReplay() as never,
    );
    const r = await ctrl.receive(fakeReq(rawBody), sign(rawBody), envelope);
    expect(r.ok).toBe(true);
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('ignora ecos de mensagens nossas (is_echo)', async () => {
    const envelopeEcho: MetaWebhookEnvelope = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 1,
          messaging: [
            {
              sender: { id: 'page-1' },
              recipient: { id: 'psid-aaa' },
              timestamp: 1,
              message: { mid: 'mid-out', text: 'resposta', is_echo: true },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(envelopeEcho);
    const inbox = makeInbox();
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      inbox as never,
      makeOAuth({ empresaId: 'emp-1' }) as never,
      makeAntiReplay() as never,
    );
    await ctrl.receive(fakeReq(raw), sign(raw), envelopeEcho);
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('roteia object=instagram pro canal INSTAGRAM', async () => {
    const env: MetaWebhookEnvelope = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          time: 1,
          messaging: [
            {
              sender: { id: 'igsid-xxx' },
              recipient: { id: 'ig-1' },
              timestamp: 1,
              message: { mid: 'mid-ig', text: 'oi do insta' },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(env);
    const inbox = makeInbox();
    const oauth = makeOAuth({ empresaId: 'emp-7' });
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      inbox as never,
      oauth as never,
      makeAntiReplay() as never,
    );
    await ctrl.receive(fakeReq(raw), sign(raw), env);
    expect(oauth.resolverPorAccount).toHaveBeenCalledWith('instagram', 'ig-1');
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({ canal: 'INSTAGRAM', peerId: 'igsid-xxx' }),
    );
  });

  it('extrai imagem como tipo IMAGE com mediaUrl', async () => {
    const env: MetaWebhookEnvelope = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 1,
          messaging: [
            {
              sender: { id: 'psid' },
              recipient: { id: 'page-1' },
              timestamp: 1,
              message: {
                mid: 'mid-img',
                attachments: [{ type: 'image', payload: { url: 'https://cdn/img.jpg' } }],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(env);
    const inbox = makeInbox();
    const ctrl = new MetaWebhookController(
      makeEnv() as never,
      inbox as never,
      makeOAuth({ empresaId: 'emp-1' }) as never,
      makeAntiReplay() as never,
    );
    await ctrl.receive(fakeReq(raw), sign(raw), env);
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'IMAGE',
        conteudo: '[imagem]',
        mediaUrl: 'https://cdn/img.jpg',
      }),
    );
  });
});
