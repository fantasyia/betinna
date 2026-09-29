import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn().mockResolvedValue({ status: 200 }),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

/**
 * Teste de fluxo com "enviar de verdade" pedido por TOKEN de API (MCP).
 *
 * Um texto malicioso lido pelo agente (mensagem de cliente, e-mail) podia levar
 * o modelo a montar um fluxo e testá-lo "de verdade" numa conversa real —
 * mensagem saindo pro cliente pelo número da empresa. A bancada de teste usa o
 * mesmo caminho, mas só pra dentro: linha de teste → número da empresa. A regra
 * é essa: por token, o envio real só alcança número CONECTADO da própria
 * empresa. Auditoria 29/09/2026.
 */
const EMPRESA_WA = '5511991616235@s.whatsapp.net';

const waNo = (config: Record<string, unknown>) => ({
  id: 'no-wa',
  fluxoId: 'fluxo-1',
  tipo: 'ACAO',
  acaoTipo: 'ENVIAR_WHATSAPP',
  titulo: 'Enviar WhatsApp',
  config: { mensagem: 'oi', ...config },
});

function makeService(contexto: Record<string, unknown>, no: ReturnType<typeof waNo>) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'exec-1',
        fluxoId: 'fluxo-1',
        empresaId: 'emp-1',
        status: 'EM_EXECUCAO',
        contexto,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    fluxoNo: { findUnique: vi.fn().mockResolvedValue(no) },
    fluxo: { findUnique: vi.fn().mockResolvedValue({ triggerTipo: 'LEAD_CRIADO' }) },
    fluxoEdge: { findMany: vi.fn().mockResolvedValue([]) },
    fluxoExecucaoLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    fluxoStepClaim: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    evolutionInstancia: {
      findMany: vi.fn().mockResolvedValue([{ ownerJid: EMPRESA_WA }]),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const whatsapp = {
    estaDisponivel: vi.fn().mockResolvedValue(true),
    enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }),
  };
  const service = new FluxoExecutorService(
    prisma as never,
    { get: vi.fn().mockReturnValue('') } as never,
    {} as never,
    whatsapp as never,
    { enviarHtmlLivre: vi.fn() } as never,
    { iniciar: vi.fn() } as never,
    { disparar: vi.fn() } as never,
    { aguardarSlot: vi.fn(), esperaAntesDoProativoMs: vi.fn().mockResolvedValue(0) } as never,
    { marcarDesconectado: vi.fn() } as never,
    { add: vi.fn().mockResolvedValue({ id: 'job-x' }) } as never,
    { criarCardsDeTarefa: vi.fn(async () => ({})) } as never,
    { suprimido: vi.fn(async () => false) } as never,
    { criarParaUsuario: vi.fn(), criarParaRole: vi.fn() } as never,
    { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never,
    { executar: vi.fn() } as never,
    {
      obterConfigBot: vi
        .fn()
        .mockResolvedValue({ delayTextoFixoSegundos: 0, mostrarDigitando: false }),
    } as never,
  );
  return { service, whatsapp, prisma };
}

const TESTE_REAL_VIA_TOKEN = { _teste: true, _testeEnviaDeVerdade: true, _testeViaToken: true };

describe('teste de fluxo por token de API — envio real só pra dentro da empresa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('número de CLIENTE: não envia e o passo falha (visível)', async () => {
    const { service, whatsapp } = makeService(
      TESTE_REAL_VIA_TOKEN,
      waNo({ destinatarioModo: 'numero', destinatarioNumero: '5511988887777' }),
    );

    await expect(service.executarPasso('exec-1', 'no-wa', 'job-1')).rejects.toThrow(
      /própria empresa/,
    );
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('número CONECTADO da empresa (o que a bancada usa): envia', async () => {
    const { service, whatsapp } = makeService(
      TESTE_REAL_VIA_TOKEN,
      waNo({ destinatarioModo: 'numero', destinatarioNumero: '5511991616235' }),
    );

    await service.executarPasso('exec-1', 'no-wa', 'job-1');
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('teste pela TELA (sem token) não ganha a trava: número de fora envia', async () => {
    const { service, whatsapp } = makeService(
      { _teste: true, _testeEnviaDeVerdade: true },
      waNo({ destinatarioModo: 'numero', destinatarioNumero: '5511988887777' }),
    );

    await service.executarPasso('exec-1', 'no-wa', 'job-1');
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });
});
