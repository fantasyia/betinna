import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportLeadsModal } from './ImportLeadsModal';

vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const importLeads = vi.fn().mockResolvedValue({
  total: 1,
  criados: 1,
  atualizados: 0,
  pulados: 0,
  erros: 0,
  dryRun: true,
  detalhes: [],
});
vi.mock('@/lib/import', () => ({
  importLeads: (req: unknown) => importLeads(req),
  readImportFile: vi.fn(),
}));
vi.mock('@/lib/xlsx', () => ({ rowsToXlsx: vi.fn() }));

const funis = [
  {
    id: 'f1',
    nome: 'Reps',
    isPadrao: true,
    ativo: true,
    etapas: [{ id: 'e1', nome: 'Prospecção', tipo: 'ATIVA' as const }],
  },
];

const abrir = () =>
  render(<ImportLeadsModal funis={funis} onClose={vi.fn()} onDone={vi.fn()} />);

const checkbox = () => screen.getByTestId('import-disparar-reguas') as HTMLInputElement;

describe('ImportLeadsModal — opt-in de automações', () => {
  beforeEach(() => importLeads.mockClear());

  it('checkbox começa desmarcado e DESABILITADO (sem funil/etapa)', () => {
    abrir();
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
  });

  it('escolher funil sozinho não libera — a etapa é que manda', () => {
    abrir();
    fireEvent.change(screen.getByTestId('import-funil-select'), { target: { value: 'f1' } });
    expect(checkbox().disabled).toBe(true);
  });

  it('com funil + etapa o checkbox libera e pode ser marcado', () => {
    abrir();
    fireEvent.change(screen.getByTestId('import-funil-select'), { target: { value: 'f1' } });
    fireEvent.change(screen.getByTestId('import-etapa-select'), { target: { value: 'e1' } });
    expect(checkbox().disabled).toBe(false);
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(true);
  });

  it('desfazer a etapa desmarca visualmente o checkbox (não fica ligado escondido)', () => {
    abrir();
    fireEvent.change(screen.getByTestId('import-funil-select'), { target: { value: 'f1' } });
    fireEvent.change(screen.getByTestId('import-etapa-select'), { target: { value: 'e1' } });
    fireEvent.click(checkbox());
    fireEvent.change(screen.getByTestId('import-etapa-select'), { target: { value: '' } });
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(true);
  });
});
