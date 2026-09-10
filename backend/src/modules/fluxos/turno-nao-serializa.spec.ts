import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * As buscas independentes do turno não voltam a ficar em fila.
 *
 * Medido em 10/09: o turno leva 15-20s, e quem digita a cada 6s ganha do bot —
 * ele responde algo que a pessoa acabou de responder. Nenhuma janela de espera
 * conserta isso; o que conserta é o turno ser mais curto.
 *
 * São DOIS caminhos, e os dois tinham a mesma fila:
 *
 *  - **opener** — a PRIMEIRA mensagem. Prompt + teto de custo + config do bot.
 *  - **turno de resposta** — os mesmos três, mais o RAG.
 *
 * ⚠️ O opener só apareceu porque este teste contou as chamadas no arquivo
 * inteiro e achou duas de cada. Eu tinha olhado só o turno de resposta.
 *
 * ⚠️ Este teste é ESTRUTURAL de propósito: o que precisa ser travado é que não
 * NASÇA uma chamada nova em fila. Teste de comportamento cobre o caminho que
 * existe hoje; a regressão aqui é alguém ACRESCENTAR um `await` — que é
 * exatamente como as quatro anteriores nasceram, uma por vez.
 *
 * 📌 E ele não fatia por TAMANHO. O guard da porta única da IA fatiava 600
 * caracteres fixos e quebrou com um comentário novo, acusando o oposto do que
 * acontecia (10/09). Aqui a checagem é por ausência no arquivo inteiro.
 */
const FONTE = readFileSync(join(__dirname, 'conversar-ia.service.ts'), 'utf8');

const ocorrencias = (agulha: string): number => FONTE.split(agulha).length - 1;

/**
 * O guard de verdade, e ele é por AUSÊNCIA: dentro de um `Promise.all` a
 * chamada não leva `await` na frente. Então qualquer `await this.<isto>` que
 * apareça é, por construção, uma chamada em FILA.
 *
 * `obterConfigBot` fica de fora desta lista: ele tem call sites legítimos em
 * outras funções deste arquivo (drenagem, envio em balões) que não são caminho
 * de turno. O que trava ele são as asserções de `cfgBot`/`cfgBotOpener` abaixo.
 */
const NUNCA_EM_FILA = [
  'await this.persona.compilarSystemPromptConversa(',
  'await this.custo.verificarTeto(empresaId)',
  'await this.montarBlocoRag(',
];

describe('o turno não serializa o que pode ser paralelo', () => {
  it.each(NUNCA_EM_FILA)('não existe `%s` — seria chamada em fila', (chamada) => {
    expect(
      ocorrencias(chamada),
      `${chamada} voltou a ser awaitada em sequência. Se for chamada nova, some ao ` +
        'Promise.all do caminho em vez de um await solto — foi assim que as quatro ' +
        'anteriores viraram fila, uma por vez.',
    ).toBe(0);
  });

  it('o TURNO DE RESPOSTA tem as quatro no mesmo Promise.all', () => {
    const i = FONTE.indexOf('const [promptCompilado, cfgBot, custoTurno, blocoRag] =');
    expect(i, 'o Promise.all do turno de resposta sumiu').toBeGreaterThan(-1);

    const bloco = FONTE.slice(i, FONTE.indexOf(']);', i));
    for (const chamada of [
      'compilarSystemPromptConversa(',
      'obterConfigBot(',
      'verificarTeto(',
      'montarBlocoRag(',
    ]) {
      expect(bloco, `${chamada} saiu do lote do turno de resposta`).toContain(chamada);
    }
  });

  it('o OPENER tem as três no mesmo Promise.all', () => {
    const i = FONTE.indexOf('const [promptOpener, custoOpener, cfgBotOpener] =');
    expect(i, 'o Promise.all do opener sumiu').toBeGreaterThan(-1);

    const bloco = FONTE.slice(i, FONTE.indexOf(']);', i));
    for (const chamada of ['compilarSystemPromptConversa(', 'verificarTeto(', 'obterConfigBot(']) {
      expect(bloco, `${chamada} saiu do lote do opener`).toContain(chamada);
    }
  });

  /**
   * O histórico fica FORA dos lotes de propósito: ele precisa do limite, que sai
   * da config do bot. É o único do grupo com dependência real — e travar isto
   * evita que alguém "otimize" jogando ele no lote com um limite chutado.
   *
   * A asserção é sobre a ORIGEM do limite: se vier do lote, ninguém foi buscar
   * config de novo.
   */
  it('o limite do histórico vem do lote, nos dois caminhos', () => {
    expect(FONTE).toContain('cfgBot?.historicoMensagens');
    expect(FONTE).toContain('cfgBotOpener?.historicoMensagens');
  });

  it('e o RAG roda as três buscas dele juntas', () => {
    expect(
      FONTE.indexOf('const [produtos, chunks, blocoDocs] = await Promise.all('),
      'as buscas do RAG voltaram pra fila',
    ).toBeGreaterThan(-1);
  });
});

/**
 * Os cronômetros. Sem eles a discussão sobre lentidão volta a ser palpite — foi
 * a falta desses números que deixou a premissa de "~10s" virar base de outro
 * ajuste sem ninguém conferir.
 */
describe('o turno é cronometrado', () => {
  it('a conta fecha: total, janela, RAG, IA e pacing', () => {
    for (const marca of [
      'CONVERSAR_IA: turno da exec',
      'janela de rajada',
      'CONVERSAR_IA: RAG levou',
      'CONVERSAR_IA: IA respondeu em',
      'CONVERSAR_IA: pacing segurou o envio',
    ]) {
      expect(FONTE, `o cronômetro "${marca}" sumiu`).toContain(marca);
    }
  });

  /**
   * `debug` não aparece em produção (o nível é `info`) — e medição que só existe
   * em dev não mede o turno de 15s, que é fenômeno de produção.
   */
  it('em `log`, não em `debug` — senão não aparece no Railway', () => {
    for (const marca of ['CONVERSAR_IA: RAG levou', 'CONVERSAR_IA: IA respondeu em']) {
      const i = FONTE.indexOf(marca);
      expect(FONTE.slice(Math.max(0, i - 200), i)).toContain('this.logger.log');
    }
  });
});
