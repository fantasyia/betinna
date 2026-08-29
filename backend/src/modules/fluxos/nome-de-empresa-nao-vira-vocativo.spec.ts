import { describe, expect, it } from 'vitest';
import { pareceNomeDePessoa, personalizarNome } from './conversar-ia.service';

/**
 * "Olá Electro." — o cadastro que não tem nome de gente.
 *
 * Medido na base real em 29/08: de 30.262 leads com `contatoNome`, **27% têm
 * cara de empresa** e outros 11% têm um token só. O motor mandava usar o
 * primeiro token e pronto — na PRIMEIRA mensagem de um contato frio, que é
 * exatamente onde a pessoa decide se aquilo é gente ou disparo de lista.
 *
 * A regra destes testes: errar pro lado da saudação neutra. "Olá!" custa nada;
 * "Olá Electro." custa o contato.
 */
describe('nome de empresa não pode virar vocativo', () => {
  describe('pareceNomeDePessoa', () => {
    it.each([
      'Electro Aco Altona S.A.',
      'Soldex Soldagem Industrial',
      'Globalfer Máquinas',
      'LC Máquinas Seladoras',
      'representação com. ainda não registrada',
      'kibellaesmaltes ktda',
      'Set Máquinas',
    ])('recusa cadastro com cara de empresa: %s', (nome) => {
      expect(pareceNomeDePessoa(nome)).toBe(false);
    });

    it.each([
      'Marcelo Harada',
      'Leonardo Beltran',
      'Maria das Graças Silva',
      'João Pedro Souza',
      // Base importada costuma vir em caixa alta — não é motivo pra recusar.
      'MARCELO HARADA',
    ])('aceita nome de pessoa: %s', (nome) => {
      expect(pareceNomeDePessoa(nome)).toBe(true);
    });

    it('token ÚNICO é ambíguo → recusa (11% da base, e "Globalfer" parece "Marcelo")', () => {
      expect(pareceNomeDePessoa('Globalfer')).toBe(false);
      expect(pareceNomeDePessoa('Marcelo')).toBe(false);
    });

    it('dígito ou & no nome é cadastro, não pessoa', () => {
      expect(pareceNomeDePessoa('Casa 10 Materiais')).toBe(false);
      expect(pareceNomeDePessoa('Silva & Filhos')).toBe(false);
    });

    it('vazio/nulo não é pessoa', () => {
      expect(pareceNomeDePessoa('')).toBe(false);
      expect(pareceNomeDePessoa(null)).toBe(false);
      expect(pareceNomeDePessoa(undefined)).toBe(false);
    });
  });

  describe('personalizarNome — o template fixo, onde o modelo NÃO está no circuito', () => {
    it('cadastro de empresa NÃO vira "Olá Electro." — sai saudação neutra', () => {
      const r = personalizarNome('Olá [primeiro_nome].', 'Electro Aco Altona S.A.');

      expect(r).not.toContain('Electro');
      expect(r).toBe('Olá.');
    });

    it('nome de pessoa CONTINUA sendo saudado (não pode virar mordaça geral)', () => {
      expect(personalizarNome('Olá [primeiro_nome].', 'Marcelo Harada')).toBe('Olá Marcelo.');
    });

    it('outros formatos de placeholder seguem a mesma regra', () => {
      expect(personalizarNome('Oi {{nome}}, tudo bem?', 'Soldex Soldagem Industrial')).toBe(
        'Oi, tudo bem?',
      );
      expect(personalizarNome('Oi {{nome}}, tudo bem?', 'João Pedro Souza')).toBe(
        'Oi João, tudo bem?',
      );
    });
  });
});
