import { describe, expect, it } from 'vitest';
import { resumoErros } from './melhorenvio.client';

/** Mensagem do 422 do Melhor Envio (PED-0008, 14/10). */
describe('resumoErros', () => {
  it('erros por campo: junta até 3', () => {
    expect(
      resumoErros({
        errors: { 'to.email': ['E-mail obrigatório'], 'from.phone': ['Telefone inválido'] },
      }),
    ).toBe('E-mail obrigatório; Telefone inválido');
  });

  it('só message (+ suggestion): mostra os dois — era "dados inválidos"', () => {
    expect(
      resumoErros({
        message:
          'E-CRT-0001: O valor segurado em envios não comerciais não pode ser maior que R$ 1.000,00.',
        suggestion: 'Considere alterar o valor do seguro ou o tipo de envio.',
        context: [],
      }),
    ).toBe(
      'E-CRT-0001: O valor segurado em envios não comerciais não pode ser maior que R$ 1.000,00. Considere alterar o valor do seguro ou o tipo de envio.',
    );
  });

  it('nada aproveitável: "dados inválidos"', () => {
    expect(resumoErros(null)).toBe('dados inválidos');
    expect(resumoErros({ errors: {} })).toBe('dados inválidos');
  });
});
