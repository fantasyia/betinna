import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FluxoTriggerTipo } from '@prisma/client';
import { FluxoEventBusService } from './fluxo-event-bus.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makeQueueMock = () => ({
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
});

const makePrismaMock = () => ({
  fluxo: {
    findMany: vi.fn(),
  } satisfies MockModel,
  // Default: fluxo SEM nó de IA (count=0) → guard anti-duplicata não interfere nos
  // testes existentes. Os testes de dedup sobrescrevem pra count=1.
  fluxoNo: {
    count: vi.fn().mockResolvedValue(0),
  } satisfies MockModel,
  fluxoExecucao: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  } satisfies MockModel,
  // Supersede anti-duplicata IA usa $executeRaw (IS DISTINCT FROM trata _ramoFilha ausente).
  $executeRaw: vi.fn().mockResolvedValue(0),
  // Fallback de nome de etiqueta (evento antigo, sem tagNome no payload).
  tag: {
    findFirst: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
});

const fakeFluxo = (overrides: Record<string, unknown> = {}) => ({
  id: 'fluxo-1',
  nome: 'Boas Vindas',
  empresaId: 'emp-1',
  status: 'ATIVO',
  triggerTipo: 'LEAD_CRIADO',
  nos: [{ id: 'no-trigger-1' }],
  ...overrides,
});

