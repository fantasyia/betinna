import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BotaoWhatsapp, linkCompartilhar, linkWhatsapp } from './Whatsapp';

/** Ícone do WhatsApp no topo da vitrine (Léo, 14/10). */

afterEach(cleanup);

describe('WhatsApp da vitrine', () => {
  it('link do wa.me com a mensagem já escrita', () => {
    expect(linkWhatsapp('5511997524483', 'Ribelt')).toBe(
      'https://wa.me/5511997524483?text=Ol%C3%A1!%20Vim%20pela%20vitrine%20de%20atacado%20da%20Ribelt.',
    );
  });

  it('abre em outra aba, com nome acessível', () => {
    render(<BotaoWhatsapp numero="5511997524483" empresa="Ribelt" />);
    const a = screen.getByTestId('vt-whatsapp') as HTMLAnchorElement;
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(a.getAttribute('aria-label')).toBe('Falar com a Ribelt no WhatsApp');
  });
});

describe('compartilhar produto', () => {
  it('leva nome e link do produto no texto', () => {
    expect(linkCompartilhar('Bermuda', 'https://x.com/p/bermuda')).toBe(
      'https://wa.me/?text=Bermuda%0Ahttps%3A%2F%2Fx.com%2Fp%2Fbermuda',
    );
  });
});
