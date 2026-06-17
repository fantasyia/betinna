/**
 * Render-tests do BarraTagsTriagem — trava o contrato visual e de interação.
 *
 * O componente usa useTagsConversa internamente (estado + API calls).
 * Mockamos o hook para controlar tagsAtuais/salvando sem disparar chamadas HTTP.
 *
 * Observáveis travados:
 *  - renderiza null quando conv=null
 *  - cada tag de tagsAtuais aparece com data-testid=inbox-tag-{tag}
 *  - clicar em "Remover tag X" chama removerTag(tag)
 *  - input de nova tag está presente quando tagsAtuais.length < 12
 *  - input desabilitado quando salvando=true
 *  - texto placeholder "Etiquetas de triagem internas" quando tagsAtuais=[]
 *  - não exibe input quando tagsAtuais.length === 12
 *  - pressionar Enter no input chama adicionarTag
 */

import { vi, afterEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ─── mocks (hoisted) ─────────────────────────────────────────────────────────

// Estado controlável do hook mockado
let mockHookState: {
  tagsAtuais: string[];
  novaTag: string;
  setNovaTag: ReturnType<typeof vi.fn>;
  salvando: boolean;
  adicionarTag: ReturnType<typeof vi.fn>;
  removerTag: ReturnType<typeof vi.fn>;
} = {
  tagsAtuais: [],
  novaTag: '',
  setNovaTag: vi.fn(),
  salvando: false,
  adicionarTag: vi.fn(),
  removerTag: vi.fn(),
};

vi.mock('../hooks/useTagsConversa', () => ({
  useTagsConversa: () => mockHookState,
}));

// ─── source imports ──────────────────────────────────────────────────────────

import { BarraTagsTriagem } from './BarraTagsTriagem';
import type { Conversation } from '../lib/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    canal: 'WHATSAPP',
    status: 'ABERTA',
    peerId: '5511999990000@s.whatsapp.net',
    tagsInternas: [],
    ...overrides,
  };
}

function resetHook(partial: Partial<typeof mockHookState> = {}) {
  mockHookState = {
    tagsAtuais: [],
    novaTag: '',
    setNovaTag: vi.fn(),
    salvando: false,
    adicionarTag: vi.fn(),
    removerTag: vi.fn(),
    ...partial,
  };
}

afterEach(() => {
  cleanup();
  resetHook();
});

// ─── testes ──────────────────────────────────────────────────────────────────

describe('BarraTagsTriagem', () => {
  it('renderiza null quando conv=null', () => {
    render(
      <BarraTagsTriagem conv={null} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.queryByTestId('inbox-tags-bar')).toBeNull();
  });

  it('renderiza null quando conv=undefined', () => {
    render(
      <BarraTagsTriagem conv={undefined} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.queryByTestId('inbox-tags-bar')).toBeNull();
  });

  it('renderiza a barra quando conv está presente', () => {
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.getByTestId('inbox-tags-bar')).toBeTruthy();
  });

  it('exibe texto placeholder quando tagsAtuais está vazio', () => {
    resetHook({ tagsAtuais: [] });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.getByText('Etiquetas de triagem internas')).toBeTruthy();
  });

  it('exibe os chips de tags presentes em tagsAtuais', () => {
    resetHook({ tagsAtuais: ['urgente', 'devolucao'] });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.getByTestId('inbox-tag-urgente')).toBeTruthy();
    expect(screen.getByTestId('inbox-tag-devolucao')).toBeTruthy();
    // texto da tag aparece dentro do chip
    expect(screen.getByTestId('inbox-tag-urgente').textContent).toContain('urgente');
    expect(screen.getByTestId('inbox-tag-devolucao').textContent).toContain('devolucao');
  });

  it('não exibe placeholder quando há tags', () => {
    resetHook({ tagsAtuais: ['urgente'] });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.queryByText('Etiquetas de triagem internas')).toBeNull();
  });

  it('clicar em remover chama removerTag com o nome correto da tag', () => {
    const removerTag = vi.fn();
    resetHook({ tagsAtuais: ['urgente', 'vip'], removerTag });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('inbox-tag-remove-urgente'));
    expect(removerTag).toHaveBeenCalledTimes(1);
    expect(removerTag).toHaveBeenCalledWith('urgente');
  });

  it('clicar em remover outra tag passa o nome correto', () => {
    const removerTag = vi.fn();
    resetHook({ tagsAtuais: ['urgente', 'vip'], removerTag });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('inbox-tag-remove-vip'));
    expect(removerTag).toHaveBeenCalledWith('vip');
  });

  it('exibe o input de nova tag quando tagsAtuais.length < 12', () => {
    resetHook({ tagsAtuais: ['a', 'b'] });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.getByTestId('inbox-tag-input')).toBeTruthy();
  });

  it('oculta o input de nova tag quando tagsAtuais.length === 12', () => {
    resetHook({
      tagsAtuais: ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'],
    });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.queryByTestId('inbox-tag-input')).toBeNull();
  });

  it('botões de remover ficam disabled quando salvando=true', () => {
    resetHook({ tagsAtuais: ['urgente'], salvando: true });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    const btnRemover = screen.getByTestId('inbox-tag-remove-urgente') as HTMLButtonElement;
    expect(btnRemover.disabled).toBe(true);
  });

  it('input fica disabled quando salvando=true', () => {
    resetHook({ tagsAtuais: [], salvando: true });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    const input = screen.getByTestId('inbox-tag-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('pressionar Enter no input chama adicionarTag', () => {
    const adicionarTag = vi.fn();
    resetHook({ tagsAtuais: [], adicionarTag });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );

    const input = screen.getByTestId('inbox-tag-input');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(adicionarTag).toHaveBeenCalledTimes(1);
  });

  it('outras teclas no input NÃO chamam adicionarTag', () => {
    const adicionarTag = vi.fn();
    resetHook({ tagsAtuais: [], adicionarTag });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );

    const input = screen.getByTestId('inbox-tag-input');
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(adicionarTag).not.toHaveBeenCalled();
  });

  it('digitar no input chama setNovaTag com o novo valor', () => {
    const setNovaTag = vi.fn();
    resetHook({ tagsAtuais: [], setNovaTag });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );

    const input = screen.getByTestId('inbox-tag-input');
    fireEvent.change(input, { target: { value: 'novo' } });
    expect(setNovaTag).toHaveBeenCalledWith('novo');
  });

  it('o valor exibido no input é novaTag vindo do hook', () => {
    resetHook({ tagsAtuais: [], novaTag: 'digitando' });
    render(
      <BarraTagsTriagem conv={makeConv()} id="c1" refetchConv={vi.fn()} onChanged={vi.fn()} />,
    );
    const input = screen.getByTestId('inbox-tag-input') as HTMLInputElement;
    expect(input.value).toBe('digitando');
  });
});
