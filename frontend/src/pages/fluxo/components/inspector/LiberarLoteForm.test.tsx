import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LiberarLoteForm } from './LiberarLoteForm';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapaOpt, InspectorTag } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * Trava de CONTRATO do LiberarLoteForm.
 *
 * O tsc não pega erro de config-key (config é Record<string,unknown>). Estes
 * testes garantem que cada controle: (a) reflete o config inicial (leitura) e
 * (b) ao mudar, chama onUpdate com um updater que grava a CHAVE e o VALOR certos.
 *
 * O form é puramente apresentacional (props data/onUpdate/etapasOpts/tags) —
 * não usa useToast nem useApiQuery, então não há mock.
 *
 * GOTCHA importante: os controles são CONTROLADOS por data.config.* e o
 * onUpdate de teste é no-op (não realimenta o data), então o React REVERTE o
 * valor do nó DOM logo após o onChange. Se a gente capturasse o updater e só
 * rodasse depois, `e.target.value` já teria revertido. Por isso o onUpdate de
 * teste aplica o updater SÍNCRONO (dentro do próprio evento) e guarda o
 * resultado — é assim que o app real chama de qualquer forma.
 */

const etapasOpts: InspectorEtapaOpt[] = [
  { id: 'et-orig', label: 'Funil A · Origem' },
  { id: 'et-dest', label: 'Funil A · Destino' },
];

const tags: InspectorTag[] = [
  { id: 'tag-1', nome: 'pausado' },
  { id: 'tag-2', nome: 'vip' },
];

/** NodePayload representativo com config já preenchido pros controles renderizarem com valor. */
function makeData(config: Record<string, unknown> = {}): NodePayload {
  return {
    titulo: 'Liberar lote',
    tipo: 'ACAO',
    acaoTipo: 'LIBERAR_LOTE',
    config: {
      etapaOrigemId: 'et-orig',
      etapaDestinoId: 'et-dest',
      quantidade: 50,
      criterioOrdem: 'antigos',
      filtroExcluiTag: ['pausado'],
      filtroSoComWhatsapp: false,
      ...config,
    },
  };
}

/**
 * onUpdate de teste que aplica o updater SÍNCRONO sobre `base` (no momento do
 * evento, antes do React reverter o DOM) e guarda o NodePayload resultante.
 * `captured.last` = config/top-level resultante da última interação.
 */
function makeOnUpdate(base: NodePayload) {
  const captured: { last: NodePayload | null } = { last: null };
  const fn = vi.fn((updater: (d: NodePayload) => NodePayload) => {
    captured.last = updater(captured.last ?? base);
  });
  return { fn, captured };
}

afterEach(() => cleanup());

describe('LiberarLoteForm — leitura (round-trip dos controles)', () => {
  it('reflete etapaOrigemId/etapaDestinoId do config nos selects', () => {
    const data = makeData();
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={tags} />);
    expect((screen.getByLabelText('Etapa de origem') as HTMLSelectElement).value).toBe('et-orig');
    expect((screen.getByLabelText('Etapa de destino') as HTMLSelectElement).value).toBe('et-dest');
  });

  it('reflete a quantidade do config no input numérico', () => {
    const data = makeData({ quantidade: 120 });
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={tags} />);
    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('120');
  });

  it('usa default 50 quando quantidade não está no config', () => {
    const data = makeData({ quantidade: undefined });
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={tags} />);
    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('50');
  });
});

describe('LiberarLoteForm — escrita (grava chave/valor certos)', () => {
  it('escreve config.etapaOrigemId ao trocar a etapa de origem', () => {
    const data = makeData();
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.change(screen.getByLabelText('Etapa de origem'), { target: { value: 'et-dest' } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(captured.last!.config.etapaOrigemId).toBe('et-dest');
  });

  it('escreve config.etapaDestinoId ao trocar a etapa de destino', () => {
    const data = makeData();
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.change(screen.getByLabelText('Etapa de destino'), { target: { value: 'et-orig' } });
    expect(captured.last!.config.etapaDestinoId).toBe('et-orig');
  });

  it('escreve config.quantidade como NÚMERO (não string) ao editar', () => {
    const data = makeData();
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '200' } });
    expect(captured.last!.config.quantidade).toBe(200);
    expect(typeof captured.last!.config.quantidade).toBe('number');
  });

  it('escreve config.criterioOrdem ao trocar o critério de ordem', () => {
    const data = makeData();
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.change(screen.getByLabelText('Critério de ordem'), { target: { value: 'novos' } });
    expect(captured.last!.config.criterioOrdem).toBe('novos');
  });
});

