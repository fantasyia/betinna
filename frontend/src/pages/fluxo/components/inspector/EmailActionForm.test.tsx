import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EmailActionForm } from './EmailActionForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorUsuario } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Trava o CONTRATO do EmailActionForm (ACAO + ENVIAR_EMAIL):
 * cada controle grava a CHAVE certa no config via o updater passado a onUpdate.
 * O tsc não pega chave errada (config é Record<string, unknown>) — estes testes pegam.
 */

afterEach(cleanup);

const usuarios: InspectorUsuario[] = [
  { id: 'u1', nome: 'Ana', role: 'ADMIN' },
  { id: 'u2', nome: 'Beto', role: 'GERENTE' },
];

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Enviar e-mail',
    tipo: 'ACAO',
    acaoTipo: 'ENVIAR_EMAIL',
    config: {
      assunto: 'Bem-vindo',
      corpo: '<p>Olá</p>',
      destinatarios: ['user:u1', 'papel:GERENTE'],
      ...config,
    },
  };
}

describe('EmailActionForm', () => {
  it('reflete o assunto inicial do config (round-trip de leitura)', () => {
    const data = makeData();
    const onUpdate = vi.fn();
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    // O Input de assunto renderiza com value = config.assunto
    const input = screen.getByDisplayValue('Bem-vindo') as HTMLInputElement;
    expect(input.value).toBe('Bem-vindo');
  });

  it('reflete o corpo inicial do config no textarea', () => {
    const data = makeData();
    const onUpdate = vi.fn();
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const textarea = screen.getByDisplayValue('<p>Olá</p>') as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('<p>Olá</p>');
  });

  it('escrita: editar assunto grava config.assunto', () => {
    const data = makeData();
    // Aplica o updater na hora (durante o dispatch), pois o handler lê e.target.value
    // — ler depois (lazy) pega o valor revertido do input controlado.
    let resultado: NodePayload = data;
    const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
      resultado = updater(resultado);
    });
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const input = screen.getByDisplayValue('Bem-vindo');
    fireEvent.change(input, { target: { value: 'Novo assunto' } });

    expect(onUpdate).toHaveBeenCalled();
    expect(resultado.config.assunto).toBe('Novo assunto');
    // não mexe em outras chaves
    expect(resultado.config.corpo).toBe('<p>Olá</p>');
  });

  it('escrita: editar corpo grava config.corpo', () => {
    const data = makeData();
    let resultado: NodePayload = data;
    const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
      resultado = updater(resultado);
    });
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const textarea = screen.getByDisplayValue('<p>Olá</p>');
    fireEvent.change(textarea, { target: { value: '<p>Novo corpo</p>' } });

    expect(onUpdate).toHaveBeenCalled();
    expect(resultado.config.corpo).toBe('<p>Novo corpo</p>');
    expect(resultado.config.assunto).toBe('Bem-vindo');
  });

  it('valor undefined no config cai pra string vazia (sem crash)', () => {
    const data = makeData({ assunto: undefined, corpo: undefined });
    const onUpdate = vi.fn();
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    // ambos controles vazios coexistem; nenhum dispara onUpdate só por render
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('destinatarios: adicionar e-mail fixo grava config.destinatarios append', () => {
    const data = makeData();
    const onUpdate = vi.fn();
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    // Input de e-mail fixo do DestinatariosField (controlado por useState '')
    const emailInput = screen.getByPlaceholderText(
      'e-mail fixo ou {{variavel}} (Enter)',
    ) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'foo@bar.com' } });
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

  it('destinatarios: escolher usuário no select grava token user:<id>', () => {
    const data = makeData({ destinatarios: [] });
    const onUpdate = vi.fn();
    render(<EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'user:u2' } });

    expect(onUpdate).toHaveBeenCalled();
    const updater = onUpdate.mock.calls.at(-1)![0] as (d: NodePayload) => NodePayload;
    const resultado = updater({ ...data, config: { ...data.config, destinatarios: [] } });
    expect(resultado.config.destinatarios).toEqual(['user:u2']);
  });
});
