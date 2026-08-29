import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarcaTenantService } from './marca-tenant.service';

/**
 * A marca que sai nos PDFs.
 *
 * O que estes testes protegem: material do cliente saindo com a marca ERRADA
 * (a do sistema, ou a de outro tenant) e documento que não sai porque o logo
 * falhou — os dois são piores que um cabeçalho simples.
 */
function build(empresa: Record<string, unknown> | null, logo?: { erro?: boolean }) {
  const prisma = { empresa: { findUnique: vi.fn().mockResolvedValue(empresa) } };
  const download = vi.fn(async () =>
    logo?.erro
      ? { data: null, error: new Error('sem acesso') }
      : { data: { arrayBuffer: async () => new ArrayBuffer(8) }, error: null },
  );
  const env = { get: vi.fn(() => 'https://x.supabase.co') };
  const svc = new MarcaTenantService(prisma as never, env as never);
  // O client do Supabase é criado no construtor; trocamos só o storage.
  (svc as unknown as { storage: unknown }).storage = {
    storage: { from: () => ({ download }) },
  };
  return { svc, prisma, download };
}

describe('marca do tenant nos materiais', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa as cores da empresa quando configuradas', async () => {
    const { svc } = build({
      nome: 'Somatec',
      cnpj: '16774052000155',
      logoUrl: null,
      config: {
        marca: { corPrimaria: '#00416E', corSecundaria: '#008CC8', rodape: 'site.com.br' },
      },
    });

    const m = await svc.resolver('emp-1');

    expect(m.primaria).toBe('#00416E');
    expect(m.secundaria).toBe('#008CC8');
    expect(m.rodape).toBe('site.com.br');
  });

  it('sem configuração, cai no padrão Betinna (nunca fica sem cor)', async () => {
    const { svc } = build({ nome: 'X', cnpj: null, logoUrl: null, config: {} });

    const m = await svc.resolver('emp-1');

    expect(m.primaria).toBe('#201554');
    expect(m.secundaria).toBe('#2bcae5');
  });

  it('cor inválida na config é IGNORADA (pintaria o documento de preto)', async () => {
    const { svc } = build({
      nome: 'X',
      cnpj: null,
      logoUrl: null,
      config: { marca: { corPrimaria: 'azul' } },
    });

    expect((await svc.resolver('emp-1')).primaria).toBe('#201554');
  });

  it('baixa o logo PNG do bucket', async () => {
    const { svc, download } = build({
      nome: 'X',
      cnpj: null,
      logoUrl: 'emp-1/123_logo.png',
      config: {},
    });

    const m = await svc.resolver('emp-1');

    expect(download).toHaveBeenCalledWith('emp-1/123_logo.png');
    expect(m.logo).toBeInstanceOf(Buffer);
  });

  it('SVG NÃO é baixado — o pdfkit não embute e viraria lixo na página', async () => {
    const { svc, download } = build({
      nome: 'X',
      cnpj: null,
      logoUrl: 'emp-1/123_logo.svg',
      config: {},
    });

    expect((await svc.resolver('emp-1')).logo).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('falha no download não derruba o documento — sai sem logo', async () => {
    const { svc } = build(
      { nome: 'X', cnpj: null, logoUrl: 'emp-1/123_logo.png', config: {} },
      { erro: true },
    );

    expect((await svc.resolver('emp-1')).logo).toBeNull();
  });

  it('cacheia por empresa e o invalidar derruba (senão a cor nova demora 10min)', async () => {
    const { svc, prisma } = build({ nome: 'X', cnpj: null, logoUrl: null, config: {} });

    await svc.resolver('emp-1');
    await svc.resolver('emp-1');
    expect(prisma.empresa.findUnique).toHaveBeenCalledTimes(1);

    svc.invalidar('emp-1');
    await svc.resolver('emp-1');
    expect(prisma.empresa.findUnique).toHaveBeenCalledTimes(2);
  });
});