describe('LiberarLoteForm — campos condicionais (criterioOrdem custom)', () => {
  it('só renderiza campoOrdem/Direção quando criterioOrdem === "custom"', () => {
    const data = makeData({ criterioOrdem: 'antigos' });
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={tags} />);
    expect(screen.queryByLabelText('Campo (variável)')).toBeNull();
    expect(screen.queryByLabelText('Direção')).toBeNull();
  });

  it('escreve config.campoOrdem ao editar o campo customizado', () => {
    const data = makeData({ criterioOrdem: 'custom', campoOrdem: 'prioridade_leo' });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    // leitura: reflete o valor do config
    expect((screen.getByLabelText('Campo (variável)') as HTMLInputElement).value).toBe(
      'prioridade_leo',
    );
    // escrita
    fireEvent.change(screen.getByLabelText('Campo (variável)'), { target: { value: 'score' } });
    expect(captured.last!.config.campoOrdem).toBe('score');
  });

  it('escreve config.ordemDir ao trocar a direção', () => {
    const data = makeData({ criterioOrdem: 'custom', ordemDir: 'asc' });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    expect((screen.getByLabelText('Direção') as HTMLSelectElement).value).toBe('asc');
    fireEvent.change(screen.getByLabelText('Direção'), { target: { value: 'desc' } });
    expect(captured.last!.config.ordemDir).toBe('desc');
  });
});

describe('LiberarLoteForm — filtroSoComWhatsapp (select string→boolean)', () => {
  it('lê false como "nao"', () => {
    const data = makeData({ filtroSoComWhatsapp: false });
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={tags} />);
    expect((screen.getByLabelText('Só liberar leads com WhatsApp') as HTMLSelectElement).value).toBe(
      'nao',
    );
  });

  it('lê true como "sim"', () => {
    const data = makeData({ filtroSoComWhatsapp: true });
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={tags} />);
    expect((screen.getByLabelText('Só liberar leads com WhatsApp') as HTMLSelectElement).value).toBe(
      'sim',
    );
  });

  it('grava boolean TRUE quando seleciona "sim"', () => {
    const data = makeData({ filtroSoComWhatsapp: false });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.change(screen.getByLabelText('Só liberar leads com WhatsApp'), {
      target: { value: 'sim' },
    });
    expect(captured.last!.config.filtroSoComWhatsapp).toBe(true);
  });

  it('grava boolean FALSE quando seleciona "nao"', () => {
    const data = makeData({ filtroSoComWhatsapp: true });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.change(screen.getByLabelText('Só liberar leads com WhatsApp'), {
      target: { value: 'nao' },
    });
    expect(captured.last!.config.filtroSoComWhatsapp).toBe(false);
  });
});

describe('LiberarLoteForm — filtroExcluiTag (toggle de botões → array)', () => {
  it('faz APPEND da tag no array ao clicar numa tag não selecionada', () => {
    const data = makeData({ filtroExcluiTag: ['pausado'] });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.click(screen.getByTestId('lote-excluitag-tag-2'));
    expect(captured.last!.config.filtroExcluiTag).toEqual(['pausado', 'vip']);
  });

  it('faz REMOVE da tag do array ao clicar numa tag já selecionada', () => {
    const data = makeData({ filtroExcluiTag: ['pausado', 'vip'] });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.click(screen.getByTestId('lote-excluitag-tag-1'));
    expect(captured.last!.config.filtroExcluiTag).toEqual(['vip']);
  });

  it('inicializa o array quando filtroExcluiTag está ausente (append no vazio)', () => {
    const data = makeData({ filtroExcluiTag: undefined });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.click(screen.getByTestId('lote-excluitag-tag-2'));
    expect(captured.last!.config.filtroExcluiTag).toEqual(['vip']);
  });

  it('mostra fallback "Nenhuma tag cadastrada" quando tags é null', () => {
    const data = makeData();
    render(<LiberarLoteForm data={data} onUpdate={vi.fn()} etapasOpts={etapasOpts} tags={null} />);
    // 2 ocorrências: uma no filtro de INCLUSÃO, outra no de EXCLUSÃO.
    expect(screen.getAllByText('Nenhuma tag cadastrada').length).toBe(2);
  });
});

describe('LiberarLoteForm — filtroComTag (só leads com tag)', () => {
  it('faz APPEND da tag de inclusão ao clicar (inicializa no vazio)', () => {
    const data = makeData({ filtroComTag: undefined });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.click(screen.getByTestId('lote-comtag-tag-2'));
    expect(captured.last!.config.filtroComTag).toEqual(['vip']);
  });

  it('faz REMOVE ao clicar numa tag de inclusão já selecionada', () => {
    const data = makeData({ filtroComTag: ['pausado', 'vip'] });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.click(screen.getByTestId('lote-comtag-tag-1'));
    expect(captured.last!.config.filtroComTag).toEqual(['vip']);
  });

  it('inclusão e exclusão são INDEPENDENTES (clicar numa não mexe na outra)', () => {
    const data = makeData({ filtroComTag: ['vip'], filtroExcluiTag: ['pausado'] });
    const { fn, captured } = makeOnUpdate(data);
    render(<LiberarLoteForm data={data} onUpdate={fn} etapasOpts={etapasOpts} tags={tags} />);
    fireEvent.click(screen.getByTestId('lote-comtag-tag-1'));
    expect(captured.last!.config.filtroComTag).toEqual(['vip', 'pausado']);
    expect(captured.last!.config.filtroExcluiTag).toEqual(['pausado']);
  });
});
