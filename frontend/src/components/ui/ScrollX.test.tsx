import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ScrollX } from './ScrollX';

/**
 * jsdom não faz layout: scrollWidth/clientWidth são 0. Simulamos as medidas
 * no protótipo pra exercitar a lógica de "tem conteúdo escondido de que lado".
 */
const medidas = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 };
const originais: Record<string, PropertyDescriptor | undefined> = {};

beforeEach(() => {
  for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
    originais[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get: () => medidas[k],
      set: (v: number) => {
        medidas[k] = v;
      },
    });
  }
  medidas.scrollWidth = 0;
  medidas.clientWidth = 0;
  medidas.scrollLeft = 0;
});
afterEach(() => {
  for (const k of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
    const d = originais[k];
    if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
});

const scroller = () => screen.getByTestId('scroll-x').firstElementChild as HTMLElement;

describe('ScrollX — pista de rolagem horizontal', () => {
  it('conteúdo que cabe: nenhuma sombra, nenhuma dica', () => {
    medidas.scrollWidth = 300;
    medidas.clientWidth = 300;
    render(
      <ScrollX>
        <table />
      </ScrollX>,
    );
    expect(screen.getByTestId('scroll-x-sombra-dir').className).toContain('opacity-0');
    expect(screen.getByTestId('scroll-x-sombra-esq').className).toContain('opacity-0');
    expect(screen.queryByTestId('scroll-x-dica')).toBeNull();
  });

  it('conteúdo maior que o contêiner: sombra à DIREITA e a dica "deslize →"', () => {
    medidas.scrollWidth = 900;
    medidas.clientWidth = 360;
    render(
      <ScrollX>
        <table />
      </ScrollX>,
    );
    expect(screen.getByTestId('scroll-x-sombra-dir').className).toContain('opacity-100');
    expect(screen.getByTestId('scroll-x-sombra-esq').className).toContain('opacity-0');
    expect(screen.getByTestId('scroll-x-dica')).toBeTruthy();
  });

  it('rolou até o fim: sombra troca de lado e a dica some pra sempre', () => {
    medidas.scrollWidth = 900;
    medidas.clientWidth = 360;
    render(
      <ScrollX>
        <table />
      </ScrollX>,
    );
    act(() => {
      medidas.scrollLeft = 540; // 540 + 360 = 900 → fim
      fireEvent.scroll(scroller());
    });
    expect(screen.getByTestId('scroll-x-sombra-dir').className).toContain('opacity-0');
    expect(screen.getByTestId('scroll-x-sombra-esq').className).toContain('opacity-100');
    expect(screen.queryByTestId('scroll-x-dica')).toBeNull();

    // Voltou pro começo: sombra à direita de novo, mas a dica não volta —
    // quem já rolou não precisa ser ensinado outra vez.
    act(() => {
      medidas.scrollLeft = 0;
      fireEvent.scroll(scroller());
    });
    expect(screen.getByTestId('scroll-x-sombra-dir').className).toContain('opacity-100');
    expect(screen.queryByTestId('scroll-x-dica')).toBeNull();
  });

  it('className vai pro wrapper externo; o scroller continua overflow-x-auto', () => {
    render(
      <ScrollX className="rounded-md border">
        <table />
      </ScrollX>,
    );
    const externo = screen.getByTestId('scroll-x');
    expect(externo.className).toContain('rounded-md');
    expect(scroller().className).toContain('overflow-x-auto');
  });
});
