import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrilhoAcao } from './TrilhoAcao';

/**
 * Trilho vazio não pode ocupar espaço.
 *
 * Os três módulos do trilho são opcionais (Personalizar). Com todos desligados o
 * `<aside>` continuava reservando 340px: uma coluna morta na direita, e — pior —
 * o canvas 340px mais estreito, o que fazia a tabela da sala de fluxos (mínimo
 * de 640px) precisar de rolagem horizontal a meia largura.
 */
// `useMediaQuery` é função LOCAL do componente (não hook importado): quem manda
// é o `window.matchMedia`. Simulamos tela larga (≥1600px), que é o caso do
// trilho pleno — onde os 340px reservados doíam.
beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('min-width: 1600px'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

describe('TrilhoAcao', () => {
  it('com conteúdo: renderiza a coluna', () => {
    render(
      <TrilhoAcao>
        <div>Precisa de você</div>
      </TrilhoAcao>,
    );

    expect(screen.getByTestId('trilho-acao')).toBeTruthy();
  });

  it('todos os módulos desligados: NÃO renderiza nada (nem os 340px)', () => {
    // É exatamente o que o Personalizar produz ao desligar os três:
    // `{false}{false}{false}`.
    render(
      <TrilhoAcao>
        {false}
        {false}
        {false}
      </TrilhoAcao>,
    );

    expect(screen.queryByTestId('trilho-acao')).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it('um módulo ligado entre desligados ainda renderiza', () => {
    render(
      <TrilhoAcao>
        {false}
        <div>Agenda de hoje</div>
        {false}
      </TrilhoAcao>,
    );

    expect(screen.getByTestId('trilho-acao')).toBeTruthy();
  });
});
