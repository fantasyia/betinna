import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { WhatsAppActionForm } from './WhatsAppActionForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorContatoWa } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Trava o CONTRATO config-key do WhatsAppActionForm.
 *
 * O tsc não pega erro de chave (config é Record<string,unknown>); estes testes
 * garantem que cada controle grava a CHAVE certa no updater de onUpdate.
 * Chaves cobertas: destinatarioModo, destinatarioNumero, destinatarioContato, mensagem.
 *
 * GOTCHA: os onChange do form passam `(d) => ({ ...d, config: { ..., x: e.target.value }})`.
 * O updater fecha sobre o EVENTO sintético — e React reverte `e.target.value` pro valor
 * controlado assim que o handler retorna. Então NÃO dá pra chamar o updater depois do
 * fireEvent. A solução (que espelha a produção): o spy `onUpdate` aplica o updater
 * SÍNCRONO, dentro do próprio handler, contra o `data` atual, e guarda o resultado.
 */

afterEach(cleanup);

const CONTATOS: InspectorContatoWa[] = [
  { id: '5511999999999', nome: 'João', tipo: 'CONTATO' },
  { id: '123@g.us', nome: 'Grupo MSM', tipo: 'GRUPO' },
];

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Enviar WhatsApp',
    tipo: 'ACAO',
    acaoTipo: 'ENVIAR_WHATSAPP',
    config,
  };
}

/**
 * Cria um onUpdate que aplica o updater SÍNCRONO contra `data` (como o reducer real
 * do inspector faria) e expõe o último resultado em `getLast()`.
 */
function makeOnUpdate(data: NodePayload) {
  let last: NodePayload | null = null;
  const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    last = updater(data);
  });
  return { onUpdate, getLast: () => last as NodePayload };
}

describe('WhatsAppActionForm', () => {
  it('LEITURA: reflete config inicial (modo + mensagem) nos controles', () => {
    const data = makeData({ destinatarioModo: 'lead', mensagem: 'Olá teste' });
    const onUpdate = vi.fn();
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={CONTATOS} />);

    const modo = screen.getByRole('combobox') as HTMLSelectElement;
    expect(modo.value).toBe('lead');

    const msg = screen.getByPlaceholderText('Olá {{nome}}, tudo bem?') as HTMLTextAreaElement;
    expect(msg.value).toBe('Olá teste');
  });

  it('LEITURA: sem destinatarioModo no config cai no default "lead"', () => {
    const data = makeData({});
    const onUpdate = vi.fn();
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={null} />);

    const modo = screen.getByRole('combobox') as HTMLSelectElement;
    expect(modo.value).toBe('lead');
  });

  it('ESCRITA: trocar destinatário grava config.destinatarioModo', () => {
    const data = makeData({ destinatarioModo: 'lead' });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={CONTATOS} />);

    const modo = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(modo, { target: { value: 'numero' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(getLast().config.destinatarioModo).toBe('numero');
  });

  it('ESCRITA: campo Número só aparece no modo "numero" e grava config.destinatarioNumero', () => {
    // No modo "lead" o input de número NÃO existe.
    const leadData = makeData({ destinatarioModo: 'lead' });
    const { unmount } = render(
      <WhatsAppActionForm data={leadData} onUpdate={vi.fn()} contatosWa={CONTATOS} />,
    );
    expect(screen.queryByPlaceholderText('+55 11 99999-9999')).toBeNull();
    unmount();

    // No modo "numero" o input aparece, reflete o valor e grava a chave certa.
    const data = makeData({ destinatarioModo: 'numero', destinatarioNumero: '+55 11 1' });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={CONTATOS} />);

    const input = screen.getByPlaceholderText('+55 11 99999-9999') as HTMLInputElement;
    expect(input.value).toBe('+55 11 1');

    fireEvent.change(input, { target: { value: '+55 11 98888-7777' } });
    expect(getLast().config.destinatarioNumero).toBe('+55 11 98888-7777');
  });

  it('ESCRITA: campo Contato só aparece no modo "contato" e grava config.destinatarioContato', () => {
    const data = makeData({ destinatarioModo: 'contato', destinatarioContato: '5511999999999' });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={CONTATOS} />);

    // Dois selects no modo "contato": [0] = modo, [1] = contato.
    const combos = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(combos).toHaveLength(2);
    const contatoSelect = combos[1];
    expect(contatoSelect.value).toBe('5511999999999');

    // As opções da lista de contatos foram renderizadas (grupo prefixado).
    expect(screen.getByText('Grupo · Grupo MSM')).toBeTruthy();

    fireEvent.change(contatoSelect, { target: { value: '123@g.us' } });
    expect(getLast().config.destinatarioContato).toBe('123@g.us');
  });

  it('ESCRITA: editar a mensagem grava config.mensagem (sem vazar pra outra chave)', () => {
    const data = makeData({ destinatarioModo: 'lead', mensagem: '' });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={CONTATOS} />);

    const msg = screen.getByPlaceholderText('Olá {{nome}}, tudo bem?') as HTMLTextAreaElement;
    fireEvent.change(msg, { target: { value: 'Mensagem nova {{empresa}}' } });

    expect(getLast().config.mensagem).toBe('Mensagem nova {{empresa}}');
    // Round-trip: o merge preserva o modo existente.
    expect(getLast().config.destinatarioModo).toBe('lead');
  });

  it('updater preserva config existente (merge, não substitui)', () => {
    const data = makeData({
      destinatarioModo: 'numero',
      destinatarioNumero: '+55 11 1',
      mensagem: 'oi',
    });
    const { onUpdate, getLast } = makeOnUpdate(data);
    render(<WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={CONTATOS} />);

    const input = screen.getByPlaceholderText('+55 11 99999-9999') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '+55 11 2' } });

    const resultado = getLast();
    expect(resultado.config.destinatarioNumero).toBe('+55 11 2');
    expect(resultado.config.mensagem).toBe('oi');
    expect(resultado.config.destinatarioModo).toBe('numero');
  });
});
