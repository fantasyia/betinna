import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRANDING_PADRAO, BrandingService } from './branding.service';

/**
 * White-label POR TENANT — não é rename.
 *
 * O que estes testes protegem é a propriedade que faz o produto continuar sendo
 * multi-tenant: dois domínios diferentes veem marcas diferentes ao mesmo tempo,
 * e quem não configurou nada continua vendo o Betinna. Se um dia alguém
 * "simplificar" isso pra uma marca só, é aqui que quebra.
 */
const build = (
  over: { empresas?: Array<{ id: string }>; config?: unknown; nome?: string } = {},
) => {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue(over.empresas ?? []),
    empresa: {
      findUnique: vi.fn().mockResolvedValue({
        nome: over.nome ?? 'Somatec Blocking',
        config: over.config ?? {
          branding: {
            nome: 'Somatec Blocking',
            nomeCurto: 'Somatec',
            dominio: 'app.somatecblocking.com.br',
            logoUrl: 'https://x/logo.png',
            cores: { primaria: '#00416E', acao: '#F39200' },
          },
        },
      }),
    },
  };
  const env = { get: () => 'https://frontend-production.up.railway.app' };
  return { svc: new BrandingService(prisma as never, env as never), prisma };
};

describe('BrandingService', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build({ empresas: [{ id: 'emp-1' }] });
  });

  it('host do tenant devolve a marca DELE', async () => {
    const b = await ctx.svc.porHost('app.somatecblocking.com.br');

    expect(b.nome).toBe('Somatec Blocking');
    expect(b.cores.acao).toBe('#F39200');
  });

  it('host desconhecido continua sendo o BETINNA — é o que separa white-label de rename', async () => {
    const c = build({ empresas: [] });

    expect(await c.svc.porHost('outro-dominio.com')).toEqual(BRANDING_PADRAO);
  });

  it('sem host (chamada interna) devolve o padrão sem ir ao banco', async () => {
    const c = build();

    expect(await c.svc.porHost(undefined)).toEqual(BRANDING_PADRAO);
    expect(c.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('normaliza o host: porta, www e maiúscula não podem deixar o tenant sem marca', async () => {
    await ctx.svc.porHost('WWW.App.SomatecBlocking.com.br:443');

    const params = ctx.prisma.$queryRaw.mock.calls[0].slice(1);
    expect(params).toContain('app.somatecblocking.com.br');
  });

  it('tenant sem branding herda o NOME da empresa, não o do produto', async () => {
    const c = build({ empresas: [{ id: 'emp-2' }], config: {}, nome: 'Indústria Alfa' });

    const b = await c.svc.porHost('alfa.com.br');

    expect(b.nome).toBe('Indústria Alfa');
    expect(b.nomeCurto).toBe('Indústria');
    // Sem cores próprias, as do produto — e não as de outro tenant.
    expect(b.cores).toEqual(BRANDING_PADRAO.cores);
  });

  it('falha de banco não deixa a tela de login sem marca nenhuma', async () => {
    const c = build();
    c.prisma.$queryRaw.mockRejectedValue(new Error('banco fora'));

    expect(await c.svc.porHost('app.somatecblocking.com.br')).toEqual(BRANDING_PADRAO);
  });

  it('o link do e-mail usa o domínio DO TENANT, não o FRONTEND_URL único', async () => {
    // Sem isto, o convite do rep da Somatec sai apontando pro domínio do outro
    // tenant: o link abre, mas com a marca errada — e pode nem estar na
    // allowlist de redirect do Supabase.
    expect(await ctx.svc.urlDoApp('emp-1')).toBe('https://app.somatecblocking.com.br');
  });

  it('tenant sem domínio próprio cai no FRONTEND_URL', async () => {
    const c = build({ config: {} });

    expect(await c.svc.urlDoApp('emp-2')).toBe('https://frontend-production.up.railway.app');
  });
});