const fakeExecucao = (overrides: Record<string, unknown> = {}) => ({
  id: 'exec-1',
  fluxoId: 'fluxo-1',
  empresaId: 'emp-1',
  status: 'PENDENTE',
  jobId: null,
  contexto: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FluxoEventBusService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let service: FluxoEventBusService;

  beforeEach(() => {
    prisma = makePrismaMock();
    queue = makeQueueMock();
    service = new FluxoEventBusService(prisma as never, queue as never);
  });

  // -------------------------------------------------------------------------
  // disparar
  // -------------------------------------------------------------------------

  describe('disparar', () => {
    it('não faz nada quando não há fluxos ativos para o trigger', async () => {
      prisma.fluxo.findMany.mockResolvedValue([]);

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('cria execução e enfileira job para cada fluxo ativo', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, { clienteId: 'cli-1' });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
      expect(queue.add).toHaveBeenCalledOnce();
    });

    it('salva jobId na execução após enfileirar', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao({ id: 'exec-42' }));
      queue.add.mockResolvedValue({ id: 'bullmq-job-99' });
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      expect(prisma.fluxoExecucao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-42' },
          data: { jobId: 'bullmq-job-99' },
        }),
      );
    });

    it('filtra fluxos por empresaId, status ATIVO e triggerTipo', async () => {
      prisma.fluxo.findMany.mockResolvedValue([]);

      await service.disparar('emp-5', 'PEDIDO_APROVADO' as FluxoTriggerTipo, {});

      const args = prisma.fluxo.findMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-5');
      expect(args.where.status).toBe('ATIVO');
      expect(args.where.triggerTipo).toBe('PEDIDO_APROVADO');
    });

    it('processa múltiplos fluxos para o mesmo trigger', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({ id: 'fluxo-1', nos: [{ id: 'trigger-1' }] }),
        fakeFluxo({ id: 'fluxo-2', nos: [{ id: 'trigger-2' }] }),
      ]);
      prisma.fluxoExecucao.create
        .mockResolvedValueOnce(fakeExecucao({ id: 'exec-1' }))
        .mockResolvedValueOnce(fakeExecucao({ id: 'exec-2' }));
      queue.add.mockResolvedValueOnce({ id: 'job-1' }).mockResolvedValueOnce({ id: 'job-2' });
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('pula fluxo sem nó TRIGGER (sem lançar)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo({ nos: [] })]);

      // Não deve lançar
      await expect(
        service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {}),
      ).resolves.toBeUndefined();

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('falha silenciosa — não relança erros (best-effort)', async () => {
      prisma.fluxo.findMany.mockRejectedValue(new Error('DB timeout'));

      // Não deve lançar — bus é best-effort
      await expect(
        service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {}),
      ).resolves.toBeUndefined();
    });

    it('enfileira job com tentativas e backoff configurados', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, {});

      const jobOpts = queue.add.mock.calls[0][2];
      expect(jobOpts.attempts).toBe(3);
      expect(jobOpts.backoff?.type).toBe('exponential');
    });

    it('cria execução com status PENDENTE e contexto passado', async () => {
      const contexto = { clienteId: 'cli-1', leadId: 'lead-1' };
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo()]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_CRIADO' as FluxoTriggerTipo, contexto);

      const createArgs = prisma.fluxoExecucao.create.mock.calls[0][0];
      expect(createArgs.data.status).toBe('PENDENTE');
      expect(createArgs.data.contexto).toMatchObject(contexto);
    });

    // Re-entrada num fluxo de IA: SUBSTITUI a execução anterior do lead (encerra a
    // antiga + cria nova) em vez de SUPRIMIR — senão o opener não disparava na
    // re-entrada. Nunca há duas em paralelo (a antiga vira CANCELADO).
    it('re-entrada encerra execução anterior do lead E cria nova (substitui)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo({ triggerTipo: 'LEAD_ETAPA_MUDOU' })]);
      prisma.fluxoNo.count.mockResolvedValue(1); // fluxo TEM nó "Conversar com IA"
      prisma.$executeRaw.mockResolvedValue(1); // 1 raiz anterior ativa cancelada
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_ETAPA_MUDOU' as FluxoTriggerTipo, { leadId: 'lead-1' });

      // Encerrou a anterior (CANCELADO via $executeRaw com IS DISTINCT FROM) E criou a nova.
      expect(prisma.$executeRaw).toHaveBeenCalledOnce();
      // O leadId e o empresaId vão como parâmetros do template raw.
      const rawCall = prisma.$executeRaw.mock.calls[0];
      expect(rawCall).toContain('lead-1');
      expect(rawCall).toContain('emp-1');
      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
      expect(queue.add).toHaveBeenCalledOnce();
    });

    it('sem execução anterior ativa: só cria a nova ($executeRaw count 0)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo({ triggerTipo: 'LEAD_ETAPA_MUDOU' })]);
      prisma.fluxoNo.count.mockResolvedValue(1);
      prisma.$executeRaw.mockResolvedValue(0); // nenhuma raiz ativa
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_ETAPA_MUDOU' as FluxoTriggerTipo, { leadId: 'lead-1' });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('#37: CLIENTE_INATIVO_30D pula o fluxo quando o cliente NÃO cruzou o diasInativo dele', async () => {
      // Fluxo de 90 dias; cliente com 35 dias de inatividade → NÃO dispara (audiência errada antes).
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'CLIENTE_INATIVO_30D',
          nos: [{ id: 'trg', config: { diasInativo: 90 } }],
        }),
      ]);

      await service.disparar('emp-1', 'CLIENTE_INATIVO_30D' as FluxoTriggerTipo, {
        clienteId: 'cli-1',
        diasSemPedido: 35,
      });

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });

    it('#37: CLIENTE_INATIVO_30D dispara quando o cliente cruzou o diasInativo do fluxo', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'CLIENTE_INATIVO_30D',
          nos: [{ id: 'trg', config: { diasInativo: 90 } }],
        }),
      ]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'CLIENTE_INATIVO_30D' as FluxoTriggerTipo, {
        clienteId: 'cli-1',
        diasSemPedido: 120,
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('MENSAGEM_CANAL: filtro de canal é case-INSENSITIVE (config "whatsapp" × contexto "WHATSAPP")', async () => {
      // O contexto traz o enum do Prisma (WHATSAPP); a config é escrita à mão via
      // MCP/API e sai minúscula. Sem normalizar, o fluxo não dispara e NÃO sobra
      // erro nenhum — falha silenciosa que matou o teste do T1 em prod.
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { canais: ['whatsapp'] } }],
        }),
      ]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-1',
        texto: 'oi',
        leadId: null,
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('MENSAGEM_CANAL: NÃO cria 2ª execução quando já há uma VIVA pra mesma conversationId (anti-reabertura)', async () => {
      // Bug de prod: cada mensagem do WhatsApp republicava MENSAGEM_CANAL e o
      // anti-duplicata de IA cancelava a execução AGUARDANDO e recriava do zero —
      // o CONVERSAR_IA reabria a saudação em loop a cada resposta do lead.
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { canais: ['WHATSAPP'] } }],
        }),
      ]);
      // O guard só vale pra fluxo COM nó de IA (é dele o loop que ele evita).
      prisma.fluxoNo.count.mockResolvedValue(1);
      prisma.fluxoExecucao.findFirst.mockResolvedValueOnce({ id: 'exec-viva' });

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-1',
        texto: 'segunda mensagem',
        leadId: 'lead-1',
      });

      expect(prisma.fluxoExecucao.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fluxoId: 'fluxo-1',
            status: { in: ['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO'] },
            contexto: { path: ['conversationId'], equals: 'conv-1' },
          }),
        }),
      );
      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });

    it('MENSAGEM_CANAL: apenasComBotLigado PULA o fluxo quando o bot está desligado', async () => {
      // Caso de prod: dono ligou o bot só numa conversa; outro contato mandou msg
      // e virou lead na triagem (o CRIAR_LEAD roda ANTES do nó de IA, então gatear
      // só na IA não bastava).
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { apenasComBotLigado: true } }],
        }),
      ]);
      prisma.empresa = { findUnique: vi.fn().mockResolvedValue({ botWhatsappAtivo: false }) };
      prisma.conversation = { findUnique: vi.fn().mockResolvedValue({ botLigado: null }) };

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-desligada',
        texto: 'oi',
        leadId: null,
      });

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });

    it('MENSAGEM_CANAL: apenasComBotLigado DISPARA na conversa com bot ligado (override)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { apenasComBotLigado: true } }],
        }),
      ]);
      // Global DESLIGADO, mas a conversa tem override ligado → roda.
      prisma.empresa = { findUnique: vi.fn().mockResolvedValue({ botWhatsappAtivo: false }) };
      prisma.conversation = { findUnique: vi.fn().mockResolvedValue({ botLigado: true }) };
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-ligada',
        texto: 'oi',
        leadId: null,
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('MENSAGEM_CANAL: escopo "empresa" PULA mensagem do WhatsApp PESSOAL do rep', async () => {
      // Dual-owner (D38): proprietarioId preenchido = WhatsApp pessoal do rep.
      // Fluxo de triagem geral não pode processar isso (viraria lead da empresa).
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { canais: ['WHATSAPP'], escopo: 'empresa' } }],
        }),
      ]);

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-1',
        texto: 'oi',
        leadId: null,
        proprietarioId: 'rep-1',
      });

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });

    it('MENSAGEM_CANAL: escopo "empresa" DISPARA no WhatsApp central (proprietarioId ausente)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { canais: ['WHATSAPP'], escopo: 'empresa' } }],
        }),
      ]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-1',
        texto: 'oi',
        leadId: null,
        proprietarioId: null,
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('MENSAGEM_CANAL: escopo "pessoal" PULA mensagem do WhatsApp central', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { escopo: 'pessoal' } }],
        }),
      ]);

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-1',
        texto: 'oi',
        leadId: null,
        proprietarioId: null,
      });

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });

    it('MENSAGEM_CANAL: SEM escopo configurado (default "ambos") dispara pros dois — compat retroativa', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { canais: ['WHATSAPP'] } }],
        }),
      ]);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'WHATSAPP',
        conversationId: 'conv-1',
        texto: 'oi',
        leadId: null,
        proprietarioId: 'rep-1', // pessoal — mas sem `escopo` configurado, deve passar
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('MENSAGEM_CANAL: canal DIFERENTE segue sendo filtrado (não vira passa-tudo)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([
        fakeFluxo({
          triggerTipo: 'MENSAGEM_CANAL',
          nos: [{ id: 'trg', config: { canais: ['whatsapp'] } }],
        }),
      ]);

      await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
        canal: 'INSTAGRAM',
        conversationId: 'conv-1',
        texto: 'oi',
        leadId: null,
      });

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // LEAD_RESPONDEU — anti-reabertura (loop de saudação)
  // -------------------------------------------------------------------------

  describe('LEAD_RESPONDEU: não recria execução quando já há uma viva', () => {
    const fluxoIa = () => fakeFluxo({ triggerTipo: 'LEAD_RESPONDEU' });

    it('pula o disparo quando existe execução viva pra mesma conversa', async () => {
      // O bug: cada mensagem do lead re-disparava LEAD_RESPONDEU, o supersede
      // cancelava a execução AGUARDANDO e recriava → a IA repetia a saudação.
      prisma.fluxo.findMany.mockResolvedValue([fluxoIa()]);
      prisma.fluxoExecucao.findFirst.mockResolvedValue({ id: 'exec-viva' });

      await service.disparar('emp-1', 'LEAD_RESPONDEU' as FluxoTriggerTipo, {
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });

      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled(); // supersede nem roda
    });

    it('usa leadId como chave quando não há conversationId (lead trocou de canal)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fluxoIa()]);
      prisma.fluxoExecucao.findFirst.mockResolvedValue({ id: 'exec-viva' });

      await service.disparar('emp-1', 'LEAD_RESPONDEU' as FluxoTriggerTipo, { leadId: 'lead-1' });

      const where = prisma.fluxoExecucao.findFirst.mock.calls[0][0].where;
      expect(where.contexto).toEqual({ path: ['leadId'], equals: 'lead-1' });
      expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    });

    it('dispara normalmente quando NÃO há execução viva (1ª resposta)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fluxoIa()]);
      prisma.fluxoExecucao.findFirst.mockResolvedValue(null);
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_RESPONDEU' as FluxoTriggerTipo, {
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });

    it('outros gatilhos NÃO ganham o guard (re-entrada por etapa segue substituindo)', async () => {
      prisma.fluxo.findMany.mockResolvedValue([fakeFluxo({ triggerTipo: 'LEAD_ETAPA_MUDOU' })]);
      prisma.fluxoExecucao.findFirst.mockResolvedValue({ id: 'exec-viva' });
      prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
      prisma.fluxoExecucao.update.mockResolvedValue({});

      await service.disparar('emp-1', 'LEAD_ETAPA_MUDOU' as FluxoTriggerTipo, {
        leadId: 'lead-1',
        conversationId: 'conv-1',
      });

      expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // dispararDireto
  // -------------------------------------------------------------------------

  describe('dispararDireto', () => {
    it('enfileira job diretamente para execução e nó informados', async () => {
      await service.dispararDireto('exec-1', 'no-1');

      expect(queue.add).toHaveBeenCalledWith(
        'step',
        { execucaoId: 'exec-1', noId: 'no-1' },
        expect.any(Object),
      );
    });

    it('usa número de tentativas customizado quando passado', async () => {
      await service.dispararDireto('exec-1', 'no-1', { tentativas: 5 });

      const opts = queue.add.mock.calls[0][2];
      expect(opts.attempts).toBe(5);
    });

    it('usa tentativas padrão=3 quando não passado', async () => {
      await service.dispararDireto('exec-1', 'no-1');

      const opts = queue.add.mock.calls[0][2];
      expect(opts.attempts).toBe(3);
    });
  });
});

