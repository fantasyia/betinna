import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CondicaoEditor } from './CondicaoEditor';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Render-test de CONTRATO do CondicaoEditor.
 *
 * O tsc NÃO pega erro de config-key (config é Record<string, unknown>), então
 * estes testes travam o contrato. Aqui o ponto crítico é a FRONTEIRA edge-aware:
 * SAÍDAS e MODO afetam ARESTAS, então vão pelos callbacks edge-aware
 * (onChangeModo / onRenameSaida / onRemoveSaida) — NUNCA por onUpdate. Só
 * variavel/campo/operador/valor (config-only) e o APPEND de saída nova vão por
 * onUpdate. Misturar reintroduz arestas órfãs — por isso asserimos a fronteira.
 *
 * Sem @testing-library/jest-dom neste projeto — só getBy / queryBy + matchers
 * core do vitest (toBe / toEqual / toHaveBeenCalled / toHaveBeenCalledWith...).
 *
 * O form usa useToast (erro de validação de saída duplicada/reservada) — mockado
 * abaixo pra não exigir <ToastProvider>.
 */

vi.mock('@/components/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const variaveis = [
  { id: 'v1', chave: 'classificacao_final' },
  { id: 'v2', chave: 'canal' },
];

/** NodePayload representativo de CONDICAO, com config já preenchido. */
function makeData(configOverrides: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Condição',
    tipo: 'CONDICAO',
    config: {
      modo: 'simples',
      campo: 'classificacao_final',
      operador: 'eq',
      valor: 'forte',
      ...configOverrides,
    },
  };
}

/**
 * Host com estado real: aplica o updater do form e re-renderiza (controlado de
 * verdade). Expõe um box com o último payload commitado, pra asserir o updater.
 * Os callbacks edge-aware ficam como spies separados (não realimentam estado —
 * é o pai-do-pai que mexe nas arestas).
 */
function Harness({
  initial,
  box,
  onUpdateSpy,
  onChangeModo,
  onRemoveSaida,
  onRenameSaida,
}: {
  initial: NodePayload;
  box: { current: NodePayload };
  onUpdateSpy?: (updater: (d: NodePayload) => NodePayload) => void;
  onChangeModo: (m: string) => void;
  onRemoveSaida: (v: string) => void;
  onRenameSaida: (antigo: string, novo: string) => void;
}) {
  const [data, setData] = useState<NodePayload>(initial);
  return (
    <CondicaoEditor
      data={data}
      onUpdate={(updater) => {
        onUpdateSpy?.(updater);
        setData((prev) => {
          const next = updater(prev);
          box.current = next;
          return next;
        });
      }}
      variaveis={variaveis}
      onChangeModo={onChangeModo}
      onRemoveSaida={onRemoveSaida}
      onRenameSaida={onRenameSaida}
    />
  );
}

afterEach(() => cleanup());

