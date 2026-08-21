import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ModuloDoCanvas, spanDeAltura } from './ModuloDoCanvas';

/**
 * Canvas do dashboard — masonry (pedido do Léo, 21/08: "assim que eu escolho o
 * que vou querer no dash, as coisas se adaptem, pra não ficar buraco").
 *
 * O buraco vinha do grid comum: a fileira é alinhada pelo módulo MAIS ALTO, e o
 * curto ao lado dele sobra um vão até a fileira seguinte. `grid-flow-dense` não
 * resolve — ele só preenche colunas que sobraram na MESMA fileira.
 *
 * Aqui cada módulo declara a própria altura em linhas de 1px. O que precisa
 * ficar travado é isso e o comportamento sem ResizeObserver, que é o caso do
 * jsdom e de navegador antigo: sem span, o módulo não pode sumir.
 */

/** ResizeObserver de mentira: guarda o callback pra o teste disparar na mão. */
class ROFake {
  static instancias: ROFake[] = [];
  desconectado = false;
  constructor(public cb: () => void) {
    ROFake.instancias.push(this);
  }
  observe() {}
  disconnect() {
    this.desconectado = true;
  }
}

/** Finge a altura natural do conteúdo e dispara a remedição. */
function medir(alturaPx: number) {
  const alvo = screen.getByTestId('modulo-canvas').firstElementChild as HTMLElement;
  alvo.getBoundingClientRect = () => ({ height: alturaPx }) as DOMRect;
  act(() => {
    for (const ro of ROFake.instancias) ro.cb();
  });
}

const item = () => screen.getByTestId('modulo-canvas');

beforeEach(() => {
  ROFake.instancias = [];
  vi.stubGlobal('ResizeObserver', ROFake);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('spanDeAltura', () => {
  it('converte altura em linhas de 1px somando o respiro entre módulos', () => {
    expect(spanDeAltura(300, 12)).toBe(312);
  });

  it('arredonda pra CIMA — altura fracionária arredondada pra baixo cortaria 1px', () => {
    expect(spanDeAltura(300.2, 12)).toBe(313);
  });

  it('nunca devolve zero: módulo sem altura medida ainda ocupa 1 linha', () => {
    expect(spanDeAltura(0, 0)).toBe(1);
    expect(spanDeAltura(-50, 0)).toBe(1);
  });
});

describe('ModuloDoCanvas', () => {
  it('aplica a largura escolhida como col-span', () => {
    render(
      <ModuloDoCanvas largura={4}>
        <div>miolo</div>
      </ModuloDoCanvas>,
    );

    expect(item().className).toContain('col-span-4');
  });

  it('mede o conteúdo e ocupa exatamente a própria altura', () => {
    render(
      <ModuloDoCanvas largura={6}>
        <div>miolo</div>
      </ModuloDoCanvas>,
    );

    medir(300);

    expect(item().style.gridRowEnd).toBe('span 312');
  });

  it('módulo curto ao lado de um alto ocupa MENOS linhas — é o fim do buraco', () => {
    const { unmount } = render(
      <ModuloDoCanvas largura={6}>
        <div>curto</div>
      </ModuloDoCanvas>,
    );
    medir(200);
    const curto = Number(item().style.gridRowEnd.replace('span ', ''));
    unmount();

    ROFake.instancias = [];
    render(
      <ModuloDoCanvas largura={6}>
        <div>alto</div>
      </ModuloDoCanvas>,
    );
    medir(900);
    const alto = Number(item().style.gridRowEnd.replace('span ', ''));

    // No grid antigo os dois ocupavam a mesma fileira e o curto sobrava vão.
    expect(curto).toBeLessThan(alto);
  });

  it('remede quando o conteúdo cresce — gráfico que carrega depois não estoura', () => {
    render(
      <ModuloDoCanvas largura={12}>
        <div>miolo</div>
      </ModuloDoCanvas>,
    );

    medir(150);
    expect(item().style.gridRowEnd).toBe('span 162');

    medir(480); // o gráfico chegou
    expect(item().style.gridRowEnd).toBe('span 492');
  });

  it('sem ResizeObserver, o módulo continua na tela — só sem masonry', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.resetModules();

    render(
      <ModuloDoCanvas largura={6}>
        <div>miolo</div>
      </ModuloDoCanvas>,
    );

    // Sem span: o grid volta ao alinhamento por fileira. Feio, nunca invisível —
    // um `span 1` sem medição deixaria o módulo com 1px de altura.
    expect(item().style.gridRowEnd).toBe('');
    expect(screen.getByText('miolo')).toBeTruthy();
  });

  it('desliga o observer ao desmontar (trocar módulo no Personalizar não vaza)', () => {
    const { unmount } = render(
      <ModuloDoCanvas largura={6}>
        <div>miolo</div>
      </ModuloDoCanvas>,
    );

    unmount();

    expect(ROFake.instancias.every((ro) => ro.desconectado)).toBe(true);
  });
});
