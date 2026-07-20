import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { LeadCaptureService } from './lead-capture.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import type { UserRole } from '@prisma/client';

const makePrismaMock = () => ({
  leadCaptureChave: {
    upsert: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  lead: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  funil: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
});

const makeRedisMock = () => ({
  incr: vi.fn().mockResolvedValue(1),
  client: { expire: vi.fn().mockResolvedValue(1) },
});

const makeLeadsMock = () => ({
  createPublico: vi.fn().mockResolvedValue({ id: 'lead-novo' }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'dir-1',
  email: 'dir@somatec.com',
  nome: 'Diretor',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const CHAVE = `blc_${'a'.repeat(48)}`;
const HASH = createHash('sha256').update(CHAVE).digest('hex');

describe('LeadCaptureService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let redis: ReturnType<typeof makeRedisMock>;
  let leads: ReturnType<typeof makeLeadsMock>;
  let svc: LeadCaptureService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaMock();
    redis = makeRedisMock();
    leads = makeLeadsMock();
    svc = new LeadCaptureService(prisma as never, redis as never, leads as never);
  });

  describe('gerarChave', () => {
    it('gera chave blc_, grava só o hash e devolve a chave 1x', async () => {
      const r = await svc.gerarChave(fakeUser());

      expect(r.chave).toMatch(/^blc_[0-9a-f]{48}$/);
      expect(r.prefixo).toBe(`${r.chave.slice(0, 12)}…`);
      const call = prisma.leadCaptureChave.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ empresaId: 'emp-1' });
      // nunca grava a chave em claro
      expect(JSON.stringify(call)).not.toContain(r.chave);
      expect(call.create.chaveHash).toHaveLength(64);
    });
  });

  describe('capturar', () => {
    const dto = { nome: 'Padaria do João', telefone: '(11) 99999-1234' };

    it('401 uniforme pra chave com formato inválido (sem tocar o banco)', async () => {
      await expect(svc.capturar('errada', dto)).rejects.toThrow(/inválida/i);
      expect(prisma.leadCaptureChave.findUnique).not.toHaveBeenCalled();
    });

    it('401 uniforme pra chave inexistente e pra chave desativada', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue(null);
      await expect(svc.capturar(CHAVE, dto)).rejects.toThrow(/inválida/i);

      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: false });
      await expect(svc.capturar(CHAVE, dto)).rejects.toThrow(/inválida/i);
    });

    it('rate-limit: estoura 429 acima do teto', async () => {
      redis.incr.mockResolvedValue(61);
      await expect(svc.capturar(CHAVE, dto)).rejects.toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
      });
    });

    it('cria lead novo via createPublico (canal SITE, com funil opcional)', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });

      const r = await svc.capturar(CHAVE, {
        ...dto,
        mensagem: 'Quero saber do Master Block',
        origem: 'landing-x',
        funilId: 'funil-1',
      });

      expect(r).toEqual({ ok: true, leadId: 'lead-novo', duplicado: false });
      expect(leads.createPublico).toHaveBeenCalledWith(
        'emp-1',
        expect.objectContaining({
          nome: 'Padaria do João',
          contatoTelefone: '(11) 99999-1234',
          funilId: 'funil-1',
          // Observações = só a mensagem livre; origem vira campo estruturado.
          observacoes: 'Quero saber do Master Block',
          variaveis: expect.objectContaining({ origem: 'landing-x' }),
        }),
      );
    });

    it('campos estruturados vão pra variaveis; observações só a mensagem', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });

      await svc.capturar(CHAVE, {
        ...dto,
        mensagem: 'Tenho paradas por queima de placas',
        origem: 'site-institucional',
        empresa: 'Metalúrgica Exemplo LTDA',
        cargo: 'Gerente de Manutenção',
        regiao: 'Interior de SP',
        experiencia: '8 anos',
        paginaOrigem: '/contato',
        consentimentoLgpd: { aceito: true, versaoTexto: 'v1' },
        metadados: { referer: 'https://somatecblocking.com.br/contato' },
      });

      const [, arg] = leads.createPublico.mock.calls[0];
      expect(arg.observacoes).toBe('Tenho paradas por queima de placas');
      expect(arg.variaveis).toMatchObject({
        origem: 'site-institucional',
        empresa: 'Metalúrgica Exemplo LTDA',
        cargo: 'Gerente de Manutenção',
        regiao: 'Interior de SP',
        experiencia: '8 anos',
        paginaOrigem: '/contato',
        consentimentoLgpd: { aceito: true, versaoTexto: 'v1' },
        metadados: { referer: 'https://somatecblocking.com.br/contato' },
      });
    });

    it('ACEITA payload SEM bloco atribuicao sem quebrar (estado normal até o site instrumentar)', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });

      const r = await svc.capturar(CHAVE, { ...dto, mensagem: 'oi' });

      expect(r).toEqual({ ok: true, leadId: 'lead-novo', duplicado: false });
      const [, arg] = leads.createPublico.mock.calls[0];
      // Sem atribuição: colunas null, origemCadastro default "site", sem chave atribuicao no JSON.
      expect(arg.utmSource).toBeNull();
      expect(arg.utmCampaign).toBeNull();
      expect(arg.origemCadastro).toBe('site');
      expect(arg.variaveis.atribuicao).toBeUndefined();
    });

    it('grava atribuição NORMALIZADA + colunas do 1º toque (source/medium/campaign)', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });

      await svc.capturar(CHAVE, {
        ...dto,
        formulario: 'Calculadora',
        atribuicao: {
          primeiro: { utmSource: 'Google', utmMedium: 'PAID', utmCampaign: 'VTCD-Alim ' },
          ultimo: { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'remarketing' },
        },
      });

      const [, arg] = leads.createPublico.mock.calls[0];
      // Colunas = 1º toque, normalizadas (lowercase+trim).
      expect(arg.utmSource).toBe('google');
      expect(arg.utmCampaign).toBe('vtcd-alim');
      expect(arg.formularioOrigem).toBe('calculadora');
      // JSON tem primeiro E último.
      expect(arg.variaveis.atribuicao.primeiro.utmCampaign).toBe('vtcd-alim');
      expect(arg.variaveis.atribuicao.ultimo.utmCampaign).toBe('remarketing');
    });

    it('DUPLICADO: último toque atualiza, 1º toque PRESERVADO (imutável)', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });
      // acharLeadAberto por telefone usa $queryRaw → devolve o lead existente
      prisma.$queryRaw.mockResolvedValue([{ id: 'lead-existente' }]);
      prisma.lead.findUnique.mockResolvedValue({
        utmCampaign: 'blog-seo-original', // 1º toque JÁ existe
        utmSource: 'blog',
        utmMedium: 'organic',
        variaveis: { atribuicao: { primeiro: { utmCampaign: 'blog-seo-original' } } },
      });

      const r = await svc.capturar(CHAVE, {
        ...dto,
        atribuicao: { ultimo: { utmSource: 'google', utmCampaign: 'nova-campanha' } },
      });

      expect(r).toEqual({ ok: true, leadId: 'lead-existente', duplicado: true });
      expect(leads.createPublico).not.toHaveBeenCalled(); // não cria lead novo
      const [[updateArg]] = prisma.lead.update.mock.calls;
      // 1º toque NÃO sobrescrito → update NÃO mexe nas colunas utm*
      expect(updateArg.data.utmCampaign).toBeUndefined();
      // Último toque atualizado no JSON; primeiro preservado
      expect(updateArg.data.variaveis.atribuicao.primeiro.utmCampaign).toBe('blog-seo-original');
      expect(updateArg.data.variaveis.atribuicao.ultimo.utmCampaign).toBe('nova-campanha');
    });

    it('encoding: corpo em latin1 (acentos como �) é recuperado a partir do rawBody', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });

      // dto como o body-parser entregaria (latin1 decodificado como UTF-8 → �)
      const dtoMojibake = {
        ...dto,
        nome: 'Integra��o Site',
        mensagem: 'Tenho paradas por queima de placas no formul�rio',
      };
      // rawBody = os BYTES originais que o site mandou (latin1)
      const rawBody = Buffer.from(
        JSON.stringify({
          ...dto,
          nome: 'Integração Site',
          mensagem: 'Tenho paradas por queima de placas no formulário',
        }),
        'latin1',
      );

      await svc.capturar(CHAVE, dtoMojibake, rawBody);

      const [, arg] = leads.createPublico.mock.calls[0];
      expect(arg.nome).toBe('Integração Site');
      expect(arg.observacoes).toBe('Tenho paradas por queima de placas no formulário');
    });

    it('encoding: corpo UTF-8 VÁLIDO com � legítimo NÃO é re-decodificado (não corrompe literais)', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });

      // Cenário do bug real: o usuário já perdeu um acento na origem (� de verdade),
      // mas os literais do site ("Formulário", "·") são UTF-8 limpos. O corpo CRU é
      // UTF-8 VÁLIDO → NÃO pode ser re-lido como latin1 (senão vira "FormulÃ¡rio").
      const bodyObj = {
        ...dto,
        mensagem: 'Quero diagn�stico\n\n— Interesse: b2b · Formulário: b2b',
      };
      const rawBody = Buffer.from(JSON.stringify(bodyObj), 'utf8');

      await svc.capturar(CHAVE, bodyObj, rawBody);

      const [, arg] = leads.createPublico.mock.calls[0];
      // literais preservados; o � do user permanece (irrecuperável) mas não espalha corrupção
      expect(arg.observacoes).toBe('Quero diagn�stico\n\n— Interesse: b2b · Formulário: b2b');
    });

    it('listarFunis: valida a chave e devolve funis com etapas', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });
      prisma.funil.findMany.mockResolvedValue([
        { id: 'f1', nome: 'Clientes', etapas: [{ id: 'e1', nome: 'Novo' }] },
      ]);

      const r = await svc.listarFunis(CHAVE);
      expect(r).toEqual([{ id: 'f1', nome: 'Clientes', etapas: [{ id: 'e1', nome: 'Novo' }] }]);
      expect(prisma.funil.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { empresaId: 'emp-1', ativo: true } }),
      );
    });

    it('dedup por telefone (sufixo-8): devolve lead existente sem criar outro', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });
      prisma.$queryRaw.mockResolvedValue([{ id: 'lead-existente' }]);

      const r = await svc.capturar(CHAVE, dto);

      expect(r).toEqual({ ok: true, leadId: 'lead-existente', duplicado: true });
      expect(leads.createPublico).not.toHaveBeenCalled();
    });

    it('dedup por e-mail quando não há telefone', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({ empresaId: 'emp-1', ativo: true });
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-email' });

      const r = await svc.capturar(CHAVE, { nome: 'Sem Fone', email: 'x@y.com' });

      expect(r).toEqual({ ok: true, leadId: 'lead-email', duplicado: true });
      expect(leads.createPublico).not.toHaveBeenCalled();
    });
  });

  describe('status/desativar', () => {
    it('status devolve prefixo/uso e nunca a chave', async () => {
      prisma.leadCaptureChave.findUnique.mockResolvedValue({
        ativo: true,
        prefixo: 'blc_a1b2c3d4…',
        criadoEm: new Date('2026-07-01'),
        ultimoUsoEm: null,
      });
      const r = await svc.status(fakeUser());
      expect(r.configurada).toBe(true);
      expect(r.prefixo).toBe('blc_a1b2c3d4…');
      expect(JSON.stringify(r)).not.toContain(HASH);
    });

    it('desativar marca ativo=false', async () => {
      await svc.desativar(fakeUser());
      expect(prisma.leadCaptureChave.updateMany).toHaveBeenCalledWith({
        where: { empresaId: 'emp-1' },
        data: { ativo: false },
      });
    });
  });
});
