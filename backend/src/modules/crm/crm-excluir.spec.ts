import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmService } from './crm.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';

/**
 * `excluirLeads` é a rota mais perigosa da superfície MCP: no banco de produção
 * convivem 26 leads de funil e 30.282 contatos da base de prospecção importada,
 * na MESMA tabela, separados só pelo `funilId`. Estes testes existem pra travar
 * as guardas — se alguém "simplificar" a validação depois, o teste cai antes do
 * deploy, não depois de a base sumir.
 */
const user = { id: 'u1', role: 'DIRECTOR', empresaIdAtiva: 'emp1' } as AuthenticatedUser;

const makePrisma = () => ({
  lead: { findMany: vi.fn(), deleteMany: vi.fn() },
  conversation: { updateMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
});

const lead = (id: string, funilId: string | null) => ({
  id,
  nome: `Lead ${id}`,
  contatoTelefone: '11999990000',
  funilId,
  funil: funilId ? { nome: 'Triagem' } : null,
  funilEtapa: funilId ? { nome: 'Novo (inbound)' } : null,
});

const makeService = (prisma: ReturnType<typeof makePrisma>) =>
  new CrmService(
    prisma as never,
    { getRepIds: vi.fn().mockResolvedValue(null) } as never,
    {} as never,
  );

describe('CrmService.excluirLeads', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('apaga os leads de funil e desamarra a conversa', async () => {
    prisma.lead.findMany.mockResolvedValue([lead('l1', 'f1'), lead('l2', 'f1')]);

    const r = await makeService(prisma).excluirLeads(user, {
      leadIds: ['l1', 'l2'],
      confirmoExclusaoDe: 2,
    });

    expect(r.total).toBe(2);
    expect(r.excluidos[0]).toMatchObject({ id: 'l1', funil: 'Triagem', etapa: 'Novo (inbound)' });
    // Conversation.leadId é campo solto (sem FK): sem desamarrar, a triagem
    // conclui "já tem lead" e a conversa nunca mais é triada.
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { leadId: { in: ['l1', 'l2'] }, empresaId: 'emp1' },
      data: { leadId: null },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('RECUSA tudo se algum lead estiver SEM FUNIL (base de prospecção)', async () => {
    prisma.lead.findMany.mockResolvedValue([lead('l1', 'f1'), lead('l2', null)]);

    await expect(
      makeService(prisma).excluirLeads(user, {
        leadIds: ['l1', 'l2'],
        confirmoExclusaoDe: 2,
      }),
    ).rejects.toThrow(/não estão em nenhum funil/i);

    // All-or-nothing: nem o lead de funil, que estava OK, pode cair.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('RECUSA tudo se algum id não existir na empresa (lista errada)', async () => {
    prisma.lead.findMany.mockResolvedValue([lead('l1', 'f1')]);

    await expect(
      makeService(prisma).excluirLeads(user, {
        leadIds: ['l1', 'l-fantasma'],
        confirmoExclusaoDe: 2,
      }),
    ).rejects.toThrow(/l-fantasma/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('o deleteMany é ancorado no empresaId E nos ids exatos (nunca filtro aberto)', async () => {
    prisma.lead.findMany.mockResolvedValue([lead('l1', 'f1')]);

    await makeService(prisma).excluirLeads(user, { leadIds: ['l1'], confirmoExclusaoDe: 1 });

    expect(prisma.lead.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['l1'] }, empresaId: 'emp1' },
    });
  });
});
