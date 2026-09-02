import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTravaRolagem, __resetTravaRolagem } from './useTravaRolagem';

/**
 * A trava e do BODY, que e global — entao a contagem tambem precisa ser.
 *
 * O bug que motivou o hook: dois overlays com salvar-e-restaurar proprio, se
 * fecharem FORA DE ORDEM, deixam `overflow: hidden` para sempre. E isso nao so
 * impede rolar: desliga o `position: sticky` de tudo que esta dentro, e o
 * sintoma aparece longe da causa ("o topo desce").
 */
describe('useTravaRolagem', () => {
  beforeEach(() => {
    __resetTravaRolagem();
    document.body.style.overflow = '';
  });

  const abrir = () => renderHook(({ ativo }) => useTravaRolagem(ativo), { initialProps: { ativo: true } });

  it('trava enquanto aberto', () => {
    abrir();

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('destrava ao fechar', () => {
    const a = abrir();

    a.unmount();

    expect(document.body.style.overflow).toBe('');
  });

  it('DOIS abertos: fechar o de baixo NAO destrava com o de cima ainda aberto', () => {
    const a = abrir();
    const b = abrir();

    a.unmount();

    expect(document.body.style.overflow).toBe('hidden');
    b.unmount();
  });

  it('fechar FORA DE ORDEM nao vaza — era esse o bug', () => {
    const a = abrir();
    const b = abrir();

    a.unmount(); // o de baixo fecha primeiro
    b.unmount(); // e so depois o de cima

    expect(document.body.style.overflow).toBe('');
  });

  it('inativo nao trava nada', () => {
    renderHook(({ ativo }) => useTravaRolagem(ativo), { initialProps: { ativo: false } });

    expect(document.body.style.overflow).toBe('');
  });

  it('alternar ativo destrava sem precisar desmontar', () => {
    const r = renderHook(({ ativo }) => useTravaRolagem(ativo), { initialProps: { ativo: true } });
    expect(document.body.style.overflow).toBe('hidden');

    r.rerender({ ativo: false });

    expect(document.body.style.overflow).toBe('');
  });
});
