import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { UserRole } from '@prisma/client';
import { BusinessRuleException, ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FluxosService } from './fluxos.service';
import { interpolate } from './fluxo-executor.service';
import { importFluxoSchema, type ImportFluxoDto } from './fluxos.dto';

// ─── Mocks ───────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  fluxo: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  fluxoNo: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'no-gatilho' }),
    update: vi.fn().mockResolvedValue({ id: 'no-gatilho' }),
  },
  fluxoEdge: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'edge-1' }),
  },
  fluxoExecucao: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn(),
  },
  fluxoFavorito: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makePrismaMock())),
});

const makeBusMock = () => ({
  disparar: vi.fn(),
  dispararDireto: vi.fn(),
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

const fakeFluxo = (overrides = {}) => ({
  id: 'fluxo-1',
  empresaId: 'emp-1',
  nome: 'Teste',
  descricao: null,
  status: 'RASCUNHO' as const,
  versao: 1,
  triggerTipo: 'LEAD_CRIADO' as const,
  triggerConfig: null,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  nos: [],
  arestas: [],
  _count: { execucoes: 0 },
  ...overrides,
});

// ─── Testes FluxosService ────────────────────────────────────────────

describe('FluxosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let bus: ReturnType<typeof makeBusMock>;
  let redis: { del: ReturnType<typeof vi.fn> };
  let whatsappMedia: { uploadOutbound: ReturnType<typeof vi.fn> };
  let svc: FluxosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    bus = makeBusMock();
    // Mock do Redis — só `del` é usado (limpeza do cursor cron).
    redis = { del: vi.fn().mockResolvedValue(1) };
    whatsappMedia = { uploadOutbound: vi.fn().mockResolvedValue('emp-1/fluvo/out_x.ogg') };
    svc = new FluxosService(prisma as never, bus as never, redis as never, whatsappMedia as never);
  });

  describe('create', () => {
    it('lança ForbiddenException para REP', async () => {
      await expect(
        svc.create(fakeUser({ role: 'REP' as UserRole }), {
          nome: 'Teste',
          nos: [],
          arestas: [],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cria fluxo com status RASCUNHO', async () => {
      prisma.fluxo.create.mockResolvedValue({ id: 'f1' });
      const fluxoComRel = fakeFluxo({ id: 'f1', nome: 'Novo Fluxo' });
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fluxoComRel);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      );

      const result = await svc.create(fakeUser(), { nome: 'Novo Fluxo', nos: [], arestas: [] });
      expect(result.nome).toBe('Novo Fluxo');
    });
  });

  describe('ativar', () => {
    it('lança quando fluxo não tem triggerTipo', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: null,
          nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
          arestas: [],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança quando não há nó TRIGGER', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [], // sem trigger
          arestas: [],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança quando há mais de 1 TRIGGER', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [
            { id: 'n1', tipo: 'TRIGGER', acaoTipo: null },
            { id: 'n2', tipo: 'TRIGGER', acaoTipo: null },
          ],
          arestas: [],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('ativa fluxo válido', async () => {
      const fluxoAtivado = fakeFluxo({
        status: 'ATIVO',
        triggerTipo: 'LEAD_CRIADO',
        nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
        arestas: [],
      });
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
        }),
      );
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fluxoAtivado);

      const result = await svc.ativar(fakeUser(), 'fluxo-1');
      expect(result.status).toBe('ATIVO');
      expect(prisma.fluxo.update).toHaveBeenCalledWith({
        where: { id: 'fluxo-1' },
        data: { status: 'ATIVO' },
      });
      // Ativar zera o cursor do cron (corrige cursor antigo travado no futuro).
      expect(redis.del).toHaveBeenCalledWith('cron:next:fluxo-1');
    });

    it('lança FLUXO_JA_ATIVO se já estiver ativo', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_JA_ATIVO',
      });
    });
  });

  describe('arquivar', () => {
    it('arquiva fluxo e cancela execuções em andamento', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo());
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'ARQUIVADO' }));

      const result = await svc.arquivar(fakeUser(), 'fluxo-1');
      expect(result.status).toBe('ARQUIVADO');
      expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fluxoId: 'fluxo-1',
            status: { in: ['PENDENTE', 'AGUARDANDO', 'EM_EXECUCAO'] },
          }),
          data: expect.objectContaining({ status: 'CANCELADO' }),
        }),
      );
    });
  });

  describe('desarquivar', () => {
    it('desarquiva fluxo ARQUIVADO → RASCUNHO', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'ARQUIVADO' }));
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'RASCUNHO' }));

      const result = await svc.desarquivar(fakeUser(), 'fluxo-1');

      expect(result.status).toBe('RASCUNHO');
      expect(prisma.fluxo.update).toHaveBeenCalledWith({
        where: { id: 'fluxo-1' },
        data: { status: 'RASCUNHO' },
      });
    });

    it('rejeita desarquivar fluxo que NÃO está arquivado', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'PAUSADO' }));
      await expect(svc.desarquivar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
      });
      expect(prisma.fluxo.update).not.toHaveBeenCalled();
    });
  });

  describe('pausar', () => {
    it('pausa fluxo ATIVO e congela (cancela) as execuções em andamento', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'PAUSADO' }));

      await svc.pausar(fakeUser(), 'fluxo-1');
      expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ fluxoId: 'fluxo-1' }),
          data: expect.objectContaining({ status: 'CANCELADO' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('CAÇADA-BUG #9: editar grafo de fluxo ATIVO rebaixa p/ RASCUNHO E cancela execuções em voo', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'RASCUNHO' }));

      await svc.update(fakeUser(), 'fluxo-1', { nos: [], arestas: [] });

      // Igual pausar/arquivar: as execuções PENDENTE/AGUARDANDO/EM_EXECUCAO são canceladas —
      // senão o bot seguia conversando num fluxo que o usuário "desativou" editando.
      expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fluxoId: 'fluxo-1',
            status: { in: ['PENDENTE', 'AGUARDANDO', 'EM_EXECUCAO'] },
          }),
          data: expect.objectContaining({ status: 'CANCELADO' }),
        }),
      );
    });

    it('editar fluxo em RASCUNHO NÃO cancela execuções (não estava rodando)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'RASCUNHO' }));
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'RASCUNHO' }));

      await svc.update(fakeUser(), 'fluxo-1', { nos: [], arestas: [] });

      expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
    });

    it('editar só o nome de fluxo ATIVO (sem tocar no grafo) NÃO rebaixa nem cancela', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));

      await svc.update(fakeUser(), 'fluxo-1', { nome: 'Novo nome' });

      expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('validarGrafo', () => {
    it('lança quando nó ACAO não tem acaoTipo', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [
            { id: 'n1', tipo: 'TRIGGER', acaoTipo: null },
            { id: 'n2', tipo: 'ACAO', acaoTipo: null }, // sem acaoTipo
          ],
          arestas: [{ sourceNoId: 'n1', targetNoId: 'n2' }],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('lança quando aresta referencia nó inexistente', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
          arestas: [{ sourceNoId: 'n1', targetNoId: 'INEXISTENTE' }],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('lança quando nó DELAY não tem quantidade > 0', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [
            { id: 'n1', tipo: 'TRIGGER', acaoTipo: null },
            { id: 'n2', tipo: 'DELAY', acaoTipo: null, config: { unidade: 'minutos' } }, // sem quantidade
          ],
          arestas: [{ sourceNoId: 'n1', targetNoId: 'n2' }],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    // ── CONDICAO: o motor roteia por LABEL. Grafo que não bate concluía VERDE
    //    sem executar nada — a falha mais silenciosa do sistema.
    const fluxoComCondicao = (config: unknown, arestas: unknown[]) =>
      fakeFluxo({
        triggerTipo: 'LEAD_CRIADO',
        nos: [
          { id: 'n1', tipo: 'TRIGGER', acaoTipo: null },
          { id: 'c1', tipo: 'CONDICAO', titulo: 'É industrial?', acaoTipo: null, config },
          { id: 'a1', tipo: 'ACAO', titulo: 'Msg', acaoTipo: 'ENVIAR_WHATSAPP', config: {} },
          { id: 'a2', tipo: 'ACAO', titulo: 'Msg2', acaoTipo: 'ENVIAR_WHATSAPP', config: {} },
        ],
        arestas: [{ sourceNoId: 'n1', targetNoId: 'c1', label: null }, ...arestas],
      });

    it('rejeita CONDICAO simples com só um ramo ligado (o outro pararia sem ação)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fluxoComCondicao({ modo: 'simples', campo: 'lead.uf', operador: 'eq', valor: 'SP' }, [
          { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
        ]),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('rejeita CONDICAO com conexão SEM rótulo (nunca casaria)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fluxoComCondicao({ modo: 'simples', campo: 'lead.uf', operador: 'eq', valor: 'SP' }, [
          { sourceNoId: 'c1', targetNoId: 'a1', label: null },
          { sourceNoId: 'c1', targetNoId: 'a2', label: 'Não' },
        ]),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('rejeita CONDICAO simples sem campo/operador (cairia sempre no Não)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fluxoComCondicao({ modo: 'simples' }, [
          { sourceNoId: 'c1', targetNoId: 'a1', label: 'Sim' },
          { sourceNoId: 'c1', targetNoId: 'a2', label: 'Não' },
        ]),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('ACEITA CONDICAO simples com Sim+Não (e também os aliases true/false do import)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fluxoComCondicao({ modo: 'simples', campo: 'lead.uf', operador: 'eq', valor: 'SP' }, [
          { sourceNoId: 'c1', targetNoId: 'a1', label: 'true' },
          { sourceNoId: 'c1', targetNoId: 'a2', label: 'false' },
        ]),
      );
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).resolves.toBeTruthy();
    });

    it('rejeita roteador com saída sem aresta correspondente (ramo morto)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fluxoComCondicao(
          { modo: 'roteador', variavel: 'lead.classificacao', saidas: ['Forte', 'Fraca'] },
          [{ sourceNoId: 'c1', targetNoId: 'a1', label: 'Forte' }],
        ),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('roteador casa saída por acento/espaço (mesma normalização do motor)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fluxoComCondicao(
          { modo: 'roteador', variavel: 'lead.classificacao', saidas: ['Não é lead'] },
          [{ sourceNoId: 'c1', targetNoId: 'a1', label: 'Nao e lead' }],
        ),
      );
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).resolves.toBeTruthy();
    });

    it('rejeita CRON_AGENDADO sem nenhuma expressão (ativava e nunca disparava)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'CRON_AGENDADO',
          triggerConfig: { expressoes: [] },
          nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
          arestas: [],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('rejeita CRON_AGENDADO com expressão inválida', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'CRON_AGENDADO',
          triggerConfig: { expressoes: ['2'] }, // 1 campo: o cron-parser leria como "segundos"
          nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
          arestas: [],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });

    it('ACEITA CRON_AGENDADO com expressão válida de 5 campos', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'CRON_AGENDADO',
          triggerConfig: { expressoes: ['0 9 * * 1-5'] },
          nos: [{ id: 'n1', tipo: 'TRIGGER', acaoTipo: null }],
          arestas: [],
        }),
      );
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).resolves.toBeTruthy();
    });

    it('rejeita ATRIBUIR_REP sem representante (runtime pegaria um usuário arbitrário)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          triggerTipo: 'LEAD_CRIADO',
          nos: [
            { id: 'n1', tipo: 'TRIGGER', acaoTipo: null },
            { id: 'a1', tipo: 'ACAO', titulo: 'Atribuir', acaoTipo: 'ATRIBUIR_REP', config: {} },
          ],
          arestas: [{ sourceNoId: 'n1', targetNoId: 'a1', label: null }],
        }),
      );
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_INVALIDO',
      });
    });
  });

  describe('remapeamento de chaves (PK global do FluxoNo)', () => {
    it('update NÃO grava a chave literal do dto como id (colidia entre fluxos)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'RASCUNHO' }));
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo());
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      );

      await svc.update(fakeUser(), 'fluxo-1', {
        nos: [
          { id: 'trigger', tipo: 'TRIGGER', titulo: 'T', config: {}, posX: 0, posY: 0 },
          {
            id: 'ia1',
            tipo: 'ACAO',
            acaoTipo: 'CONVERSAR_IA',
            titulo: 'IA',
            config: {},
            posX: 0,
            posY: 0,
          },
        ],
        arestas: [{ sourceNoId: 'trigger', targetNoId: 'ia1' }],
      });

      const nosGravados = prisma.fluxoNo.createMany.mock.calls[0][0].data as { id: string }[];
      expect(nosGravados.map((n) => n.id)).not.toContain('trigger');
      expect(nosGravados.map((n) => n.id)).not.toContain('ia1');
      // A aresta tem que apontar pros ids NOVOS (senão a FK quebra).
      const arestas = prisma.fluxoEdge.createMany.mock.calls[0][0].data as {
        sourceNoId: string;
        targetNoId: string;
      }[];
      expect(arestas[0].sourceNoId).toBe(nosGravados[0].id);
      expect(arestas[0].targetNoId).toBe(nosGravados[1].id);
    });
  });

  describe('metricas', () => {
    it('calcula taxaSucesso corretamente', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo());
      prisma.fluxoExecucao.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // concluidos
        .mockResolvedValueOnce(1) // falhos
        .mockResolvedValueOnce(1); // emExecucao

      const m = await svc.metricas(fakeUser(), 'fluxo-1');
      expect(m.total).toBe(10);
      expect(m.concluidos).toBe(8);
      expect(m.taxaSucesso).toBe(80);
    });

    it('retorna taxaSucesso 0 quando não há execuções', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo());
      prisma.fluxoExecucao.count.mockResolvedValue(0);

      const m = await svc.metricas(fakeUser(), 'fluxo-1');
      expect(m.taxaSucesso).toBe(0);
    });
  });

  describe('importar', () => {
    const dtoBoasVindas: ImportFluxoDto = {
      nome: 'Boas-vindas',
      triggerTipo: 'LEAD_CRIADO',
      nos: [
        { id: 'trigger', tipo: 'TRIGGER', titulo: 'Lead criado', config: {}, posX: 0, posY: 0 },
        {
          id: 'msg',
          tipo: 'ACAO',
          acaoTipo: 'ENVIAR_WHATSAPP',
          titulo: 'Mensagem',
          config: { mensagem: 'Olá {{lead.nome}}' },
          posX: 0,
          posY: 100,
        },
      ],
      arestas: [{ sourceNoId: 'trigger', targetNoId: 'msg', label: null }],
    };

    it('lança ForbiddenException para REP', async () => {
      await expect(
        svc.importar(fakeUser({ role: 'REP' as UserRole }), dtoBoasVindas),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cria como RASCUNHO re-mapeando as chaves dos nós e mantendo as ligações', async () => {
      prisma.fluxo.create.mockResolvedValue({ id: 'novo-fluxo' });
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(
        fakeFluxo({ id: 'novo-fluxo', nome: 'Boas-vindas' }),
      );
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      );

      const result = await svc.importar(fakeUser(), dtoBoasVindas);
      expect(result.id).toBe('novo-fluxo');
      expect(prisma.fluxo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RASCUNHO' }) }),
      );

      const nodesArg = prisma.fluxoNo.createMany.mock.calls[0][0].data as Array<{
        id: string;
        titulo: string;
        acaoTipo: string | null;
      }>;
      expect(nodesArg).toHaveLength(2);
      // As chaves "trigger"/"msg" do arquivo NÃO viram os ids internos.
      expect(nodesArg.map((n) => n.id)).not.toContain('trigger');
      expect(nodesArg.map((n) => n.id)).not.toContain('msg');
      expect(nodesArg.find((n) => n.titulo === 'Mensagem')?.acaoTipo).toBe('ENVIAR_WHATSAPP');

      // A aresta aponta pros ids internos NOVOS (chave remapeada), não pelas chaves do arquivo.
      const edgesArg = prisma.fluxoEdge.createMany.mock.calls[0][0].data as Array<{
        sourceNoId: string;
        targetNoId: string;
      }>;
      const triggerNode = nodesArg.find((n) => n.titulo === 'Lead criado');
      const msgNode = nodesArg.find((n) => n.titulo === 'Mensagem');
      expect(edgesArg[0].sourceNoId).toBe(triggerNode?.id);
      expect(edgesArg[0].targetNoId).toBe(msgNode?.id);
    });

    it('dois imports do mesmo arquivo geram ids de nós diferentes (sem colisão)', async () => {
      prisma.fluxo.create.mockResolvedValue({ id: 'f' });
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo());
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      );

      await svc.importar(fakeUser(), dtoBoasVindas);
      await svc.importar(fakeUser(), dtoBoasVindas);

      const ids1 = (prisma.fluxoNo.createMany.mock.calls[0][0].data as Array<{ id: string }>).map(
        (n) => n.id,
      );
      const ids2 = (prisma.fluxoNo.createMany.mock.calls[1][0].data as Array<{ id: string }>).map(
        (n) => n.id,
      );
      expect(ids1[0]).not.toBe(ids2[0]);
    });
  });

  describe('exportar', () => {
    it('serializa no formato de arquivo (chaves nos nós, arestas sem id)', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(
        fakeFluxo({
          nome: 'Fluxo X',
          descricao: 'desc',
          triggerTipo: 'LEAD_CRIADO',
          nos: [
            {
              id: 'n1',
              tipo: 'TRIGGER',
              acaoTipo: null,
              titulo: 'Lead criado',
              config: {},
              posX: 0,
              posY: 0,
            },
          ],
          arestas: [{ sourceNoId: 'n1', targetNoId: 'n1', label: 'true' }],
        }),
      );

      const exp = await svc.exportar(fakeUser(), 'fluxo-1');
      expect(exp.betinnaFluxo).toBe(1);
      expect(exp.tipo).toBe('fluxo');
      expect(exp.nome).toBe('Fluxo X');
      expect(exp.nos[0].id).toBe('n1');
      expect(exp.arestas[0]).toEqual({ sourceNoId: 'n1', targetNoId: 'n1', label: 'true' });
      // arestas exportadas NÃO carregam id próprio (gerado no reimport).
      expect(exp.arestas[0]).not.toHaveProperty('id');
    });
  });

  describe('uploadMidia', () => {
    const b64 = Buffer.from('conteudo').toString('base64');

    it('sobe pro Storage (peer fixo "fluxo") e devolve storagePath + metadados', async () => {
      const res = await svc.uploadMidia(fakeUser(), {
        tipo: 'AUDIO',
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        dataBase64: b64,
      });
      expect(whatsappMedia.uploadOutbound).toHaveBeenCalledWith(
        'emp-1',
        'fluxo',
        expect.any(Buffer),
        'audio/ogg; codecs=opus',
      );
      expect(res).toMatchObject({
        storagePath: 'emp-1/fluvo/out_x.ogg',
        tipo: 'AUDIO',
        ptt: true,
      });
    });

    it('DOCUMENT sem fileName → BusinessRuleException', async () => {
      await expect(
        svc.uploadMidia(fakeUser(), { tipo: 'DOCUMENT', dataBase64: b64 }),
      ).rejects.toThrow(/fileName/);
    });

    it('upload falha (Storage null) → BusinessRuleException', async () => {
      whatsappMedia.uploadOutbound.mockResolvedValueOnce(null);
      await expect(svc.uploadMidia(fakeUser(), { tipo: 'IMAGE', dataBase64: b64 })).rejects.toThrow(
        /Falha ao subir/,
      );
    });
  });
});

