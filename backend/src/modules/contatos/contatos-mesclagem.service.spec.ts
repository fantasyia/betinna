import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ContatosMesclagemService } from './contatos-mesclagem.service';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'u@x.com',
  nome: 'U',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...over,
});

/** Lead velho = quem trouxe o contato (tem a campanha). */
const leadVelho = {
  id: 'lead-velho',
  empresaId: 'emp-1',
  nome: 'ACME',
  criadoEm: new Date('2026-01-01T00:00:00Z'),
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'vtcd-alimenticia',
  origemCadastro: 'site',
  contatoEmail: 'contato@acme.com',
  contatoTelefone: null,
  cidade: null,
  variaveis: { atribuicao: { primeiro: { utmCampaign: 'vtcd-alimenticia' } } },
};

/** Lead novo = recadastro sem rastreio (o caso clássico de duplicata). */
const leadNovo = {
  id: 'lead-novo',
  empresaId: 'emp-1',
  nome: 'Acme Industria',
  criadoEm: new Date('2026-06-01T00:00:00Z'),
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  origemCadastro: 'manual_rep',
  contatoEmail: null,
  contatoTelefone: '11999990000',
  cidade: 'São Paulo',
  variaveis: {},
};

const makePrisma = () => {
  const tx = {
    leadTag: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    leadEtapaHistorico: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    formularioResposta: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    lead: {
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    mesclagemContato: {
      create: vi.fn().mockResolvedValue({ id: 'msc-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    cliente: { findFirst: vi.fn().mockResolvedValue({ id: 'cli-1' }) },
  };
  return {
    tx,
    lead: {
      findMany: vi.fn().mockResolvedValue([leadNovo, leadVelho]),
      findFirst: vi.fn().mockResolvedValue({ id: 'lead-velho', clienteId: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cliente: { findFirst: vi.fn().mockResolvedValue({ id: 'cli-1' }) },
    leadTag: { count: vi.fn().mockResolvedValue(2) },
    leadEtapaHistorico: { count: vi.fn().mockResolvedValue(3) },
    conversation: { count: vi.fn().mockResolvedValue(1) },
    formularioResposta: { count: vi.fn().mockResolvedValue(0) },
    mesclagemContato: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: unknown) => unknown)(tx) : arg,
    ),
  };
};

describe('ContatosMesclagemService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ContatosMesclagemService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ContatosMesclagemService(prisma as never);
  });

  describe('permissão', () => {
    it('REP não mescla', async () => {
      await expect(
        svc.mesclarLeads(user({ role: 'REP' as UserRole }), 'lead-novo', 'lead-velho'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('SAC não mescla', async () => {
      await expect(svc.duplicatas(user({ role: 'SAC' as UserRole }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('mesclarLeads', () => {
    it('⚠️ a atribuição vem do MAIS ANTIGO, mesmo quando ele é o absorvido', async () => {
      // Principal = o lead NOVO (sem rastreio). O velho é absorvido — mas foi ele
      // que trouxe o contato, então a campanha dele é que vale.
      await svc.mesclarLeads(user(), 'lead-novo', 'lead-velho');

      const patch = prisma.tx.lead.update.mock.calls[0][0].data;
      expect(patch.utmCampaign).toBe('vtcd-alimenticia');
      expect(patch.utmSource).toBe('google');
      expect(patch.origemCadastro).toBe('site');
      // O bloco de 1º toque do JSON também vem do mais antigo.
      expect(patch.variaveis.atribuicao).toEqual({
        primeiro: { utmCampaign: 'vtcd-alimenticia' },
      });
    });

    it('preenche buraco do principal com dado do absorvido, sem sobrescrever o que já tem', async () => {
      await svc.mesclarLeads(user(), 'lead-novo', 'lead-velho');

      const patch = prisma.tx.lead.update.mock.calls[0][0].data;
      // Principal não tinha e-mail → herda do absorvido.
      expect(patch.contatoEmail).toBe('contato@acme.com');
      // Principal JÁ tinha telefone e cidade → intocados (nem aparecem no patch).
      expect(patch.contatoTelefone).toBeUndefined();
      expect(patch.cidade).toBeUndefined();
    });

    it('migra os vínculos ANTES de apagar o absorvido', async () => {
      prisma.tx.leadEtapaHistorico.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
      prisma.tx.conversation.findMany.mockResolvedValue([{ id: 'conv-1' }]);

      await svc.mesclarLeads(user(), 'lead-novo', 'lead-velho');

      expect(prisma.tx.leadEtapaHistorico.updateMany).toHaveBeenCalledWith({
        where: { leadId: 'lead-velho' },
        data: { leadId: 'lead-novo' },
      });
      expect(prisma.tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { leadId: 'lead-velho', empresaId: 'emp-1' },
        data: { leadId: 'lead-novo' },
      });
      expect(prisma.tx.lead.delete).toHaveBeenCalledWith({ where: { id: 'lead-velho' } });
    });

    it('não migra tag que o principal JÁ tem (unique leadId+tagId)', async () => {
      prisma.tx.leadTag.findMany
        .mockResolvedValueOnce([{ tagId: 'tag-a' }, { tagId: 'tag-b' }]) // do absorvido
        .mockResolvedValueOnce([{ tagId: 'tag-a' }]); // do principal

      await svc.mesclarLeads(user(), 'lead-novo', 'lead-velho');

      expect(prisma.tx.leadTag.updateMany).toHaveBeenCalledWith({
        where: { leadId: 'lead-velho', tagId: { in: ['tag-b'] } },
        data: { leadId: 'lead-novo' },
      });
    });

    it('guarda snapshot do absorvido (é o que permite desfazer)', async () => {
      await svc.mesclarLeads(user(), 'lead-novo', 'lead-velho');

      const snap = prisma.tx.mesclagemContato.create.mock.calls[0][0].data.snapshot;
      expect(snap.absorvido.id).toBe('lead-velho');
      // Datas viram string no JSON (Date não sobrevive cru no snapshot).
      expect(snap.absorvido.criadoEm).toBe('2026-01-01T00:00:00.000Z');
      expect(snap.principalAntes.utmCampaign).toBeNull();
    });

    it('recusa mesclar um contato com ele mesmo', async () => {
      await expect(svc.mesclarLeads(user(), 'lead-x', 'lead-x')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  describe('vincularLeadCliente', () => {
    it('NÃO apaga nada — só liga o lead ao cliente', async () => {
      await svc.vincularLeadCliente(user(), 'lead-velho', 'cli-1');

      expect(prisma.tx.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-velho' },
        data: { clienteId: 'cli-1' },
      });
      // O lead continua existindo: é ele que guarda a atribuição e é ele que o
      // nó "Conversar com IA" exige pra atuar.
      expect(prisma.tx.lead.delete).not.toHaveBeenCalled();
    });

    it('recusa vincular ao cliente que já está vinculado', async () => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-velho', clienteId: 'cli-1' });
      await expect(svc.vincularLeadCliente(user(), 'lead-velho', 'cli-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  describe('desfazer', () => {
    it('recria o absorvido com o MESMO id e devolve os vínculos', async () => {
      prisma.mesclagemContato.findFirst.mockResolvedValue({
        id: 'msc-1',
        empresaId: 'emp-1',
        tipo: 'lead_lead',
        principalId: 'lead-novo',
        absorvidoId: 'lead-velho',
        desfeitaEm: null,
        snapshot: {
          absorvido: { ...leadVelho, criadoEm: '2026-01-01T00:00:00.000Z' },
          principalAntes: { utmCampaign: null, variaveis: {} },
          migrados: {
            tags: ['tag-b'],
            historicoEtapas: ['h1'],
            conversas: ['conv-1'],
            formularios: [],
          },
        },
      });

      await svc.desfazer(user(), 'msc-1');

      // Mesmo id — é o que faz os vínculos voltarem a bater.
      expect(prisma.tx.lead.create.mock.calls[0][0].data.id).toBe('lead-velho');
      expect(prisma.tx.leadEtapaHistorico.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['h1'] } },
        data: { leadId: 'lead-velho' },
      });
      expect(prisma.tx.mesclagemContato.update).toHaveBeenCalledWith({
        where: { id: 'msc-1' },
        data: { desfeitaEm: expect.any(Date) },
      });
    });

    it('não desfaz duas vezes', async () => {
      prisma.mesclagemContato.findFirst.mockResolvedValue({
        id: 'msc-1',
        empresaId: 'emp-1',
        tipo: 'lead_lead',
        desfeitaEm: new Date(),
        snapshot: {},
      });
      await expect(svc.desfazer(user(), 'msc-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  describe('previa', () => {
    it('mostra o que muda antes de confirmar', async () => {
      const r = await svc.previa(user(), 'lead-novo', 'lead-velho');

      expect(r.atribuicaoFinal.utmCampaign).toBe('vtcd-alimenticia');
      expect(r.atribuicaoMudou).toBe(true);
      expect(r.vinculosMigrados).toEqual({
        tags: 2,
        historicoEtapas: 3,
        conversas: 1,
        formularios: 0,
      });
      expect(r.camposPreenchidos.map((c) => c.campo)).toContain('contatoEmail');
    });
  });
});
