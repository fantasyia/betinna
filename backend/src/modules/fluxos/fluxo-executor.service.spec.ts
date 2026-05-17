import { describe, expect, it, vi, beforeEach } from 'vitest';
import { interpolate, FluxoExecutorService } from './fluxo-executor.service';

// ---------------------------------------------------------------------------
// Mock safeRequest (SSRF guard — não queremos chamadas de rede nos testes)
// ---------------------------------------------------------------------------

const { mockSafeRequest } = vi.hoisted(() => ({
  mockSafeRequest: vi.fn().mockResolvedValue({ status: 200 }),
}));

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: mockSafeRequest,
  SsrfBlockedError: class SsrfBlockedError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'SsrfBlockedError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  fluxoExecucao: {
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } satisfies MockModel,
  fluxoNo: {
    findUnique: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
  fluxoEdge: {
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  fluxoExecucaoLog: {
    create: vi.fn().mockResolvedValue({}),
  } satisfies MockModel,
  cliente: {
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } satisfies MockModel,
  lead: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  } satisfies MockModel,
  usuario: {
    findFirst: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
  agendaItem: {
    create: vi.fn().mockResolvedValue({ id: 'agenda-1' }),
  } satisfies MockModel,
  tag: {
    upsert: vi.fn().mockResolvedValue({ id: 'tag-1', nome: 'vip' }),
  } satisfies MockModel,
  clienteTag: {
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  } satisfies MockModel,
});

const makeWhatsappMock = () => ({
  enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-msg-1' }),
});

const makeSendgridMock = () => ({
  enviarSistemico: vi.fn().mockResolvedValue({ messageId: 'sg-msg-1' }),
});

const makeQueueMock = () => ({
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
});

const makeEnvMock = () => ({
  get: vi.fn().mockReturnValue(''),
});

const fakeExecucao = (overrides: Record<string, unknown> = {}) => ({
  id: 'exec-1',
  fluxoId: 'fluxo-1',
  empresaId: 'emp-1',
  status: 'PENDENTE',
  contexto: {},
  jobId: null,
  iniciadoEm: null,
  terminouEm: null,
  erroMsg: null,
  ...overrides,
});

const fakeNo = (overrides: Record<string, unknown> = {}) => ({
  id: 'no-1',
  fluxoId: 'fluxo-1',
  tipo: 'TRIGGER',
  acaoTipo: null,
  titulo: 'Trigger',
  config: {},
  posX: 0,
  posY: 0,
  ...overrides,
});

