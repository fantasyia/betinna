import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DestinatariosField } from './DestinatariosField';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Trava o CONTRATO do DestinatariosField (campo standalone usado pelo EmailActionForm).
 * Único config-key que ele LÊ e ESCREVE: `config.destinatarios` (string[] de tokens
 * `user:<id>` / `papel:<PAPEL>` / e-mail fixo / {{variável}}).
 *
 * O tsc não pega chave errada (config é Record<string, unknown>) — estes testes pegam.
 * Como o form sempre reconstrói a lista a partir de `data.config.destinatarios`, o
 * updater capturado pode ser aplicado direto sobre `data`.
 */

afterEach(cleanup);

const usuarios = [
  { id: 'u1', nome: 'Ana', role: 'ADMIN' },
  { id: 'u2', nome: 'Beto', role: 'GERENTE' },
];

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Enviar e-mail',
    tipo: 'ACAO',
    acaoTipo: 'ENVIAR_EMAIL',
    config: {
      destinatarios: ['user:u1', 'papel:GERENTE'],
      ...config,
    },
  };
}

describe('DestinatariosField', () => {
  it('round-trip de leitura: renderiza um chip por token do config (rótulo resolvido)', () => {
    const data = makeData();
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    // user:u1 vira "👤 Ana" (nome resolvido via usuarios), papel:GERENTE vira "🏷️ GERENTE".
    // O texto "👤 Ana" também aparece numa <option> do select; filtra pelo chip (<span>).
    const anaChip = screen
      .getAllByText('👤 Ana')
      .find((el) => el.tagName === 'SPAN');
    expect(anaChip).toBeTruthy();
    const papelChip = screen
      .getAllByText('🏷️ GERENTE')
      .find((el) => el.tagName === 'SPAN');
    expect(papelChip).toBeTruthy();
    // um botão de remover por chip
    expect(screen.getAllByLabelText('Remover destinatário')).toHaveLength(2);
    // nada disparado só por render
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('lista vazia: nenhum chip e nenhum onUpdate no render', () => {
    const data = makeData({ destinatarios: [] });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    expect(screen.queryAllByLabelText('Remover destinatário')).toHaveLength(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('config.destinatarios undefined cai pra [] sem crash', () => {
    const data = makeData({ destinatarios: undefined });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    expect(screen.queryAllByLabelText('Remover destinatário')).toHaveLength(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('escrita: escolher usuário no select faz append do token user:<id>', () => {
    const data = makeData({ destinatarios: [] });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'user:u2' } });

    expect(onUpdate).toHaveBeenCalled();
    const updater = onUpdate.mock.calls.at(-1)![0] as (d: NodePayload) => NodePayload;
    const resultado = updater(data);
    expect(resultado.config.destinatarios).toEqual(['user:u2']);
  });

  it('escrita: escolher papel no select faz append do token papel:<PAPEL>', () => {
    const data = makeData({ destinatarios: ['user:u1'] });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'papel:ADMIN' } });

    expect(onUpdate).toHaveBeenCalled();
    const updater = onUpdate.mock.calls.at(-1)![0] as (d: NodePayload) => NodePayload;
    const resultado = updater(data);
    expect(resultado.config.destinatarios).toEqual(['user:u1', 'papel:ADMIN']);
  });

  it('escrita: digitar e-mail fixo + Enter faz append (e trim) na config.destinatarios', () => {
    const data = makeData();
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const emailInput = screen.getByPlaceholderText(
      'e-mail fixo ou {{variavel}} (Enter)',
    ) as HTMLInputElement;
    // espaços nas pontas pra travar o trim()
    fireEvent.change(emailInput, { target: { value: '  foo@bar.com  ' } });
    fireEvent.keyDown(emailInput, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalled();
    const updater = onUpdate.mock.calls.at(-1)![0] as (d: NodePayload) => NodePayload;
    const resultado = updater(data);
    expect(resultado.config.destinatarios).toEqual([
      'user:u1',
      'papel:GERENTE',
      'foo@bar.com',
    ]);
  });

  it('escrita: botão + também faz append do e-mail fixo digitado', () => {
    const data = makeData({ destinatarios: [] });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const emailInput = screen.getByPlaceholderText(
      'e-mail fixo ou {{variavel}} (Enter)',
    ) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: '{{lead.email}}' } });
    fireEvent.click(screen.getByRole('button', { name: '+' }));

    expect(onUpdate).toHaveBeenCalled();
    const updater = onUpdate.mock.calls.at(-1)![0] as (d: NodePayload) => NodePayload;
    const resultado = updater(data);
    expect(resultado.config.destinatarios).toEqual(['{{lead.email}}']);
  });

  it('dedup: token já presente NÃO dispara onUpdate (não duplica)', () => {
    const data = makeData({ destinatarios: ['user:u1', 'papel:GERENTE'] });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'user:u1' } });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('escrita: remover chip grava a lista sem o token removido (filter por índice)', () => {
    const data = makeData({ destinatarios: ['user:u1', 'papel:GERENTE'] });
    const onUpdate = vi.fn();
    render(<DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    // remove o primeiro chip (user:u1)
    fireEvent.click(screen.getAllByLabelText('Remover destinatário')[0]);

    expect(onUpdate).toHaveBeenCalled();
    const updater = onUpdate.mock.calls.at(-1)![0] as (d: NodePayload) => NodePayload;
    const resultado = updater(data);
    expect(resultado.config.destinatarios).toEqual(['papel:GERENTE']);
  });
});
