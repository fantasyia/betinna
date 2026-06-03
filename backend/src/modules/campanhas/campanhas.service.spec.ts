import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CampanhasService, toWhatsAppJid } from './campanhas.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  campanha: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'camp-1' }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    delete: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  campanhaDestinatario: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    groupBy: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  cliente: {
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
});

const makeRepScopeMock = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a', 'rep-b'];
    return null;
  }),
});

const makeQueueMock = () => ({
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeCampanha = (overrides: Record<string, unknown> = {}) => ({
  id: 'camp-1',
  empresaId: 'emp-1',
  criadoPorId: 'admin-1',
  nome: 'Campanha Teste',
  canal: 'EMAIL',
  status: 'RASCUNHO',
  segTagIds: [],
  segRepIds: [],
  segClienteIds: [],
  assunto: 'Olá cliente',
  mensagemWa: null,
  mensagemEmail: '<p>Conteúdo</p>',
  objetivo: null,
  usarIaPersonalizacao: false,
  agendadoPara: null,
  iniciadoEm: null,
  finalizadoEm: null,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  destinatarios: [],
  criadoPor: { id: 'admin-1', nome: 'Admin' },
  _count: { destinatarios: 0 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CampanhasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScopeMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let service: CampanhasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScopeMock();
    queue = makeQueueMock();
    service = new CampanhasService(prisma as never, repScope as never, queue as never);
  });

  // -------------------------------------------------------------------------
  // toWhatsAppJid — helper puro
  // -------------------------------------------------------------------------

  describe('toWhatsAppJid', () => {
    it('adiciona 55 quando número não tem código do país', () => {
      expect(toWhatsAppJid('11987654321')).toBe('5511987654321@s.whatsapp.net');
    });

    it('preserva 55 quando já está presente', () => {
      expect(toWhatsAppJid('5511987654321')).toBe('5511987654321@s.whatsapp.net');
    });

    it('remove formatação (parênteses, hífens, espaços)', () => {
      expect(toWhatsAppJid('(11) 98765-4321')).toBe('5511987654321@s.whatsapp.net');
    });
  });

  // -------------------------------------------------------------------------
  // Controle de acesso — ForbiddenException sem empresaIdAtiva
  // -------------------------------------------------------------------------

  describe('acesso sem empresaIdAtiva → ForbiddenException', () => {
    const noEmp = fakeUser({ empresaIdAtiva: null });

    it('list', async () => {
      await expect(service.list(noEmp, { page: 1, limit: 20 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('create', async () => {
      await expect(
        service.create(noEmp, {
          nome: 'X',
          canal: 'EMAIL',
          segTagIds: [],
          segRepIds: [],
          segClienteIds: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('retorna lista paginada vazia', async () => {
      prisma.campanha.count.mockResolvedValue(0);
      prisma.campanha.findMany.mockResolvedValue([]);

      const result = await service.list(fakeUser(), { page: 1, limit: 20 });

      expect(result).toMatchObject({ data: [], pagination: expect.any(Object) });
    });

    it('aplica empresaId no where', async () => {
      await service.list(fakeUser({ empresaIdAtiva: 'emp-9' }), { page: 1, limit: 10 });

      const whereArg = prisma.campanha.findMany.mock.calls[0][0].where;
      expect(whereArg.empresaId).toBe('emp-9');
    });

    it('REP vê apenas campanhas criadas por ele', async () => {
      await service.list(fakeUser({ role: 'REP', id: 'rep-5' }), { page: 1, limit: 10 });

      const whereArg = prisma.campanha.findMany.mock.calls[0][0].where;
      expect(whereArg.criadoPorId).toBe('rep-5');
    });

    it('ADMIN não tem filtro de criadoPorId', async () => {
      await service.list(fakeUser({ role: 'ADMIN' }), { page: 1, limit: 10 });

      const whereArg = prisma.campanha.findMany.mock.calls[0][0].where;
      expect(whereArg.criadoPorId).toBeUndefined();
    });

    it('aplica filtro de status quando informado', async () => {
      await service.list(fakeUser(), { page: 1, limit: 10, status: 'AGENDADA' as never });

      const whereArg = prisma.campanha.findMany.mock.calls[0][0].where;
      expect(whereArg.AND).toEqual(expect.arrayContaining([{ status: 'AGENDADA' }]));
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna campanha quando encontrada', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha());

      const result = await service.findById(fakeUser(), 'camp-1');

      expect(result.id).toBe('camp-1');
    });

    it('lança NotFoundException quando não encontrada', async () => {
      prisma.campanha.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    beforeEach(() => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha());
    });

    it('cria campanha como RASCUNHO quando sem agendadoPara', async () => {
      await service.create(fakeUser(), {
        nome: 'Nova',
        canal: 'EMAIL',
        segTagIds: [],
        segRepIds: [],
        segClienteIds: [],
      });

      const createArgs = prisma.campanha.create.mock.calls[0][0];
      expect(createArgs.data.status).toBe('RASCUNHO');
    });

    it('cria campanha como AGENDADA quando agendadoPara está presente', async () => {
      await service.create(fakeUser(), {
        nome: 'Agendada',
        canal: 'WHATSAPP',
        segTagIds: [],
        segRepIds: [],
        segClienteIds: [],
        agendadoPara: new Date('2026-06-01'),
      });

      const createArgs = prisma.campanha.create.mock.calls[0][0];
      expect(createArgs.data.status).toBe('AGENDADA');
    });

    it('persiste empresaId e criadoPorId no banco', async () => {
      await service.create(fakeUser({ id: 'user-x', empresaIdAtiva: 'emp-x' }), {
        nome: 'X',
        canal: 'EMAIL',
        segTagIds: [],
        segRepIds: [],
        segClienteIds: [],
      });

      const createArgs = prisma.campanha.create.mock.calls[0][0];
      expect(createArgs.data.empresaId).toBe('emp-x');
      expect(createArgs.data.criadoPorId).toBe('user-x');
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza campos quando campanha está em RASCUNHO', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'RASCUNHO' }))
        .mockResolvedValueOnce(fakeCampanha({ nome: 'Atualizado' }));

      const result = await service.update(fakeUser(), 'camp-1', { nome: 'Atualizado' });

      expect(prisma.campanha.update).toHaveBeenCalledOnce();
      expect(result.nome).toBe('Atualizado');
    });

    it('lança BusinessRuleException se status não é RASCUNHO', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIANDO' }));

      await expect(service.update(fakeUser(), 'camp-1', { nome: 'X' })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('remove campanha em RASCUNHO', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'RASCUNHO' }));

      await service.remove(fakeUser(), 'camp-1');

      expect(prisma.campanha.delete).toHaveBeenCalledWith({ where: { id: 'camp-1' } });
    });

    it('remove campanha em CANCELADA', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'CANCELADA' }));

      await expect(service.remove(fakeUser(), 'camp-1')).resolves.toBeUndefined();
    });

    it('lança BusinessRuleException se status não é RASCUNHO nem CANCELADA', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIANDO' }));

      await expect(service.remove(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // agendar
  // -------------------------------------------------------------------------

  describe('agendar', () => {
    it('agenda campanha em RASCUNHO', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'RASCUNHO' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'AGENDADA' }));

      const result = await service.agendar(fakeUser(), 'camp-1', {
        agendadoPara: new Date('2026-07-01'),
      });

      expect(prisma.campanha.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'AGENDADA' }) }),
      );
      expect(result.status).toBe('AGENDADA');
    });

    it('lança BusinessRuleException se campanha está em status inválido para agendamento', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIADA' }));

      await expect(
        service.agendar(fakeUser(), 'camp-1', { agendadoPara: new Date() }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // disparar
  // -------------------------------------------------------------------------

  describe('disparar', () => {
    const fakeCliente = (id: string) => ({
      id,
      email: `${id}@test.com`,
      telefone: '11999990000',
    });

    it('lança BusinessRuleException se campanha não está em RASCUNHO/AGENDADA', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIANDO' }));

      await expect(service.disparar(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('lança BusinessRuleException quando não há destinatários', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'AGENDADA' }));
      prisma.campanha.updateMany.mockResolvedValue({ count: 1 });
      prisma.cliente.findMany.mockResolvedValue([]); // nenhum cliente no segmento

      await expect(service.disparar(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('reverte status pra RASCUNHO quando destinatários estão vazios', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'AGENDADA' }));
      prisma.campanha.updateMany.mockResolvedValue({ count: 1 });
      prisma.cliente.findMany.mockResolvedValue([]);

      await expect(service.disparar(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );

      expect(prisma.campanha.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'RASCUNHO', iniciadoEm: null } }),
      );
    });

    it('enfileira 1 job por destinatário com delay escalonado', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'RASCUNHO' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'ENVIANDO' }));
      prisma.campanha.updateMany.mockResolvedValue({ count: 1 });
      prisma.cliente.findMany.mockResolvedValue([fakeCliente('cli-1'), fakeCliente('cli-2')]);
      prisma.campanhaDestinatario.findMany.mockResolvedValue([{ id: 'dest-1' }, { id: 'dest-2' }]);

      await service.disparar(fakeUser(), 'camp-1');

      expect(queue.add).toHaveBeenCalledTimes(2);
      // Primeiro destinatário tem delay 0, segundo tem delay 1500
      const call0 = queue.add.mock.calls[0][2];
      const call1 = queue.add.mock.calls[1][2];
      expect(call0.delay).toBe(0);
      expect(call1.delay).toBe(1500);
    });

    it('jobs enfileirados têm attempts=3 e backoff exponential', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'AGENDADA' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'ENVIANDO' }));
      prisma.campanha.updateMany.mockResolvedValue({ count: 1 });
      prisma.cliente.findMany.mockResolvedValue([fakeCliente('cli-1')]);
      prisma.campanhaDestinatario.findMany.mockResolvedValue([{ id: 'dest-1' }]);

      await service.disparar(fakeUser(), 'camp-1');

      const jobOpts = queue.add.mock.calls[0][2];
      expect(jobOpts.attempts).toBe(3);
      expect(jobOpts.backoff?.type).toBe('exponential');
    });

    it('lança BusinessRuleException com CAMPANHA_NAO_PODE_DISPARAR quando lock falha (count=0)', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'RASCUNHO' }));
      prisma.campanha.updateMany.mockResolvedValue({ count: 0 }); // lock não conseguiu

      await expect(service.disparar(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('remove destinatários PENDENTE anteriores antes de criar novos', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'RASCUNHO' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'ENVIANDO' }));
      prisma.campanha.updateMany.mockResolvedValue({ count: 1 });
      prisma.cliente.findMany.mockResolvedValue([fakeCliente('cli-1')]);
      prisma.campanhaDestinatario.findMany.mockResolvedValue([{ id: 'dest-1' }]);

      await service.disparar(fakeUser(), 'camp-1');

      expect(prisma.campanhaDestinatario.deleteMany).toHaveBeenCalledWith({
        where: { campanhaId: 'camp-1', status: 'PENDENTE' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // reenviarErros
  // -------------------------------------------------------------------------

  describe('reenviarErros', () => {
    it('lança BusinessRuleException se campanha não está ENVIADA', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'RASCUNHO' }));

      await expect(service.reenviarErros(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('lança BusinessRuleException quando não há falhas', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIADA' }));
      prisma.campanhaDestinatario.findMany.mockResolvedValue([]); // nenhum ERRO

      await expect(service.reenviarErros(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('reseta ERRO→PENDENTE e reenfileira só as falhas com delay escalonado', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'ENVIADA' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'ENVIANDO' }));
      prisma.campanhaDestinatario.findMany.mockResolvedValue([{ id: 'dest-1' }, { id: 'dest-2' }]);
      prisma.campanha.updateMany.mockResolvedValue({ count: 1 });

      await service.reenviarErros(fakeUser(), 'camp-1');

      expect(prisma.campanhaDestinatario.updateMany).toHaveBeenCalledWith({
        where: { campanhaId: 'camp-1', status: 'ERRO' },
        data: { status: 'PENDENTE', erro: null, enviadoEm: null },
      });
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add.mock.calls[0][2].delay).toBe(0);
      expect(queue.add.mock.calls[1][2].delay).toBe(1500);
    });

    it('lança BusinessRuleException quando o lock ENVIADA→ENVIANDO falha (count=0)', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIADA' }));
      prisma.campanhaDestinatario.findMany.mockResolvedValue([{ id: 'dest-1' }]);
      prisma.campanha.updateMany.mockResolvedValue({ count: 0 }); // lock não conseguiu

      await expect(service.reenviarErros(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // pausar / cancelar
  // -------------------------------------------------------------------------

  describe('pausar', () => {
    it('pausa campanha em ENVIANDO', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'ENVIANDO' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'PAUSADA' }));

      const result = await service.pausar(fakeUser(), 'camp-1');

      expect(prisma.campanha.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PAUSADA' } }),
      );
      expect(result.status).toBe('PAUSADA');
    });

    it('lança BusinessRuleException se não está em ENVIANDO', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'RASCUNHO' }));

      await expect(service.pausar(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  describe('cancelar', () => {
    it('cancela campanha em RASCUNHO', async () => {
      prisma.campanha.findFirst
        .mockResolvedValueOnce(fakeCampanha({ status: 'RASCUNHO' }))
        .mockResolvedValueOnce(fakeCampanha({ status: 'CANCELADA' }));

      await service.cancelar(fakeUser(), 'camp-1');

      expect(prisma.campanha.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELADA' } }),
      );
    });

    it('lança BusinessRuleException se já está em ENVIADA ou CANCELADA', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha({ status: 'ENVIADA' }));

      await expect(service.cancelar(fakeUser(), 'camp-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // metricas
  // -------------------------------------------------------------------------

  describe('metricas', () => {
    it('retorna zeroes quando não há destinatários', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha());
      prisma.campanhaDestinatario.groupBy.mockResolvedValue([]);

      const result = await service.metricas(fakeUser(), 'camp-1');

      expect(result).toMatchObject({
        total: 0,
        pendentes: 0,
        enviados: 0,
        lidos: 0,
        erros: 0,
        taxaEnvio: 0,
        taxaLeitura: 0,
      });
    });

    it('calcula taxaEnvio e taxaLeitura corretamente', async () => {
      prisma.campanha.findFirst.mockResolvedValue(fakeCampanha());
      prisma.campanhaDestinatario.groupBy.mockResolvedValue([
        { status: 'ENVIADO', _count: { _all: 8 } },
        { status: 'LIDO', _count: { _all: 2 } },
        { status: 'PENDENTE', _count: { _all: 0 } },
      ]);

      const result = await service.metricas(fakeUser(), 'camp-1');

      expect(result.total).toBe(10);
      expect(result.taxaEnvio).toBe(100); // (8+2)/10 * 100
      expect(result.taxaLeitura).toBe(20); // 2/(8+2) * 100
    });
  });

  // -------------------------------------------------------------------------
  // resumo
  // -------------------------------------------------------------------------

  describe('resumo', () => {
    it('retorna contagens por status', async () => {
      prisma.campanha.groupBy.mockResolvedValue([
        { status: 'RASCUNHO', _count: { _all: 3 } },
        { status: 'AGENDADA', _count: { _all: 1 } },
        { status: 'ENVIANDO', _count: { _all: 2 } },
        { status: 'ENVIADA', _count: { _all: 5 } },
      ]);
      prisma.campanhaDestinatario.count.mockResolvedValue(120);

      const result = await service.resumo(fakeUser());

      expect(result).toMatchObject({
        total: 11, // 3 + 1 + 2 + 5
        rascunhos: 3,
        agendadas: 1,
        enviando: 2,
        enviadas: 5,
        alcanceUltimos30d: 120,
      });
    });
  });

  // -------------------------------------------------------------------------
  // tentarFinalizarCampanha
  // -------------------------------------------------------------------------

  describe('tentarFinalizarCampanha', () => {
    it('atualiza status para ENVIADA quando não há mais pendentes', async () => {
      prisma.campanhaDestinatario.count.mockResolvedValue(0);

      await service.tentarFinalizarCampanha('camp-1');

      expect(prisma.campanha.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'camp-1', status: 'ENVIANDO' },
          data: expect.objectContaining({ status: 'ENVIADA' }),
        }),
      );
    });

    it('não atualiza status quando ainda há destinatários pendentes', async () => {
      prisma.campanhaDestinatario.count.mockResolvedValue(5);

      await service.tentarFinalizarCampanha('camp-1');

      expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // resolverDestinatarios
  // -------------------------------------------------------------------------

  describe('resolverDestinatarios', () => {
    const baseCampanha = {
      empresaId: 'emp-1',
      canal: 'EMAIL' as const,
      segTagIds: [],
      segRepIds: [],
      segClienteIds: [],
    };

    it('retorna lista de destinatários com contatos', async () => {
      prisma.cliente.findMany.mockResolvedValue([
        { id: 'cli-1', email: 'a@test.com', telefone: '11999990000' },
      ]);

      const result = await service.resolverDestinatarios(baseCampanha);

      expect(result).toHaveLength(1);
      expect(result[0].clienteId).toBe('cli-1');
    });

    it('canal EMAIL → telefone é null no destinatário', async () => {
      prisma.cliente.findMany.mockResolvedValue([
        { id: 'cli-1', email: 'a@test.com', telefone: '11999990000' },
      ]);

      const result = await service.resolverDestinatarios({ ...baseCampanha, canal: 'EMAIL' });

      expect(result[0].telefone).toBeNull();
      expect(result[0].email).toBe('a@test.com');
    });

    it('canal WHATSAPP → email é null no destinatário', async () => {
      prisma.cliente.findMany.mockResolvedValue([
        { id: 'cli-1', email: 'a@test.com', telefone: '11999990000' },
      ]);

      const result = await service.resolverDestinatarios({ ...baseCampanha, canal: 'WHATSAPP' });

      expect(result[0].email).toBeNull();
      expect(result[0].telefone).toBe('5511999990000@s.whatsapp.net');
    });

    it('filtra por segClienteIds quando informado', async () => {
      prisma.cliente.findMany.mockResolvedValue([]);

      await service.resolverDestinatarios({ ...baseCampanha, segClienteIds: ['cli-1', 'cli-2'] });

      const whereArg = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(whereArg.id).toEqual({ in: ['cli-1', 'cli-2'] });
    });

    it('filtra por segTagIds e segRepIds quando segClienteIds está vazio', async () => {
      prisma.cliente.findMany.mockResolvedValue([]);

      await service.resolverDestinatarios({
        ...baseCampanha,
        segTagIds: ['tag-1'],
        segRepIds: ['rep-1'],
      });

      const whereArg = prisma.cliente.findMany.mock.calls[0][0].where;
      expect(whereArg.AND).toEqual(
        expect.arrayContaining([
          { tags: { some: { tagId: { in: ['tag-1'] } } } },
          { representanteId: { in: ['rep-1'] } },
        ]),
      );
    });
  });
});