// ─── Auditoria 2026-08: o guard não pode calar fluxo SEM IA ───────────

describe('FluxoEventBusService — anti-reabertura só vale pra fluxo COM nó de IA', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let service: FluxoEventBusService;

  beforeEach(() => {
    prisma = makePrismaMock();
    queue = makeQueueMock();
    service = new FluxoEventBusService(prisma as never, queue as never);
  });

  it('fluxo SEM nó de IA dispara mesmo com execução viva na conversa', async () => {
    // O guard existe pra impedir o loop da IA. Num fluxo comum (ex.: com um
    // DELAY de 1h em voo), ele virava descarte: a mensagem seguinte do contato
    // era IGNORADA em silêncio.
    prisma.fluxo.findMany.mockResolvedValue([
      fakeFluxo({
        triggerTipo: 'MENSAGEM_CANAL',
        nos: [{ id: 'trg', config: { canais: ['WHATSAPP'] } }],
      }),
    ]);
    prisma.fluxoNo.count.mockResolvedValue(0); // sem CONVERSAR_IA
    prisma.fluxoExecucao.findFirst.mockResolvedValue({ id: 'exec-viva' });
    prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
    prisma.fluxoExecucao.update.mockResolvedValue({});

    await service.disparar('emp-1', 'MENSAGEM_CANAL' as FluxoTriggerTipo, {
      canal: 'WHATSAPP',
      conversationId: 'conv-1',
      texto: 'segunda mensagem',
    });

    expect(prisma.fluxoExecucao.create).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// LEAD_RECEBEU_TAG — QUAL etiqueta dispara (antes: nenhuma filtragem)
// ---------------------------------------------------------------------------

describe('FluxoEventBusService — filtro do gatilho LEAD_RECEBEU_TAG', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let service: FluxoEventBusService;

  const comConfig = (config: Record<string, unknown>) => {
    prisma.fluxo.findMany.mockResolvedValue([
      fakeFluxo({ triggerTipo: 'LEAD_RECEBEU_TAG', nos: [{ id: 'no-trigger-1', config }] }),
    ]);
    prisma.fluxoExecucao.create.mockResolvedValue(fakeExecucao());
  };
  const receber = (tagNome: string, tagId = 'tag-1') =>
    service.disparar('emp-1', 'LEAD_RECEBEU_TAG', { leadId: 'lead-1', tagId, tagNome });

  beforeEach(() => {
    prisma = makePrismaMock();
    queue = makeQueueMock();
    service = new FluxoEventBusService(prisma as never, queue as never);
  });

  it('sem config: qualquer etiqueta dispara (compatível com o que já está no ar)', async () => {
    comConfig({});
    await receber('setor:cadeia-do-frio');
    expect(queue.add).toHaveBeenCalled();
  });

  it('modo default é EXATO — a etiqueta certa dispara', async () => {
    comConfig({ tagNome: 'setor:cadeia-do-frio' });
    await receber('setor:cadeia-do-frio');
    expect(queue.add).toHaveBeenCalled();
  });

  it('o `:` sobrevive à leitura — etiqueta-dimensão casa igualzinho', async () => {
    comConfig({ tagNome: 'publico:comercio' });
    await receber('publico:comercio');
    expect(queue.add).toHaveBeenCalled();
  });

  it('exato NÃO dispara pra outra etiqueta da mesma família', async () => {
    comConfig({ tagNome: 'setor:cadeia-do-frio' });
    await receber('setor:laticinios');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('exato não sofre colisão de substring (varejo ≠ varejo-alimentar)', async () => {
    comConfig({ tagNome: 'setor:varejo' });
    await receber('setor:varejo-alimentar');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('modo prefixo pega a família inteira da dimensão', async () => {
    comConfig({ tagNome: 'setor:', modo: 'prefixo' });
    await receber('setor:cadeia-do-frio');
    expect(queue.add).toHaveBeenCalled();
  });

  it('modo prefixo NÃO vaza pra outra dimensão', async () => {
    comConfig({ tagNome: 'setor:', modo: 'prefixo' });
    await receber('publico:comercio');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('modo contem casa no meio (escape hatch explícito)', async () => {
    comConfig({ tagNome: 'frio', modo: 'contem' });
    await receber('setor:cadeia-do-frio');
    expect(queue.add).toHaveBeenCalled();
  });

  it('match ignora caixa e acento (mesma normalização do roteador)', async () => {
    comConfig({ tagNome: 'setor:comercio' });
    await receber('  SETOR:Comércio ');
    expect(queue.add).toHaveBeenCalled();
  });

  it('aceita lista de nomes (tagNomes) — dispara em qualquer uma delas', async () => {
    comConfig({ tagNomes: ['setor:laticinios', 'setor:cadeia-do-frio'] });
    await receber('setor:cadeia-do-frio');
    expect(queue.add).toHaveBeenCalled();
  });

  it('filtro por tagIds usa o id, não o nome', async () => {
    comConfig({ tagIds: ['tag-9'] });
    await receber('setor:cadeia-do-frio', 'tag-1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('evento antigo sem tagNome no payload: busca o nome no banco', async () => {
    comConfig({ tagNome: 'setor:cadeia-do-frio' });
    prisma.tag.findFirst.mockResolvedValue({ nome: 'setor:cadeia-do-frio' });
    await service.disparar('emp-1', 'LEAD_RECEBEU_TAG', { leadId: 'lead-1', tagId: 'tag-1' });
    expect(prisma.tag.findFirst).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });
});
