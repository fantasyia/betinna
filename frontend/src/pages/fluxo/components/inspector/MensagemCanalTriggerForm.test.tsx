import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MensagemCanalTriggerForm } from './MensagemCanalTriggerForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Trava o CONTRATO config-key do MensagemCanalTriggerForm — o backend
 * (fluxo-event-bus) lê config.palavrasChave/modo/caseSensitive/apenasComLead.
 * Os onChange fecham sobre o evento síncrono; o spy aplica o updater na hora.
 */
afterEach(cleanup);

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return { titulo: 'Mensagem', tipo: 'TRIGGER', triggerTipo: 'MENSAGEM_CANAL', config };
}
function makeOnUpdate(data: NodePayload) {
  let last: NodePayload | null = null;
  const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    last = updater(data);
  });
  return { onUpdate, getLast: () => last as NodePayload };
}

describe('MensagemCanalTriggerForm', () => {
  it('sem palavras: o seletor de modo NÃO aparece', () => {
    render(<MensagemCanalTriggerForm data={makeData()} onUpdate={vi.fn()} />);
    // Só o checkbox "lead conhecido" existe; nenhum combobox (modo) renderizado.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('ESCRITA: textarea grava config.palavrasChave como array (split/trim/filter)', () => {
    const data = makeData();
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<MensagemCanalTriggerForm data={data} onUpdate={onUpdate} />);

    const ta = screen.getByPlaceholderText(/cancelar/) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cancelar\n  quero comprar  \n\n' } });

    expect(getLast().config.palavrasChave).toEqual(['cancelar', 'quero comprar']);
  });

  it('com palavras: seletor de modo aparece e grava config.modo', () => {
    const data = makeData({ palavrasChave: ['cancelar'] });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<MensagemCanalTriggerForm data={data} onUpdate={onUpdate} />);

    const modo = screen.getByRole('combobox') as HTMLSelectElement;
    expect(modo.value).toBe('qualquer'); // default
    fireEvent.change(modo, { target: { value: 'exata' } });
    expect(getLast().config.modo).toBe('exata');
  });

  it('ESCRITA: checkbox "lead conhecido" grava config.apenasComLead', () => {
    const data = makeData();
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<MensagemCanalTriggerForm data={data} onUpdate={onUpdate} />);

    const chk = screen.getByRole('checkbox', { name: /lead conhecido/i });
    fireEvent.click(chk);
    expect(getLast().config.apenasComLead).toBe(true);
  });

  it('ESCRITA: caseSensitive grava a chave certa quando há palavras', () => {
    const data = makeData({ palavrasChave: ['cancelar'] });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<MensagemCanalTriggerForm data={data} onUpdate={onUpdate} />);

    const chk = screen.getByRole('checkbox', { name: /maiúsculas/i });
    fireEvent.click(chk);
    expect(getLast().config.caseSensitive).toBe(true);
  });
});
