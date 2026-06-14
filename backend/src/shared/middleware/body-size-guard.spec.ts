import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  bodySizeGuard,
  limiteCorpoPara,
  LIMITE_CORPO_GRANDE_BYTES,
  LIMITE_CORPO_PADRAO_BYTES,
} from './body-size-guard';

const makeRes = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
};

const makeReq = (path: string, contentLength?: number, contentType?: string): Request =>
  ({
    path,
    headers: {
      ...(contentLength === undefined ? {} : { 'content-length': String(contentLength) }),
      ...(contentType === undefined ? {} : { 'content-type': contentType }),
    },
  }) as unknown as Request;

describe('limiteCorpoPara', () => {
  it('rotas grandes (webhooks/inbox/import) → 20MB', () => {
    expect(limiteCorpoPara('/api/v1/webhooks/omie/cliente-status')).toBe(LIMITE_CORPO_GRANDE_BYTES);
    expect(limiteCorpoPara('/api/v1/inbox/123/responder-midia')).toBe(LIMITE_CORPO_GRANDE_BYTES);
    expect(limiteCorpoPara('/api/v1/import/clientes')).toBe(LIMITE_CORPO_GRANDE_BYTES);
  });

  it('rotas comuns → 1MB', () => {
    expect(limiteCorpoPara('/api/v1/clientes')).toBe(LIMITE_CORPO_PADRAO_BYTES);
    expect(limiteCorpoPara('/api/v1/pedidos/abc')).toBe(LIMITE_CORPO_PADRAO_BYTES);
    expect(limiteCorpoPara('/api/v1/inbox')).toBe(LIMITE_CORPO_PADRAO_BYTES); // listagem, sem /
  });
});

describe('bodySizeGuard', () => {
  it('rejeita 413 quando corpo excede o limite da rota comum', () => {
    const req = makeReq('/api/v1/clientes', 2 * 1024 * 1024); // 2MB > 1MB
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(res.statusCode).toBe(413);
    expect((res.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(next).not.toHaveBeenCalled();
  });

  it('deixa passar corpo grande numa rota de webhook (até 20MB)', () => {
    const req = makeReq('/api/v1/webhooks/omie/cliente-status', 15 * 1024 * 1024); // 15MB < 20MB
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0); // não respondeu
  });

  it('deixa passar corpo pequeno em rota comum', () => {
    const req = makeReq('/api/v1/clientes', 50 * 1024); // 50KB
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('sem Content-Length → deixa passar (parser global de 20MB é o backstop)', () => {
    const req = makeReq('/api/v1/clientes'); // sem header
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('deixa passar upload MULTIPART grande fora da allowlist (multer cuida do limite)', () => {
    // /clientes/:id/documentos não casa com a allowlist, mas é upload (multer
    // limita a 10MB) — o guard não pode barrar por Content-Length.
    const req = makeReq(
      '/api/v1/clientes/abc/documentos',
      8 * 1024 * 1024,
      'multipart/form-data; boundary=xyz',
    );
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('deixa passar upload de logo multipart (empresas/:id/logo)', () => {
    const req = makeReq(
      '/api/v1/empresas/abc/logo',
      Math.round(1.5 * 1024 * 1024),
      'multipart/form-data; boundary=abc',
    );
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejeita 413 corpo > 20MB até em rota grande', () => {
    const req = makeReq('/api/v1/inbox/1/responder-midia', 25 * 1024 * 1024); // 25MB
    const res = makeRes();
    const next = vi.fn();

    bodySizeGuard(req, res, next);

    expect(res.statusCode).toBe(413);
    expect(next).not.toHaveBeenCalled();
  });
});
