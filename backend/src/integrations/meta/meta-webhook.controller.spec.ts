import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { ForbiddenException, UnauthorizedException } from '@shared/errors/app-exception';
import { MetaWebhookController } from './meta-webhook.controller';
import type { MetaWebhookEnvelope } from './meta.types';

const APP_SECRET = 'app-secret-meta';

const sign = (body: string) =>
  `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;

const EMP = 'cmempresaum0000000000001';
const EMP7 = 'cmempresasete00000000007';

/**
 * Item 13 (29/09): o segredo e o verify token são do app DA EMPRESA
 * (`meta_app`), não do env. `semApp` = empresa sem app cadastrado.
 */
const makeApps = (opts: { semApp?: boolean; secret?: string } = {}) => ({
  talvez: vi.fn(async () =>
    opts.semApp
      ? null
      : { appId: 'app-1', appSecret: opts.secret ?? APP_SECRET, verifyToken: 'verify-123' },
  ),
});

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

const makeLeadgen = () => ({ enfileirar: vi.fn(async () => undefined) });

const fakeReq = (raw: string): Request =>
  ({ rawBody: Buffer.from(raw, 'utf8') }) as unknown as Request;

describe('MetaWebhookController.verify (GET handshake)', () => {
  it('retorna challenge quando mode + token batem', async () => {
    const ctrl = new MetaWebhookController(
      makeApps() as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    expect(await ctrl.verify(EMP, 'subscribe', 'verify-123', 'desafio-xyz')).toBe('desafio-xyz');
  });

  it('rejeita quando verify_token não bate', async () => {
    const ctrl = new MetaWebhookController(
      makeApps() as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await expect(ctrl.verify(EMP, 'subscribe', 'errado', 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejeita quando mode != subscribe', async () => {
    const ctrl = new MetaWebhookController(
      makeApps() as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await expect(ctrl.verify(EMP, 'unsubscribe', 'verify-123', 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejeita quando a empresa não tem App da Meta cadastrado', async () => {
    const ctrl = new MetaWebhookController(
      makeApps({ semApp: true }) as never,
      makeInbox() as never,
      makeOAuth() as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await expect(ctrl.verify(EMP, 'subscribe', 'qualquer', 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
      makeApps() as never,
      makeInbox() as never,
      makeOAuth({ empresaId: EMP }) as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await expect(
      ctrl.receive(EMP, fakeReq(rawBody), 'sha256=deadbeef', envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('empresa sem App da Meta: rejeita (fail-closed, sem modo "aceita sem HMAC")', async () => {
    const ctrl = new MetaWebhookController(
      makeApps({ semApp: true }) as never,
      makeInbox() as never,
      makeOAuth({ empresaId: EMP }) as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await expect(ctrl.receive(EMP, fakeReq(rawBody), undefined, envelope)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('aceita HMAC válido e despacha pra InboxService', async () => {
    const inbox = makeInbox();
    const oauth = makeOAuth({ empresaId: EMP });
    const ctrl = new MetaWebhookController(
      makeApps() as never,
      inbox as never,
      oauth as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    const r = await ctrl.receive(EMP, fakeReq(rawBody), sign(rawBody), envelope);
    expect(r.ok).toBe(true);
    expect(oauth.resolverPorAccount).toHaveBeenCalledWith('facebook', 'page-1');
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: EMP,
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
      makeApps() as never,
      inbox as never,
      oauth as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    const r = await ctrl.receive(EMP, fakeReq(rawBody), sign(rawBody), envelope);
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
      makeApps() as never,
      inbox as never,
      makeOAuth({ empresaId: EMP }) as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await ctrl.receive(EMP, fakeReq(raw), sign(raw), envelopeEcho);
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
    const oauth = makeOAuth({ empresaId: EMP7 });
    const ctrl = new MetaWebhookController(
      makeApps() as never,
      inbox as never,
      oauth as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await ctrl.receive(EMP7, fakeReq(raw), sign(raw), env);
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
      makeApps() as never,
      inbox as never,
      makeOAuth({ empresaId: EMP }) as never,
      makeAntiReplay() as never,
      {
        baixarEArmazenar: vi.fn(async () => null),
        signedUrl: vi.fn(async () => null),
      } as never,
      makeLeadgen() as never,
    );
    await ctrl.receive(EMP, fakeReq(raw), sign(raw), env);
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'IMAGE',
        conteudo: '[imagem]',
        mediaUrl: 'https://cdn/img.jpg',
      }),
    );
  });
});

/**
 * Lead Ads chega neste MESMO webhook, mas em `entry.changes` (não em
 * `messaging`) e sem dado nenhum do lead. Antes deste ramo, o payload caía num
 * `entry.messaging ?? []` vazio e era descartado sem erro nenhum.
 */
describe('MetaWebhookController.receive (Lead Ads)', () => {
  const envelopeLeadgen = (value: Record<string, unknown>): MetaWebhookEnvelope =>
    ({
      object: 'page',
      entry: [{ id: 'page-1', time: 1, changes: [{ field: 'leadgen', value }] }],
    }) as unknown as MetaWebhookEnvelope;

  const ctrlCom = (leadgen: ReturnType<typeof makeLeadgen>, oauthEmpresa = EMP) =>
    new MetaWebhookController(
      makeApps() as never,
      makeInbox() as never,
      makeOAuth(oauthEmpresa ? { empresaId: oauthEmpresa } : undefined) as never,
      makeAntiReplay() as never,
      { baixarEArmazenar: vi.fn(async () => null), signedUrl: vi.fn(async () => null) } as never,
      leadgen as never,
    );

  it('enfileira o lead com os ponteiros do webhook (o payload não traz os dados)', async () => {
    const leadgen = makeLeadgen();
    const env = envelopeLeadgen({
      leadgen_id: 'lg-1',
      page_id: 'page-1',
      form_id: 'form-9',
      ad_id: 'ad-42',
      adgroup_id: 'adset-7',
      created_time: 1_756_600_000,
    });
    const raw = JSON.stringify(env);

    await ctrlCom(leadgen).receive(EMP, fakeReq(raw), sign(raw), env);

    expect(leadgen.enfileirar).toHaveBeenCalledWith({
      empresaId: EMP,
      leadgenId: 'lg-1',
      pageId: 'page-1',
      formId: 'form-9',
      adId: 'ad-42',
      adgroupId: 'adset-7',
      createdTime: 1_756_600_000,
    });
  });

  it('formulário orgânico (sem ad_id) também entra', async () => {
    const leadgen = makeLeadgen();
    const env = envelopeLeadgen({ leadgen_id: 'lg-2', page_id: 'page-1', form_id: 'form-9' });
    const raw = JSON.stringify(env);

    await ctrlCom(leadgen).receive(EMP, fakeReq(raw), sign(raw), env);

    expect(leadgen.enfileirar).toHaveBeenCalledWith(
      expect.objectContaining({ leadgenId: 'lg-2', adId: undefined }),
    );
  });

  it('página sem IntegracaoConexao não enfileira — não saberíamos de que empresa é', async () => {
    const leadgen = makeLeadgen();
    const env = envelopeLeadgen({ leadgen_id: 'lg-3', page_id: 'page-desconhecida' });
    const raw = JSON.stringify(env);

    await ctrlCom(leadgen, '').receive(EMP, fakeReq(raw), sign(raw), env);

    expect(leadgen.enfileirar).not.toHaveBeenCalled();
  });

  it('falha ao enfileirar vira 5xx — o Meta reentrega em vez de o lead sumir', async () => {
    const leadgen = makeLeadgen();
    leadgen.enfileirar.mockRejectedValue(new Error('redis fora'));
    const env = envelopeLeadgen({ leadgen_id: 'lg-4', page_id: 'page-1' });
    const raw = JSON.stringify(env);

    await expect(ctrlCom(leadgen).receive(EMP, fakeReq(raw), sign(raw), env)).rejects.toThrow();
  });

  it('mudança que não é leadgen não vai pra fila do Lead Ads', async () => {
    const leadgen = makeLeadgen();
    const env = {
      object: 'page',
      entry: [{ id: 'page-1', time: 1, changes: [{ field: 'feed', value: { post_id: 'p1' } }] }],
    } as unknown as MetaWebhookEnvelope;
    const raw = JSON.stringify(env);

    await ctrlCom(leadgen).receive(EMP, fakeReq(raw), sign(raw), env);

    expect(leadgen.enfileirar).not.toHaveBeenCalled();
  });
});

/**
 * Item 13 (29/09): cada empresa tem o PRÓPRIO app da Meta. Prova do checklist:
 * webhook de duas empresas com apps diferentes — cada uma só aceita o próprio
 * segredo, e o segredo de uma não vira passe pra entry da outra.
 */
describe('MetaWebhookController — app por empresa (item 13)', () => {
  const SEGREDO_A = 'segredo-app-empresa-a';
  const SEGREDO_B = 'segredo-app-empresa-b';
  const EMP_A = 'cmempresaa00000000000000a';
  const EMP_B = 'cmempresab00000000000000b';
  const assinar = (body: string, segredo: string) =>
    `sha256=${createHmac('sha256', segredo).update(body, 'utf8').digest('hex')}`;
  const envelope: MetaWebhookEnvelope = {
    object: 'page',
    entry: [
      {
        id: 'page-a',
        time: 1,
        messaging: [
          {
            sender: { id: 'psid-1' },
            recipient: { id: 'page-a' },
            timestamp: 1_700_000_000_000,
            message: { mid: 'mid-a', text: 'oi' },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(envelope);

  /** Apps por empresa: A e B com segredos diferentes. */
  const apps = {
    talvez: vi.fn(async (empresaId: string) =>
      empresaId === EMP_A
        ? { appId: 'app-a', appSecret: SEGREDO_A, verifyToken: 'vt-a' }
        : empresaId === EMP_B
          ? { appId: 'app-b', appSecret: SEGREDO_B, verifyToken: 'vt-b' }
          : null,
    ),
  };
  const montar = (donoDaPagina: string) => {
    const inbox = makeInbox();
    const ctrl = new MetaWebhookController(
      apps as never,
      inbox as never,
      makeOAuth({ empresaId: donoDaPagina }) as never,
      makeAntiReplay() as never,
      { baixarEArmazenar: vi.fn(async () => null), signedUrl: vi.fn(async () => null) } as never,
      makeLeadgen() as never,
    );
    return { ctrl, inbox };
  };

  it('empresa A aceita o que o app A assinou', async () => {
    const { ctrl, inbox } = montar(EMP_A);
    await ctrl.receive(EMP_A, fakeReq(raw), assinar(raw, SEGREDO_A), envelope);
    expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
      expect.objectContaining({ empresaId: EMP_A }),
    );
  });

  it('a URL da empresa B recusa o que o app A assinou', async () => {
    const { ctrl, inbox } = montar(EMP_A);
    await expect(
      ctrl.receive(EMP_B, fakeReq(raw), assinar(raw, SEGREDO_A), envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('assinatura válida da B NÃO passa entry de Página da A', async () => {
    const { ctrl, inbox } = montar(EMP_A); // page-a é da empresa A
    await ctrl.receive(EMP_B, fakeReq(raw), assinar(raw, SEGREDO_B), envelope);
    expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
  });

  it('handshake usa o verify token de CADA empresa', async () => {
    const { ctrl } = montar(EMP_A);
    expect(await ctrl.verify(EMP_A, 'subscribe', 'vt-a', 'ok-a')).toBe('ok-a');
    await expect(ctrl.verify(EMP_B, 'subscribe', 'vt-a', 'x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('id de empresa malformado na URL: recusa sem nem consultar o app', async () => {
    apps.talvez.mockClear();
    const { ctrl } = montar(EMP_A);
    await expect(
      ctrl.receive("x' OR 1=1", fakeReq(raw), assinar(raw, SEGREDO_A), envelope),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apps.talvez).not.toHaveBeenCalled();
  });
});
