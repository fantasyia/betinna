import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ContatosService } from './contatos.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  lead: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  cliente: {
    findMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  conversation: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  message: {
    deleteMany: vi.fn(),
  },
  tag: {
    findMany: vi.fn(),
  },
  leadTag: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  clienteTag: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
});

/** RepScopeService mock: REP → [user.id], ADMIN/DIRECTOR → null (sem filtro). */
const makeRepScopeMock = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    return null;
  }),
});

/** LeadsService mock — só os métodos usados por ContatosService. */
const makeLeadsMock = () => ({
  create: vi.fn(),
  moverEtapa: vi.fn(),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'rep-1',
  email: 'rep@betinna.ai',
  nome: 'Rep Teste',
  role: 'REP' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const adminUser = fakeUser({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin Teste',
  role: 'ADMIN' as UserRole,
});

/** Constrói um Prisma.PrismaClientKnownRequestError com code P2003. */
const makeP2003 = () =>
  new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: '6.0.0',
  });

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ContatosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScopeMock>;
  let leads: ReturnType<typeof makeLeadsMock>;
  let svc: ContatosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScopeMock();
    leads = makeLeadsMock();
    svc = new ContatosService(prisma as never, repScope as never, leads as never);
  });

  // =========================================================================
  // 1. acaoMassa — excluir com guard FK (P2003)
  // =========================================================================

  describe('acaoMassa — excluir cliente com FK (P2003 guard)', () => {
    it('captura P2003 em cliente, adiciona em falhas com mensagem correta e continua para os demais', async () => {
      // Resolve ids acessíveis: lead vazio, clientes c1+c2, sem conversas
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      prisma.conversation.findMany.mockResolvedValue([]);

      // c1: tem pedidos/propostas → P2003; c2: sucesso
      prisma.cliente.deleteMany
        .mockRejectedValueOnce(makeP2003()) // c1
        .mockResolvedValueOnce({ count: 1 }); // c2

      const result = await svc.acaoMassa(adminUser, {
        acao: 'excluir',
        leadIds: [],
        clienteIds: ['c1', 'c2'],
        conversaIds: [],
      });

      // c2 foi excluído, c1 falhou
      expect(result.ok).toBe(true);
      expect(result.afetados).toBe(1);
      expect(result.falhas).toHaveLength(1);
      expect(result.falhas[0]).toEqual({
        id: 'c1',
        erro: 'Cliente tem pedidos/propostas — inative em vez de excluir',
      });

      // deleteMany chamado individualmente pra cada cliente
      expect(prisma.cliente.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('propaga mensagem genérica para erros que não sejam P2003', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'cx' }]);
      prisma.conversation.findMany.mockResolvedValue([]);

      const genErr = new Error('disco cheio');
      prisma.cliente.deleteMany.mockRejectedValueOnce(genErr);

      const result = await svc.acaoMassa(adminUser, {
        acao: 'excluir',
        leadIds: [],
        clienteIds: ['cx'],
        conversaIds: [],
      });

      expect(result.afetados).toBe(0);
      expect(result.falhas[0]).toEqual({ id: 'cx', erro: 'disco cheio' });
    });
  });

  // =========================================================================
  // 2. acaoMassa — scoping por carteira (REP vs ADMIN)
  // =========================================================================

  describe('acaoMassa — scoping por carteira', () => {
    it('REP: getRepIds retorna [user.id] e a query de clientes usa scope', async () => {
      const rep = fakeUser();
      prisma.lead.findMany.mockResolvedValue([]);
      // scope restringe: só cliente do rep é devolvido
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c-rep' }]);
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.cliente.deleteMany.mockResolvedValue({ count: 1 });

      await svc.acaoMassa(rep, {
        acao: 'excluir',
        leadIds: [],
        clienteIds: ['c-rep', 'c-outro'], // c-outro não está no scope
        conversaIds: [],
      });

      // getRepIds deve ter sido chamado com o user REP
      expect(repScope.getRepIds).toHaveBeenCalledWith(rep);

      // findMany de cliente chamado com filtro de scope (representanteId: { in: [rep.id] })
      const findManyCall = prisma.cliente.findMany.mock.calls[0][0] as {
        where: { representanteId?: unknown };
      };
      expect(findManyCall.where).toMatchObject({
        representanteId: { in: ['rep-1'] },
      });

      // Apenas c-rep (devolvido pelo mock) foi excluído — c-outro não chegou pra ação
      expect(prisma.cliente.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.cliente.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'c-rep' }) }),
      );
    });

    it('ADMIN: getRepIds retorna null e query de clientes NÃO filtra por representanteId', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.cliente.deleteMany.mockResolvedValue({ count: 1 });

      await svc.acaoMassa(adminUser, {
        acao: 'excluir',
        leadIds: [],
        clienteIds: ['c1', 'c2'],
        conversaIds: [],
      });

      const findManyCall = prisma.cliente.findMany.mock.calls[0][0] as {
        where: { representanteId?: unknown };
      };
      // Com scope=null o service NÃO aplica filtro de representanteId
      expect(findManyCall.where).not.toHaveProperty('representanteId');
    });
  });

  // =========================================================================
  // 3. acaoMassa — tag aplica em leads+clientes; mover-etapa só em leads
  // =========================================================================

  describe('acaoMassa — ação tag', () => {
    it('tag adicionar cria LeadTag e ClienteTag, ignora conversas', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'l1' }]);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.conversation.findMany.mockResolvedValue([{ id: 'cv1' }]);
      prisma.tag.findMany.mockResolvedValue([{ id: 'tag-1' }]);
      prisma.leadTag.createMany.mockResolvedValue({ count: 1 });
      prisma.clienteTag.createMany.mockResolvedValue({ count: 1 });

      const result = await svc.acaoMassa(adminUser, {
        acao: 'tag',
        leadIds: ['l1'],
        clienteIds: ['c1'],
        conversaIds: ['cv1'],
        tagIds: ['tag-1'],
        modo: 'adicionar',
      });

      expect(result.ok).toBe(true);
      expect(result.afetados).toBe(2); // 1 lead + 1 cliente (conversa ignorada)

      expect(prisma.leadTag.createMany).toHaveBeenCalledOnce();
      expect(prisma.clienteTag.createMany).toHaveBeenCalledOnce();

      // Conversas não são tocadas em tag
      expect(prisma.conversation.deleteMany).not.toHaveBeenCalled();
    });

    it('tag remover deleta LeadTag e ClienteTag', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'l1' }]);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.tag.findMany.mockResolvedValue([{ id: 'tag-1' }]);
      prisma.leadTag.deleteMany.mockResolvedValue({ count: 1 });
      prisma.clienteTag.deleteMany.mockResolvedValue({ count: 1 });

      const result = await svc.acaoMassa(adminUser, {
        acao: 'tag',
        leadIds: ['l1'],
        clienteIds: ['c1'],
        conversaIds: [],
        tagIds: ['tag-1'],
        modo: 'remover',
      });

      expect(result.afetados).toBe(2);
      expect(prisma.leadTag.deleteMany).toHaveBeenCalledOnce();
      expect(prisma.clienteTag.deleteMany).toHaveBeenCalledOnce();
    });
  });

  describe('acaoMassa — ação mover-etapa (só leads)', () => {
    it('chama leads.moverEtapa para cada leadId e retorna afetados corretos', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);
      prisma.cliente.findMany.mockResolvedValue([{ id: 'c1' }]); // cliente não deve ser movido
      prisma.conversation.findMany.mockResolvedValue([]);
      leads.moverEtapa.mockResolvedValue({ id: 'l1' });

      const result = await svc.acaoMassa(adminUser, {
        acao: 'mover-etapa',
        leadIds: ['l1', 'l2'],
        clienteIds: ['c1'],
        conversaIds: [],
        funilEtapaId: 'etapa-2',
        motivo: 'teste',
      });

      expect(result.ok).toBe(true);
      expect(result.afetados).toBe(2);

      // moverEtapa chamado apenas para leads (NÃO para clientes)
      expect(leads.moverEtapa).toHaveBeenCalledTimes(2);
      expect(leads.moverEtapa).toHaveBeenCalledWith(
        adminUser,
        'l1',
        expect.objectContaining({ funilEtapaId: 'etapa-2', motivo: 'teste' }),
      );
      expect(leads.moverEtapa).toHaveBeenCalledWith(
        adminUser,
        'l2',
        expect.objectContaining({ funilEtapaId: 'etapa-2' }),
      );
    });

    it('falha em um lead não derruba os outros (continua o loop)', async () => {
      prisma.lead.findMany.mockResolvedValue([{ id: 'lX' }, { id: 'lY' }]);
      prisma.cliente.findMany.mockResolvedValue([]);
      prisma.conversation.findMany.mockResolvedValue([]);

      leads.moverEtapa
        .mockRejectedValueOnce(new Error('etapa inválida')) // lX falha
        .mockResolvedValueOnce({}); // lY ok

      const result = await svc.acaoMassa(adminUser, {
        acao: 'mover-etapa',
        leadIds: ['lX', 'lY'],
        clienteIds: [],
        conversaIds: [],
        funilEtapaId: 'etapa-3',
      });

      expect(result.afetados).toBe(1);
      expect(result.falhas).toHaveLength(1);
      expect(result.falhas[0]).toEqual({ id: 'lX', erro: 'etapa inválida' });
    });
  });

  // =========================================================================
  // 4. criarLeads — dedup D18 (sufixo 8 dígitos)
  // =========================================================================

  describe('criarLeads — dedup D18', () => {
    it('pula contato cujo sufixo de telefone já tem lead existente e conta em jaEramLead', async () => {
      // Lead existente com telefone terminando em 12345678
      prisma.lead.findMany.mockResolvedValue([
        { contatoTelefone: '55119912345678' }, // sufixo: 12345678
      ]);

      leads.create.mockResolvedValue({ id: 'novo-lead' });

      const result = await svc.criarLeads(adminUser, {
        contatos: [
          { nome: 'Já é lead', telefone: '9912345678' }, // sufixo: 12345678 → dup
          { nome: 'Novo contato', telefone: '5511987654321' }, // sufixo: 87654321 → novo
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.afetados).toBe(1); // só o novo
      expect(result.jaEramLead).toBe(1); // 1 pulado
      expect(result.falhas).toHaveLength(0);

      // leads.create só chamado para o novo contato
      expect(leads.create).toHaveBeenCalledOnce();
      expect(leads.create).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({ contatoTelefone: '5511987654321' }),
      );
    });

    it('previne duplicação DENTRO do mesmo lote (dois contatos com mesmo sufixo)', async () => {
      // Sem leads existentes
      prisma.lead.findMany.mockResolvedValue([]);
      leads.create.mockResolvedValue({ id: 'lead-novo' });

      const result = await svc.criarLeads(adminUser, {
        contatos: [
          { nome: 'Contato A', telefone: '11 9 9999-1234' }, // sufixo: 99991234
          { nome: 'Contato B', telefone: '(21)99999-1234' }, // sufixo: 99991234 → mesmo → dup
        ],
      });

      // Só o primeiro cria; o segundo é pulado (jaEramLead)
      expect(result.afetados).toBe(1);
      expect(result.jaEramLead).toBe(1);
      expect(leads.create).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // 5. criarLeads — força rep p/ REP (passa user REP a leads.create)
  // =========================================================================

  describe('criarLeads — força representanteId para user REP', () => {
    // CUID válido para satisfazer a validação do createLeadSchema
    const repCuid = 'cjld2cjxh0000qzrmn831i7rn';

    it('chama leads.create com o user REP (LeadsService força representanteId = user.id)', async () => {
      // O ContatosService não força representanteId — delega ao LeadsService.
      // O que testa aqui: leads.create é chamado com o user REP original,
      // para que LeadsService possa sobrescrever representanteId = user.id.
      const rep = fakeUser({ id: repCuid }); // role: REP com id cuid válido
      prisma.lead.findMany.mockResolvedValue([]);
      leads.create.mockResolvedValue({ id: 'lead-rep' });

      await svc.criarLeads(rep, {
        contatos: [{ nome: 'Prospect' }], // sem telefone: sem dedup, vai criar
      });

      // leads.create chamado com o user REP
      expect(leads.create).toHaveBeenCalledOnce();
      const [calledUser] = leads.create.mock.calls[0] as [AuthenticatedUser, ...unknown[]];
      expect(calledUser.id).toBe(repCuid);
      expect(calledUser.role).toBe('REP');
    });

    it('com ADMIN não força representanteId — passes payload com representanteId informado', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      leads.create.mockResolvedValue({ id: 'lead-admin' });

      // representanteId no nível do contato (cuid válido)
      await svc.criarLeads(adminUser, {
        contatos: [{ nome: 'Cliente X', representanteId: repCuid }],
      });

      expect(leads.create).toHaveBeenCalledOnce();
      const [calledUser, calledPayload] = leads.create.mock.calls[0] as [
        AuthenticatedUser,
        { representanteId?: string },
      ];
      expect(calledUser.role).toBe('ADMIN');
      // payload tem representanteId do contato (ADMIN não sobrescreve no ContatosService)
      expect(calledPayload).toMatchObject({ representanteId: repCuid });
    });
  });
});
