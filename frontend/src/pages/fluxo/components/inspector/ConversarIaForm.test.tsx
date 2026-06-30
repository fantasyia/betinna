import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConversarIaForm } from './ConversarIaForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorPrompt } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Render-test de CONTRATO do ConversarIaForm.
 *
 * O tsc NÃO pega erro de config-key (config é Record<string, unknown>), então
 * estes testes travam o contrato: ao mexer num controle, o form chama onUpdate
 * com um updater que grava a CHAVE e o VALOR certos.
 *
 * Sem @testing-library/jest-dom neste projeto — só getBy / queryBy + matchers
 * core do vitest (toBe / toEqual / toHaveBeenCalled...).
 *
 * Os controles são CONTROLADOS (value vem de data.config). Pra um fireEvent.change
 * fluir de verdade, o pai precisa re-renderizar com o novo data — senão o React
 * reverte o value pro controlado e o handler nem dispara. Por isso usamos um
 * Harness com estado que aplica o updater real do form, e inspecionamos o
 * último payload commitado (`last()`) — isso exercita o updater de ponta a ponta.
 */

const prompts: InspectorPrompt[] = [
  { id: 'p1', nome: 'Prompt Vendas' },
  { id: 'p2', nome: 'Prompt Suporte', isPadrao: true },
];

/** NodePayload representativo, com config já preenchido pros controles renderizarem com valor. */
function makeData(configOverrides: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Conversar com IA',
    tipo: 'ACAO',
    acaoTipo: 'CONVERSAR_IA',
    config: {
      promptId: 'p1',
      aguardarResposta: true,
      timeoutHoras: 12,
      variaveisGravadas: ['classificacao', 'canal'],
      ...configOverrides,
    },
  };
}

/**
 * Host com estado real: aplica o updater do form e re-renderiza (controlado de verdade).
 * Expõe um ref-box `box` com o último payload commitado, pra asserir o resultado do updater.
 */
function Harness({
  initial,
  box,
  promptsList = prompts,
}: {
  initial: NodePayload;
  box: { current: NodePayload };
  promptsList?: InspectorPrompt[] | null;
}) {
  const [data, setData] = useState<NodePayload>(initial);
  return (
    <ConversarIaForm
      data={data}
      onUpdate={(updater) =>
        setData((prev) => {
          const next = updater(prev);
          box.current = next;
          return next;
        })
      }
      prompts={promptsList}
    />
  );
}

afterEach(() => cleanup());

describe('ConversarIaForm — contrato de config-keys', () => {
  it('lê promptId no select de prompt e escreve a chave certa ao trocar', () => {
    const initial = makeData();
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    // ROUND-TRIP DE LEITURA: o select de prompt reflete config.promptId.
    const promptSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(promptSelect.value).toBe('p1');

    // ESCRITA: trocar pra p2 grava config.promptId = 'p2'.
    fireEvent.change(promptSelect, { target: { value: 'p2' } });
    expect(box.current.config.promptId).toBe('p2');
    expect(promptSelect.value).toBe('p2');
  });

  it('"Prompt padrão da empresa" (value vazio) grava promptId = undefined', () => {
    const initial = makeData();
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    const promptSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(promptSelect, { target: { value: '' } });
    expect(box.current.config.promptId).toBe(undefined);
  });

  it('aguardarResposta: lê true como "sim" e escreve "nao" → false', () => {
    const initial = makeData({ aguardarResposta: true });
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    // ROUND-TRIP DE LEITURA: aguardarResposta true → select mostra 'sim'.
    const aguardarSelect = screen.getAllByRole('combobox')[3] as HTMLSelectElement;
    expect(aguardarSelect.value).toBe('sim');

    // ESCRITA: 'nao' vira boolean false (transformação string→bool).
    fireEvent.change(aguardarSelect, { target: { value: 'nao' } });
    expect(box.current.config.aguardarResposta).toBe(false);
  });

  it('aguardarResposta: lê false como "nao" e escreve "sim" → true', () => {
    const initial = makeData({ aguardarResposta: false });
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    const aguardarSelect = screen.getAllByRole('combobox')[3] as HTMLSelectElement;
    expect(aguardarSelect.value).toBe('nao');

    fireEvent.change(aguardarSelect, { target: { value: 'sim' } });
    expect(box.current.config.aguardarResposta).toBe(true);
  });

  it('timeoutHoras: lê o número e escreve Number(value) na chave certa', () => {
    const initial = makeData({ timeoutHoras: 12 });
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    // ROUND-TRIP DE LEITURA: input number reflete 12.
    const timeoutInput = screen.getByDisplayValue('12') as HTMLInputElement;
    expect(timeoutInput.value).toBe('12');

    // ESCRITA: vira Number (não string).
    fireEvent.change(timeoutInput, { target: { value: '48' } });
    expect(box.current.config.timeoutHoras).toBe(48);
  });

  it('variaveisGravadas: lê o array como CSV e escreve split/trim/filter → array', () => {
    const initial = makeData({ variaveisGravadas: ['classificacao', 'canal'] });
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    // ROUND-TRIP DE LEITURA: array renderiza como "classificacao, canal".
    const varsInput = screen.getByPlaceholderText(
      'classificacao, canal, potencial_pedidos',
    ) as HTMLInputElement;
    expect(varsInput.value).toBe('classificacao, canal');

    // ESCRITA: "a, b" vira ['a','b'] (split por vírgula + trim).
    fireEvent.change(varsInput, { target: { value: 'a, b' } });
    expect(box.current.config.variaveisGravadas).toEqual(['a', 'b']);
  });

  it('variaveisGravadas: trim + filter de itens vazios (vírgula sobrando)', () => {
    const initial = makeData();
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    const varsInput = screen.getByPlaceholderText(
      'classificacao, canal, potencial_pedidos',
    ) as HTMLInputElement;
    fireEvent.change(varsInput, { target: { value: '  classificacao ,, canal , ' } });
    expect(box.current.config.variaveisGravadas).toEqual(['classificacao', 'canal']);
  });

  it('preserva o resto do config ao escrever (spread não dropa chaves)', () => {
    const initial = makeData({ promptId: 'p1', timeoutHoras: 12 });
    const box = { current: initial };
    render(<Harness initial={initial} box={box} />);

    const aguardarSelect = screen.getAllByRole('combobox')[3] as HTMLSelectElement;
    fireEvent.change(aguardarSelect, { target: { value: 'nao' } });
    // mexeu só em aguardarResposta; promptId/timeoutHoras intactos.
    expect(box.current.config.promptId).toBe('p1');
    expect(box.current.config.timeoutHoras).toBe(12);
    expect(box.current.config.aguardarResposta).toBe(false);
  });

  it('renderiza com prompts=null sem quebrar e cai no prompt padrão (value vazio)', () => {
    const initial = makeData({ promptId: undefined });
    const box = { current: initial };
    render(<Harness initial={initial} box={box} promptsList={null} />);

    const promptSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(promptSelect.value).toBe('');
  });
});
