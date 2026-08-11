import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClienteInativoTriggerForm } from './ClienteInativoTriggerForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * #65: o `diasInativo` já era lido pelo backend, mas não existia campo na tela.
 * O usuário ficava preso nos 30 dias do nome do gatilho — e o template de
 * reativação prometia 21 dias enquanto a régua rodava em 30.
 */
const payload = (config: Record<string, unknown> = {}): NodePayload =>
  ({ tipo: 'TRIGGER', triggerTipo: 'CLIENTE_INATIVO_30D', label: 'x', config }) as NodePayload;

function montar(config: Record<string, unknown> = {}) {
  const onUpdate = vi.fn();
  render(<ClienteInativoTriggerForm data={payload(config)} onUpdate={onUpdate} />);
  const input = screen.getByTestId('trigger-dias-inativo') as HTMLInputElement;
  // Aplica o updater no payload atual pra ver o que seria gravado.
  const gravado = () => {
    const fn = onUpdate.mock.calls.at(-1)?.[0] as (d: NodePayload) => NodePayload;
    return fn(payload(config)).config;
  };
  return { input, onUpdate, gravado };
}

describe('ClienteInativoTriggerForm', () => {
  it('sem valor salvo, mostra o padrão de 30 como placeholder (não como valor)', () => {
    const { input } = montar();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('30');
  });

  it('mostra o valor já configurado', () => {
    const { input } = montar({ diasInativo: 21 });
    expect(input.value).toBe('21');
  });

  it('digitar grava o número em config.diasInativo', () => {
    const { input, gravado } = montar();
    fireEvent.change(input, { target: { value: '45' } });
    expect(gravado().diasInativo).toBe(45);
  });

  it('limpar o campo volta pro default — NÃO grava 0', () => {
    // Gravar 0 faria TODO cliente virar inativo na primeira varredura.
    const { input, gravado } = montar({ diasInativo: 21 });
    fireEvent.change(input, { target: { value: '' } });
    expect(gravado().diasInativo).toBeUndefined();
  });

  it('preserva o resto do config ao editar', () => {
    const { input, gravado } = montar({ diasInativo: 21, ticketMinimo: 2000 });
    fireEvent.change(input, { target: { value: '60' } });
    expect(gravado()).toEqual({ diasInativo: 60, ticketMinimo: 2000 });
  });
});
