import { describe, expect, it, vi } from 'vitest';
import { turnoDeIaAberto } from './turno-ia-aberto.util';

/**
 * Três mensagens seguidas não podem virar três vezes a mesma pergunta.
 *
 * Medido em 09/09 com uma rajada de 3 mensagens:
 *
 *   20:00:18  cliente → "opa, e o disjuntor geral aqui e de 63A"
 *   20:00:21  cliente → "a tensao e 220V"
 *   20:00:25  BOT     → "Consegue olhar no quadro de luz…? Qual aparece?"
 *   20:00:34  BOT     → "Consegue olhar no quadro de luz…? Qual aparece?"
 *   20:00:39  BOT     → "Consegue olhar no quadro de luz…? Qual aparece?"
 *
 * A mesma pergunta três vezes, para quem já tinha respondido na primeira linha.
 * E as variáveis do lead no fim: `{}` — nada do que ele escreveu foi guardado.
 *
 * A causa era uma JANELA: a 2ª mensagem chega enquanto o consultivo ainda
 * caminha rumo ao nó de IA. Sem `aguardandoNoId` e sem `processandoTurno`, o
 * guard dizia "ninguém conduzindo", o RT concluía "sumiu e voltou" de quem
 * estava falando naquele instante, e o consultivo recomeçava do topo.
 *
 * Mandar três mensagens seguidas é o que qualquer pessoa faz no WhatsApp — o
 * defeito estava no caso NORMAL, não no raro.
 */
const capturarSql = () => {
  let sql = '';
  const prisma = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      sql = strings.join('?');
      return [];
    }),
  };
  return { prisma, sql: () => sql };
};

describe('a janela entre começar o fluxo e estacionar no nó de IA', () => {
  it('execução CAMINHANDO conta como turno aberto', async () => {
    const { prisma, sql } = capturarSql();

    await turnoDeIaAberto(prisma as never, 'emp-1', { conversationId: 'conv-1' });

    const q = sql().replace(/\s+/g, ' ');
    expect(q).toContain("e.status IN ('PENDENTE', 'EM_EXECUCAO')");
  });

  it('mas SÓ em fluxo que tem nó de IA', async () => {
    // Um fluxo de aviso (P1, P2) caminhando não conduz conversa nenhuma — se
    // contasse, um aviso de rastreio calaria o atendimento.
    const { prisma, sql } = capturarSql();

    await turnoDeIaAberto(prisma as never, 'emp-1', { conversationId: 'conv-1' });

    const q = sql().replace(/\s+/g, ' ');
    expect(q).toContain('EXISTS');
    expect(q).toContain('fn."fluxoId" = e."fluxoId" AND fn."acaoTipo" = \'CONVERSAR_IA\'');
  });

  it('os dois sinais antigos continuam valendo', async () => {
    // Parado NO nó de IA (esperando o cliente) e lock do turno tomado (a IA
    // está gerando agora). A janela nova SOMA, não substitui.
    const { prisma, sql } = capturarSql();

    await turnoDeIaAberto(prisma as never, 'emp-1', { leadId: 'lead-1' });

    const q = sql().replace(/\s+/g, ' ');
    expect(q).toContain('n."acaoTipo" = \'CONVERSAR_IA\'');
    expect(q).toContain('e."processandoTurno" = true');
  });

  it('sem conversa e sem lead, não pergunta ao banco', async () => {
    const { prisma } = capturarSql();

    await expect(turnoDeIaAberto(prisma as never, 'emp-1', {})).resolves.toBe(false);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('linha encontrada = alguém conduzindo', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ id: 'exec-1' }]) };

    await expect(
      turnoDeIaAberto(prisma as never, 'emp-1', { conversationId: 'conv-1' }),
    ).resolves.toBe(true);
  });
});
