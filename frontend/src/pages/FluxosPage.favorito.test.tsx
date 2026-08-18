import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BotaoFavorito } from './FluxosPage';

/**
 * A estrela de favoritar vive DENTRO do item da lista, e o item inteiro é
 * clicável (abre o editor do fluxo). Sem `stopPropagation`, clicar na estrela
 * arrastaria o usuário pra dentro do fluxo — o gesto de 1 segundo viraria uma
 * navegação indesejada toda vez.
 */
afterEach(cleanup);

describe('BotaoFavorito', () => {
  it('clicar NÃO propaga pro item (senão abriria o editor)', () => {
    const onToggle = vi.fn();
    const onClickDoItem = vi.fn();
    render(
      <div onClick={onClickDoItem}>
        <BotaoFavorito favorito={false} onToggle={onToggle} />
      </div>,
    );

    fireEvent.click(screen.getByTestId('fluxo-favorito'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClickDoItem).not.toHaveBeenCalled();
  });

  it('estado vira aria-pressed (acessível e testável)', () => {
    const { rerender } = render(<BotaoFavorito favorito={false} onToggle={() => {}} />);
    expect(screen.getByTestId('fluxo-favorito').getAttribute('aria-pressed')).toBe('false');

    rerender(<BotaoFavorito favorito onToggle={() => {}} />);
    expect(screen.getByTestId('fluxo-favorito').getAttribute('aria-pressed')).toBe('true');
  });

  it('o título diz o que o clique vai fazer, não o estado atual', () => {
    render(<BotaoFavorito favorito={false} onToggle={() => {}} />);
    expect(screen.getByTestId('fluxo-favorito').getAttribute('title')).toMatch(/Favoritar/i);

    cleanup();
    render(<BotaoFavorito favorito onToggle={() => {}} />);
    expect(screen.getByTestId('fluxo-favorito').getAttribute('title')).toMatch(/Remover/i);
  });
});
