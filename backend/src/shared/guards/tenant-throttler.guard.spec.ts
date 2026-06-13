import { describe, expect, it } from 'vitest';
import { TenantThrottlerGuard } from './tenant-throttler.guard';

/**
 * Acessa o `getTracker` (protected) sem precisar do contexto Nest completo —
 * só nos interessa qual CHAVE de rate-limit o guard deriva da request.
 */
function makeGuard(): { getTracker: (req: unknown, ctx?: unknown) => Promise<string> } {
  const reflector = { getAllAndOverride: () => false };
  const guard = new TenantThrottlerGuard(
    { throttlers: [] } as never,
    {} as never,
    reflector as never,
  );
  return guard as unknown as {
    getTracker: (req: unknown, ctx?: unknown) => Promise<string>;
  };
}

describe('TenantThrottlerGuard.getTracker — chave de rate-limit', () => {
  it('SEGURANÇA: ignora x-forwarded-for forjado e usa req.ip (anti brute-force)', async () => {
    const guard = makeGuard();

    // Atacante forja o XFF tentando trocar de "IP" a cada request.
    const tracker = await guard.getTracker({
      headers: { 'x-forwarded-for': '1.2.3.4' },
      ip: '203.0.113.9', // IP real resolvido pelo Express (trust proxy=1)
    });

    expect(tracker).toBe('203.0.113.9');
    expect(tracker).not.toBe('1.2.3.4');
  });

  it('forjar XFF com IPs diferentes NÃO muda a chave (mesmo req.ip = mesmo bucket)', async () => {
    const guard = makeGuard();
    const a = await guard.getTracker({
      headers: { 'x-forwarded-for': '10.0.0.1' },
      ip: '203.0.113.9',
    });
    const b = await guard.getTracker({
      headers: { 'x-forwarded-for': '10.0.0.2' },
      ip: '203.0.113.9',
    });
    expect(a).toBe(b); // o atacante não escapa do limite trocando o header
  });

  it('usuário autenticado é rastreado por tenant (empresaIdAtiva)', async () => {
    const guard = makeGuard();
    const tracker = await guard.getTracker({
      headers: {},
      ip: '203.0.113.9',
      user: { id: 'u-1', empresaIdAtiva: 'emp-1' },
    });
    expect(tracker).toBe('tenant:emp-1');
  });

  it('sem IP nem user → "unknown" (não quebra)', async () => {
    const guard = makeGuard();
    const tracker = await guard.getTracker({ headers: {} });
    expect(tracker).toBe('unknown');
  });
});
