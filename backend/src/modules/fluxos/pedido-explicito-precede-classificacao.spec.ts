import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

/**
 * P1 da Bateria 3 (14/09/2026) — o caso A3.
 *
 * O lead escreve "quero falar com uma pessoa". O nó de IA grava certo
 * (`pediu_contato: sim`) e, na MESMA passada, grava `classificacao_final:
 * Indefinido`. O roteador da classificação roda primeiro e manda pra
 * **Descartado**; o portão "Pediu pra falar com uma pessoa?" existe no grafo,
 * mas num ramo adiante que nunca é alcançado.
 *
 * Nada falha, nada fica vermelho — a única pessoa da bateria que pediu
 * atendimento humano é descartada em silêncio.
 *
 * O conserto mora no MOTOR (e não na ordem dos nós) por decisão do Léo em
 * 14/09: vale pra qualquer fluxo que tenha o portão, não muda desenho nenhum e
 * não exige full-replace de fluxo ATIVO — que cancelaria as conversas em voo.
 */

const ROTEADOR = {
  id: 'no-roteador',
  fluxoId: 'fluxo-t1',
  tipo: 'CONDICAO',
  acaoTipo: null,
  titulo: 'Roteador — classificacao_final',
  config: {
    modo: 'roteador',
    variavel: 'classificacao_final',
    saidas: ['Interesse comercial', 'Indefinido'],
  },
  posX: 0,
  posY: 0,
};

const PORTAO = {
  id: 'no-portao',
  titulo: 'Pediu pra falar com uma pessoa?',
  config: { campo: 'pediu_contato', operador: 'eq', valor: 'sim' },
};

const DESCARTADO = 'no-descartado';

function setup(leadVars: Record<string, unknown>) {
  const contexto = { leadId: 'lead-1' };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-novo' }) };
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-t1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto,
        jobId: null,
        iniciadoEm: null,
        terminouEm: null,
        erroMsg: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoNo: {
      findUnique: vi.fn().mockResolvedValue(ROTEADOR),
      // O motor procura, no MESMO fluxo, o portão que trata o sinal.
      findMany: vi.fn().mockResolvedValue([ROTEADOR, PORTAO]),
    },
    fluxoEdge: {
      findMany: vi.fn().mockResolvedValue([
        { sourceNoId: 'no-roteador', targetNoId: DESCARTADO, label: 'Indefinido' },
        { sourceNoId: 'no-roteador', targetNoId: 'no-comercial', label: 'Interesse comercial' },
      ]),
    },
    fluxoExecucaoLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoStepClaim: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'MENSAGEM_CANAL' }) },
    empresa: { findUnique: vi.fn().mockResolvedValue({ nome: 'Somatec', botWhatsappAtivo: true }) },
    // O motor LIMPA os sinais achatados do topo do contexto e os repõe a partir
    // de Lead.variaveis (fonte fresca). Sem o lead aqui, o roteador não veria
    // nem a classificação nem o pedido — que é justamente o caminho de produção.
    lead: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'lead-1',
        nome: 'Fulano',
        contatoNome: 'Fulano',
        variaveis: leadVars,
      }),
      findUnique: vi.fn().mockResolvedValue({ id: 'lead-1' }),
    },
    variavelCustomizada: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (ops: unknown) =>
      typeof ops === 'function' ? (ops as (tx: unknown) => unknown)({}) : Promise.all(ops as []),
    ),
  };
  const service = new FluxoExecutorService(
    prisma as never,
    { get: () => '' } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { disparar: vi.fn() } as never,
    {
      aguardarSlot: vi.fn(),
      esperaAntesDoProativoMs: vi.fn().mockResolvedValue(0),
      esperaAntesDoEmailMs: vi.fn().mockResolvedValue(0),
      reservarCotaEmailDoDia: vi.fn().mockResolvedValue(undefined),
    } as never,
    {} as never,
    queue as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { executar: vi.fn() } as never,
    {
      obterConfigBot: vi
        .fn()
        .mockResolvedValue({ delayTextoFixoSegundos: 0, mostrarDigitando: false }),
    } as never,
  );
  return { service, prisma, queue };
}

/** Pra onde o passo mandou o fluxo (o nó do job enfileirado). */
function proximoNo(queue: { add: ReturnType<typeof vi.fn> }): string | undefined {
  const call = queue.add.mock.calls.at(-1);
  return (call?.[1] as { noId?: string } | undefined)?.noId;
}

describe('P1 · pedido explícito do lead precede a classificação da IA', () => {
  beforeEach(() => vi.clearAllMocks());

  it('🔴 o caso A3: pediu_contato=sim + classificacao_final=Indefinido → vai pro PORTÃO, não pra Descartado', async () => {
    const { service, queue } = setup({
      pediu_contato: 'sim',
      classificacao_final: 'Indefinido',
    });

    await service.executarPasso('exec-1', 'no-roteador', 'job-1');

    expect(proximoNo(queue)).toBe('no-portao');
    expect(proximoNo(queue)).not.toBe(DESCARTADO);
  });

  it('sem o pedido, o roteador decide como sempre (Indefinido → Descartado)', async () => {
    const { service, queue } = setup({ classificacao_final: 'Indefinido' });

    await service.executarPasso('exec-1', 'no-roteador', 'job-1');

    expect(proximoNo(queue)).toBe(DESCARTADO);
  });

  it('"nao" não é pedido: só valores afirmativos desviam', async () => {
    const { service, queue } = setup({
      pediu_contato: 'nao',
      classificacao_final: 'Indefinido',
    });

    await service.executarPasso('exec-1', 'no-roteador', 'job-1');

    expect(proximoNo(queue)).toBe(DESCARTADO);
  });

  it('desvia UMA vez: execução que já desviou segue o roteamento normal (sem laço)', async () => {
    const { service, prisma, queue } = setup({
      pediu_contato: 'sim',
      classificacao_final: 'Indefinido',
    });
    // A marca vive no CONTEXTO da execução (é o que sobrevive entre passos).
    prisma.fluxoExecucao.findUnique.mockResolvedValue({
      id: 'exec-1',
      fluxoId: 'fluxo-t1',
      empresaId: 'emp-1',
      status: 'EM_EXECUCAO',
      contexto: { leadId: 'lead-1', _desviouPedidoExplicito: true },
      jobId: null,
      iniciadoEm: null,
      terminouEm: null,
      erroMsg: null,
    });

    await service.executarPasso('exec-1', 'no-roteador', 'job-1');

    expect(proximoNo(queue)).toBe(DESCARTADO);
  });

  it('marca o desvio no contexto — é o que garante a passada única', async () => {
    const { service, prisma } = setup({
      pediu_contato: 'sim',
      classificacao_final: 'Indefinido',
    });

    await service.executarPasso('exec-1', 'no-roteador', 'job-1');

    const gravado = prisma.fluxoExecucao.update.mock.calls
      .map((c) => (c[0] as { data?: { contexto?: Record<string, unknown> } }).data?.contexto)
      .find((c) => c && '_desviouPedidoExplicito' in c);
    expect(gravado?._desviouPedidoExplicito).toBe(true);
  });

  it('fluxo SEM portão pro sinal: nada muda (o motor não inventa destino)', async () => {
    const { service, prisma, queue } = setup({
      pediu_contato: 'sim',
      classificacao_final: 'Indefinido',
    });
    prisma.fluxoNo.findMany.mockResolvedValue([ROTEADOR]); // só o roteador

    await service.executarPasso('exec-1', 'no-roteador', 'job-1');

    expect(proximoNo(queue)).toBe(DESCARTADO);
  });
});
