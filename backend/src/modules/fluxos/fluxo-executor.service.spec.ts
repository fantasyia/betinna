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
    delete: vi.fn().mockResolvedValue({}),
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
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  } satisfies MockModel,
  funilEtapa: {
    findFirst: vi.fn().mockResolvedValue(null),
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
  leadTag: {
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  } satisfies MockModel,
  variavelCustomizada: {
    findMany: vi.fn().mockResolvedValue([]),
  } satisfies MockModel,
  fluxoStepClaim: {
    create: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  } satisfies MockModel,
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
});

const makeWhatsappMock = () => ({
  enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-msg-1' }),
});

const makeEmailSvcMock = () => ({
  enviarHtmlLivre: vi.fn().mockResolvedValue({ ok: true, id: 're-msg-1' }),
});

const makeQueueMock = () => ({
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
});

const makeConversarIaMock = () => ({
  iniciar: vi.fn().mockResolvedValue({ aguardando: false }),
});

const makeBusMock = () => ({
  disparar: vi.fn().mockResolvedValue(undefined),
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
  let emailSvc: ReturnType<typeof makeEmailSvcMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let bus: ReturnType<typeof makeBusMock>;
  let conversarIa: ReturnType<typeof makeConversarIaMock>;
  let service: FluxoExecutorService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaMock();
    whatsapp = makeWhatsappMock();
    emailSvc = makeEmailSvcMock();
    queue = makeQueueMock();
    bus = makeBusMock();
    conversarIa = makeConversarIaMock();
    service = new FluxoExecutorService(
      prisma as never,
      makeEnvMock() as never,
      {} as never,
      whatsapp as never,
      emailSvc as never,
      conversarIa as never,
      bus as never,
      { aguardarSlot: vi.fn() } as never,
      queue as never,
    );
  });

  describe('LIBERAR_LOTE (Fase B)', () => {
    it('move o lote por prioridade e dispara LEAD_ETAPA_MUDOU por lead', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(
        fakeNo({
          tipo: 'ACAO',
          acaoTipo: 'LIBERAR_LOTE',
          config: { etapaOrigemId: 'et-prosp', etapaDestinoId: 'et-abord', quantidade: 2 },
        }),
      );
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-abord',
        funilId: 'funil-1',
        tipo: 'ATIVA',
      });
      prisma.lead.findMany.mockResolvedValue([{ id: 'lead-a' }, { id: 'lead-b' }]);

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ funilEtapaId: 'et-prosp' }),
          take: 2,
        }),
      );
      // CAS: move via updateMany guardado por funilEtapaId de origem (count===1 por lead).
      expect(prisma.lead.updateMany).toHaveBeenCalledTimes(2);
      expect(bus.disparar).toHaveBeenCalledWith(
        'emp-1',
        'LEAD_ETAPA_MUDOU',
        expect.objectContaining({
          leadId: 'lead-a',
          funilId: 'funil-1',
          paraFunilEtapaId: 'et-abord',
        }),
      );
    });

    it('cron sem leads elegíveis (movidos:0) → DESCARTA a execução vazia', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { _cron: true } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(
        fakeNo({
          tipo: 'ACAO',
          acaoTipo: 'LIBERAR_LOTE',
          config: { etapaOrigemId: 'et-prosp', etapaDestinoId: 'et-abord', quantidade: 1 },
        }),
      );
      prisma.fluxoEdge.findMany.mockResolvedValue([]); // terminal
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-abord',
        funilId: 'funil-1',
        tipo: 'ATIVA',
      });
      prisma.lead.findMany.mockResolvedValue([]); // 0 elegíveis → movidos:0

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.fluxoExecucao.delete).toHaveBeenCalledWith({ where: { id: 'exec-1' } });
      // não marca CONCLUIDO (foi descartada)
      expect(prisma.fluxoExecucao.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONCLUIDO' }) }),
      );
    });

    it('respeitarCapacidadeDestino: destino já no limite → libera 0 (espera sair)', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { _cron: true } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(
        fakeNo({
          tipo: 'ACAO',
          acaoTipo: 'LIBERAR_LOTE',
          config: {
            etapaOrigemId: 'et-prosp',
            etapaDestinoId: 'et-abord',
            quantidade: 1,
            respeitarCapacidadeDestino: true,
          },
        }),
      );
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-abord',
        funilId: 'funil-1',
        tipo: 'ATIVA',
        capacidadeMaxima: null,
      });
      prisma.lead.count.mockResolvedValue(1); // destino já tem 1 lead

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      // conta a ocupação do destino e NÃO move nenhum lead (já no limite)
      expect(prisma.lead.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ funilEtapaId: 'et-abord' }) }),
      );
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('disparo MANUAL sem leads (movidos:0) → NÃO descarta (mantém no histórico)', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: {} }), // sem _cron
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(
        fakeNo({
          tipo: 'ACAO',
          acaoTipo: 'LIBERAR_LOTE',
          config: { etapaOrigemId: 'et-prosp', etapaDestinoId: 'et-abord', quantidade: 1 },
        }),
      );
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-abord',
        funilId: 'funil-1',
        tipo: 'ATIVA',
      });
      prisma.lead.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.fluxoExecucao.delete).not.toHaveBeenCalled();
      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONCLUIDO' }) }),
      );
    });
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

      await service.executarPasso('exec-99', 'no-1', 'job-test');

      expect(prisma.fluxoExecucaoLog.create).not.toHaveBeenCalled();
    });

    it('marca como FALHOU quando execução não tem empresaId', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ empresaId: null }));

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FALHOU' }) }),
      );
    });

    it('retorna sem fazer nada quando execução está CANCELADA', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'CANCELADO' }));

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.fluxoExecucaoLog.create).not.toHaveBeenCalled();
    });

    it('atualiza status para EM_EXECUCAO quando está PENDENTE', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'PENDENTE' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]); // sem próximos → CONCLUIDO

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EM_EXECUCAO' }),
        }),
      );
    });

    it('CONVERSAR_IA roteado pela saída "erro" → passo logado FALHOU (vermelho), sem retry nem caminho normal', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(
        fakeNo({ tipo: 'ACAO', acaoTipo: 'CONVERSAR_IA', titulo: 'Conversar com IA' }),
      );
      // Existe aresta normal, mas NÃO deve ser seguida (o service já roteou "erro").
      prisma.fluxoEdge.findMany.mockResolvedValue([fakeEdge('no-1', 'no-normal')]);
      conversarIa.iniciar.mockResolvedValue({
        aguardando: false,
        roteado: true,
        tipoErro: 'whatsapp_falha',
      });

      // Não relança (o erro já foi tratado/roteado — nada de retry do BullMQ).
      await expect(service.executarPasso('exec-1', 'no-1', 'job-test')).resolves.toBeUndefined();

      // Passo agora loga FALHOU com o motivo (antes ficava verde "Concluída sem erros",
      // mascarando que nada foi enviado).
      expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FALHOU',
            erroMsg: expect.stringContaining('whatsapp_falha'),
          }),
        }),
      );
      // Não enfileirou o caminho normal (o ramo "erro" sai dentro do ConversarIaService).
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('não atualiza status quando já está EM_EXECUCAO', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      // Só deve ter chamado update uma vez (para CONCLUIDO no final), não para EM_EXECUCAO
      const updateCalls = prisma.fluxoExecucao.update.mock.calls;
      const emExecucaoCall = updateCalls.find((c: unknown[]) => {
        const arg = c[0] as { data?: Record<string, unknown> } | undefined;
        return arg?.data?.status === 'EM_EXECUCAO';
      });
      expect(emExecucaoCall).toBeUndefined();
    });

    it('marca como FALHOU e relança quando nó não é encontrado', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao());
      prisma.fluxoNo.findUnique.mockResolvedValue(null);

      await service.executarPasso('exec-1', 'no-inexistente', 'job-test');

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FALHOU' }) }),
      );
    });

    it('marca execução como CONCLUIDO quando não há próximos nós', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo());
      prisma.fluxoEdge.findMany.mockResolvedValue([]); // sem arestas

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      const lastUpdate = prisma.fluxoExecucao.update.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.status).toBe('CONCLUIDO');
    });

    it('enfileira próximos nós via queue.add', async () => {
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(fakeNo({ id: 'no-1' }));
      prisma.fluxoEdge.findMany.mockResolvedValue([fakeEdge('no-1', 'no-2')]);

      await service.executarPasso('exec-1', 'no-1', 'job-test');

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
        // chave REAL gravada pelo front é `quantidade` (não `valor`).
        config: { quantidade: 2, unidade: 'horas' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(delayNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([fakeEdge('no-delay', 'no-next')]);

      await service.executarPasso('exec-1', 'no-delay', 'job-test');

      const jobOpts = queue.add.mock.calls[0][2];
      expect(jobOpts.delay).toBe(2 * 3_600_000); // 2 horas em ms
    });

    it('DELAY respeita a quantidade configurada (3 dias = 3 dias, não 1)', async () => {
      // Regressão: o back lia `cfg.valor` (que o front nunca grava) → todo DELAY virava 1 unidade.
      const delayNo = fakeNo({
        id: 'no-delay',
        tipo: 'DELAY',
        config: { quantidade: 3, unidade: 'dias' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(fakeExecucao({ status: 'EM_EXECUCAO' }));
      prisma.fluxoNo.findUnique.mockResolvedValue(delayNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([fakeEdge('no-delay', 'no-next')]);

      await service.executarPasso('exec-1', 'no-delay', 'job-test');

      expect(queue.add.mock.calls[0][2].delay).toBe(3 * 86_400_000); // 3 dias, não 1
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
      // Duas arestas: a do ramo verdadeiro ("Sim") e a do falso ("Não") — labels
      // iguais aos que o editor grava (handle true→"Sim", false→"Não").
      prisma.fluxoEdge.findMany.mockResolvedValue([
        fakeEdge('no-cond', 'no-true', 'Sim'),
        fakeEdge('no-cond', 'no-false', 'Não'),
      ]);

      await service.executarPasso('exec-1', 'no-cond', 'job-test');

      // Condição 200 > 100 → "Sim" → deve enfileirar no-true
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

      await service.executarPasso('exec-1', 'no-1', 'job-test');

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

      await expect(service.executarPasso('exec-1', 'no-1', 'job-test')).rejects.toThrow();
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

      await service.executarPasso('exec-1', 'no-wa', 'job-test');

      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '11987654321@s.whatsapp.net',
        'Olá Carlos!',
        { idempotencyKey: 'fx:job-test' },
      );
    });

    it('lança quando clienteId está ausente no contexto', async () => {
      setupWhatsappPasso({}); // sem clienteId

      await expect(service.executarPasso('exec-1', 'no-wa', 'job-test')).rejects.toThrow();
    });

    it('lança quando cliente não tem telefone', async () => {
      setupWhatsappPasso({ clienteId: 'cli-1' });
      prisma.cliente.findFirst.mockResolvedValue({ telefone: null, nome: 'Ana' });

      await expect(service.executarPasso('exec-1', 'no-wa', 'job-test')).rejects.toThrow();
    });

    it('envia direto pro jid quando o contato salvo é um GRUPO (@g.us)', async () => {
      const acaoNo = fakeNo({
        id: 'no-wa',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        config: {
          mensagem: 'Bom dia, time!',
          destinatarioModo: 'contato',
          destinatarioContato: '120363000000000000@g.us',
        },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: {} }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      await service.executarPasso('exec-1', 'no-wa', 'job-test');

      // jid de grupo vai DIRETO (não vira @s.whatsapp.net nem perde o @g.us)
      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '120363000000000000@g.us',
        'Bom dia, time!',
        { idempotencyKey: 'fx:job-test' },
      );
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

      await service.executarPasso('exec-1', 'no-email', 'job-test');

      expect(emailSvc.enviarHtmlLivre).toHaveBeenCalledWith(
        expect.objectContaining({
          para: 'dest@test.com',
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

      await service.executarPasso('exec-1', 'no-1', 'job-test');

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

      await expect(service.executarPasso('exec-1', 'no-1', 'job-test')).rejects.toThrow();
    });

    it('dispara LEAD_ETAPA_MUDOU ao mover por funilEtapaId (encadeia abordagem)', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MOVER_LEAD_ETAPA',
        config: { funilEtapaId: 'et-abord' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { leadId: 'lead-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-abord',
        funilId: 'funil-1',
        tipo: 'ATIVA',
      });
      // Etapa de origem diferente da destino → deve disparar o evento.
      prisma.lead.findFirst.mockResolvedValue({ funilEtapaId: 'et-prosp' });

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(bus.disparar).toHaveBeenCalledWith(
        'emp-1',
        'LEAD_ETAPA_MUDOU',
        expect.objectContaining({
          leadId: 'lead-1',
          funilId: 'funil-1',
          deFunilEtapaId: 'et-prosp',
          paraFunilEtapaId: 'et-abord',
        }),
      );
    });

    it('NÃO dispara LEAD_ETAPA_MUDOU quando a etapa não muda (re-move no-op)', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MOVER_LEAD_ETAPA',
        config: { funilEtapaId: 'et-abord' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { leadId: 'lead-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.funilEtapa.findFirst.mockResolvedValue({
        id: 'et-abord',
        funilId: 'funil-1',
        tipo: 'ATIVA',
      });
      // Origem == destino → não dispara (evita laço e re-disparo).
      prisma.lead.findFirst.mockResolvedValue({ funilEtapaId: 'et-abord' });

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(bus.disparar).not.toHaveBeenCalled();
    });
  });

  describe('interpolação — variáveis SEM prefixo (atalhos no topo do contexto)', () => {
    it('resolve {{nome}}/{{cidade}}/{{uf}}/{{whatsapp}} do lead e {{var}} capturada pela IA', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        config: {
          destinatarioModo: 'numero',
          destinatarioNumero: '11999990000',
          mensagem:
            'Lead: {{nome}} ({{cidade}}/{{uf}}) wpp {{whatsapp}} | canal {{canal_dominante}} | obs {{observacao_executiva}}',
        },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { leadId: 'lead-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.lead.findFirst.mockResolvedValue({
        nome: 'Padaria Forte',
        contatoNome: 'João',
        contatoTelefone: '+55 19 98888-7777',
        contatoEmail: null,
        cidade: 'Campinas',
        uf: 'SP',
        segmento: null,
        score: null,
        etapa: 'QUALIFICANDO',
        variaveis: { canal_dominante: 'atacado', observacao_executiva: 'Compra 3x/mês' },
        funil: null,
        funilEtapa: null,
        tags: [],
      });

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
        'emp-1',
        '11999990000@s.whatsapp.net',
        'Lead: Padaria Forte (Campinas/SP) wpp +55 19 98888-7777 | canal atacado | obs Compra 3x/mês',
        { idempotencyKey: 'fx:job-test' },
      );
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

      await service.executarPasso('exec-1', 'no-1', 'job-test');

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

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.clienteTag.deleteMany).toHaveBeenCalledOnce();
    });

    // REGRESSÃO: fluxo LEAD-driven (gatilho "Lead mudou etapa") só tem leadId no
    // contexto → MUDAR_TAG falhava ("contexto.clienteId ausente"). Agora tagueia o
    // LEAD via LeadTag.
    it('adiciona tag ao LEAD quando o contexto só tem leadId (fluxo de prospecção)', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MUDAR_TAG',
        config: { tagNome: 'Forte Sinergia', operacao: 'adicionar' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: { leadId: 'lead-1' } }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });

      await service.executarPasso('exec-1', 'no-1', 'job-test');

      expect(prisma.leadTag.upsert).toHaveBeenCalledOnce();
      expect(prisma.clienteTag.upsert).not.toHaveBeenCalled();
    });

    it('falha só quando o contexto não tem nem clienteId nem leadId', async () => {
      const acaoNo = fakeNo({
        tipo: 'ACAO',
        acaoTipo: 'MUDAR_TAG',
        config: { tagNome: 'vip', operacao: 'adicionar' },
      });
      prisma.fluxoExecucao.findUnique.mockResolvedValue(
        fakeExecucao({ status: 'EM_EXECUCAO', contexto: {} }),
      );
      prisma.fluxoNo.findUnique.mockResolvedValue(acaoNo);
      prisma.fluxoEdge.findMany.mockResolvedValue([]);

      // O executor loga FALHOU e RE-LANÇA (pra BullMQ retentar) — sem cliente nem lead.
      await expect(service.executarPasso('exec-1', 'no-1', 'job-test')).rejects.toThrow(
        /MUDAR_TAG/,
      );
      expect(prisma.leadTag.upsert).not.toHaveBeenCalled();
      expect(prisma.clienteTag.upsert).not.toHaveBeenCalled();
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

      await service.executarPasso('exec-1', 'no-1', 'job-test');

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

      await expect(service.executarPasso('exec-1', 'no-1', 'job-test')).rejects.toThrow(
        'SSRF blocked',
      );
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

      await service.executarPasso('exec-1', 'no-1', 'job-test');

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

      await expect(service.executarPasso('exec-1', 'no-1', 'job-test')).rejects.toThrow();
    });
  });
});
