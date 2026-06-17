import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { FlowNode, NodePayload } from '@/pages/fluxo/lib/types';

/**
 * Render-test do NodeInspector (DISPATCHER). Trava o CONTRATO de roteamento:
 * pra cada tipo/acaoTipo, o form certo aparece (asserir um label distintivo).
 * Também o header: clicar no botão excluir → onDelete.
 *
 * O tsc não pega config-key errada (config é Record<string, unknown>), e tampouco
 * pega um ramo de despacho quebrado — estes testes são a rede de segurança.
 *
 * useInspectorData faz 6 useApiQuery → mockamos useApiQuery retornando
 * { data: [], loading, error, refetch } pra todos (as derivações do hook
 * degradam pra listas vazias sem quebrar).
 */
vi.mock('@/hooks/useApiQuery', () => ({
  useApiQuery: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));

// CondicaoEditor usa useToast — mockado pra não depender do provider real.
vi.mock('@/components/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import { NodeInspector } from './NodeInspector';

// Monta um FlowNode mínimo do @xyflow com o NodePayload no .data.
function makeNode(data: NodePayload): FlowNode {
  return {
    id: 'n1',
    type: 'default',
    position: { x: 0, y: 0 },
    data,
  };
}

interface InspectorProps {
  onUpdate: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onRemoveSaida: ReturnType<typeof vi.fn>;
  onRenameSaida: ReturnType<typeof vi.fn>;
  onChangeModo: ReturnType<typeof vi.fn>;
  onDisparar: ReturnType<typeof vi.fn>;
}

function renderInspector(data: NodePayload): InspectorProps {
  const props: InspectorProps = {
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onRemoveSaida: vi.fn(),
    onRenameSaida: vi.fn(),
    onChangeModo: vi.fn(),
    onDisparar: vi.fn(),
  };
  render(<NodeInspector node={makeNode(data)} {...props} />);
  return props;
}

describe('NodeInspector (dispatcher)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('TRIGGER manual (sem triggerTipo) → botão "Disparar agora" e chama onDisparar', () => {
    const data: NodePayload = {
      titulo: 'Disparo do lote',
      tipo: 'TRIGGER',
      config: { descricao: 'rodar de manhã' },
    };
    const { onDisparar } = renderInspector(data);

    const btn = screen.getByText('Disparar agora');
    fireEvent.click(btn);
    expect(onDisparar).toHaveBeenCalledTimes(1);
  });

  it('ACAO + CONVERSAR_IA → renderiza o form de IA ("Aguardar resposta do lead?")', () => {
    const data: NodePayload = {
      titulo: 'Entrevista IA',
      tipo: 'ACAO',
      acaoTipo: 'CONVERSAR_IA',
      config: { aguardarResposta: true, timeoutHoras: 24 },
    };
    renderInspector(data);

    expect(screen.getByText('Aguardar resposta do lead?')).toBeTruthy();
  });

  it('CONDICAO → renderiza o CondicaoEditor ("Modo")', () => {
    const data: NodePayload = {
      titulo: 'Roteia por canal',
      tipo: 'CONDICAO',
      config: { modo: 'simples', campo: 'canal', operador: 'eq', valor: 'whatsapp' },
    };
    renderInspector(data);

    expect(screen.getByText('Modo')).toBeTruthy();
  });

  it('ACAO + ENVIAR_WHATSAPP → renderiza o WhatsAppActionForm ("Destinatário" + "Mensagem")', () => {
    const data: NodePayload = {
      titulo: 'Manda zap',
      tipo: 'ACAO',
      acaoTipo: 'ENVIAR_WHATSAPP',
      config: { destinatarioModo: 'lead', mensagem: 'Olá' },
    };
    renderInspector(data);

    expect(screen.getByText('Destinatário')).toBeTruthy();
    expect(screen.getByText('Mensagem')).toBeTruthy();
  });

  it('DELAY → renderiza o DelayForm ("Aguardar quantidade" + "Unidade")', () => {
    const data: NodePayload = {
      titulo: 'Espera',
      tipo: 'DELAY',
      config: { quantidade: 2, unidade: 'horas' },
    };
    renderInspector(data);

    expect(screen.getByText('Aguardar quantidade')).toBeTruthy();
    expect(screen.getByText('Unidade')).toBeTruthy();
  });

  it('header: clicar no botão excluir → chama onDelete', () => {
    const data: NodePayload = {
      titulo: 'Qualquer nó',
      tipo: 'ACAO',
      acaoTipo: 'ENVIAR_WHATSAPP',
      config: {},
    };
    const { onDelete } = renderInspector(data);

    const excluir = screen.getByLabelText('Excluir nó');
    fireEvent.click(excluir);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('header: o título reflete data.titulo e editar grava titulo (top-level) no updater', () => {
    const data: NodePayload = {
      titulo: 'Título inicial',
      tipo: 'ACAO',
      acaoTipo: 'ENVIAR_WHATSAPP',
      config: {},
    };

    // onUpdate APLICA o updater na hora (síncrono, dentro do tick do change) —
    // se a gente capturasse o updater e só rodasse depois, o React já teria
    // revertido o input controlado pro valor original (data nunca muda) e
    // e.target.value leria o valor antigo. Aplicar na hora pega o valor certo.
    let captured: NodePayload | null = null;
    const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
      captured = updater(data);
    });
    render(
      <NodeInspector
        node={makeNode(data)}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onRemoveSaida={vi.fn()}
        onRenameSaida={vi.fn()}
        onChangeModo={vi.fn()}
        onDisparar={vi.fn()}
      />,
    );

    // ROUND-TRIP de leitura: o input do título reflete data.titulo.
    const tituloInput = screen.getByDisplayValue('Título inicial') as HTMLInputElement;
    expect(tituloInput.value).toBe('Título inicial');

    // ESCRITA: editar o título → updater grava titulo no TOP-LEVEL (não em config).
    fireEvent.change(tituloInput, { target: { value: 'Novo título' } });
    expect(onUpdate).toHaveBeenCalled();
    expect(captured).not.toBeNull();
    expect(captured!.titulo).toBe('Novo título');
  });

  it('ACAO + CONVERSAR_IA: editar "Variáveis que a IA pode gravar" → config.variaveisGravadas vira array (split por vírgula)', () => {
    const data: NodePayload = {
      titulo: 'Entrevista IA',
      tipo: 'ACAO',
      acaoTipo: 'CONVERSAR_IA',
      config: { aguardarResposta: true, timeoutHoras: 24 },
    };
    let captured: NodePayload | null = null;
    const onUpdate = vi.fn((updater: (d: NodePayload) => NodePayload) => {
      captured = updater(data);
    });
    render(
      <NodeInspector
        node={makeNode(data)}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onRemoveSaida={vi.fn()}
        onRenameSaida={vi.fn()}
        onChangeModo={vi.fn()}
        onDisparar={vi.fn()}
      />,
    );

    const varsInput = screen.getByPlaceholderText(
      'classificacao, canal, potencial_pedidos',
    ) as HTMLInputElement;
    fireEvent.change(varsInput, { target: { value: 'classificacao, canal' } });

    // TRANSFORMAÇÃO exata: a string vírgula-separada vira array trimado.
    expect(captured).not.toBeNull();
    expect(captured!.config.variaveisGravadas).toEqual(['classificacao', 'canal']);
  });
});
