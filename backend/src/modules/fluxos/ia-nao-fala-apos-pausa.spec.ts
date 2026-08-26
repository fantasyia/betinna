import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';

/**
 * A trava final: mesmo cancelada, uma execução que já estava dentro da chamada
 * ao modelo voltava e FALAVA. Cancelar sozinho não resolve — ninguém consegue
 * interromper uma chamada HTTP no meio. O que dá pra fazer é conferir, no
 * último instante antes de mandar, se a execução ainda tem direito de falar.
 *
 * Este é o ponto ÚNICO por onde toda fala do nó de IA passa (abertura, turno e
 * aviso de teto), então a checagem aqui cobre os três.
 */
function build(statusDaExecucao: string | null) {
  const prisma = {
    fluxoExecucao: {
      findUnique: vi.fn().mockResolvedValue(statusDaExecucao ? { status: statusDaExecucao } : null),
    },
  };
  const whatsapp = { enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-1' }) };
  const pacing = { aguardarSlot: vi.fn().mockResolvedValue(undefined) };
  const svc = new ConversarIaService(
    prisma as never,
    {
      obterConfigBot: vi.fn().mockResolvedValue({ quebrarMensagens: false, maxMensagens: 3 }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    whatsapp as never,
    {} as never,
    pacing as never,
    {} as never,
    { processarMensagemEntrante: vi.fn().mockResolvedValue({}) } as never,
    {} as never,
  );
  const enviar = (execId?: string) =>
    (
      svc as unknown as {
        enviarWhatsapp: (
          e: string,
          t: string,
          txt: string,
          r?: boolean,
          k?: string,
          p?: string | null,
          x?: string,
        ) => Promise<void>;
      }
    ).enviarWhatsapp('emp-1', '+5519999998877', 'Oi, tudo bem?', true, undefined, null, execId);
  return { enviar, whatsapp, pacing, prisma };
}

describe('nó de IA não fala depois da pausa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('execução CANCELADA durante a chamada da IA → não envia', async () => {
    // O caso do T1.11: o RT pausou, e o C1 voltou 14s depois querendo falar.
    const { enviar, whatsapp, pacing } = build('CANCELADO');

    await enviar('exec-c1');

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    // Nem consome slot do pacing: mensagem que não vai sair não disputa fila.
    expect(pacing.aguardarSlot).not.toHaveBeenCalled();
  });

  it('execução viva → envia normalmente', async () => {
    const { enviar, whatsapp } = build('EM_EXECUCAO');
    await enviar('exec-c1');
    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });

  it('execução que sumiu do banco → não envia', async () => {
    const { enviar, whatsapp } = build(null);
    await enviar('exec-sumiu');
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('sem execucaoId (chamada legada) → envia, sem quebrar', async () => {
    const { enviar, whatsapp, prisma } = build('EM_EXECUCAO');
    await enviar(undefined);
    expect(prisma.fluxoExecucao.findUnique).not.toHaveBeenCalled();
    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });

  it('erro ao consultar o status NÃO cala o bot', async () => {
    // Errar pro lado de calar seria pior: a conversa em curso pararia sem
    // ninguém saber por quê. Uma fala a mais é recuperável; silêncio não.
    const { enviar, whatsapp, prisma } = build('EM_EXECUCAO');
    prisma.fluxoExecucao.findUnique.mockRejectedValue(new Error('banco fora'));

    await enviar('exec-c1');

    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });
});
