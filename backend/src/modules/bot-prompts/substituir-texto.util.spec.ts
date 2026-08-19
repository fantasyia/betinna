import { describe, expect, it } from 'vitest';
import {
  SubstituicaoInvalidaError,
  aplicarSubstituicoes,
  contarOcorrencias,
} from './substituir-texto.util';

/**
 * Editar prompt de 64 mil caracteres reenviando o texto inteiro é arriscado:
 * quem edita tem que reproduzir centenas de linhas verbatim. Estas regras são o
 * que torna a edição por trecho segura — trocar a ocorrência errada em silêncio
 * seria pior que o problema que a feature resolve.
 */
describe('contarOcorrencias', () => {
  it('conta sem sobreposição', () => {
    expect(contarOcorrencias('aaaa', 'aa')).toBe(2);
    expect(contarOcorrencias('abcabc', 'abc')).toBe(2);
    expect(contarOcorrencias('abc', 'xyz')).toBe(0);
  });

  it('trecho vazio não conta (senão daria infinito)', () => {
    expect(contarOcorrencias('abc', '')).toBe(0);
  });
});

describe('aplicarSubstituicoes', () => {
  const prompt = [
    '# Regras',
    'NUNCA use emojis.',
    'Saudação: SEMPRE "Olá" — você não sabe que horas são pro lead.',
    '',
    '# Exemplo',
    'Boa noite! 😊 Então, [nome], tem uns minutinhos agora?',
  ].join('\n');

  it('troca o trecho único e devolve o texto completo', () => {
    const novo = aplicarSubstituicoes(prompt, [
      {
        de: 'Boa noite! 😊 Então, [nome], tem uns minutinhos agora?',
        para: 'Olá, [nome]. Tem uns minutos agora?',
      },
    ]);
    expect(novo).toContain('Olá, [nome]. Tem uns minutos agora?');
    expect(novo).not.toContain('😊');
    // O resto do prompt fica intacto — é o ponto da edição cirúrgica.
    expect(novo).toContain('NUNCA use emojis.');
    expect(novo.split('\n')).toHaveLength(prompt.split('\n').length);
  });

  it('trecho que NÃO existe: erro dizendo isso, sem alterar nada', () => {
    expect(() =>
      aplicarSubstituicoes(prompt, [{ de: 'texto que não está lá', para: 'x' }]),
    ).toThrow(SubstituicaoInvalidaError);
    try {
      aplicarSubstituicoes(prompt, [{ de: 'texto que não está lá', para: 'x' }]);
    } catch (e) {
      expect((e as Error).message).toMatch(/não encontrado/i);
      expect((e as Error).message).toMatch(/Nada foi alterado/i);
    }
  });

  it('trecho AMBÍGUO: erro dizendo quantas vezes aparece — nunca troca a primeira', () => {
    const texto = 'linha A\nlinha A\nfim';
    try {
      aplicarSubstituicoes(texto, [{ de: 'linha A', para: 'linha B' }]);
      throw new Error('devia ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(SubstituicaoInvalidaError);
      expect((e as Error).message).toMatch(/2 vezes/);
    }
  });

  it('várias substituições encadeiam sobre o texto que vai saindo', () => {
    const novo = aplicarSubstituicoes(prompt, [
      { de: 'NUNCA use emojis.', para: 'NUNCA use emojis nem gírias.' },
      { de: 'Boa noite! 😊 ', para: 'Olá! ' },
    ]);
    expect(novo).toContain('nem gírias');
    expect(novo).toContain('Olá! Então, [nome]');
  });

  it('se a SEGUNDA falha, a primeira também não vale (tudo ou nada)', () => {
    // O util lança e o chamador descarta o resultado — o texto original nunca
    // é tocado, porque a troca acontece em memória e só o retorno é gravado.
    expect(() =>
      aplicarSubstituicoes(prompt, [
        { de: 'NUNCA use emojis.', para: 'ok' },
        { de: 'não existe', para: 'x' },
      ]),
    ).toThrow(SubstituicaoInvalidaError);
    // O original segue intacto (strings são imutáveis — a garantia é do design).
    expect(prompt).toContain('NUNCA use emojis.');
  });

  it('o `para` é literal: $& e afins não viram referência de regex', () => {
    // `String.replace` com string interpretaria `$&` como "o trecho casado".
    // Num prompt cheio de exemplo e template, isso corromperia o texto calado.
    const novo = aplicarSubstituicoes('preço: XXX', [{ de: 'XXX', para: 'R$& 100' }]);
    expect(novo).toBe('preço: R$& 100');
  });

  it('trecho com quebra de linha e acento casa como está', () => {
    const novo = aplicarSubstituicoes(prompt, [
      { de: '# Exemplo\nBoa noite!', para: '# Exemplo (revisado)\nOlá!' },
    ]);
    expect(novo).toContain('# Exemplo (revisado)\nOlá!');
  });
});
