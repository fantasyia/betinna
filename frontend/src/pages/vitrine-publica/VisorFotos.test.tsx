import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VisorFotos, fotoComVolta, limitarZoom, voltaDoArrasto } from './VisorFotos';

/** Carrossel que dá a volta + visor em tela cheia (Léo, 14/10). */

afterEach(cleanup);

describe('carrossel dá a volta', () => {
  it('da ÚLTIMA arrastando pra frente → 1ª; da 1ª arrastando pra trás → última', () => {
    expect(voltaDoArrasto(6, 7, -80, 5)).toBe(0);
    expect(voltaDoArrasto(0, 7, 80, 5)).toBe(6);
  });

  it('no meio, a rolagem nativa cuida — nada a fazer', () => {
    expect(voltaDoArrasto(3, 7, -80, 0)).toBeNull();
    expect(voltaDoArrasto(6, 7, 80, 0)).toBeNull(); // última, voltando: rolagem normal
  });

  it('gesto curto ou mais vertical (rolando o feed) não dá a volta', () => {
    expect(voltaDoArrasto(6, 7, -20, 0)).toBeNull();
    expect(voltaDoArrasto(6, 7, -60, 120)).toBeNull();
    expect(voltaDoArrasto(0, 1, 80, 0)).toBeNull(); // uma foto só
  });

  it('fotoComVolta anda e dá a volta nos dois sentidos; zoom entre 1× e 4×', () => {
    expect(fotoComVolta(6, 7, 1)).toBe(0);
    expect(fotoComVolta(0, 7, -1)).toBe(6);
    expect(fotoComVolta(2, 7, 1)).toBe(3);
    expect(limitarZoom(0.5)).toBe(1);
    expect(limitarZoom(9)).toBe(4);
  });
});

describe('<VisorFotos>', () => {
  const fotos = [{ url: 'https://x/1.webp' }, { url: 'https://x/2.webp' }, { url: 'https://x/3.webp' }];

  it('abre na foto tocada, inteira, e as setas dão a volta', () => {
    render(<VisorFotos fotos={fotos} nome="Bermuda" inicial={2} onFechar={vi.fn()} />);
    const foto = () => screen.getByTestId('vt-visor-foto') as HTMLImageElement;
    expect(foto().src).toBe('https://x/3.webp');
    expect(screen.getByTestId('vt-visor-contador').textContent).toBe('3 / 3');
    fireEvent.click(screen.getByTestId('vt-visor-proxima'));
    expect(foto().src).toBe('https://x/1.webp');
    fireEvent.click(screen.getByTestId('vt-visor-anterior'));
    expect(foto().src).toBe('https://x/3.webp');
  });

  it('fecha pelo × e pelo Esc', () => {
    const onFechar = vi.fn();
    render(<VisorFotos fotos={fotos} nome="Bermuda" inicial={0} onFechar={onFechar} />);
    fireEvent.click(screen.getByLabelText('Fechar'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onFechar).toHaveBeenCalledTimes(2);
  });

  it('arrastar pro lado no celular passa a foto (com volta)', () => {
    render(<VisorFotos fotos={fotos} nome="Bermuda" inicial={2} onFechar={vi.fn()} />);
    const palco = screen.getByTestId('vt-visor-foto').parentElement!;
    fireEvent.touchStart(palco, { touches: [{ clientX: 300, clientY: 400 }] });
    fireEvent.touchEnd(palco, { changedTouches: [{ clientX: 150, clientY: 405 }] });
    expect((screen.getByTestId('vt-visor-foto') as HTMLImageElement).src).toBe('https://x/1.webp');
  });
});
