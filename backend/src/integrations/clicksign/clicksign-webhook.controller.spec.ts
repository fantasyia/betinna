import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { ClickSignWebhookController } from './clicksign-webhook.controller';

const SEGREDO = 'segredo-do-webhook';

const assinar = (corpo: string) =>
  `sha256=${createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('hex')}`;

const env = () => ({
  get: vi.fn((k: string) => (k === 'CLICKSIGN_WEBHOOK_SECRET' ? SEGREDO : '')),
});
/** Ambiente sem o segredo — é o estado de quem ainda não cadastrou o webhook. */
const envSemSegredo = () => ({ get: vi.fn(() => '') });

const assinatura = () => ({
  registrarAssinado: vi.fn(async () => 'aplicado' as const),
  registrarRecusa: vi.fn(async () => 'aplicado' as const),
});

const req = (cru: string): Request => ({ rawBody: Buffer.from(cru, 'utf8') }) as unknown as Request;

const CORPO = JSON.stringify({
  event: { name: 'document_closed' },
  document: { key: 'doc-1', status: 'closed' },
});

describe('ClickSignWebhookController', () => {
  it('recusa quando o segredo não está configurado — não dá pra confiar em nada', async () => {
    const svc = assinatura();
    const ctrl = new ClickSignWebhookController(envSemSegredo() as never, svc as never);
    await expect(
      ctrl.receber(req(CORPO), assinar(CORPO), 'document_closed'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(svc.registrarAssinado).not.toHaveBeenCalled();
  });

  it('recusa HMAC inválido', async () => {
    const svc = assinatura();
    const ctrl = new ClickSignWebhookController(env() as never, svc as never);
    await expect(
      ctrl.receber(req(CORPO), 'sha256=deadbeef', 'document_closed'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(svc.registrarAssinado).not.toHaveBeenCalled();
  });

  it('processa fechamento com HMAC válido', async () => {
    const svc = assinatura();
    const ctrl = new ClickSignWebhookController(env() as never, svc as never);
    await expect(ctrl.receber(req(CORPO), assinar(CORPO), 'document_closed')).resolves.toEqual({
      ok: true,
    });
    expect(svc.registrarAssinado).toHaveBeenCalledOnce();
  });

  it('cai no nome do evento dentro do corpo quando o header Event não vem', async () => {
    const svc = assinatura();
    const ctrl = new ClickSignWebhookController(env() as never, svc as never);
    await ctrl.receber(req(CORPO), assinar(CORPO), undefined);
    expect(svc.registrarAssinado).toHaveBeenCalledOnce();
  });

  it('roteia recusa pro caminho de recusa', async () => {
    const svc = assinatura();
    const corpo = JSON.stringify({ event: { name: 'refusal' }, document: { key: 'doc-1' } });
    const ctrl = new ClickSignWebhookController(env() as never, svc as never);
    await ctrl.receber(req(corpo), assinar(corpo), 'refusal');
    expect(svc.registrarRecusa).toHaveBeenCalledOnce();
    expect(svc.registrarAssinado).not.toHaveBeenCalled();
  });

  it('ignora evento que não muda nada aqui, mas responde 200', async () => {
    const svc = assinatura();
    const corpo = JSON.stringify({ event: { name: 'sign' }, document: { key: 'doc-1' } });
    const ctrl = new ClickSignWebhookController(env() as never, svc as never);
    await expect(ctrl.receber(req(corpo), assinar(corpo), 'sign')).resolves.toEqual({ ok: true });
    expect(svc.registrarAssinado).not.toHaveBeenCalled();
    expect(svc.registrarRecusa).not.toHaveBeenCalled();
  });
});
