import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoEventBusService } from './fluxo-event-bus.service';

/**
 * Execução de TESTE não acende outros fluxos.
 *
 * As ações de mutação (MUDAR_TAG, MOVER_LEAD_ETAPA, CRIAR_LEAD, LIBERAR_LOTE)
 * rodam de verdade no teste e disparavam eventos SEM marca nenhuma — o fluxo
 * downstream nascia como PRODUÇÃO (coluna teste=false) e mandava WhatsApp REAL.
 * Testar o T1 com uma nutrição ativa = mensagem real pro contato, exatamente o
 * que o modo seco prometia não fazer. De quebra, o supersede anti-duplicata do
 * bus podia CANCELAR uma execução AGUARDANDO de produção do mesmo lead.
 *
 * A regra agora é uma só, no gate do bus: payload com `_teste` → suprimido.
 * Vale até com enviarDeVerdade — o teste exercita o fluxo TESTADO; encadeamento
 * se valida ativando.
 */
describe('FluxoEventBusService — gate de teste', () => {
  let prisma: {
    fluxo: { findMany: ReturnType<typeof vi.fn> };
    fluxoNo: { count: ReturnType<typeof vi.fn> };
    fluxoExecucao: { create: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  let queue: { add: ReturnType<typeof vi.fn> };
  let bus: FluxoEventBusService;

  beforeEach(() => {
    prisma = {
      fluxo: { findMany: vi.fn().mockResolvedValue([]) },
      fluxoNo: { count: vi.fn().mockResolvedValue(0) },
      fluxoExecucao: { create: vi.fn() },
      $executeRaw: vi.fn().mockResolvedValue(0),
    };
    queue = { add: vi.fn() };
    bus = new FluxoEventBusService(prisma as never, queue as never);
  });

  it('payload com _teste=true é SUPRIMIDO — nem consulta fluxos ativos', async () => {
    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG', {
      leadId: 'lead-1',
      tagNome: 'setor:x',
      _teste: true,
    });

    // Nem chega a procurar fluxos — logo não cria execução, não enfileira job e
    // o supersede anti-duplicata (que cancelaria AGUARDANDO de produção) nunca roda.
    expect(prisma.fluxo.findMany).not.toHaveBeenCalled();
    expect(prisma.fluxoExecucao.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('sem a marca, o disparo segue o caminho normal', async () => {
    await bus.disparar('emp-1', 'LEAD_RECEBEU_TAG', { leadId: 'lead-1', tagNome: 'setor:x' });

    expect(prisma.fluxo.findMany).toHaveBeenCalled();
  });
});
