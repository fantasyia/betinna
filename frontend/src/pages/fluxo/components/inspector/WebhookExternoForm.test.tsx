import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WebhookExternoForm } from './WebhookExternoForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Contrato do WebhookExternoForm (WEBHOOK_EXTERNO).
 *
 * Trava as config-keys que o form LÊ/ESCREVE — o tsc não pega troca de chave
 * porque config é Record<string, unknown>. Os testes capturam o updater
 * passado pro onUpdate e aplicam sobre o `data` pra checar a chave/valor exatos.
 */

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Webhook externo',
    tipo: 'ACAO',
    acaoTipo: 'WEBHOOK_EXTERNO',
    config,
  };
}

/**
 * Host controlado: aplica o updater no state (pro input/select controlado
 * commitar o valor novo) e expõe o NodePayload resultante de cada chamada
 * via `onUpdate`, pra asserir a chave/valor exatos que o form gravou.
 */
function Host({ initial, onUpdate }: { initial: NodePayload; onUpdate: (d: NodePayload) => void }) {
  const [data, setData] = useState<NodePayload>(initial);
  return (
    <WebhookExternoForm
      data={data}
      onUpdate={(updater) =>
        setData((prev) => {
          const next = updater(prev);
          onUpdate(next);
          return next;
        })
      }
    />
  );
}

describe('WebhookExternoForm', () => {
  afterEach(() => cleanup());

  it('reflete config.url inicial no input (round-trip de leitura)', () => {
    const data = makeData({ url: 'https://exemplo.com/hook', method: 'POST' });
    const onUpdate = vi.fn();
    render(<WebhookExternoForm data={data} onUpdate={onUpdate} />);

    const input = screen.getByPlaceholderText('https://exemplo.com/hook') as HTMLInputElement;
    expect(input.value).toBe('https://exemplo.com/hook');
  });

  it('reflete config.method inicial no select (round-trip de leitura)', () => {
    const data = makeData({ url: '', method: 'PUT' });
    const onUpdate = vi.fn();
    render(<WebhookExternoForm data={data} onUpdate={onUpdate} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('PUT');
  });

  it('default do método é POST quando config.method ausente', () => {
    const data = makeData({});
    const onUpdate = vi.fn();
    render(<WebhookExternoForm data={data} onUpdate={onUpdate} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('POST');
  });

  it('editar a URL grava config.url (e preserva method)', () => {
    const onUpdate = vi.fn<(d: NodePayload) => void>();
    render(<Host initial={makeData({ url: '', method: 'POST' })} onUpdate={onUpdate} />);

    const input = screen.getByPlaceholderText('https://exemplo.com/hook') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://novo.com/webhook' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const resultado = onUpdate.mock.calls.at(-1)![0];
    expect(resultado.config.url).toBe('https://novo.com/webhook');
    // não mexe no método existente
    expect(resultado.config.method).toBe('POST');
  });

  it('trocar o método grava config.method (e preserva url)', () => {
    const onUpdate = vi.fn<(d: NodePayload) => void>();
    render(<Host initial={makeData({ url: 'https://x.com', method: 'POST' })} onUpdate={onUpdate} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GET' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const resultado = onUpdate.mock.calls.at(-1)![0];
    expect(resultado.config.method).toBe('GET');
    // não mexe na url existente
    expect(resultado.config.url).toBe('https://x.com');
  });

  it('updater preserva titulo/tipo/acaoTipo (não-config) intactos', () => {
    const onUpdate = vi.fn<(d: NodePayload) => void>();
    render(<Host initial={makeData({ url: '', method: 'POST' })} onUpdate={onUpdate} />);

    const input = screen.getByPlaceholderText('https://exemplo.com/hook') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://y.com' } });

    const resultado = onUpdate.mock.calls.at(-1)![0];
    expect(resultado.titulo).toBe('Webhook externo');
    expect(resultado.tipo).toBe('ACAO');
    expect(resultado.acaoTipo).toBe('WEBHOOK_EXTERNO');
  });
});
