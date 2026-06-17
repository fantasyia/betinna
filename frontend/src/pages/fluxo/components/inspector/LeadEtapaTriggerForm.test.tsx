import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LeadEtapaTriggerForm } from './LeadEtapaTriggerForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapa, InspectorFunil } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Render-test de CONTRATO do LeadEtapaTriggerForm (trigger LEAD_ETAPA_MUDOU).
 *
 * O tsc NÃO pega erro de config-key (config é Record<string, unknown>), então
 * estes testes travam o contrato: ao mexer num controle, o form chama onUpdate
 * com um updater que grava a CHAVE e o VALOR certos.
 *
 * ESPECIAL: dropdowns dependentes. Trocar o FUNIL deve LIMPAR paraEtapa/deEtapa
 * (podem não existir no novo funil) — esse é o invariante mais importante aqui.
 *
 * Sem @testing-library/jest-dom neste projeto — só getBy / queryBy + matchers
 * core do vitest (toBe / toEqual / toHaveBeenCalled...).
 *
 * Os selects são CONTROLADOS (value vem de data.config). Pra um fireEvent.change
 * fluir de verdade, o pai precisa re-renderizar com o novo data — senão o React
 * reverte o value pro controlado e o handler nem dispara. Por isso usamos um
 * Harness com estado que aplica o updater real do form, e inspecionamos o
 * último payload commitado (`box.current`) — isso exercita o updater de ponta a ponta.
 *
 * Os três selects renderizam em ordem fixa: [0] Funil, [1] Para etapa, [2] De etapa.
 */

const etapasFunilA: InspectorEtapa[] = [
  { id: 'a1', nome: 'Novo' },
  { id: 'a2', nome: 'Qualificado' },
];
const etapasFunilB: InspectorEtapa[] = [
  { id: 'b1', nome: 'Em negociação' },
  { id: 'b2', nome: 'Fechado' },
];

const funis: InspectorFunil[] = [
  { id: 'funil-a', nome: 'Funil A', etapas: etapasFunilA },
  { id: 'funil-b', nome: 'Funil B', etapas: etapasFunilB },
];

/** etapasDoFunil real: devolve as etapas do funil pedido (igual o useInspectorData faz). */
const etapasDoFunil = (funilId?: string): InspectorEtapa[] =>
  funis.find((f) => f.id === funilId)?.etapas ?? [];

/** NodePayload representativo, com config já preenchido pros controles renderizarem com valor. */
function makeData(configOverrides: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Lead mudou de etapa',
    tipo: 'TRIGGER',
    triggerTipo: 'LEAD_ETAPA_MUDOU',
    config: { ...configOverrides },
  };
}

/**
 * Host com estado real: aplica o updater do form e re-renderiza (controlado de verdade).
 * `box.current` segura o último payload commitado, pra asserir o resultado do updater.
 * `onUpdate` é um spy que recebe o updater toda vez que o form chama onUpdate.
 */
function Harness({
  initial,
  box,
  onUpdate,
}: {
  initial: NodePayload;
  box: { current: NodePayload };
  onUpdate: ReturnType<typeof vi.fn>;
}) {
  const [data, setData] = useState<NodePayload>(initial);
  return (
    <LeadEtapaTriggerForm
      data={data}
      onUpdate={(updater) => {
        onUpdate(updater);
        setData((prev) => {
          const next = updater(prev);
          box.current = next;
          return next;
        });
      }}
      funis={funis}
      etapasDoFunil={etapasDoFunil}
    />
  );
}

function setup(initialConfig: Record<string, unknown> = {}) {
  const initial = makeData(initialConfig);
  const box = { current: initial };
  const onUpdate = vi.fn();
  render(<Harness initial={initial} box={box} onUpdate={onUpdate} />);
  const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
  return {
    box,
    onUpdate,
    funilSelect: selects[0],
    paraEtapaSelect: selects[1],
    deEtapaSelect: selects[2],
  };
}

afterEach(() => cleanup());

