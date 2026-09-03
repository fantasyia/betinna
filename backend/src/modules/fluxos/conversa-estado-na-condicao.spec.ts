import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoExecutorService } from './fluxo-executor.service';

vi.mock('@shared/utils/safe-request', () => ({
  safeRequest: vi.fn(),
  SsrfBlockedError: class extends Error {},
}));

/**
 * `CONDICAO` precisa conseguir perguntar "ainda posso falar com essa pessoa?".
 *
 * O caso que abriu isto: o P3 agradece a entrega em D+2, o cliente responde que
 * o produto veio com defeito, um atendente assume a conversa — e dez dias
 * depois o D+12 dispara "conseguiu instalar?" por cima dele. `ENVIAR_WHATSAPP`
 * não consulta estado nenhum, então a proteção só pode morar numa condição
 * antes; e `ctx.conversa`, apesar do nome, era montado a partir das variáveis
 * do LEAD — `botLigado` e `precisaHumano` nunca chegavam ao contexto.
 */
const prismaMock = (conv: Record<string, unknown> | null, botDaEmpresa = true) => ({
  empresa: {
    findUnique: vi.fn().mockResolvedValue({ nome: 'Somatec', botWhatsappAtivo: botDaEmpresa }),
  },
  variavelCustomizada: { findMany: vi.fn().mockResolvedValue([]) },
  lead: {
    findFirst: vi.fn().mockResolvedValue({
      nome: 'Fulano',
      contatoNome: 'Fulano',
      contatoTelefone: '+5511999998888',
      variaveis: {},
      tags: [],
    }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  conversation: { findFirst: vi.fn().mockResolvedValue(conv) },
});

function build(conv: Record<string, unknown> | null, botDaEmpresa = true) {
  const prisma = prismaMock(conv, botDaEmpresa);
  const svc = new FluxoExecutorService(
    prisma as never,
    { get: () => 'test', isProduction: false } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const enriquecer = (ctx: Record<string, unknown>) =>
    (
      svc as unknown as {
        enriquecerContexto: (c: unknown, e: string) => Promise<Record<string, unknown>>;
      }
    ).enriquecerContexto(ctx, 'emp-1');
  const conversa = async (ctx: Record<string, unknown> = { leadId: 'lead-1' }) =>
    (await enriquecer(ctx)).conversa as Record<string, unknown>;
  return { svc, prisma, enriquecer, conversa };
}

describe('estado da conversa no contexto da CONDICAO', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bot pausado na conversa → bot_ligado false (é o desvio que cala a régua)', async () => {
    const { conversa } = build({ botLigado: false, precisaHumano: false, proprietarioId: null });

    expect((await conversa()).bot_ligado).toBe(false);
  });

  it('conversa NOVA (botLigado null) resolve como LIGADO pelo default da empresa', async () => {
    // O campo da conversa só deixa de ser null quando alguém mexe. Ler null cru
    // concluiria "bot desligado" em toda conversa virgem — o oposto da verdade.
    const { conversa } = build(
      { botLigado: null, precisaHumano: null, proprietarioId: null },
      true,
    );

    expect((await conversa()).bot_ligado).toBe(true);
  });

  it('conversa nova com o bot DESLIGADO na empresa → bot_ligado false', async () => {
    const { conversa } = build(
      { botLigado: null, precisaHumano: null, proprietarioId: null },
      false,
    );

    expect((await conversa()).bot_ligado).toBe(false);
  });

  it('atendente pediu humano → precisa_humano true', async () => {
    const { conversa } = build({ botLigado: true, precisaHumano: true, proprietarioId: null });

    expect((await conversa()).precisa_humano).toBe(true);
  });

  it('conversa de WhatsApp pessoal de rep → tem_dono true', async () => {
    const { conversa } = build({ botLigado: true, precisaHumano: false, proprietarioId: 'user-1' });

    expect((await conversa()).tem_dono).toBe(true);
  });

  it('sem conversa nenhuma vale o default da empresa — é o estado que ela teria ao nascer', async () => {
    const { conversa } = build(null, true);

    expect(await conversa()).toMatchObject({
      bot_ligado: true,
      precisa_humano: false,
      tem_dono: false,
    });
  });

  it('com conversationId no contexto, olha ELA — não a mais recente do lead', async () => {
    // Proteger uma conversa e mandar a mensagem em outra não protege nada.
    const { prisma, conversa } = build({
      botLigado: false,
      precisaHumano: false,
      proprietarioId: null,
    });

    await conversa({ leadId: 'lead-1', conversationId: 'conv-7' });

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-7', empresaId: 'emp-1' } }),
    );
  });

  it('sem conversationId, procura a conversa da EMPRESA do lead (proprietarioId null)', async () => {
    const { prisma, conversa } = build({
      botLigado: true,
      precisaHumano: false,
      proprietarioId: null,
    });

    await conversa({ leadId: 'lead-1' });

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', leadId: 'lead-1', canal: 'WHATSAPP', proprietarioId: null },
      }),
    );
  });

  it('variável do LEAD com o mesmo nome NÃO mascara o estado real', async () => {
    const { prisma, conversa } = build({
      botLigado: false,
      precisaHumano: false,
      proprietarioId: null,
    });
    prisma.lead.findFirst.mockResolvedValue({
      nome: 'Fulano',
      contatoNome: 'Fulano',
      contatoTelefone: '+5511999998888',
      variaveis: { bot_ligado: 'sim' },
      tags: [],
    });

    expect((await conversa()).bot_ligado).toBe(false);
  });

  it('falha de banco não cala a régua — cai no default "pode falar"', async () => {
    const { prisma, conversa } = build(null, true);
    prisma.conversation.findFirst.mockRejectedValue(new Error('banco fora'));

    expect((await conversa()).bot_ligado).toBe(true);
  });
});
