import { describe, expect, it, vi } from 'vitest';
import { turnoDeIaAberto } from './turno-ia-aberto.util';

/**
 * ⛔ A JANELA ENTRE COMEÇAR E ESTACIONAR NO NÓ DE IA — o que NÃO pode entrar aqui.
 *
 * Este arquivo nasceu como "consertei a rajada". Ele agora trava o contrário: a
 * tentativa de fechar aquela janela alargando esta função, que quebrou produção
 * duas vezes em 09/09, cada vez com efeito pior que o anterior.
 *
 *   antes      3 mensagens seguidas → 3 vezes a mesma pergunta
 *   1ddb08b    → nenhuma resposta por 30 min (o bus segurava e redisparava)
 *   5783164    → nenhuma resposta, ponto (o RT encerrava, sem redisparo)
 *
 * O proxy que eu usei — "existe execução viva num fluxo que TEM nó de IA" —
 * erra de duas formas:
 *
 *  1. conta fluxo que JÁ PASSOU do nó (o T1 pula a IA quando o lead já foi
 *     triado, mas o fluxo dele "tem" o nó);
 *  2. conta A PRÓPRIA execução que pergunta (o RT tem um nó de IA, então ao
 *     avaliar `{{conversa.ia_aguardando}}` ele se enxerga e responde "Sim").
 *
 * A lição não é "faltou excluir a própria execução": é que "o fluxo tem um nó de
 * IA" não responde "alguém está conduzindo AGORA". Quem for fechar a janela
 * precisa de um sinal de POSIÇÃO — a execução ainda vai chegar ao nó? — e não de
 * existência.
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

describe('definição de turno de IA aberto', () => {
  it('conta execução parada NO nó de IA e turno em processamento', async () => {
    const { prisma, sql } = capturarSql();

    await turnoDeIaAberto(prisma as never, 'emp-1', { conversationId: 'conv-1' });

    const q = sql().replace(/\s+/g, ' ');
    expect(q).toContain('n."acaoTipo" = \'CONVERSAR_IA\'');
    expect(q).toContain('e."processandoTurno" = true');
  });

  it('NÃO conta execução só por o FLUXO dela ter um nó de IA', async () => {
    // Foi este `EXISTS` que quebrou produção duas vezes. Ele conta o T1 que já
    // passou da IA, e conta a própria execução que está perguntando.
    const { prisma, sql } = capturarSql();

    await turnoDeIaAberto(prisma as never, 'emp-1', { conversationId: 'conv-1' });

    const q = sql().replace(/\s+/g, ' ');
    expect(q).not.toContain('EXISTS');
    expect(q).not.toContain("e.status IN ('PENDENTE', 'EM_EXECUCAO')");
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