describe('LeadEtapaTriggerForm — contrato de config-keys', () => {
  it('renderiza os três selects (funil / para etapa / de etapa)', () => {
    setup();
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3);
  });

  it('lê config.funil no primeiro select (round-trip de leitura)', () => {
    const { funilSelect } = setup({ funil: 'funil-b' });
    expect(funilSelect.value).toBe('funil-b');
  });

  it('lê config.paraEtapa e config.deEtapa nos selects dependentes', () => {
    const { paraEtapaSelect, deEtapaSelect } = setup({
      funil: 'funil-a',
      paraEtapa: 'a2',
      deEtapa: 'a1',
    });
    expect(paraEtapaSelect.value).toBe('a2');
    expect(deEtapaSelect.value).toBe('a1');
  });

  it('escolher um funil grava config.funil com o id escolhido', () => {
    const { funilSelect, box, onUpdate } = setup({});
    fireEvent.change(funilSelect, { target: { value: 'funil-a' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(box.current.config.funil).toBe('funil-a');
    expect(funilSelect.value).toBe('funil-a');
  });

  it('escolher a opção vazia de funil grava config.funil = undefined', () => {
    const { funilSelect, box } = setup({ funil: 'funil-a' });
    fireEvent.change(funilSelect, { target: { value: '' } });
    expect(box.current.config.funil).toBeUndefined();
  });

  it('ESPECIAL: trocar o funil LIMPA paraEtapa e deEtapa no updater', () => {
    // funil A com etapas escolhidas; ao trocar pro funil B as etapas A não existem mais.
    const { funilSelect, box } = setup({
      funil: 'funil-a',
      paraEtapa: 'a2',
      deEtapa: 'a1',
    });

    fireEvent.change(funilSelect, { target: { value: 'funil-b' } });

    expect(box.current.config.funil).toBe('funil-b');
    // o invariante: as etapas filhas são limpas (undefined), não carregadas de A.
    expect(box.current.config.paraEtapa).toBeUndefined();
    expect(box.current.config.deEtapa).toBeUndefined();
  });

  it('os selects de etapa ficam vazios depois de trocar o funil', () => {
    const { funilSelect, paraEtapaSelect, deEtapaSelect } = setup({
      funil: 'funil-a',
      paraEtapa: 'a2',
      deEtapa: 'a1',
    });

    fireEvent.change(funilSelect, { target: { value: 'funil-b' } });

    expect(paraEtapaSelect.value).toBe('');
    expect(deEtapaSelect.value).toBe('');
  });

  it('selecionar uma "para etapa" grava config.paraEtapa e preserva funil/deEtapa', () => {
    const { paraEtapaSelect, box } = setup({ funil: 'funil-a', deEtapa: 'a1' });
    fireEvent.change(paraEtapaSelect, { target: { value: 'a2' } });

    expect(box.current.config.paraEtapa).toBe('a2');
    // não mexe no funil nem na de-etapa
    expect(box.current.config.funil).toBe('funil-a');
    expect(box.current.config.deEtapa).toBe('a1');
  });

  it('opção vazia de "para etapa" grava config.paraEtapa = undefined', () => {
    const { paraEtapaSelect, box } = setup({ funil: 'funil-a', paraEtapa: 'a1' });
    fireEvent.change(paraEtapaSelect, { target: { value: '' } });
    expect(box.current.config.paraEtapa).toBeUndefined();
  });

  it('selecionar uma "de etapa" grava config.deEtapa e preserva o resto do node', () => {
    const { deEtapaSelect, box } = setup({ funil: 'funil-b', paraEtapa: 'b2' });
    fireEvent.change(deEtapaSelect, { target: { value: 'b1' } });

    expect(box.current.config.deEtapa).toBe('b1');
    expect(box.current.config.paraEtapa).toBe('b2');
    // top-level do node preservado
    expect(box.current.titulo).toBe('Lead mudou de etapa');
    expect(box.current.tipo).toBe('TRIGGER');
    expect(box.current.triggerTipo).toBe('LEAD_ETAPA_MUDOU');
  });

  it('selects de etapa ficam disabled enquanto não há funil escolhido', () => {
    const { paraEtapaSelect, deEtapaSelect } = setup({});
    expect(paraEtapaSelect.disabled).toBe(true);
    expect(deEtapaSelect.disabled).toBe(true);
  });

  it('com funil escolhido, "para etapa" renderiza uma opção por etapa do funil (+ vazia)', () => {
    const { paraEtapaSelect } = setup({ funil: 'funil-a' });
    expect(paraEtapaSelect.disabled).toBe(false);
    const options = Array.from(paraEtapaSelect.options) as HTMLOptionElement[];
    // 2 etapas do funil A + a opção "Selecionar etapa…"
    expect(options.map((o) => o.value)).toEqual(['', 'a1', 'a2']);
  });
});
