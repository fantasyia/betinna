import { describe, expect, it, vi } from 'vitest';
import { ExtrairVariaveisService } from './extrair-variaveis.service';
import type { ExtrairVariaveisConfig } from './fluxo-executor.types';

/**
 * O card de 17/09: quem VOLTA e já diz a tensão na primeira mensagem é
 * perguntado assim mesmo, porque no C1 o único nó que extrai é a "IA — acolhe" e
 * o caminho de retorno pula ela pela tag `mb-explicado`. Entre a condição e o
 * portão "Já sabemos a tensão?" não roda nó nenhum.
 *
 * As falas aqui são as mesmas transcrições reais de 09-11/09 usadas no spec da
 * rede determinística — não exemplos inventados.
 */
const VARIAVEIS = [
  'corrente_quadro',
  'tensao_rede: 127V | 220V | 380V | 440V | nao sei',
  'perfil_cliente: comercio | residencia | condominio | carro_eletrico',
  'o_que_proteger',
  'origem_corrente: disjuntor | conta | estimativa',
];

const PERGUNTA_TENSAO = 'E qual o padrão de energia aí, 110V, 220V ou 380V?';

type Msg = { direction: 'INBOUND' | 'OUTBOUND'; conteudo: string };

/**
 * `janela` vai na ordem que o Prisma devolve: `criadoEm desc`, ou seja, a
 * mensagem MAIS NOVA primeiro. Escrever os testes nessa ordem é chato de ler,
 * então aqui eles passam em ordem cronológica e a gente inverte.
 */
function build(cronologico: Msg[], variaveisDoLead: Record<string, unknown> = {}) {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = {
    conversation: { findFirst: vi.fn().mockResolvedValue({ id: 'conv-1' }) },
    message: { findMany: vi.fn().mockResolvedValue([...cronologico].reverse()) },
    lead: { findFirst: vi.fn().mockResolvedValue({ variaveis: variaveisDoLead }) },
    $executeRaw: executeRaw,
  };
  const svc = new ExtrairVariaveisService(prisma as never);
  return { svc, prisma, executeRaw };
}

/**
 * O `$executeRaw` é template tag: chega como (strings, ...values). O patch JSON
 * é o primeiro valor interpolado.
 */
function patchGravado(executeRaw: ReturnType<typeof vi.fn>): Record<string, string> {
  expect(executeRaw).toHaveBeenCalledTimes(1);
  const valores = executeRaw.mock.calls[0].slice(1);
  const json = valores.find((v: unknown) => typeof v === 'string' && v.startsWith('{'));
  return JSON.parse(json as string) as Record<string, string>;
}

const cfg = (extra: Partial<ExtrairVariaveisConfig> = {}): ExtrairVariaveisConfig => ({
  variaveis: VARIAVEIS,
  ...extra,
});

const ctx = { leadId: 'lead-1' };

describe('EXTRAIR_VARIAVEIS — o caso do card', () => {
  it('lead que VOLTA e já diz tudo na 1ª mensagem: grava sem perguntar', async () => {
    const { svc, executeRaw } = build([
      {
        direction: 'INBOUND',
        conteudo:
          'queimou o freezer da minha padaria. o disjuntor geral aqui e de 63A e a tensao e 220V',
      },
    ]);

    const r = await svc.executar(cfg(), ctx, 'emp-1');

    // Os três campos que os portões do C1 leem — o que decide se o TEXTO FIXO
    // vai perguntar de novo o que a pessoa acabou de dizer.
    expect(patchGravado(executeRaw)).toEqual({
      corrente_quadro: '63',
      tensao_rede: '220V',
      perfil_cliente: 'comercio',
    });
    expect(r.gravadas).toEqual(
      expect.arrayContaining(['tensao_rede', 'corrente_quadro', 'perfil_cliente']),
    );
  });

  it('NÃO sobrescreve o que o lead já tinha — só preenche lacuna', async () => {
    const { svc, executeRaw } = build(
      [
        {
          direction: 'INBOUND',
          conteudo: 'o disjuntor geral aqui e de 63A e a tensao e 220V',
        },
      ],
      { tensao_rede: '380V' },
    );

    await svc.executar(cfg(), ctx, 'emp-1');

    const patch = patchGravado(executeRaw);
    expect(patch.tensao_rede).toBeUndefined();
    expect(patch.corrente_quadro).toBe('63');
  });

  it('não escreve nada quando o lead já tem tudo (nenhum UPDATE)', async () => {
    const { svc, executeRaw } = build([{ direction: 'INBOUND', conteudo: 'a tensao e 220V' }], {
      tensao_rede: '220V',
    });

    const r = await svc.executar(
      cfg({ variaveis: ['tensao_rede: 127V | 220V | 380V'] }),
      ctx,
      'emp-1',
    );

    expect(executeRaw).not.toHaveBeenCalled();
    expect(r.gravadas).toEqual([]);
  });
});

