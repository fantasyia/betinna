import { describe, expect, it, vi } from 'vitest';
import { iaAFrente } from './turno-ia-aberto.util';

/**
 * `iaAFrente` — o sinal de POSIÇÃO que faltava, e o teste que as duas
 * regressões de 09/09 exigem.
 *
 * O proxy que quebrou produção respondia "o FLUXO desta execução TEM um nó de
 * IA?". Esta função responde "DAQUI, a execução ainda ALCANÇA um nó de IA?".
 * A pergunta é a diferença toda, e é isso que estes testes travam.
 *
 * A consulta é uma CTE recursiva; aqui se prova o CONTRATO dela — o que entra,
 * o que a resposta significa, e os três limites que impedem o desastre
 * anterior. A alcançabilidade em si é do Postgres.
 */
const prismaCom = (linhas: Array<{ id: string }>) => {
  const $queryRaw = vi.fn().mockResolvedValue(linhas);
  return { prisma: { $queryRaw }, $queryRaw };
};

/** Junta o SQL do template literal, pra assertar o que a consulta pede. */
const sqlDe = ($queryRaw: { mock: { calls: unknown[][] } }) =>
  (($queryRaw.mock.calls[0]?.[0] as string[]) ?? []).join('?');

const valoresDe = ($queryRaw: { mock: { calls: unknown[][] } }) =>
  ($queryRaw.mock.calls[0] ?? []).slice(1);

describe('iaAFrente', () => {
  it('sem conversa e sem lead, não consulta o banco', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await expect(iaAFrente(prisma as never, 'emp-1', {})).resolves.toBe(false);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('achou execução a caminho do nó de IA → true', async () => {
    const { prisma } = prismaCom([{ id: 'exec-outra' }]);
    await expect(iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' })).resolves.toBe(
      true,
    );
  });

  it('nada a caminho → false', async () => {
    const { prisma } = prismaCom([]);
    await expect(iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' })).resolves.toBe(
      false,
    );
  });

  /**
   * REGRESSÃO 2 de 09/09 — a pior das duas.
   *
   * O RT tem um nó de IA. Quando a execução do RT avaliava
   * `{{conversa.ia_aguardando}}`, ela se enxergava e respondia "Sim" — sempre,
   * deterministicamente. O RT encerrava, o C1 nunca era acionado, e a conversa
   * ficava em silêncio PERMANENTE.
   */
  it('EXCLUI a execução que pergunta — foi ela que causou o silêncio permanente', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', {
      conversationId: 'conv-1',
      execucaoId: 'exec-que-pergunta',
    });
    expect(sqlDe($queryRaw)).toContain('e.id <> ');
    expect(valoresDe($queryRaw)).toContain('exec-que-pergunta');
  });

  it('sem execucaoId, o filtro de self usa string vazia (nenhum id é "")', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    expect(valoresDe($queryRaw)).toContain('');
  });

  /**
   * REGRESSÃO 1 de 09/09 — o T1 pula o nó de IA quando o lead já foi triado,
   * mas o fluxo dele "tem" o nó. O proxy contava, e o RT era segurado por 30
   * min: cliente que voltava a escrever recebia silêncio.
   *
   * A defesa não é um filtro: é a consulta partir da POSIÇÃO da execução (o nó
   * do último log) e andar pra FRENTE. Nó já passado não é alcançável.
   */
  it('parte do último log da execução, não do fluxo', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    const sql = sqlDe($queryRaw);
    expect(sql).toContain('"FluxoExecucaoLog"');
    expect(sql).toContain('ORDER BY l."iniciadoEm" DESC');
    // e anda pra frente pelas arestas, do source pro target
    expect(sql).toContain('ed."sourceNoId" = a."noId"');
    expect(sql).toContain('ed."targetNoId"');
  });

  it('execução recém-criada parte do TRIGGER — ainda não escolheu caminho', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    expect(sqlDe($queryRaw)).toContain("n.tipo = 'TRIGGER'");
  });

  /**
   * O limite que impede o desastre novo: execução parada num DELAY de 3 dias
   * continua `EM_EXECUCAO` (nada a devolve pra PENDENTE). Sem janela, ela
   * emudeceria a conversa por três dias — pior que o problema original.
   */
  it('só conta execução que começou nos últimos 30s', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    const antes = Date.now();
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    const depois = Date.now();

    expect(sqlDe($queryRaw)).toContain('e."iniciouEm" >= ');
    const desde = valoresDe($queryRaw).find((v): v is Date => v instanceof Date);
    expect(desde).toBeInstanceOf(Date);
    // 30s atrás, com folga pro tempo de execução do próprio teste
    expect(desde!.getTime()).toBeGreaterThanOrEqual(antes - 30_000 - 50);
    expect(desde!.getTime()).toBeLessThanOrEqual(depois - 30_000 + 50);
  });

  it('só EM_EXECUCAO — quem está AGUARDANDO já é do outro sinal', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    const sql = sqlDe($queryRaw);
    expect(sql).toContain("e.status = 'EM_EXECUCAO'");
    expect(sql).not.toContain('AGUARDANDO');
  });

  // Grafo com ciclo existe de verdade (RT→C1→RT). Sem teto, a CTE não para.
  it('tem teto de profundidade — RT→C1→RT é ciclo real', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    expect(sqlDe($queryRaw)).toContain('a.nivel < ');
    expect(valoresDe($queryRaw)).toContain(40);
  });

  it('procura o nó de IA pelo acaoTipo, não pelo título', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    expect(sqlDe($queryRaw)).toContain('n."acaoTipo" = \'CONVERSAR_IA\'');
  });

  it('casa por conversa OU por lead, e sempre dentro da empresa', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', {
      conversationId: 'conv-1',
      leadId: 'lead-1',
    });
    const sql = sqlDe($queryRaw);
    expect(sql).toContain('{conversationId}');
    expect(sql).toContain('{leadId}');
    expect(sql).toContain('e."empresaId" = ');
    expect(valoresDe($queryRaw)).toContain('emp-1');
  });

  // A alcançabilidade cruza arestas do MESMO fluxo. Sem isto, um nó de IA de
  // outro fluxo do tenant entraria no caminho.
  it('não atravessa fluxos diferentes', async () => {
    const { prisma, $queryRaw } = prismaCom([]);
    await iaAFrente(prisma as never, 'emp-1', { conversationId: 'conv-1' });
    expect(sqlDe($queryRaw)).toContain('ed."fluxoId" = a."fluxoId"');
  });
});
