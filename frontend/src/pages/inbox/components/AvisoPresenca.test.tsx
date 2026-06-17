import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { AvisoPresenca } from './AvisoPresenca';

afterEach(cleanup);

describe('AvisoPresenca', () => {
  it('renderiza null quando outros está vazio', () => {
    render(<AvisoPresenca outros={[]} />);
    expect(screen.queryByTestId('inbox-presenca-aviso')).toBeNull();
  });

  it('renderiza o aviso quando há um atendente presente', () => {
    render(<AvisoPresenca outros={[{ id: 'u1', nome: 'Ana' }]} />);
    const aviso = screen.getByTestId('inbox-presenca-aviso');
    expect(aviso).toBeTruthy();
    // nome do atendente aparece
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('usa "está" (singular) para um único atendente', () => {
    render(<AvisoPresenca outros={[{ id: 'u1', nome: 'Ana' }]} />);
    const aviso = screen.getByTestId('inbox-presenca-aviso');
    expect(aviso.textContent).toContain('está');
    expect(aviso.textContent).not.toContain('estão');
  });

  it('usa "estão" (plural) para dois ou mais atendentes', () => {
    render(
      <AvisoPresenca
        outros={[
          { id: 'u1', nome: 'Ana' },
          { id: 'u2', nome: 'Bruno' },
        ]}
      />,
    );
    const aviso = screen.getByTestId('inbox-presenca-aviso');
    expect(aviso.textContent).toContain('estão');
    // ambos os nomes aparecem
    expect(aviso.textContent).toContain('Ana');
    expect(aviso.textContent).toContain('Bruno');
  });

  it('une múltiplos nomes com vírgula', () => {
    render(
      <AvisoPresenca
        outros={[
          { id: 'u1', nome: 'Ana' },
          { id: 'u2', nome: 'Bruno' },
          { id: 'u3', nome: 'Carla' },
        ]}
      />,
    );
    const aviso = screen.getByTestId('inbox-presenca-aviso');
    expect(aviso.textContent).toContain('Ana, Bruno, Carla');
  });

  it('oculta o aviso ao re-renderizar com lista vazia', () => {
    const { rerender } = render(<AvisoPresenca outros={[{ id: 'u1', nome: 'Ana' }]} />);
    expect(screen.getByTestId('inbox-presenca-aviso')).toBeTruthy();

    rerender(<AvisoPresenca outros={[]} />);
    expect(screen.queryByTestId('inbox-presenca-aviso')).toBeNull();
  });
});
