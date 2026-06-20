import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { DelayForm } from './DelayForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Contrato do DelayForm: grava as CHAVES certas com os VALORES certos —
 * config.quantidade (Number, não string) pelo input numérico, e config.unidade
 * (string: minutos/horas/dias) pelo select. O tsc não pega chave errada porque
 * config é Record<string,unknown>; só este teste trava o contrato.
 *
 * Input e Select são controlados (value vem de data.config). Pra um
 * fireEvent.change "pegar" num controle controlado no jsdom, o componente
 * precisa re-renderizar com o data atualizado — por isso o Harness segura o
 * data em estado e aplica o updater (igual o NodeInspector real faz).
 */

afterEach(cleanup);

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Aguardar',
    tipo: 'DELAY',
    config,
  };
}

type DriveResult = {
  quantidade: HTMLInputElement;
  unidade: HTMLSelectElement;
  /** Estado mais recente do node depois de aplicar o updater do form. */
  current: () => NodePayload;
  /** Spy que recebe o (updater) toda vez que o form chama onUpdate. */
  onUpdate: ReturnType<typeof vi.fn>;
};

/** Renderiza o form num harness controlado e devolve handles pra dirigir/asserir. */
function setup(initialConfig: Record<string, unknown> = {}): DriveResult {
  const onUpdate = vi.fn();
  let snapshot: NodePayload = makeData(initialConfig);

  function Harness() {
    const [data, setData] = useState<NodePayload>(makeData(initialConfig));
    snapshot = data;
    return (
      <DelayForm
        data={data}
        onUpdate={(updater) => {
          onUpdate(updater);
          setData((d) => updater(d));
        }}
      />
    );
  }

  render(<Harness />);
  const quantidade = screen.getByRole('spinbutton') as HTMLInputElement;
  const unidade = screen.getByRole('combobox') as HTMLSelectElement;
  return { quantidade, unidade, current: () => snapshot, onUpdate };
}

describe('DelayForm', () => {
  it('reflete config.quantidade e config.unidade iniciais nos controles (round-trip de leitura)', () => {
    const { quantidade, unidade } = setup({ quantidade: 5, unidade: 'horas' });
    expect(quantidade.value).toBe('5');
    expect(unidade.value).toBe('horas');
  });

  it('usa defaults (1 / minutos) quando config está vazio', () => {
    const { quantidade, unidade } = setup({});
    expect(quantidade.value).toBe('1');
    expect(unidade.value).toBe('minutos');
  });

  it('editar a quantidade grava config.quantidade como Number (não string)', () => {
    const { quantidade, current, onUpdate } = setup({ quantidade: 1, unidade: 'minutos' });
    fireEvent.change(quantidade, { target: { value: '15' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const resultado = current();
    expect(resultado.config.quantidade).toBe(15);
    // garante que converteu pra number, não deixou string "15"
    expect(typeof resultado.config.quantidade).toBe('number');
    expect(quantidade.value).toBe('15');
  });

  it('trocar a unidade grava config.unidade com o valor escolhido', () => {
    const { unidade, current, onUpdate } = setup({ quantidade: 1, unidade: 'minutos' });
    fireEvent.change(unidade, { target: { value: 'dias' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const resultado = current();
    expect(resultado.config.unidade).toBe('dias');
    expect(unidade.value).toBe('dias');
  });

  it('cada controle preserva a outra chave do config e o top-level do node', () => {
    const { quantidade, unidade, current } = setup({ quantidade: 3, unidade: 'horas' });

    fireEvent.change(quantidade, { target: { value: '7' } });
    let resultado = current();
    expect(resultado.config.quantidade).toBe(7);
    // editar quantidade não mexe na unidade
    expect(resultado.config.unidade).toBe('horas');

    fireEvent.change(unidade, { target: { value: 'minutos' } });
    resultado = current();
    expect(resultado.config.unidade).toBe('minutos');
    // editar unidade preserva a quantidade já gravada
    expect(resultado.config.quantidade).toBe(7);
    // top-level do node intacto
    expect(resultado.titulo).toBe('Aguardar');
    expect(resultado.tipo).toBe('DELAY');
  });

  it('renderiza as opções de unidade (segundos/minutos/horas/dias)', () => {
    setup({});
    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['segundos', 'minutos', 'horas', 'dias']);
  });
});
