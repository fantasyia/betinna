import { describe, expect, it } from 'vitest';
import { usuarioIdSchema } from './id.schema';

describe('usuarioIdSchema', () => {
  it('aceita UUID (formato real do Usuario.id via Supabase Auth)', () => {
    // ids reais do tenant Somatec (do card do bug)
    expect(usuarioIdSchema.safeParse('efae4ce7-6509-44a0-9708-f1ea3007ca16').success).toBe(true);
    expect(usuarioIdSchema.safeParse('784899a6-405d-40b3-84d3-1c12e5195a47').success).toBe(true);
  });

  it('aceita CUID (default do Prisma / demais entidades)', () => {
    expect(usuarioIdSchema.safeParse('cmry0nbib000jpwapi7s5wo7g').success).toBe(true);
    expect(usuarioIdSchema.safeParse('cmrv0ytmz000ir4ap3m3glgt8').success).toBe(true);
  });

  it('rejeita string vazia e lixo (não é UUID nem CUID)', () => {
    expect(usuarioIdSchema.safeParse('').success).toBe(false);
    expect(usuarioIdSchema.safeParse('123').success).toBe(false);
    expect(usuarioIdSchema.safeParse('not-an-id').success).toBe(false);
  });

  it('mensagem de erro cita UUID ou CUID (não "Invalid cuid")', () => {
    const r = usuarioIdSchema.safeParse('xxx');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/UUID ou CUID/);
  });
});
