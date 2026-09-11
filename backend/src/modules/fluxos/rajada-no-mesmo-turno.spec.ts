import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversarIaService } from './conversar-ia.service';

/**
 * Rajada: gente não escreve um parágrafo, escreve três mensagens em 13 segundos.
 *
 * Medido em 07/09, conversa real de pizzaria: "ah esqueci" (20:28:25) · "o
 * disjuntor geral aqui marca 63A" (20:28:32) · "e a rede é 220v mesmo"
 * (20:28:38). O turno respondia a PRIMEIRA e recolhia o resto depois — o cliente
 * levava duas respostas, e a primeira já nascia velha: às 20:28:34 o bot pediu
 * foto do quadro "pra identificar a corrente", dois segundos depois de a pessoa
 * ter dito 63A.
 *
 * A janela junta a rajada no MESMO turno. E a segunda metade destes testes cobre
 * o estrago que sobrou daquele caso: o registro guardou `tensao_rede: "nao sei"`
 * DEPOIS de o cliente dizer 220v.
 */

const chamarAbsorver = async (msgs: Array<{ conteudo: string }>, janelaMs: string | undefined) => {
  const findMany = vi.fn().mockResolvedValue(msgs);
  const svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
  Object.assign(svc, {
    prisma: { message: { findMany } },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  });
  if (janelaMs === undefined) delete process.env.IA_JANELA_RAJADA_MS;
  else process.env.IA_JANELA_RAJADA_MS = janelaMs;
  const r = await (
    svc as unknown as {
      absorverRajada: (c: string, d: Date) => Promise<{ texto: string; ate: Date }>;
    }
  ).absorverRajada('conv-1', new Date(Date.now() - 1000));
  return { r, findMany };
};

const gravar = async (
  atuais: Record<string, unknown>,
  doTurno: Record<string, unknown>,
  gravaveis: string[],
) => {
  // A gravacao virou MERGE jsonb no banco (`||`) em vez de reescrever a coluna
  // a partir do objeto lido no comeco do turno. O mock espelha isso: acumula o
  // patch sobre o estado corrente e devolve o resultado, como o UPDATE faz.
  const banco: Record<string, unknown> = { ...atuais };
  const update = vi.fn((_s: unknown, ...vals: unknown[]) => {
    Object.assign(banco, JSON.parse(String(vals[0])) as Record<string, unknown>);
    return Promise.resolve([{ variaveis: { ...banco } }]);
  });
  const svc = Object.create(ConversarIaService.prototype) as ConversarIaService;
  Object.assign(svc, {
    prisma: { $queryRaw: update },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  });
  const novas = await (
    svc as unknown as {
      gravarVariaveisDoTurno: (p: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }
  ).gravarVariaveisDoTurno({
    leadId: 'lead-1',
    leadVariaveis: atuais,
    gravaveis,
    variaveisTurno: doTurno,
    execucaoId: 'exec-1',
  });
  return { novas, update };
};

afterEach(() => {
  delete process.env.IA_JANELA_RAJADA_MS;
});

describe('janela de rajada', () => {
  it('junta as mensagens que chegaram na janela num texto só', async () => {
    const { r } = await chamarAbsorver(
      [{ conteudo: 'o disjuntor geral aqui marca 63A' }, { conteudo: 'e a rede é 220v mesmo' }],
      '1',
    );

    expect(r.texto).toBe('o disjuntor geral aqui marca 63A\ne a rede é 220v mesmo');
  });

  it('o corte volta DEPOIS da janela — senão a varredura pós-turno responde de novo', async () => {
    const antes = new Date();
    const { r } = await chamarAbsorver([{ conteudo: 'x' }], '1');

    expect(r.ate.getTime()).toBeGreaterThanOrEqual(antes.getTime());
  });

  it('janela 0 desliga: não consulta mensagem nenhuma (volta ao comportamento antigo)', async () => {
    const { r, findMany } = await chamarAbsorver([{ conteudo: 'x' }], '0');

    expect(findMany).not.toHaveBeenCalled();
    expect(r.texto).toBe('');
  });

  it('rajada vazia não inventa texto', async () => {
    const { r } = await chamarAbsorver([], '1');

    expect(r.texto).toBe('');
  });
});

describe('"não sei" não apaga o que o cliente já informou', () => {
  it('valor concreto sobrevive a um "nao sei" do turno seguinte', async () => {
    // O caso de 07/09: o cliente disse 220v e o registro ficou "nao sei" —
    // guardar o CONTRÁRIO do que a pessoa falou é pior que não guardar nada.
    const { novas, update } = await gravar({ tensao_rede: '220' }, { tensao_rede: 'não sei' }, [
      'tensao_rede',
    ]);

    expect(novas.tensao_rede).toBe('220');
    expect(update).not.toHaveBeenCalled();
  });

  it('mas outro valor CONCRETO corrige normalmente — o cliente pode se retratar', async () => {
    const { novas } = await gravar({ tensao_rede: '220' }, { tensao_rede: '380' }, ['tensao_rede']);

    expect(novas.tensao_rede).toBe('380');
  });

  it('sobre vazio, "não sei" passa — é a informação que existe', async () => {
    const { novas } = await gravar({}, { tensao_rede: 'nao sei' }, ['tensao_rede']);

    expect(novas.tensao_rede).toBe('nao sei');
  });

  it('as variantes contam: n/a, indefinido, "-" também não apagam', async () => {
    for (const v of ['n/a', 'indefinido', '-', 'Não informado']) {
      const { novas } = await gravar({ corrente_quadro: '63' }, { corrente_quadro: v }, [
        'corrente_quadro',
      ]);
      expect(novas.corrente_quadro).toBe('63');
    }
  });
});