// ─── Testes interpolate (utilitário) ────────────────────────────────

describe('interpolate', () => {
  it('substitui variável simples', () => {
    expect(interpolate('Olá {{nome}}', { nome: 'João' })).toBe('Olá João');
  });

  it('substitui variável aninhada', () => {
    expect(interpolate('Empresa: {{empresa.nome}}', { empresa: { nome: 'Betinna' } })).toBe(
      'Empresa: Betinna',
    );
  });

  it('mantém placeholder quando variável não existe', () => {
    expect(interpolate('{{inexistente}}', {})).toBe('{{inexistente}}');
  });

  it('substitui múltiplas variáveis na mesma string', () => {
    expect(
      interpolate('{{cliente.nome}} — pedido {{pedido.numero}}', {
        cliente: { nome: 'Maria' },
        pedido: { numero: 'PED-001' },
      }),
    ).toBe('Maria — pedido PED-001');
  });

  it('converte números para string', () => {
    expect(interpolate('Total: R${{valor}}', { valor: 1500 })).toBe('Total: R$1500');
  });
});

// ─── Testes importFluxoSchema (validação do arquivo .json) ──────────
describe('importFluxoSchema', () => {
  const base = {
    nome: 'F',
    nos: [{ id: 'trigger', tipo: 'TRIGGER', titulo: 'T' }],
    arestas: [],
  };

  it('aceita arquivo mínimo (sem envelope) e aplica defaults', () => {
    const r = importFluxoSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nos[0].config).toEqual({});
      expect(r.data.nos[0].posX).toBe(0);
    }
  });

  it('rejeita aresta que referencia nó inexistente', () => {
    const r = importFluxoSchema.safeParse({
      ...base,
      arestas: [{ sourceNoId: 'trigger', targetNoId: 'fantasma' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita nó ACAO sem acaoTipo', () => {
    const r = importFluxoSchema.safeParse({
      nome: 'F',
      nos: [
        { id: 'trigger', tipo: 'TRIGGER', titulo: 'T' },
        { id: 'a', tipo: 'ACAO', titulo: 'Ação' },
      ],
      arestas: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita chaves de nó duplicadas', () => {
    const r = importFluxoSchema.safeParse({
      nome: 'F',
      nos: [
        { id: 'x', tipo: 'TRIGGER', titulo: 'T' },
        { id: 'x', tipo: 'DELAY', titulo: 'D' },
      ],
      arestas: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejeita triggerTipo inválido', () => {
    const r = importFluxoSchema.safeParse({ ...base, triggerTipo: 'NAO_EXISTE' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// definirGatilho — conserta fluxo que nasceu sem nó de gatilho
// ---------------------------------------------------------------------------

describe('FluxosService.definirGatilho', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: FluxosService;

  const comGrafo = (nos: unknown[], arestas: unknown[] = [], extra = {}) => {
    const fluxo = fakeFluxo({ nos, arestas, ...extra });
    prisma.fluxo.findFirst.mockResolvedValue(fluxo);
    prisma.fluxo.update.mockResolvedValue(fluxo);
    return fluxo;
  };

  let redisGatilho: { del: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = makePrismaMock();
    redisGatilho = { del: vi.fn().mockResolvedValue(1) };
    svc = new FluxosService(
      prisma as never,
      makeBusMock() as never,
      redisGatilho as never,
      { uploadOutbound: vi.fn() } as never,
    );
  });

  it('espelha o config em Fluxo.triggerConfig E limpa o cursor cron (auditoria 20/08)', async () => {
    // O job de CRON_AGENDADO lê SÓ Fluxo.triggerConfig — gravar a agenda apenas
    // no nó TRIGGER fazia a troca de horário pelo MCP ser ignorada em silêncio,
    // com o cursor Redis preso na config antiga.
    comGrafo([{ id: 'trigger-1', tipo: 'TRIGGER', posX: 0, posY: 0 }]);

    await svc.definirGatilho(fakeUser(), 'fluxo-1', {
      triggerTipo: 'CRON_AGENDADO',
      config: { expressoes: ['0 9 * * 1'], pularFeriados: true },
    });

    const upd = prisma.fluxo.update.mock.calls.at(-1)?.[0];
    expect(upd?.data?.triggerConfig).toEqual({ expressoes: ['0 9 * * 1'], pularFeriados: true });
    expect(redisGatilho.del).toHaveBeenCalledWith('cron:next:fluxo-1');
  });

  it('fluxo SEM gatilho: cria o nó TRIGGER e liga na raiz — sem tocar nos outros nós', async () => {
    // É o caso real da leva E1/E2: 100% ação/delay, zero TRIGGER.
    comGrafo(
      [
        { id: 'email-1', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL', posX: 0, posY: 0 },
        { id: 'delay-1', tipo: 'DELAY', posX: 250, posY: 0 },
      ],
      [{ sourceNoId: 'email-1', targetNoId: 'delay-1' }],
    );

    await svc.definirGatilho(fakeUser(), 'fluxo-1', {
      triggerTipo: 'LEAD_RECEBEU_TAG',
      config: { tagNome: 'setor:cadeia-do-frio', modo: 'exato' },
    });

    const criado = prisma.fluxoNo.create.mock.calls[0][0].data;
    expect(criado.tipo).toBe('TRIGGER');
    expect(criado.config).toEqual({ tagNome: 'setor:cadeia-do-frio', modo: 'exato' });
    // Ligou na RAIZ (o e-mail 1, que ninguém aponta), não no delay.
    expect(prisma.fluxoEdge.create.mock.calls[0][0].data.targetNoId).toBe('email-1');
    // Nada de deleteMany/createMany: o resto do grafo fica intacto.
    expect(prisma.fluxoNo.deleteMany).not.toHaveBeenCalled();
    expect(prisma.fluxoEdge.deleteMany).not.toHaveBeenCalled();
  });

  it('posiciona o gatilho ANTES da raiz no canvas', async () => {
    comGrafo([{ id: 'email-1', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL', posX: 500, posY: 120 }]);

    await svc.definirGatilho(fakeUser(), 'fluxo-1', { triggerTipo: 'LEAD_CRIADO' });

    const criado = prisma.fluxoNo.create.mock.calls[0][0].data;
    expect(criado.posX).toBe(250);
    expect(criado.posY).toBe(120);
  });

  it('fluxo que JÁ tem gatilho: atualiza a config, não cria outro nó', async () => {
    comGrafo(
      [
        { id: 'trg', tipo: 'TRIGGER', posX: 0, posY: 0 },
        { id: 'email-1', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL', posX: 250, posY: 0 },
      ],
      [{ sourceNoId: 'trg', targetNoId: 'email-1' }],
    );

    await svc.definirGatilho(fakeUser(), 'fluxo-1', {
      config: { tagNome: 'publico:', modo: 'prefixo' },
    });

    expect(prisma.fluxoNo.create).not.toHaveBeenCalled();
    expect(prisma.fluxoEdge.create).not.toHaveBeenCalled();
    expect(prisma.fluxoNo.update.mock.calls[0][0].data.config).toEqual({
      tagNome: 'publico:',
      modo: 'prefixo',
    });
  });

  it('recusa fluxo com 2+ nós TRIGGER (conserto tem que ser no editor)', async () => {
    comGrafo([
      { id: 't1', tipo: 'TRIGGER', posX: 0, posY: 0 },
      { id: 't2', tipo: 'TRIGGER', posX: 0, posY: 100 },
    ]);

    await expect(
      svc.definirGatilho(fakeUser(), 'fluxo-1', { triggerTipo: 'LEAD_CRIADO' }),
    ).rejects.toThrow(/2 n/);
  });

  it('recusa quando não há triggerTipo (nem no dto, nem no fluxo)', async () => {
    comGrafo([{ id: 'email-1', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL', posX: 0, posY: 0 }], [], {
      triggerTipo: null,
    });

    await expect(svc.definirGatilho(fakeUser(), 'fluxo-1', {})).rejects.toThrow(/triggerTipo/);
  });

  it('recusa fluxo ARQUIVADO', async () => {
    comGrafo([{ id: 'email-1', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL', posX: 0, posY: 0 }], [], {
      status: 'ARQUIVADO',
    });

    await expect(
      svc.definirGatilho(fakeUser(), 'fluxo-1', { triggerTipo: 'LEAD_CRIADO' }),
    ).rejects.toThrow(/arquivado/i);
  });

  it('REP não mexe em gatilho', async () => {
    await expect(
      svc.definirGatilho(fakeUser({ role: 'REP' as UserRole }), 'fluxo-1', {
        triggerTipo: 'LEAD_CRIADO',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// importar — grafo sem gatilho não entra mais
// ---------------------------------------------------------------------------

describe('FluxosService.importar — exige nó TRIGGER', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: FluxosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new FluxosService(
      prisma as never,
      makeBusMock() as never,
      { del: vi.fn() } as never,
      { uploadOutbound: vi.fn() } as never,
    );
  });

  it('recusa import de grafo SEM nó TRIGGER (o bug da leva E1/E2)', async () => {
    await expect(
      svc.importar(fakeUser(), {
        nome: 'E-mail sem gatilho',
        triggerTipo: 'LEAD_CRIADO',
        nos: [{ id: 'a', tipo: 'ACAO', acaoTipo: 'ENVIAR_EMAIL', titulo: 'E1' }],
        arestas: [],
      } as never),
    ).rejects.toThrow(/1 n[óo] TRIGGER/i);
    expect(prisma.fluxo.create).not.toHaveBeenCalled();
  });

  it('recusa import com 2 nós TRIGGER', async () => {
    await expect(
      svc.importar(fakeUser(), {
        nome: 'Dois gatilhos',
        triggerTipo: 'LEAD_CRIADO',
        nos: [
          { id: 't1', tipo: 'TRIGGER', titulo: 'G1' },
          { id: 't2', tipo: 'TRIGGER', titulo: 'G2' },
        ],
        arestas: [],
      } as never),
    ).rejects.toThrow(/1 n[óo] TRIGGER/i);
  });
});

/**
 * Favoritar fluxo. Favorito é PESSOAL: o SAC vive na triagem, o diretor na
 * prospecção — se fosse coluna em `Fluxo`, um desmarcaria o do outro.
 */
describe('FluxosService — favoritos', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: FluxosService;

  const fluxo = (id: string, nome: string) => ({
    id,
    nome,
    empresaId: 'emp-1',
    criadoEm: new Date('2026-01-01'),
    nos: [],
    arestas: [],
  });

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new FluxosService(prisma as never, makeBusMock() as never);
  });

  it('favorito sobe pro topo, o resto segue em ordem de nome', async () => {
    prisma.fluxo.findMany
      // 1ª chamada: as chaves (id/nome/criadoEm) pra ordenar
      .mockResolvedValueOnce([
        { id: 'a', nome: 'A · Primeiro no alfabeto', criadoEm: new Date('2026-01-01') },
        { id: 'z', nome: 'Z · Último no alfabeto', criadoEm: new Date('2026-01-01') },
      ])
      // 2ª chamada: as linhas da página
      .mockResolvedValueOnce([
        fluxo('a', 'A · Primeiro no alfabeto'),
        fluxo('z', 'Z · Último no alfabeto'),
      ]);
    prisma.fluxoFavorito.findMany.mockResolvedValue([{ fluxoId: 'z' }]);

    const r = await svc.list(fakeUser(), { page: 1, limit: 20 } as never);

    expect(r.data.map((f) => f.id)).toEqual(['z', 'a']); // ← favorito primeiro
    expect(r.data[0].favorito).toBe(true);
    expect(r.data[1].favorito).toBe(false);
  });

  it('filtro "só favoritos" com NENHUM favorito devolve vazio (não a lista toda)', async () => {
    prisma.fluxoFavorito.findMany.mockResolvedValue([]);
    prisma.fluxo.findMany.mockResolvedValueOnce([]);

    const r = await svc.list(fakeUser(), { page: 1, limit: 20, favoritos: true } as never);

    const where = prisma.fluxo.findMany.mock.calls[0][0].where as { id?: { in: string[] } };
    expect(where.id).toEqual({ in: [] });
    expect(r.data).toEqual([]);
  });

  it('favoritar duas vezes não estoura (duplo clique / duas abas)', async () => {
    prisma.fluxo.findFirst.mockResolvedValue(fluxo('f1', 'X'));
    prisma.fluxoFavorito.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6.0.0' }),
    );

    await expect(svc.definirFavorito(fakeUser(), 'f1', true)).resolves.toEqual({ favorito: true });
  });

  it('desfavoritar o que não é favorito não dá erro', async () => {
    prisma.fluxo.findFirst.mockResolvedValue(fluxo('f1', 'X'));
    prisma.fluxoFavorito.deleteMany.mockResolvedValue({ count: 0 });

    await expect(svc.definirFavorito(fakeUser(), 'f1', false)).resolves.toEqual({
      favorito: false,
    });
  });

  it('não dá pra favoritar fluxo de OUTRA empresa', async () => {
    prisma.fluxo.findFirst.mockResolvedValue(null); // findOne filtra por empresaId

    await expect(svc.definirFavorito(fakeUser(), 'de-outro-tenant', true)).rejects.toThrow();
    expect(prisma.fluxoFavorito.create).not.toHaveBeenCalled();
  });
});