describe('EXTRAIR_VARIAVEIS — qual mensagem vale', () => {
  it('mensagem MAIS NOVA ganha da mais velha', async () => {
    const { svc, executeRaw } = build([
      { direction: 'INBOUND', conteudo: 'a rede aqui e 380 trifasico' },
      { direction: 'INBOUND', conteudo: 'me enganei, a tensao e 220V mesmo' },
    ]);

    await svc.executar(cfg(), ctx, 'emp-1');

    expect(patchGravado(executeRaw).tensao_rede).toBe('220V');
  });

  it('número solto vale DEPOIS da pergunta do bot', async () => {
    const { svc, executeRaw } = build([
      { direction: 'OUTBOUND', conteudo: PERGUNTA_TENSAO },
      { direction: 'INBOUND', conteudo: '220' },
    ]);

    await svc.executar(cfg(), ctx, 'emp-1');

    expect(patchGravado(executeRaw).tensao_rede).toBe('220V');
  });

  /**
   * 🔴 A borda que justifica o recorte por última-fala-do-bot. Um "220" pelado
   * numa mensagem ANTERIOR à pergunta não é resposta a pergunta nenhuma — é a
   * porta por onde "sao 220 clientes por dia" virou tensão nas varreduras de
   * 11/09. O convite autoriza número solto; ele não pode valer retroativo.
   */
  it('número solto ANTES da última fala do bot NÃO vira tensão', async () => {
    const { svc, executeRaw } = build([
      { direction: 'INBOUND', conteudo: '220' },
      { direction: 'OUTBOUND', conteudo: PERGUNTA_TENSAO },
    ]);

    const r = await svc.executar(cfg(), ctx, 'emp-1');

    expect(executeRaw).not.toHaveBeenCalled();
    expect(r.gravadas).toEqual([]);
  });

  it('lê no máximo `mensagens` falas do lead', async () => {
    const { svc, executeRaw, prisma } = build([
      { direction: 'INBOUND', conteudo: 'o disjuntor geral e de 63A' },
      { direction: 'INBOUND', conteudo: 'oi' },
      { direction: 'INBOUND', conteudo: 'tudo bem?' },
    ]);

    await svc.executar(cfg({ mensagens: 1 }), ctx, 'emp-1');

    expect(prisma.message.findMany).toHaveBeenCalled();
    // Só a última ("tudo bem?") foi lida — a fala com a corrente ficou fora.
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe('EXTRAIR_VARIAVEIS — não pode derrubar o fluxo', () => {
  it.each([
    ['sem lead no contexto', {}, { conv: { id: 'conv-1' } }],
    ['sem conversa', { leadId: 'lead-1' }, { conv: null }],
  ])('%s → pulado, sem lançar', async (_nome, contexto, { conv }) => {
    const prisma = {
      conversation: { findFirst: vi.fn().mockResolvedValue(conv) },
      message: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findFirst: vi.fn().mockResolvedValue({ variaveis: {} }) },
      $executeRaw: vi.fn(),
    };
    const svc = new ExtrairVariaveisService(prisma as never);

    const r = await svc.executar(cfg(), contexto, 'emp-1');

    expect(r.pulado).toBe(true);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('conversa sem nenhuma mensagem do lead → pulado', async () => {
    const { svc, executeRaw } = build([{ direction: 'OUTBOUND', conteudo: PERGUNTA_TENSAO }]);

    const r = await svc.executar(cfg(), ctx, 'emp-1');

    expect(r.pulado).toBe(true);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  /**
   * A ÚNICA coisa que este nó trata como erro. Mesma régua do CONVERSAR_IA com
   * "não falar primeiro" + "não aguardar resposta": um nó que não pode fazer
   * nada fechando VERDE esconde exatamente o defeito que ele existe pra evitar.
   */
  it('nó sem variável declarada FALHA em vez de fechar verde', async () => {
    const { svc } = build([{ direction: 'INBOUND', conteudo: 'a tensao e 220V' }]);

    await expect(svc.executar({ variaveis: [] }, ctx, 'emp-1')).rejects.toThrow(
      /nenhuma variável declarada/,
    );
  });
});

describe('EXTRAIR_VARIAVEIS — isolamento multi-tenant', () => {
  it('filtra mensagens e lead pela empresa da execução', async () => {
    const { svc, prisma } = build([{ direction: 'INBOUND', conteudo: 'a tensao e 220V' }]);

    await svc.executar(cfg(), ctx, 'emp-1');

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversation: { empresaId: 'emp-1' } }),
      }),
    );
    expect(prisma.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1', empresaId: 'emp-1' } }),
    );
  });

  /**
   * O lead pode ter conversa no WhatsApp da empresa E no pessoal de um rep. Ler
   * a do rep aqui puxaria conversa particular dele pro cadastro do lead.
   */
  it('só olha a conversa da EMPRESA (proprietarioId null)', async () => {
    const { svc, prisma } = build([{ direction: 'INBOUND', conteudo: 'a tensao e 220V' }]);

    await svc.executar(cfg(), ctx, 'emp-1');

    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ empresaId: 'emp-1', proprietarioId: null }),
      }),
    );
  });
});
