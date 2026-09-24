import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MultiSelectList, type MultiSelectOption } from './MultiSelectList';

const opts: MultiSelectOption[] = [
  { value: 'Reaquecer', label: 'Reaquecer', key: 't1' },
  { value: 'Sem Resposta', label: 'Sem Resposta', key: 't2' },
  { value: 'Reação', label: 'Reação', key: 't3' },
];

function montar(value: string[], onChange = vi.fn()) {
  render(<MultiSelectList options={opts} value={value} onChange={onChange} testIdPrefix="m" />);
  return onChange;
}

const box = (key: string) => screen.getByTestId(`m-${key}`) as HTMLInputElement;

afterEach(() => cleanup());

describe('MultiSelectList', () => {
  it('marca as selecionadas e mostra a contagem', () => {
    montar(['Sem Resposta']);
    expect(box('t2').checked).toBe(true);
    expect(box('t1').checked).toBe(false);
    expect(screen.getByTestId('m-contagem').textContent).toBe('1 selecionada');
  });

  it('marcar faz APPEND preservando a ordem de seleção', () => {
    const onChange = montar(['Sem Resposta']);
    fireEvent.click(box('t1'));
    expect(onChange).toHaveBeenCalledWith(['Sem Resposta', 'Reaquecer']);
  });

  it('desmarcar REMOVE só aquela', () => {
    const onChange = montar(['Reaquecer', 'Sem Resposta']);
    fireEvent.click(box('t1'));
    expect(onChange).toHaveBeenCalledWith(['Sem Resposta']);
  });

  it('a busca ignora caixa e acento', () => {
    montar([]);
    fireEvent.change(screen.getByTestId('m-busca'), { target: { value: 'REACAO' } });
    expect(screen.queryByTestId('m-t1')).toBeNull();
    expect(screen.queryByTestId('m-t2')).toBeNull();
    expect(box('t3')).toBeTruthy();
  });

  it('filtrar NÃO desmarca o que ficou escondido', () => {
    const onChange = montar(['Reaquecer']);
    fireEvent.change(screen.getByTestId('m-busca'), { target: { value: 'sem' } });
    fireEvent.click(box('t2'));
    expect(onChange).toHaveBeenCalledWith(['Reaquecer', 'Sem Resposta']);
  });

  it('busca sem resultado avisa em vez de sumir', () => {
    montar([]);
    fireEvent.change(screen.getByTestId('m-busca'), { target: { value: 'xyz' } });
    expect(screen.getByText(/Nenhum resultado/)).toBeTruthy();
  });

  it('Limpar zera tudo', () => {
    const onChange = montar(['Reaquecer', 'Reação']);
    fireEvent.click(screen.getByTestId('m-limpar'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('valor salvo que não existe mais aparece marcado e pode ser desmarcado', () => {
    // Senão ele ficaria gravado e invisível, filtrando o lote sem ninguém ver por quê.
    const onChange = montar(['Tag Apagada', 'Reaquecer']);
    expect(screen.getByText('não existe mais')).toBeTruthy();
    expect(box('Tag Apagada').checked).toBe(true);
    fireEvent.click(box('Tag Apagada'));
    expect(onChange).toHaveBeenCalledWith(['Reaquecer']);
  });

  it('sem opções e sem valor mostra o texto vazio', () => {
    render(<MultiSelectList options={[]} value={[]} onChange={vi.fn()} emptyText="Nada aqui" />);
    expect(screen.getByText('Nada aqui')).toBeTruthy();
  });
});
