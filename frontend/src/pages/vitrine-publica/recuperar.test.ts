import { describe, expect, it } from 'vitest';
import { carrinhoDosItens, paramsDoLink, semToken } from './recuperar';

/** Recuperador de carrinho na vitrine (Léo, 14/10). */
describe('recuperar', () => {
  it('lê ?r= (link do WhatsApp) e ?c= (link de recuperar)', () => {
    expect(paramsDoLink('https://atacado.ribelt.com.br/?r=lead1.abc&utm_source=wa')).toEqual({
      ref: 'lead1.abc',
      token: null,
    });
    expect(paramsDoLink('https://atacado.ribelt.com.br/?c=tok')).toEqual({ ref: null, token: 'tok' });
  });

  it('itens salvos viram o carrinho por modelo; cor que saiu da vitrine fica de fora', () => {
    const modelos = [
      { id: 'bermuda', cores: [{ id: 'b-preto' }] },
      { id: 'calca', cores: [{ id: 'c-preto' }] },
    ] as never;
    expect(
      carrinhoDosItens(
        [
          { corId: 'b-preto', tamanhoId: 'p', quantidade: 10 },
          { corId: 'c-preto', tamanhoId: 'm', quantidade: 5 },
          { corId: 'sumiu', tamanhoId: 'g', quantidade: 3 },
        ],
        modelos,
      ),
    ).toEqual({ bermuda: { 'b-preto': { p: 10 } }, calca: { 'c-preto': { m: 5 } } });
  });

  it('tira só o ?c= do endereço (mantém utm)', () => {
    expect(semToken('https://x.com/?c=tok&utm_source=wa')).toBe('/?utm_source=wa');
    expect(semToken('https://x.com/?c=tok')).toBe('/');
  });
});
