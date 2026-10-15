import { describe, expect, it } from 'vitest';
import { leadDoRef, linkDoCarrinho, primeiroNome, reais, refDoLead } from './carrinho-recuperador';

/** Recuperador de carrinho (Léo, 14/10): ref assinado, link e textos. */
describe('recuperador de carrinho — puros', () => {
  const S = 'segredo-de-teste';

  it('ref do lead vai e volta; alterado ou de outro segredo não vale', () => {
    const ref = refDoLead('cmv8abc1230000xyz', S);
    expect(leadDoRef(ref, S)).toBe('cmv8abc1230000xyz');
    expect(leadDoRef(ref.replace(/.$/, ref.endsWith('0') ? '1' : '0'), S)).toBeNull();
    expect(leadDoRef(refDoLead('cmv8abc1230000xyz', 'outro'), S)).toBeNull();
    expect(leadDoRef('cmv8outrolead000.' + ref.split('.')[1], S)).toBeNull();
    expect(leadDoRef(null, S)).toBeNull();
    expect(leadDoRef('lixo', S)).toBeNull();
  });

  it('link: domínio próprio na raiz; sem domínio, o app com /v/<slug>', () => {
    expect(linkDoCarrinho('tok', 'atacado-ribelt', 'atacado.ribelt.com.br', 'https://app.x')).toBe(
      'https://atacado.ribelt.com.br/?c=tok',
    );
    expect(linkDoCarrinho('tok', 'atacado-ribelt', null, 'https://app.x/')).toBe(
      'https://app.x/v/atacado-ribelt?c=tok',
    );
  });

  it('primeiro nome e total em reais', () => {
    expect(primeiroNome('  Maria Clara Souza ')).toBe('Maria');
    expect(primeiroNome(null)).toBe('');
    expect(reais(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50');
  });
});
