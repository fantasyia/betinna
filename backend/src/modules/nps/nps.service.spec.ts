import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NpsService } from './nps.service';

const makePrisma = () => ({
  pesquisaNPS: { findFirst: vi.fn() },
  respostaNPS: { findFirst: vi.fn(), create: vi.fn() },
  cliente: { findFirst: vi.fn() },
});

const PESQUISA = {
  id: 'pesq-1',
  empresaId: 'emp-1',
  mensagemAgradecimento: 'Valeu!',
  expiraEm: null,
};

describe('NpsService.submitPublico — anti-duplicata/flood', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: NpsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new NpsService(prisma as never);
    prisma.pesquisaNPS.findFirst.mockResolvedValue(PESQUISA);
    prisma.respostaNPS.create.mockResolvedValue({ id: 'resp-1' });
  });

  it('1ª resposta de um IP é registrada', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue(null); // ninguém respondeu ainda

    const r = await svc.submitPublico('slug', { nota: 9 } as never, { ip: '203.0.113.9' });

    expect(prisma.respostaNPS.create).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  it('2ª resposta do MESMO IP NÃO cria nova (idempotente — não infla a métrica)', async () => {
    prisma.respostaNPS.findFirst.mockResolvedValue({ id: 'resp-existente' }); // já respondeu

    const r = await svc.submitPublico('slug', { nota: 1 } as never, { ip: '203.0.113.9' });

    expect(prisma.respostaNPS.create).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, message: 'Valeu!' });
    // a dedup foi consultada com (pesquisa, ip)
    expect(prisma.respostaNPS.findFirst).toHaveBeenCalledWith({
      where: { pesquisaId: 'pesq-1', ip: '203.0.113.9' },
      select: { id: true },
    });
  });

  it('sem IP não deduplica (best-effort) — registra normalmente', async () => {
    const r = await svc.submitPublico('slug', { nota: 7 } as never, {});

    expect(prisma.respostaNPS.findFirst).not.toHaveBeenCalled();
    expect(prisma.respostaNPS.create).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });
});
