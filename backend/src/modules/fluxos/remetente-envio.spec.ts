import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * O remetente no motor: a regra pura está no util; aqui se prova que ela chega
 * ao ENVIO, e que a validação do override falha ALTO em vez de cair calado pro
 * número da empresa — mandar do número errado é pior que não mandar, porque
 * ninguém percebe.
 */
function makeService(opts: {
  config: Record<string, unknown>;
  contexto?: Record<string, unknown>;
  usuarioExiste?: boolean;
  instanciaOk?: boolean;
}) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto: opts.contexto ?? {},
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'MENSAGEM_CANAL' }) },
    fluxoNo: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'no-1',
        fluxoId: 'fluxo-1',
        tipo: 'ACAO',
        acaoTipo: 'ENVIAR_WHATSAPP',
        titulo: 'Enviar WhatsApp',
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
    usuario: {
      findFirst: vi
        .fn()
        .mockResolvedValue(opts.usuarioExiste === false ? null : { id: 'rep-1', nome: 'Leandro' }),
    },
    lead: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'lead-1',
        contatoTelefone: '5511988887777',
        ultimaMensagemEm: new Date(),
      }),
    },
    cliente: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const whatsapp = {
    enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }),
    enviarMidia: vi.fn().mockResolvedValue({ externalId: 'wa-2' }),
    estaDisponivel: vi.fn().mockResolvedValue(opts.instanciaOk !== false),
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
  );
  return { service, prisma, whatsapp };
}

const NUMERO = { destinatarioModo: 'numero', destinatarioNumero: '5511999999999', mensagem: 'oi' };

describe('remetente do ENVIAR_WHATSAPP', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aviso interno (modo numero) NÃO herda o dono da conversa', async () => {
    const { service, whatsapp } = makeService({
      config: { destinatarioModo: 'numero', destinatarioNumero: '5511988887777', mensagem: 'oi' },
      contexto: { proprietarioId: 'rep-1' },
    });
    // Execução veio da conversa do rep, mas o destino é número fixo: sairia do
    // celular dele um recado que não é resposta a ninguém.
    await service.executarPasso('exec-1', 'no-1', 'job-1');
    expect(whatsapp.enviarTexto.mock.calls[0][3]).not.toHaveProperty('proprietarioId');
  });

  it('modo LEAD numa conversa do rep: herda o dono da conversa', async () => {
    const { service, whatsapp } = makeService({
      config: { destinatarioModo: 'lead', mensagem: 'oi' },
      contexto: { proprietarioId: 'rep-1', leadId: 'lead-1' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    const ctx = whatsapp.enviarTexto.mock.calls[0]?.[3] as { proprietarioId?: string } | undefined;
    expect(ctx?.proprietarioId).toBe('rep-1');
  });

  it('override explícito manda pela instância escolhida, mesmo em aviso interno', async () => {
    const { service, whatsapp } = makeService({
      config: { ...NUMERO, remetenteUsuarioId: 'rep-1' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(
      (whatsapp.enviarTexto.mock.calls[0][3] as { proprietarioId?: string }).proprietarioId,
    ).toBe('rep-1');
  });

  it('override de usuário de OUTRA empresa: falha e NÃO envia', async () => {
    const { service, whatsapp, prisma } = makeService({
      config: { ...NUMERO, remetenteUsuarioId: 'rep-de-outro-tenant' },
      usuarioExiste: false,
    });

    await expect(service.executarPasso('exec-1', 'no-1', 'job-1')).rejects.toThrow(
      /não pertence a esta empresa/i,
    );
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    // O passo é registrado como FALHOU, com o motivo — não some.
    expect(prisma.fluxoExecucaoLog.create).toHaveBeenCalled();
  });

  it('WhatsApp pessoal desconectado: falha em vez de sair pela empresa', async () => {
    // O pior desfecho seria mandar do número errado calado. Melhor falhar.
    const { service, whatsapp } = makeService({
      config: { ...NUMERO, remetenteUsuarioId: 'rep-1' },
      instanciaOk: false,
    });

    await expect(service.executarPasso('exec-1', 'no-1', 'job-1')).rejects.toThrow(
      /não está conectado/i,
    );
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('sem dono e sem override: segue pela empresa (comportamento de sempre)', async () => {
    const { service, whatsapp } = makeService({ config: NUMERO });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    expect(whatsapp.enviarTexto.mock.calls[0][3]).not.toHaveProperty('proprietarioId');
  });

  it('a origem do remetente fica no output do passo (auditoria)', async () => {
    const { service, prisma } = makeService({
      config: { ...NUMERO, remetenteUsuarioId: 'rep-1' },
    });

    await service.executarPasso('exec-1', 'no-1', 'job-1');

    const log = prisma.fluxoExecucaoLog.create.mock.calls[0][0] as {
      data: { output: { remetente?: string } };
    };
    expect(log.data.output.remetente).toBe('configurado');
  });
});
