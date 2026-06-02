import { describe, expect, it } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { Prisma } from '@prisma/client';
import { ResponseInterceptor } from './response.interceptor';

const ctx = {
  switchToHttp: () => ({ getRequest: () => ({ url: '/x', method: 'GET', id: 'req-1' }) }),
} as never;

function run(data: unknown): Promise<unknown> {
  const interceptor = new ResponseInterceptor();
  const handler = { handle: () => of(data) } as never;
  return lastValueFrom(interceptor.intercept(ctx, handler));
}

describe('ResponseInterceptor — Decimal → number (#17 Fase 0)', () => {
  it('converte Decimal de topo, aninhado e em array; mantém os outros tipos', async () => {
    const r = (await run({
      total: new Prisma.Decimal('80.50'),
      itens: [{ preco: new Prisma.Decimal('10.10') }],
      nome: 'x',
      n: 5,
    })) as { data: Record<string, unknown> };

    expect(r.data.total).toBe(80.5);
    expect(typeof r.data.total).toBe('number');
    expect((r.data.itens as Array<{ preco: number }>)[0].preco).toBe(10.1);
    expect(r.data.nome).toBe('x');
    expect(r.data.n).toBe(5);
  });

  it('preserva Date (não vira objeto vazio)', async () => {
    const d = new Date('2026-06-02T00:00:00.000Z');
    const r = (await run({ criadoEm: d })) as { data: { criadoEm: Date } };
    expect(r.data.criadoEm).toBeInstanceOf(Date);
    expect(r.data.criadoEm.getTime()).toBe(d.getTime());
  });

  it('envelopa resposta simples em { success, data, meta }', async () => {
    const r = (await run({ ok: true, valor: new Prisma.Decimal('1.5') })) as {
      success: boolean;
      data: { valor: number };
      meta: { path: string };
    };
    expect(r.success).toBe(true);
    expect(r.data.valor).toBe(1.5);
    expect(r.meta.path).toBe('/x');
  });

  it('preserva envelope já pronto (paginado) e converte Decimals internos', async () => {
    const r = (await run({
      success: true,
      data: { valor: new Prisma.Decimal('2.25') },
      meta: { page: 1 },
    })) as { success: boolean; data: { valor: number } };
    expect(r.success).toBe(true);
    expect(r.data.valor).toBe(2.25);
  });

  it('null passa direto (204 sem corpo)', async () => {
    expect(await run(null)).toBeNull();
  });
});
