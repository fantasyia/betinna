import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * O TEXTO FIXO do fluxo (`ENVIAR_WHATSAPP`) ganhou ritmo PRÓPRIO.
 *
 * 🔴 O que isto conserta, medido em 17/09 numa rajada real: o
 * `delayRespostaSegundos` da persona vale só pros nós de IA. A IA leva 5–13s só
 * pra compor, mais o delay; este nó ia direto pro `enviarTexto` e respondia em
 * ~1s. E no caminho do cliente que VOLTA (`triado` + `mb-explicado`) o texto
 * fixo é a PRIMEIRA voz — então todo retorno era atendido instantaneamente
 * enquanto o resto da conversa andava no ritmo da persona.
 *
 * ⏱️ Os testes usam timers FALSOS. Com timer real, "espera 3s" viraria 3
 * segundos de suíte por caso — e um teste lento é um teste que alguém desliga.
 */
function makeService(opts: {
  config: Record<string, unknown>;
  ritmo?: { delayTextoFixoSegundos?: number; mostrarDigitando?: boolean };
  personaQuebra?: boolean;
  instanciaOk?: boolean;
}) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto: { leadId: 'lead-1' },
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'LEAD_ETAPA_MUDOU' }) },
    fluxoNo: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'no-1',
        fluxoId: 'fluxo-1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'TEXTO FIXO — pergunta a tensão',
        config: opts.config,
      }),
    },
    fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
    fluxoExecucaoLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoStepClaim: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    usuario: { findFirst: vi.fn().mockResolvedValue({ id: 'rep-1', nome: 'Leandro' }) },
    lead: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'lead-1',
        contatoTelefone: '5511988887777',
        ultimaMensagemEm: new Date(),
        tags: [],
        variaveis: {},
      }),
    },
    cliente: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const whatsapp = {
    enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }),
    enviarMidia: vi.fn().mockResolvedValue({ externalId: 'wa-2' }),
    estaDisponivel: vi.fn().mockResolvedValue(opts.instanciaOk !== false),
    enviarPresenca: vi.fn().mockResolvedValue(undefined),
  };

  const persona = {
    obterConfigBot: opts.personaQuebra
      ? vi.fn().mockRejectedValue(new Error('persona fora do ar'))
      : vi.fn().mockResolvedValue({
          delayTextoFixoSegundos: opts.ritmo?.delayTextoFixoSegundos ?? 0,
          mostrarDigitando: opts.ritmo?.mostrarDigitando ?? false,
        }),
  };

  const service = new FluxoExecutorService(
    prisma as never,
    { get: vi.fn().mockReturnValue('') } as never,
    {} as never,
    whatsapp as never,
    { enviarHtmlLivre: vi.fn() } as never,
    { iniciar: vi.fn().mockResolvedValue({ aguardando: false }) } as never,
    { disparar: vi.fn() } as never,
    { aguardarSlot: vi.fn(), esperaAntesDoProativoMs: vi.fn().mockResolvedValue(0) } as never,
    { marcarDesconectado: vi.fn() } as never,
    { add: vi.fn().mockResolvedValue({ id: 'j' }) } as never,
    { criarCardsDeTarefa: vi.fn(async () => ({})) } as never,
    { suprimido: vi.fn(async () => false) } as never,
    { criar: vi.fn() } as never,
    { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never,
    { executar: vi.fn() } as never,
    persona as never,
  );
  return { service, prisma, whatsapp, persona };
}

const LEAD = { destinatarioModo: 'lead', mensagem: 'E qual o padrão de energia aí?' };

/** Roda o passo com timers falsos e adianta o relógio até ele terminar. */
async function rodar(service: FluxoExecutorService): Promise<void> {
  const p = service.executarPasso('exec-1', 'no-1', 'job-1');
  await vi.runAllTimersAsync();
  await p;
}

