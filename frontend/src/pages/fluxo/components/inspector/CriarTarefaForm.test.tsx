import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CriarTarefaForm } from './CriarTarefaForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorUsuario } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Render-test do contrato de config-keys do CriarTarefaForm.
 *
 * O tsc não pega erro de chave (config é Record<string,unknown>), então estes
 * testes travam que cada controle grava a CHAVE + VALOR certos no updater.
 *
 * Config-keys do form: titulo, descricao, responsavelId, diasApartirDeHoje.
 * Sutilezas testadas:
 *  - responsavelId vazio vira `undefined` (não string vazia).
 *  - diasApartirDeHoje passa por Number() (string do input → number).
 *
 * GOTCHA: os controles são CONTROLADOS (value={config.xxx}) e o onUpdate é mock
 * (não re-renderiza). Se a gente guardasse o updater e só chamasse depois, o
 * React já teria resetado o input pro valor controlado e `e.target.value`
 * leria o valor ANTIGO. Por isso aplicamos o updater DENTRO do mock, no momento
 * do evento, e guardamos o NodePayload resultante.
 */

afterEach(cleanup);

const usuarios: InspectorUsuario[] = [
  { id: 'u1', nome: 'Ana Rep', role: 'REP' },
  { id: 'u2', nome: 'Bruno Admin', role: 'ADMIN' },
];

function makeData(): NodePayload {
  return {
    titulo: 'Criar tarefa',
    tipo: 'ACAO',
    acaoTipo: 'CRIAR_TAREFA',
    config: {
      titulo: 'Ligar pro {{nome}}',
      descricao: 'Confirmar interesse',
      responsavelId: 'u1',
      diasApartirDeHoje: 3,
    },
  };
}

/**
 * Renderiza o form com um onUpdate que aplica o updater na hora (no evento) e
 * acumula os NodePayloads resultantes. Devolve { results } pra inspecionar a
 * última gravação.
 */
function setup(data: NodePayload) {
  const results: NodePayload[] = [];
  const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    results.push(updater(data));
  });
  render(<CriarTarefaForm data={data} onUpdate={onUpdate} usuarios={usuarios} />);
  const last = () => results.at(-1)!;
  return { onUpdate, results, last };
}

describe('CriarTarefaForm', () => {
  it('reflete o config inicial nos controles (round-trip de leitura)', () => {
    const data = makeData();
    setup(data);

    const titulo = screen.getByLabelText('Título da tarefa') as HTMLInputElement;
    expect(titulo.value).toBe('Ligar pro {{nome}}');

    const descricao = screen.getByLabelText('Descrição (opcional)') as HTMLTextAreaElement;
    expect(descricao.value).toBe('Confirmar interesse');

    const responsavel = screen.getByLabelText('Responsável') as HTMLSelectElement;
    expect(responsavel.value).toBe('u1');

    const prazo = screen.getByLabelText(
      'Prazo (dias a partir de hoje)',
    ) as HTMLInputElement;
    expect(prazo.value).toBe('3');

    // Lista de usuários vira <option> (+ o "Automático").
    expect(screen.getByRole('option', { name: 'Ana Rep' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bruno Admin' })).toBeTruthy();
  });

  it('escreve config.titulo no updater ao editar o título', () => {
    const data = makeData();
    const { onUpdate, last } = setup(data);

    fireEvent.change(screen.getByLabelText('Título da tarefa'), {
      target: { value: 'Novo título' },
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(last().config.titulo).toBe('Novo título');
    // Não mexe nas outras chaves.
    expect(last().config.descricao).toBe('Confirmar interesse');
  });

  it('escreve config.descricao no updater ao editar a descrição', () => {
    const data = makeData();
    const { last } = setup(data);

    fireEvent.change(screen.getByLabelText('Descrição (opcional)'), {
      target: { value: 'Outra descrição' },
    });

    expect(last().config.descricao).toBe('Outra descrição');
  });

  it('escreve config.responsavelId ao escolher um usuário', () => {
    const data = makeData();
    const { last } = setup(data);

    fireEvent.change(screen.getByLabelText('Responsável'), {
      target: { value: 'u2' },
    });

    expect(last().config.responsavelId).toBe('u2');
  });

  it('zera responsavelId para undefined ao escolher "Automático" (não string vazia)', () => {
    const data = makeData();
    const { last } = setup(data);

    fireEvent.change(screen.getByLabelText('Responsável'), {
      target: { value: '' },
    });

    expect(last().config.responsavelId).toBe(undefined);
  });

  it('converte o prazo para Number ao escrever config.diasApartirDeHoje', () => {
    const data = makeData();
    const { last } = setup(data);

    fireEvent.change(screen.getByLabelText('Prazo (dias a partir de hoje)'), {
      target: { value: '7' },
    });

    // Grava número, não a string '7'.
    expect(last().config.diasApartirDeHoje).toBe(7);
    expect(typeof last().config.diasApartirDeHoje).toBe('number');
  });
});
