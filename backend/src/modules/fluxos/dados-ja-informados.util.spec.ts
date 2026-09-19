import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { instrucaoDadosJaInformados } from './dados-ja-informados.util';
import { SINAIS_ROTEAMENTO } from './fluxo-executor.types';
import { CHAVE_RESERVADA } from './conversar-ia.service';

/**
 * O bloco `[Dado]` que conserta COB.2/COB.3 — lead que já informou a tensão
 * sendo perguntado sobre ela de novo.
 *
 * ⚠️ O que estas asserções protegem NÃO é a redação do texto: é o CONTRATO de
 * o que entra e o que fica de fora. Um bloco que vaza `_iaHistorico` ou que
 * apresenta um default da empresa como fala do lead é pior que bloco nenhum —
 * ele mente pro modelo com a mesma autoridade das linhas verdadeiras.
 */
const OPTS = { reservada: CHAVE_RESERVADA, ignorar: SINAIS_ROTEAMENTO };

describe('instrucaoDadosJaInformados', () => {
  it('lista a variável que o lead informou e proíbe perguntar de novo', () => {
    const txt = instrucaoDadosJaInformados({ tensao_rede: '220V', corrente_quadro: '100' }, OPTS);

    expect(txt).toContain('tensao_rede: 220V');
    expect(txt).toContain('corrente_quadro: 100');
    expect(txt).toContain('[Dado]');
    // Sem o "NÃO pergunte" explícito o bloco vira contexto decorativo: o dado
    // já chegava ao modelo antes (`| tensão | **220V** |`) e ele perguntava.
    expect(txt).toContain('NÃO pergunte');
  });

  it('manda o bloco VENCER o prompt — é a razão de ele existir', () => {
    // O prompt do C1 tem NOVE menções mandando perguntar a tensão. Sem dizer
    // qual voz ganha, o modelo fica com nove contra uma — que é exatamente o
    // que a tentativa por prompt (v61) provou ao reprovar igual.
    const txt = instrucaoDadosJaInformados({ tensao_rede: '220V' }, OPTS);
    expect(txt).toMatch(/ACIMA de qualquer instrução/i);
  });

  it('oferece CONFIRMAR como saída, em vez de só proibir', () => {
    // "Não pergunte" sozinho deixa o modelo sem alternativa quando ele precisa
    // checar — e aí ele pergunta do mesmo jeito.
    const txt = instrucaoDadosJaInformados({ tensao_rede: '220V' }, OPTS);
    expect(txt).toMatch(/CONFIRME/);
  });

  it('não diz nada quando o lead não informou nada', () => {
    expect(instrucaoDadosJaInformados({}, OPTS)).toBe('');
    expect(instrucaoDadosJaInformados(null, OPTS)).toBe('');
    expect(instrucaoDadosJaInformados(undefined, OPTS)).toBe('');
    // Array não é mapa de variáveis — entra como "nada", não como lixo listado.
    expect(instrucaoDadosJaInformados([1, 2], OPTS)).toBe('');
  });

  it('IGNORA sinais de roteamento — são decisão do motor, não fala do lead', () => {
    const txt = instrucaoDadosJaInformados(
      { classificacao_final: 'Interesse comercial', trilho: 'A', tensao_rede: '220V' },
      OPTS,
    );
    expect(txt).toContain('tensao_rede');
    expect(txt).not.toContain('classificacao_final');
    expect(txt).not.toContain('trilho');
  });

  it('IGNORA chaves reservadas — `_iaHistorico` no prompt seria a conversa inteira colada', () => {
    const txt = instrucaoDadosJaInformados(
      { _iaHistorico: 'blá'.repeat(500), leadId: 'l1', tensao_rede: '220V' },
      OPTS,
    );
    expect(txt).not.toContain('_iaHistorico');
    expect(txt).not.toContain('leadId');
    expect(txt).toContain('tensao_rede');
  });

  it('descarta objeto e array — é estrutura interna, não algo que a pessoa disse', () => {
    const txt = instrucaoDadosJaInformados(
      { payload_bruto: { a: 1 }, historico: [1, 2, 3], tensao_rede: '220V' },
      OPTS,
    );
    expect(txt).not.toContain('payload_bruto');
    expect(txt).not.toContain('historico');
    expect(txt).toContain('tensao_rede');
  });

  it('descarta string vazia/em branco — ausência não é resposta', () => {
    // `EXTRAIR_VARIAVEIS` grava lacuna; anunciar "já informou: tensao_rede: "
    // faria o modelo parar de perguntar um dado que ninguém deu.
    expect(instrucaoDadosJaInformados({ tensao_rede: '   ' }, OPTS)).toBe('');
  });

  it('aceita número e booleano — valor gravado nem sempre é string', () => {
    const txt = instrucaoDadosJaInformados({ corrente_quadro: 100, tem_gerador: true }, OPTS);
    expect(txt).toContain('corrente_quadro: 100');
    expect(txt).toContain('tem_gerador: sim');
  });

  /**
   * ⚠️ ESTRUTURAL, e é o teste que mais importa aqui.
   *
   * Todos os outros provam que a FUNÇÃO faz a coisa certa. Nenhum deles fica
   * vermelho se alguém apagar a chamada dela no serviço — e aí o conserto
   * existe, tem suíte verde, e o cliente continua sendo perguntado duas vezes.
   * É o mesmo padrão do `ia-tem-uma-porta-so`: o buraco não foi o código que
   * existe, foi o ponto onde ninguém ligou.
   */
  it('o serviço REALMENTE monta o bloco no turno de resposta', () => {
    const fonte = readFileSync(join(__dirname, 'conversar-ia.service.ts'), 'utf8');
    expect(fonte).toContain('instrucaoDadosJaInformados(lead.variaveis');
    // Com as duas listas — sem elas o bloco vaza sinal de roteamento e `_*`.
    expect(fonte).toMatch(/instrucaoDadosJaInformados\(lead\.variaveis,\s*\{[^}]*reservada:/);
    expect(fonte).toMatch(/instrucaoDadosJaInformados\(lead\.variaveis,\s*\{[^}]*ignorar:/);
  });

  it('corta valor gigante e limita a quantidade — o bloco não pode empurrar o prompt pra fora', () => {
    const muitas: Record<string, string> = { grande: 'x'.repeat(5000) };
    for (let i = 0; i < 40; i++) muitas[`v${i}`] = `valor${i}`;
    const txt = instrucaoDadosJaInformados(muitas, OPTS);

    expect(txt).not.toContain('x'.repeat(300));
    // 20 itens + as duas linhas de moldura ([Dado] e [Regra]).
    expect(txt.split('\n- ').length - 1).toBe(20);
  });
});