const fakeEdge = (sourceNoId: string, targetNoId: string, label?: string) => ({
  id: `edge-${sourceNoId}-${targetNoId}`,
  fluxoId: 'fluxo-1',
  sourceNoId,
  targetNoId,
  label: label ?? null,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FluxoExecutorService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let whatsapp: ReturnType<typeof makeWhatsappMock>;
  let sendgrid: ReturnType<typeof makeSendgridMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let service: FluxoExecutorService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaMock();
    whatsapp = makeWhatsappMock();
    sendgrid = makeSendgridMock();
    queue = makeQueueMock();
    service = new FluxoExecutorService(
      prisma as never,
      makeEnvMock() as never,
      {} as never,
      whatsapp as never,
      sendgrid as never,
      queue as never,
    );
  });

  // -------------------------------------------------------------------------
  // interpolate — helper puro
  // -------------------------------------------------------------------------

  describe('interpolate', () => {
    it('substitui variável simples', () => {
      expect(interpolate('Olá {{nome}}!', { nome: 'João' })).toBe('Olá João!');
    });

    it('substitui variável aninhada com ponto', () => {
      expect(interpolate('Cliente: {{cliente.nome}}', { cliente: { nome: 'Maria' } })).toBe(
        'Cliente: Maria',
      );
    });

    it('preserva placeholder quando variável não existe', () => {
      expect(interpolate('{{ausente}}', {})).toBe('{{ausente}}');
    });

    it('substitui múltiplos placeholders', () => {
      expect(interpolate('{{a}} e {{b}}', { a: '1', b: '2' })).toBe('1 e 2');
    });

    it('converte valor numérico para string', () => {
      expect(interpolate('Total: {{total}}', { total: 500 })).toBe('Total: 500');
    });

    it('preserva placeholder quando caminho intermediário é null', () => {
      expect(interpolate('{{a.b.c}}', { a: null })).toBe('{{a.b.c}}');
    });
  });

  // -------------------------------------------------------------------------
  // executarPasso — lifecycle
  // -------------------------------------------------------------------------

  describe('executarPasso', () => {
    it('retorna sem fazer nada quando execução não é encontrada', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(null);

      await service.executarPasso('exec-99', 'no-1');

      expect(prisma.fluxoExecucaoLog.create).not.toHaveBeenCalled();
    });

    it('marca como FALHOU quando execução não tem empresaId', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ empresaId: null }));

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FALHOU' }) }),
      );
    });

    it('retorna sem fazer nada quando execução está CANCELADA', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'CANCELADO' }));

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.fluxoExecucaoLog.create).not.toHaveBeenCalled();
    });

    it('atualiza status para EM_EXECUCAO quando está PENDENTE', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'PENDENTE' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]); // sem próximos → CONCLUIDO

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EM_EXECUCAO' }),
        }),
      );
    });

    it('não atualiza status quando já está EM_EXECUCAO', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-1');

      // Só deve ter chamado update uma vez (para CONCLUIDO no final), não para EM_EXECUCAO
      const updateCalls = prisma.fluxoExecucao.update.mock.calls;
      const emExecucaoCall = updateCalls.find(
        (c: [Record<string, unknown>]) =>
          (c[0].data as Record<string, unknown>)?.status === 'EM_EXECUCAO',
      );
      expect(emExecucaoCall).toBeUndefined();
    });

    it('marca como FALHOU e relança quando nó não é encontrado', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao());
      prisma.fluxoNo.findUnique.mockResolvedValue(null);

      await service.executarPasso('exec-1', 'no-inexistente');

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FALHOU' }) }),
      );
    });

    it('marca execução como CONCLUIDO quando não há próximos nós', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]); // sem arestas

      await service.executarPasso('exec-1', 'no-1');

      const lastUpdate = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.status).toBe('CONCLUIDO');
    });

    it('enfileira próximos nós via queue.add', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo({ id: 'no-1' }));
      prisma.fluxoEdge.findMany.mockResolvedValue([fakeEdge('no-1', 'no-2')]);

      await service.executarPasso('exec-1', 'no-1');

      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-2' },
        expect.any(Object),
      );
    });

    it('DELAY node enfileira próximo com delay em ms', async () => {
      const delayNo = fakeNo({
        id: 'no-delay',
        tipo: 'DELAY',
        config: { valor: 2, unidade: 'horas' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(delayNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([fakeEdge('no-delay', 'no-next')]);

      await service.executarPasso('exec-1', 'no-delay');

      const jobOpts = queue.add.mock.calls[0][2];
      expect(jobOpts.delay).toBe(2 * 3_600_000); // 2 horas em ms
    });

    it('CONDICAO node segue aresta com label correto', async () => {
      const condicaoNo = fakeNo({
        id: 'no-cond',
        tipo: 'CONDICAO',
        config: { campo: 'valor', operador: 'gt', valor: 100 },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { valor: 200 } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(condicaoNo);
      // Duas arestas: uma "true" e uma "false"
      prisma.fluxoEdge.findMany.mockResolvedValue([
        fakeEdge('no-cond', 'no-true', 'true'),
        fakeEdge('no-cond', 'no-false', 'false'),
      ]);

      await service.executarPasso('exec-1', 'no-cond');

      // Condição 200 > 100 → "true" → deve enfileirar no-true
      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-true' },
        expect.any(Object),
      );
      expect(queue.add).not.toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-false' },
        expect.any(Object),
      );
    });

    it('registra log do passo após executar nó', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalledOnce();
    });

    it('lança erro quando nó falha (BullMQ retry)', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        config: { mensagem: 'Olá' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: {} }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      // clienteId ausente → ação lança

      await expect(service.executarPasso('exec-1', 'no-1')).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Ações concretas (via executarPasso com nó ACAO)
  // -------------------------------------------------------------------------

  describe('ação ENVIAR_WHATSAPP', () => {
    const setupWhatsappPasso = (contexto: Record<string, unknown> = { clienteId: 'cli-1' }) => {
      const acaoNo = fakeNo({
        id: 'no-wa',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        config: { mensagem: 'Olá {{cliente.nome}}!' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.cliente.findFirst.mockResolvedValue({
        telefone: '11987654321',
        nome: 'Carlos',
      });
      return acaoNo;
    };

    it('envia mensagem interpolada pelo WhatsApp', async () => {
      setupWhatsappPasso({ clienteId: 'cli-1', cliente: { nome: 'Carlos' } });

      await service.executarPasso('exec-1', 'no-wa');

      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '11987654321@s.whatsapp.net',
        'Olá Carlos!',
        {},
      );
    });

    it('lança quando clienteId está ausente no contexto', async () => {
      setupWhatsappPasso({}); // sem clienteId

      await expect(service.executarPasso('exec-1', 'no-wa')).rejects.toThrow();
    });

    it('lança quando cliente não tem telefone', async () => {
      setupWhatsappPasso({ clienteId: 'cli-1' });
      prisma.cliente.findFirst.mockResolvedValue({ telefone: null, nome: 'Ana' });

      await expect(service.executarPasso('exec-1', 'no-wa')).rejects.toThrow();
    });
  });

  describe('ação ENVIAR_EMAIL', () => {
    it('envia e-mail com assunto e corpo interpolados', async () => {
      const acaoNo = fakeNo({
        id: 'no-email',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_EMAIL',
        config: {
          destinatario: 'dest@test.com',
          assunto: 'Olá {{nome}}',
          corpo: 'Conteúdo para {{nome}}',
        },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { nome: 'Maria' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-email');

      expect(sendgrid.enviarSistemico).toHaveBeenCalledWith(
        expect.objectContaining({
          para: { email: 'dest@test.com' },
          assunto: 'Olá Maria',
          html: 'Conteúdo para Maria',
        }),
      );
    });
  });

  describe('ação MOVER_LEAD_ETAPA', () => {
    it('move lead para nova etapa com updateMany scoped por empresaId', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MOVER_LEAD_ETAPA',
        config: { etapa: 'QUALIFICADO' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { leadId: 'lead-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.lead.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1', empresaId: 'emp-1' },
          data: expect.objectContaining({ etapa: 'QUALIFICADO' }),
        }),
      );
    });

    it('lança quando leadId está ausente no contexto', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MOVER_LEAD_ETAPA',
        config: { etapa: 'QUALIFICADO' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: {} }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await expect(service.executarPasso('exec-1', 'no-1')).rejects.toThrow();
    });
  });

  describe('ação MUDAR_TAG', () => {
    it('adiciona tag ao cliente', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MUDAR_TAG',
        config: { tagNome: 'vip', operacao: 'adicionar' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { clienteId: 'cli-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1' });

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { empresaId_nome: { empresaId: 'emp-1', nome: 'vip' } },
        }),
      );
      expect(prisma.clienteTag.upsert).toHaveBeenCalledOnce();
    });

    it('remove tag do cliente quando operacao=remover', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MUDAR_TAG',
        config: { tagNome: 'vip', operacao: 'remover' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { clienteId: 'cli-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.cliente.findFirst.mockResolvedValue({ id: 'cli-1' });

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.clienteTag.deleteMany).toHaveBeenCalledOnce();
    });
  });

  describe('ação WEBHOOK_EXTERNO', () => {
    it('chama safeRequest com URL interpolada e payload', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'WEBHOOK_EXTERNO',
        config: {
          url: 'https://hooks.example.com/{{fluxoId}}',
          method: 'POST',
          payload: { clienteId: '{{clienteId}}' },
        },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({
          status: 'EM_EXECUCAO',
          contexto: { fluxoId: 'fluxo-1', clienteId: 'cli-1' },
        }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-1');

      expect(mockSafeRequest).toHaveBeenCalledWith(
        'https://hooks.example.com/fluxo-1',
        expect.objectContaining({ method: 'POST' }),
        expect.any(Object),
      );
    });

    it('propaga erro quando safeRequest falha (ex: SSRF bloqueado)', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'WEBHOOK_EXTERNO',
        config: { url: 'http://169.254.169.254/metadata', method: 'POST' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: {} }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      mockSafeRequest.mockRejectedValueOnce(new Error('SSRF blocked'));

      await expect(service.executarPasso('exec-1', 'no-1')).rejects.toThrow('SSRF blocked');
    });
  });

  describe('ação ATRIBUIR_REP', () => {
    it('atualiza representanteId do cliente com scope por empresaId', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'ATRIBUIR_REP',
        config: { representanteId: 'rep-x' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { clienteId: 'cli-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.usuario.findFirst.mockResolvedValue({ id: 'rep-x' }); // rep pertence à empresa

      await service.executarPasso('exec-1', 'no-1');

      expect(prisma.cliente.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cli-1', empresaId: 'emp-1' },
          data: { representanteId: 'rep-x' },
        }),
      );
    });

    it('lança quando rep não pertence à empresa', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'ATRIBUIR_REP',
        config: { representanteId: 'rep-foreign' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { clienteId: 'cli-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.usuario.findFirst.mockResolvedValue(null); // rep não encontrado na empresa

      await expect(service.executarPasso('exec-1', 'no-1')).rejects.toThrow();
    });
  });
});
