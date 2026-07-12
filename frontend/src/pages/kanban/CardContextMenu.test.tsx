import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CardContextMenu, type CardMenuAcao } from './CardContextMenu';

/**
 * Menu de contexto (botão direito) do card: renderiza os itens, dispara a ação
 * + fecha ao clicar num item, e fecha com Esc / clique fora.
 */
function itens(onArquivar = vi.fn()): CardMenuAcao[] {
  return [
    { id: 'abrir', label: 'Abrir cartão', icon: null, onClick: vi.fn() },
    { id: 'link', label: 'Copiar link', icon: null, onClick: vi.fn() },
    { id: 'arquivar', label: 'Arquivar', icon: null, danger: true, onClick: onArquivar },
  ];
}

describe('CardContextMenu', () => {
  beforeEach(() => cleanup());

  it('renderiza todos os itens', () => {
    render(<CardContextMenu x={10} y={10} itens={itens()} onFechar={() => {}} />);
    expect(screen.getByTestId('card-menu-abrir')).toBeTruthy();
    expect(screen.getByTestId('card-menu-link')).toBeTruthy();
    expect(screen.getByTestId('card-menu-arquivar')).toBeTruthy();
  });

  it('clicar num item dispara a ação e fecha o menu', () => {
    const onArquivar = vi.fn();
    const onFechar = vi.fn();
    render(<CardContextMenu x={10} y={10} itens={itens(onArquivar)} onFechar={onFechar} />);
    fireEvent.click(screen.getByTestId('card-menu-arquivar'));
    expect(onArquivar).toHaveBeenCalledTimes(1);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('Esc fecha o menu', () => {
    const onFechar = vi.fn();
    render(<CardContextMenu x={10} y={10} itens={itens()} onFechar={onFechar} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('clique fora fecha o menu', () => {
    const onFechar = vi.fn();
    render(
      <div>
        <button data-testid="fora">fora</button>
        <CardContextMenu x={10} y={10} itens={itens()} onFechar={onFechar} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('fora'));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});
