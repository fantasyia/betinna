import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DescadastroService } from './descadastro.service';
import { SupressaoService } from '@shared/supressao/supressao.service';

/**
 * Descadastro de um clique.
 *
 * Não precisa de mecanismo novo de supressão: o `SupressaoService` já gateia
 * todo outbound pela tag LGPD, e o clique só aplica essa tag. O que estes testes
 * protegem é o resto — o token não pode expor id de lead numa URL que passa por
 * provedor de e-mail e histórico de navegador, e um token de outra empresa não
 * pode etiquetar contato nenhum.
 */
const CHAVE = 'a'.repeat(64);

const build = (over: { lead?: unknown; cliente?: unknown } = {}) => {
  const prisma = {
    tag: { upsert: vi.fn().mockResolvedValue({ id: 'tag-lgpd' }) },
    // `??` aqui engoliria o `null` do teste de outro tenant — o default só vale
    // quando a chave NÃO foi passada.
    lead: { findFirst: vi.fn().mockResolvedValue('lead' in over ? over.lead : { id: 'lead-1' }) },
    cliente: { findFirst: vi.fn().mockResolvedValue('cliente' in over ? over.cliente : null) },
    leadTag: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    clienteTag: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const env = {
    get: (k: string) =>
      k === 'ENCRYPTION_KEY' ? CHAVE : k === 'API_PUBLIC_URL' ? 'https://api.x/api/v1' : '',
  };
  return { svc: new DescadastroService(prisma as never, env as never), prisma };
};

describe('DescadastroService', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it('o token NÃO deixa o id do lead legível na URL', () => {
    const token = ctx.svc.gerarToken({ empresaId: 'emp-1', leadId: 'lead-segredo' });

    expect(token).not.toContain('lead-segredo');
    expect(Buffer.from(token, 'base64').toString('utf8')).not.toContain('lead-segredo');
  });

  it('mas o próprio serviço lê de volta', () => {
    const token = ctx.svc.gerarToken({ empresaId: 'emp-1', leadId: 'lead-1', email: 'a@b.com' });

    expect(ctx.svc.lerToken(token)).toMatchObject({ e: 'emp-1', l: 'lead-1', m: 'a@b.com' });
  });

  it('token adulterado não estoura — vira "link inválido"', async () => {
    const r = await ctx.svc.descadastrar('nao-e-um-token');

    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/inválido/i);
    expect(ctx.prisma.leadTag.createMany).not.toHaveBeenCalled();
  });

  it('aplica a MESMA tag que o guard de supressão procura', async () => {
    const token = ctx.svc.gerarToken({ empresaId: 'emp-1', leadId: 'lead-1' });

    await ctx.svc.descadastrar(token);

    expect(ctx.prisma.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId_nome: { empresaId: 'emp-1', nome: SupressaoService.TAG_LGPD } },
      }),
    );
    expect(ctx.prisma.leadTag.createMany).toHaveBeenCalled();
  });

  it('clicar duas vezes não é erro — só diz que já estava fora', async () => {
    ctx.prisma.leadTag.createMany.mockResolvedValue({ count: 0 });
    const token = ctx.svc.gerarToken({ empresaId: 'emp-1', leadId: 'lead-1' });

    const r = await ctx.svc.descadastrar(token);

    expect(r).toMatchObject({ ok: true, jaEstava: true });
  });

  it('lead de OUTRA empresa não é etiquetado (o token carrega o tenant)', async () => {
    const c = build({ lead: null }); // o findFirst filtra por empresaId e não acha
    const token = c.svc.gerarToken({ empresaId: 'emp-1', leadId: 'lead-de-outro-tenant' });

    const r = await c.svc.descadastrar(token);

    expect(c.prisma.leadTag.createMany).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('a URL sai pronta pro rodapé e pro cabeçalho List-Unsubscribe', () => {
    const url = ctx.svc.urlDescadastro('abc/def+gh');

    expect(url.startsWith('https://api.x/api/v1/descadastrar?t=')).toBe(true);
    // Query string: o token precisa ir escapado.
    expect(url).not.toContain('abc/def+gh');
  });
});