describe('CondicaoEditor — fronteira edge-aware + contrato de config-keys', () => {
  it('select de Modo: lê config.modo e dispara onChangeModo (NÃO onUpdate)', () => {
    const initial = makeData({ modo: 'simples' });
    const box = { current: initial };
    const onUpdateSpy = vi.fn();
    const onChangeModo = vi.fn();
    const onRemoveSaida = vi.fn();
    const onRenameSaida = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onUpdateSpy={onUpdateSpy}
        onChangeModo={onChangeModo}
        onRemoveSaida={onRemoveSaida}
        onRenameSaida={onRenameSaida}
      />,
    );

    // ROUND-TRIP DE LEITURA: primeiro combobox é o Modo, reflete 'simples'.
    const modoSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(modoSelect.value).toBe('simples');

    // ESCRITA edge-aware: trocar pra roteador chama onChangeModo, NÃO onUpdate.
    fireEvent.change(modoSelect, { target: { value: 'roteador' } });
    expect(onChangeModo).toHaveBeenCalledTimes(1);
    expect(onChangeModo).toHaveBeenCalledWith('roteador');
    expect(onUpdateSpy).not.toHaveBeenCalled();
  });

  it('modo simples: campo lê config.campo e escreve via onUpdate (não edge-aware)', () => {
    const initial = makeData({ campo: 'classificacao_final' });
    const box = { current: initial };
    const onChangeModo = vi.fn();
    const onRemoveSaida = vi.fn();
    const onRenameSaida = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onChangeModo={onChangeModo}
        onRemoveSaida={onRemoveSaida}
        onRenameSaida={onRenameSaida}
      />,
    );

    // ROUND-TRIP DE LEITURA: input de campo reflete config.campo.
    const campoInput = screen.getByDisplayValue('classificacao_final') as HTMLInputElement;
    expect(campoInput.value).toBe('classificacao_final');

    // ESCRITA: grava config.campo; sem tocar nos callbacks edge-aware.
    fireEvent.change(campoInput, { target: { value: 'lead.etapa' } });
    expect(box.current.config.campo).toBe('lead.etapa');
    expect(onChangeModo).not.toHaveBeenCalled();
    expect(onRenameSaida).not.toHaveBeenCalled();
    expect(onRemoveSaida).not.toHaveBeenCalled();
  });

  it('modo simples: operador lê config.operador e escreve a chave certa', () => {
    const initial = makeData({ operador: 'eq' });
    const box = { current: initial };
    const onChangeModo = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onChangeModo={onChangeModo}
        onRemoveSaida={vi.fn()}
        onRenameSaida={vi.fn()}
      />,
    );

    // ROUND-TRIP DE LEITURA: o select de operador reflete 'eq'.
    // (Em modo simples há 2 comboboxes-<select>: Modo[0] e Operador[1]; o input
    // de campo tem list=datalist e também conta como combobox p/ ARIA — por isso
    // filtramos só os <select> e pegamos o de operador.)
    const selects = screen
      .getAllByRole('combobox')
      .filter((el) => el.tagName === 'SELECT') as HTMLSelectElement[];
    const operadorSelect = selects[1];
    expect(operadorSelect.value).toBe('eq');

    fireEvent.change(operadorSelect, { target: { value: 'contains' } });
    expect(box.current.config.operador).toBe('contains');
    expect(onChangeModo).not.toHaveBeenCalled();
  });

  it('modo simples: valor lê config.valor e escreve config.valor (preserva o resto)', () => {
    const initial = makeData({ valor: 'forte', campo: 'classificacao_final' });
    const box = { current: initial };
    render(
      <Harness
        initial={initial}
        box={box}
        onChangeModo={vi.fn()}
        onRemoveSaida={vi.fn()}
        onRenameSaida={vi.fn()}
      />,
    );

    // ROUND-TRIP DE LEITURA: input de valor reflete config.valor.
    const valorInput = screen.getByDisplayValue('forte') as HTMLInputElement;
    expect(valorInput.value).toBe('forte');

    fireEvent.change(valorInput, { target: { value: 'fraco' } });
    expect(box.current.config.valor).toBe('fraco');
    // spread não dropa as outras chaves.
    expect(box.current.config.campo).toBe('classificacao_final');
  });

  it('modo roteador: variavel lê config.variavel e escreve via onUpdate (não edge-aware)', () => {
    const initial = makeData({
      modo: 'roteador',
      variavel: 'classificacao_final',
      saidas: ['Forte', 'Médio'],
    });
    const box = { current: initial };
    const onChangeModo = vi.fn();
    const onRemoveSaida = vi.fn();
    const onRenameSaida = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onChangeModo={onChangeModo}
        onRemoveSaida={onRemoveSaida}
        onRenameSaida={onRenameSaida}
      />,
    );

    // ROUND-TRIP DE LEITURA: input de variavel reflete config.variavel.
    const variavelInput = screen.getByDisplayValue('classificacao_final') as HTMLInputElement;
    expect(variavelInput.value).toBe('classificacao_final');

    // ESCRITA config-only: editar variavel vai por onUpdate, nunca edge-aware.
    fireEvent.change(variavelInput, { target: { value: 'canal' } });
    expect(box.current.config.variavel).toBe('canal');
    expect(onChangeModo).not.toHaveBeenCalled();
    expect(onRenameSaida).not.toHaveBeenCalled();
    expect(onRemoveSaida).not.toHaveBeenCalled();
  });

  it('modo roteador: renomear uma saída (Enter) chama onRenameSaida(antigo, novo), não onUpdate', () => {
    const initial = makeData({ modo: 'roteador', saidas: ['Forte', 'Médio'] });
    const box = { current: initial };
    const onUpdateSpy = vi.fn();
    const onRenameSaida = vi.fn();
    const onRemoveSaida = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onUpdateSpy={onUpdateSpy}
        onChangeModo={vi.fn()}
        onRemoveSaida={onRemoveSaida}
        onRenameSaida={onRenameSaida}
      />,
    );

    // A linha 'Forte' renderiza num input editável (display value = 'Forte').
    const saidaInput = screen.getByDisplayValue('Forte') as HTMLInputElement;
    fireEvent.change(saidaInput, { target: { value: 'Forte Sinergia' } });
    fireEvent.keyDown(saidaInput, { key: 'Enter' });

    expect(onRenameSaida).toHaveBeenCalledTimes(1);
    expect(onRenameSaida).toHaveBeenCalledWith('Forte', 'Forte Sinergia');
    // rename é edge-aware — não passa por onUpdate (sem append/patch de config).
    expect(onUpdateSpy).not.toHaveBeenCalled();
    expect(onRemoveSaida).not.toHaveBeenCalled();
  });

  it('modo roteador: remover saída (botão lixeira) chama onRemoveSaida(valor), não onUpdate', () => {
    const initial = makeData({ modo: 'roteador', saidas: ['Forte', 'Médio'] });
    const box = { current: initial };
    const onUpdateSpy = vi.fn();
    const onRemoveSaida = vi.fn();
    const onRenameSaida = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onUpdateSpy={onUpdateSpy}
        onChangeModo={vi.fn()}
        onRemoveSaida={onRemoveSaida}
        onRenameSaida={onRenameSaida}
      />,
    );

    // Cada saída tem seu botão "Remover saída"; o 1º é o da 'Forte'.
    const removeBtns = screen.getAllByLabelText('Remover saída');
    fireEvent.click(removeBtns[0]);

    expect(onRemoveSaida).toHaveBeenCalledTimes(1);
    expect(onRemoveSaida).toHaveBeenCalledWith('Forte');
    expect(onUpdateSpy).not.toHaveBeenCalled();
    expect(onRenameSaida).not.toHaveBeenCalled();
  });

  it('modo roteador: adicionar saída nova (Enter) faz APPEND via onUpdate (config.saidas), não edge-aware', () => {
    const initial = makeData({ modo: 'roteador', saidas: ['Forte'] });
    const box = { current: initial };
    const onChangeModo = vi.fn();
    const onRemoveSaida = vi.fn();
    const onRenameSaida = vi.fn();
    render(
      <Harness
        initial={initial}
        box={box}
        onChangeModo={onChangeModo}
        onRemoveSaida={onRemoveSaida}
        onRenameSaida={onRenameSaida}
      />,
    );

    const novaInput = screen.getByPlaceholderText('Ex: Forte Sinergia (Enter)') as HTMLInputElement;
    fireEvent.change(novaInput, { target: { value: 'Médio' } });
    fireEvent.keyDown(novaInput, { key: 'Enter' });

    // APPEND é config-only (onUpdate), preservando as saídas existentes.
    expect(box.current.config.saidas).toEqual(['Forte', 'Médio']);
    expect(onChangeModo).not.toHaveBeenCalled();
    expect(onRenameSaida).not.toHaveBeenCalled();
    expect(onRemoveSaida).not.toHaveBeenCalled();
  });

  it('modo roteador: adicionar saída pelo botão "+" também faz APPEND via onUpdate', () => {
    const initial = makeData({ modo: 'roteador', saidas: ['Forte'] });
    const box = { current: initial };
    render(
      <Harness
        initial={initial}
        box={box}
        onChangeModo={vi.fn()}
        onRemoveSaida={vi.fn()}
        onRenameSaida={vi.fn()}
      />,
    );

    const novaInput = screen.getByPlaceholderText('Ex: Forte Sinergia (Enter)') as HTMLInputElement;
    fireEvent.change(novaInput, { target: { value: 'Fraco' } });
    fireEvent.click(screen.getByRole('button', { name: '+' }));

    expect(box.current.config.saidas).toEqual(['Forte', 'Fraco']);
  });
});
