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
          observacoes: 'Quero saber do Master Block\n[origem: landing-x]',
        }),
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
