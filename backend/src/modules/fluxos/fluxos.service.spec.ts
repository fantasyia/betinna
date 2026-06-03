import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  },
  fluxoEdge: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  fluxoExecucao: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
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
  let svc: FluxosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    bus = makeBusMock();
    svc = new FluxosService(prisma as never, bus as never);
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
    });

    it('lança FLUXO_JA_ATIVO se já estiver ativo', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo({ status: 'ATIVO' }));
      await expect(svc.ativar(fakeUser(), 'fluxo-1')).rejects.toMatchObject({
        code: 'FLUXO_JA_ATIVO',
      });
    });
  });

  describe('arquivar', () => {
    it('arquiva fluxo existente', async () => {
      prisma.fluxo.findFirst.mockResolvedValue(fakeFluxo());
      prisma.fluxo.update.mockResolvedValue({});
      prisma.fluxo.findUniqueOrThrow.mockResolvedValue(fakeFluxo({ status: 'ARQUIVADO' }));

      const result = await svc.arquivar(fakeUser(), 'fluxo-1');
      expect(result.status).toBe('ARQUIVADO');
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
