import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CrmService } from './crm.service';

/**
 * As duas portas de MCP que destravam o teste AUTÔNOMO dos fluxos (card 🤖):
 * atribuir/desatribuir representante e a entrada RETROATIVA na etapa.
 * O CrmService é só a porta — as validações moram no LeadsService.
 */
const fakeUser = (): AuthenticatedUser => ({
  id: 'adm-1',
  email: 'a@b.c',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
});

describe('CrmService — portas do teste autônomo', () => {
  let prisma: {
    lead: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    funilEtapa: { findFirst: ReturnType<typeof vi.fn> };
  };
  let leads: {
    moverEtapa: ReturnType<typeof vi.fn>;
    atribuirRep: ReturnType<typeof vi.fn>;
  };
  let svc: CrmService;

  beforeEach(() => {
    prisma = {
      lead: {
        findFirst: vi.fn().mockResolvedValue({ funilEtapa: { id: 'et-a', nome: 'Novo' } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      funilEtapa: {
        findFirst: vi.fn().mockResolvedValue({ id: 'et-b', nome: 'Proposta', funilId: 'f1' }),
      },
    };
    leads = {
      moverEtapa: vi.fn().mockResolvedValue({}),
      atribuirRep: vi.fn().mockResolvedValue({
        representanteId: 'rep-7',
        representante: { nome: 'Marcelo' },
      }),
    };
    svc = new CrmService(
      prisma as never,
      { getRepIds: vi.fn().mockResolvedValue(null) } as never,
      leads as never,
    );
  });

  it('atribuir representante delega pro LeadsService (carteira + rep válido moram lá)', async () => {
    const r = await svc.atribuirRepresentante(fakeUser(), {
      leadId: 'lead-1',
      representanteId: 'rep-7',
    });

    expect(leads.atribuirRep).toHaveBeenCalledWith(expect.anything(), 'lead-1', {
      representanteId: 'rep-7',
    });
    expect(r).toEqual({
      ok: true,
      leadId: 'lead-1',
      representanteId: 'rep-7',
      representanteNome: 'Marcelo',
    });
  });

  it('representanteId null DESATRIBUI — é o que alterna o lead entre os dois ramos do teste', async () => {
    leads.atribuirRep.mockResolvedValue({ representanteId: null, representante: null });

    const r = await svc.atribuirRepresentante(fakeUser(), {
      leadId: 'lead-1',
      representanteId: null,
    });

    expect(leads.atribuirRep).toHaveBeenCalledWith(expect.anything(), 'lead-1', {
      representanteId: null,
    });
    expect(r.representanteId).toBeNull();
  });

  it('etapaDesde retroativo sobrescreve o carimbo DEPOIS do move (é o que faz o SLA vencer)', async () => {
    const retro = new Date('2026-08-10T12:00:00Z');

    await svc.moverEtapa(fakeUser(), {
      leadId: 'lead-1',
      etapaId: 'et-b',
      etapaDesde: retro,
    });

    // O moverEtapa do LeadsService carimba etapaDesde=agora; o override vem depois.
    expect(leads.moverEtapa).toHaveBeenCalled();
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', empresaId: 'emp-1' },
      data: { etapaDesde: retro },
    });
  });

  it('sem etapaDesde, não mexe no carimbo (comportamento de sempre)', async () => {
    await svc.moverEtapa(fakeUser(), { leadId: 'lead-1', etapaId: 'et-b' });

    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });
});
