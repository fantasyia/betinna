import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MudarTagForm } from './MudarTagForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorTag } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Render-tests do MudarTagForm — travam o CONTRATO config-key.
 * O tsc não pega chave errada (config é Record<string,unknown>); estes testes pegam.
 *
 * Form props: { data, onUpdate, tags }.
 * Config lida/escrita: operacao ('adicionar'/'remover') + tagNome (string = nome da tag).
 * Há 2 <select> (Operação, Tag) → desambiguados via getByLabelText (Field liga label↔id).
 *
 * GOTCHA importante (e por isso o harness abaixo):
 * o form passa um updater que lê `e.target.value` de forma PREGUIÇOSA. Como o <select>
 * é controlado, React reverte o value do DOM logo após o handler. Se a gente guardasse o
 * updater e só chamasse depois, `e.target.value` já teria revertido → valor velho.
 * O parent real (NodeInspector) aplica o updater AINDA dentro do handler, com o evento vivo.
 * Então o mock de onUpdate aplica o updater na hora e guarda o resultado — fiel ao parent.
 */

const TAGS: InspectorTag[] = [
  { id: 't1', nome: 'Quente' },
  { id: 't2', nome: 'Frio' },
];

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Mudar tag',
    tipo: 'ACAO',
    acaoTipo: 'MUDAR_TAG',
    config,
  };
}

/**
 * onUpdate que aplica o updater na hora (como o parent real), acumulando o estado.
 * Retorna o mock + um getter do último payload resultante.
 */
function makeOnUpdate(initial: NodePayload) {
  let current = initial;
  const results: NodePayload[] = [];
  const fn = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    current = updater(current);
    results.push(current);
  });
  return { fn, last: () => results.at(-1)!, results };
}

afterEach(cleanup);

describe('MudarTagForm', () => {
  it('reflete config.operacao inicial no select de Operação (round-trip de leitura)', () => {
    const data = makeData({ operacao: 'remover', tagNome: 'Quente' });
    const { fn } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    const operacao = screen.getByLabelText('Operação') as HTMLSelectElement;
    expect(operacao.value).toBe('remover');
  });

  it('usa "adicionar" como default quando config.operacao está ausente', () => {
    const data = makeData({});
    const { fn } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    const operacao = screen.getByLabelText('Operação') as HTMLSelectElement;
    expect(operacao.value).toBe('adicionar');
  });

  it('reflete config.tagNome inicial no select de Tag (round-trip de leitura)', () => {
    const data = makeData({ operacao: 'adicionar', tagNome: 'Frio' });
    const { fn } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    const tag = screen.getByLabelText('Tag') as HTMLSelectElement;
    expect(tag.value).toBe('Frio');
  });

  it('mudar Operação grava config.operacao (e preserva tagNome)', () => {
    const data = makeData({ operacao: 'adicionar', tagNome: 'Quente' });
    const { fn, last } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    fireEvent.change(screen.getByLabelText('Operação'), { target: { value: 'remover' } });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(last().config.operacao).toBe('remover');
    // só a chave mexida muda — tagNome preservada.
    expect(last().config.tagNome).toBe('Quente');
  });

  it('mudar Tag grava config.tagNome (NOME da tag, não id) e preserva operacao', () => {
    const data = makeData({ operacao: 'adicionar', tagNome: 'Quente' });
    const { fn, last } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'Frio' } });

    expect(fn).toHaveBeenCalledTimes(1);
    // value da <option> é t.nome → grava o NOME (não o id 't2').
    expect(last().config.tagNome).toBe('Frio');
    expect(last().config.operacao).toBe('adicionar');
  });

  it('limpar a Tag grava config.tagNome vazio', () => {
    const data = makeData({ operacao: 'adicionar', tagNome: 'Quente' });
    const { fn, last } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: '' } });

    expect(last().config.tagNome).toBe('');
  });

  it('preserva tag salva fora da lista como <option> extra (não some do select)', () => {
    const data = makeData({ operacao: 'adicionar', tagNome: 'TagAntiga' });
    const { fn } = makeOnUpdate(data);
    render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);

    const tag = screen.getByLabelText('Tag') as HTMLSelectElement;
    // mantém o valor mesmo não estando em TAGS (option preservada).
    expect(tag.value).toBe('TagAntiga');
    expect(screen.getByText('TagAntiga')).toBeTruthy();
  });

  it('renderiza as tags da lista como options e tolera tags=null', () => {
    const data = makeData({ operacao: 'adicionar', tagNome: '' });
    const { fn } = makeOnUpdate(data);
    const { rerender } = render(<MudarTagForm data={data} onUpdate={fn} tags={TAGS} />);
    expect(screen.getByText('Quente')).toBeTruthy();
    expect(screen.getByText('Frio')).toBeTruthy();

    // tags=null não deve quebrar (usa `tags ?? []`).
    rerender(<MudarTagForm data={data} onUpdate={fn} tags={null} />);
    const tag = screen.getByLabelText('Tag') as HTMLSelectElement;
    expect(tag.value).toBe('');
  });
});
