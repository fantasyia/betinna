import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { MoverLeadEtapaForm } from './MoverLeadEtapaForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapaOpt } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Contrato do MoverLeadEtapaForm: o select de etapa grava a CHAVE certa
 * (config.funilEtapaId — NÃO "etapaId") com o VALOR certo, e a opção vazia
 * limpa a chave (undefined). O tsc não pega isso porque config é
 * Record<string,unknown>; só este teste trava o contrato.
 *
 * O Select é controlado (value vem de data.config). Pra um fireEvent.change
 * "pegar" num select controlado no jsdom, o componente precisa re-renderizar
 * com o data atualizado — por isso o Harness segura o data em estado e aplica
 * o updater (igual o NodeInspector real faz). last/lastUpdater expõem o que o
 * form mandou pro onUpdate.
 */

afterEach(cleanup);

const etapasOpts: InspectorEtapaOpt[] = [
  { id: 'etapa-1', label: 'Funil A · Novo' },
  { id: 'etapa-2', label: 'Funil A · Qualificado' },
  { id: 'etapa-3', label: 'Funil B · Fechado' },
];

function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Mover lead',
    tipo: 'ACAO',
    acaoTipo: 'MOVER_LEAD_ETAPA',
    config,
  };
}

type DriveResult = {
  select: HTMLSelectElement;
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
      <MoverLeadEtapaForm
        data={data}
        onUpdate={(updater) => {
          onUpdate(updater);
          setData((d) => updater(d));
        }}
        etapasOpts={etapasOpts}
      />
    );
  }

  render(<Harness />);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  return { select, current: () => snapshot, onUpdate };
}

describe('MoverLeadEtapaForm', () => {
  it('reflete config.funilEtapaId inicial no select (round-trip de leitura)', () => {
    const { select } = setup({ funilEtapaId: 'etapa-2' });
    expect(select.value).toBe('etapa-2');
  });

  it('select default é vazio quando config não tem funilEtapaId', () => {
    const { select } = setup({});
    expect(select.value).toBe('');
  });

  it('selecionar uma etapa grava config.funilEtapaId com o id escolhido', () => {
    const { select, current, onUpdate } = setup({});
    fireEvent.change(select, { target: { value: 'etapa-3' } });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const resultado = current();
    expect(resultado.config.funilEtapaId).toBe('etapa-3');
    // garante que não inventou a chave errada do hint ("etapaId")
    expect(resultado.config.etapaId).toBeUndefined();
    // o select controlado passou a refletir o novo valor
    expect(select.value).toBe('etapa-3');
  });

  it('selecionar a opção vazia limpa config.funilEtapaId (undefined)', () => {
    const { select, current } = setup({ funilEtapaId: 'etapa-1' });
    fireEvent.change(select, { target: { value: '' } });

    const resultado = current();
    expect(resultado.config.funilEtapaId).toBeUndefined();
    expect(select.value).toBe('');
  });

  it('trocar de uma etapa pra outra grava o novo id e preserva o resto', () => {
    const { select, current } = setup({ funilEtapaId: 'etapa-1', outraChave: 42 });
    fireEvent.change(select, { target: { value: 'etapa-2' } });

    const resultado = current();
    expect(resultado.config.funilEtapaId).toBe('etapa-2');
    // updater não mexe em outras chaves do config nem no top-level do node
    expect(resultado.config.outraChave).toBe(42);
    expect(resultado.titulo).toBe('Mover lead');
    expect(resultado.acaoTipo).toBe('MOVER_LEAD_ETAPA');
    expect(resultado.tipo).toBe('ACAO');
  });

  it('renderiza uma opção por etapa de etapasOpts (mais a opção vazia)', () => {
    setup({});
    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    // 3 etapas + a opção "Selecionar etapa…"
    expect(options.length).toBe(etapasOpts.length + 1);
    expect(options.map((o) => o.value)).toEqual(['', 'etapa-1', 'etapa-2', 'etapa-3']);
  });
});
