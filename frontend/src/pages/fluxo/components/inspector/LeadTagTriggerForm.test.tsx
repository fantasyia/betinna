import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeadTagTriggerForm } from './LeadTagTriggerForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorTag } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Render-tests do LeadTagTriggerForm — travam o CONTRATO config-key com o
 * filtro do bus (`fluxo-event-bus`: config.tagNome + config.modo). O tsc não
 * pega chave errada (config é Record<string,unknown>); estes testes pegam.
 *
 * O mesmo GOTCHA do MudarTagForm vale aqui: o updater lê `e.target.value` de
 * forma preguiçosa, então o mock aplica na hora (como o parent real faz).
 */

const TAGS: InspectorTag[] = [
  { id: 't1', nome: 'setor:cadeia-do-frio' },
  { id: 't2', nome: 'publico:comercio' },
];

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return { titulo: 'Lead recebeu tag', tipo: 'TRIGGER', triggerTipo: 'LEAD_RECEBEU_TAG', config };
}

function makeOnUpdate(initial: NodePayload) {
  let current = initial;
  const results: NodePayload[] = [];
  const fn = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    current = updater(current);
    results.push(current);
  });
  return { fn, last: () => results.at(-1)! };
}

afterEach(cleanup);

describe('LeadTagTriggerForm', () => {
  it('default do modo é EXATO (evita colisão de substring entre slugs)', () => {
    const data = makeData({});
    const { fn } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    expect((screen.getByLabelText('Comparação') as HTMLSelectElement).value).toBe('exato');
  });

  it('modo exato lista as etiquetas — inclusive as com ":" (dimensão)', () => {
    const data = makeData({ tagNome: 'setor:cadeia-do-frio' });
    const { fn } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    const sel = screen.getByTestId('tag-trigger-nome-select') as HTMLSelectElement;
    expect(sel.value).toBe('setor:cadeia-do-frio');
  });

  it('escolher a etiqueta grava config.tagNome com o ":" intacto', () => {
    const data = makeData({});
    const { fn, last } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    fireEvent.change(screen.getByTestId('tag-trigger-nome-select'), {
      target: { value: 'publico:comercio' },
    });
    expect(last().config.tagNome).toBe('publico:comercio');
  });

  it('"Qualquer etiqueta" limpa o filtro (config.tagNome undefined)', () => {
    const data = makeData({ tagNome: 'publico:comercio' });
    const { fn, last } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    fireEvent.change(screen.getByTestId('tag-trigger-nome-select'), { target: { value: '' } });
    expect(last().config.tagNome).toBeUndefined();
  });

  it('modo prefixo troca pra campo de texto e grava o prefixo da família', () => {
    const data = makeData({ modo: 'prefixo' });
    const { fn, last } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    fireEvent.change(screen.getByTestId('tag-trigger-nome-input'), { target: { value: 'setor:' } });
    expect(last().config.modo).toBe('prefixo');
    expect(last().config.tagNome).toBe('setor:');
  });

  it('trocar o modo LIMPA o alvo (valor herdado casaria errado calado)', () => {
    const data = makeData({ tagNome: 'setor:cadeia-do-frio' });
    const { fn, last } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    fireEvent.change(screen.getByLabelText('Comparação'), { target: { value: 'prefixo' } });
    expect(last().config.modo).toBe('prefixo');
    expect(last().config.tagNome).toBeUndefined();
  });

  it('preserva etiqueta salva que não está mais na lista', () => {
    const data = makeData({ tagNome: 'setor:sumida' });
    const { fn } = makeOnUpdate(data);
    render(<LeadTagTriggerForm data={data} onUpdate={fn} tags={TAGS} />);
    expect((screen.getByTestId('tag-trigger-nome-select') as HTMLSelectElement).value).toBe(
      'setor:sumida',
    );
  });
});