describe('ritmo do TEXTO FIXO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('com delay configurado, ESPERA antes de mandar', async () => {
    const { service, whatsapp } = makeService({
      config: LEAD,
      ritmo: { delayTextoFixoSegundos: 3 },
    });

    const p = service.executarPasso('exec-1', 'no-1', 'job-1');
    // Deixa o caminho até a espera rodar (resolve promessas pendentes), mas NÃO
    // adianta o relógio: se o delay não existisse, a mensagem já teria saído.
    await vi.advanceTimersByTimeAsync(2000);
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await p;
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('sem delay (0 = o de sempre) manda na hora', async () => {
    const { service, whatsapp } = makeService({
      config: LEAD,
      ritmo: { delayTextoFixoSegundos: 0 },
    });

    const p = service.executarPasso('exec-1', 'no-1', 'job-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await p;
  });

  it('com "digitando" ligado, mostra composing pela duração da espera e depois paused', async () => {
    const { service, whatsapp } = makeService({
      config: LEAD,
      ritmo: { delayTextoFixoSegundos: 3, mostrarDigitando: true },
    });

    await rodar(service);

    const estados = whatsapp.enviarPresenca.mock.calls.map((c) => c[2]);
    expect(estados).toEqual(['composing', 'paused']);
    // A duração vai junto: é ela que segura o "digitando" na tela pelo tempo da
    // espera. Omitir o campo é o que derrubava a instância (LOGOUT de 24/08).
    expect(whatsapp.enviarPresenca.mock.calls[0][3]).toBe(3000);
  });

  it('sem "digitando", espera calada — nenhuma presença é enviada', async () => {
    const { service, whatsapp } = makeService({
      config: LEAD,
      ritmo: { delayTextoFixoSegundos: 3, mostrarDigitando: false },
    });

    await rodar(service);

    expect(whatsapp.enviarPresenca).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  /**
   * 🔴 A espera vem DEPOIS do gate de disponibilidade. Com a instância fora do
   * ar o passo tem que falhar rápido e cair no reagendamento — não segurar um
   * job da fila por N segundos pra descobrir isso no fim.
   */
  it('instância fora do ar: falha sem gastar a espera', async () => {
    const { service, whatsapp } = makeService({
      config: LEAD,
      ritmo: { delayTextoFixoSegundos: 3, mostrarDigitando: true },
      instanciaOk: false,
    });

    // O passo REJEITA de propósito (`WhatsappIndisponivelError` cai no
    // reagendamento). O que se prova aqui é que ele rejeita SEM ter esperado.
    const p = service.executarPasso('exec-1', 'no-1', 'job-1');
    await expect(p).rejects.toThrow(/não está conectado/);

    expect(whatsapp.enviarPresenca).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  /**
   * Ritmo é enfeite. Se a leitura da persona falhar, a mensagem SAI — emudecer
   * o fluxo porque a config não respondeu seria trocar um defeito de estilo por
   * um de entrega.
   */
  it('persona indisponível: manda assim mesmo, sem espera', async () => {
    const { service, whatsapp } = makeService({ config: LEAD, personaQuebra: true });

    const p = service.executarPasso('exec-1', 'no-1', 'job-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await p;
  });

  /**
   * Quando quem manda é o WhatsApp PESSOAL de um rep, o ritmo é o do bot DELE:
   * o número é dele, e a conversa tem que soar igual venha do fluxo ou do bot.
   */
  it('remetente pessoal usa a persona do REP, não a da empresa', async () => {
    const { service, persona } = makeService({
      config: { ...LEAD, remetenteUsuarioId: 'rep-1' },
      ritmo: { delayTextoFixoSegundos: 3 },
    });

    await rodar(service);

    expect(persona.obterConfigBot).toHaveBeenCalledWith('emp-1', 'rep-1');
  });

  /**
   * 🔴 A presença tem que sair pela MESMA instância do envio.
   *
   * Sem o `proprietarioId`, o "digitando…" iria pela instância da EMPRESA numa
   * conversa que é do WhatsApp PESSOAL do rep — a empresa nem conhece esse peer.
   * O envio já resolvia isso pelo `ctxEnvio`; a presença é uma porta NOVA, e
   * essa é a única coisa que ela pode errar sozinha.
   */
  it('a presença sai pela instância do DONO do envio, igual à mensagem', async () => {
    const { service, whatsapp } = makeService({
      config: { ...LEAD, remetenteUsuarioId: 'rep-1' },
      ritmo: { delayTextoFixoSegundos: 3, mostrarDigitando: true },
    });

    await rodar(service);

    // 5º argumento de `enviarPresenca` = proprietarioId. Nos DOIS estados.
    for (const chamada of whatsapp.enviarPresenca.mock.calls) {
      expect(chamada[4]).toBe('rep-1');
    }
    expect(
      (whatsapp.enviarTexto.mock.calls[0][3] as { proprietarioId?: string }).proprietarioId,
    ).toBe('rep-1');
  });

  /**
   * ⚠️ O `paused` NÃO manda duração — e é justamente aí que mora o defeito de
   * 24/08: omitir o campo `delay` devolvia 400 do Evolution e, um segundo
   * depois, LOGOUT da instância. Quem garante o `delay: 0` é o
   * `EvolutionService.enviarPresenca`; este teste fixa que a camada de cima
   * passa `undefined` (e não, digamos, um número errado), pra o contrato entre
   * as duas continuar sendo o que aquele conserto assumiu.
   */
  it('o "paused" não inventa duração — quem põe o delay 0 é a camada do Evolution', async () => {
    const { service, whatsapp } = makeService({
      config: LEAD,
      ritmo: { delayTextoFixoSegundos: 3, mostrarDigitando: true },
    });

    await rodar(service);

    const paused = whatsapp.enviarPresenca.mock.calls.find((c) => c[2] === 'paused');
    expect(paused).toBeDefined();
    expect(paused?.[3]).toBeUndefined();
  });
});
