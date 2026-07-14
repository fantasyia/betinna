import { useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  MousePointerClick,
  PanelRight,
  PanelRightClose,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FullPageSpinner } from '@/components/ui';
import { type FluxoDetailApi, type TriggerTipo } from '@/pages/fluxo/lib/types';
import { TRIGGER_LABEL } from '@/pages/fluxo/lib/metadata';
import { NodeCard } from '@/pages/fluxo/components/NodeCard';
import { EdgeRemovivel } from '@/pages/fluxo/components/EdgeRemovivel';
import { FluxoToolbar } from '@/pages/fluxo/components/FluxoToolbar';
import { TestarFluxoModal } from '@/pages/fluxo/components/TestarFluxoModal';
import { PaletteSidebar } from '@/pages/fluxo/components/PaletteSidebar';
import { FluxoCanvas } from '@/pages/fluxo/components/FluxoCanvas';
import { NodeInspector } from '@/pages/fluxo/components/inspector/NodeInspector';
import { useFluxoEditor } from '@/pages/fluxo/hooks/useFluxoEditor';

/**
 * FluxoEditor — editor visual de fluxos de automação com React Flow.
 *
 * Layout (3 colunas):
 *  - Esquerda (palette): GATILHOS / CONDIÇÕES / AÇÕES / TEMPO — drag pro canvas
 *  - Centro (canvas): React Flow com nós custom e edges
 *  - Direita (inspector): edita props do nó selecionado
 *
 * Persistência: PUT /fluxos/:id com `{ nos, arestas, triggerTipo }`.
 * Backend faz full-replace dos nós e arestas (per schema docs).
 */

// Componentes de canvas (NodeCard / EdgeRemovivel) e o contrato de saídas vivem
// em @/pages/fluxo/* — aqui só o registro pro React Flow.
const NODE_TYPES = { fluxo: NodeCard };
const EDGE_TYPES = { removivel: EdgeRemovivel };

// ─── Editor principal ────────────────────────────────────────────

export function FluxoEditor({
  fluxoId,
  onClose,
  onSaved,
}: {
  fluxoId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <FluxoEditorInner fluxoId={fluxoId} onClose={onClose} onSaved={onSaved} />
    </ReactFlowProvider>
  );
}

function FluxoEditorInner({
  fluxoId,
  onClose,
  onSaved,
}: {
  fluxoId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data, loading, refetch } = useApiQuery<FluxoDetailApi>(`/fluxos/${fluxoId}`);

  // Após salvar, mantém o comportamento original: avisa o pai E recarrega o fluxo.
  const handleSaved = useCallback(() => {
    onSaved?.();
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSaved]);

  // O cérebro do editor (estado + handlers + history + hidratação + save).
  const editor = useFluxoEditor({ fluxoId, data, onSaved: handleSaved });

  // Mobile: painéis viram drawers sobrepostos (só um aberto por vez). Em desktop
  // (md+) os painéis são fixos e este estado é ignorado pelo layout.
  const [mobilePanel, setMobilePanel] = useState<'palette' | 'inspector' | null>(null);
  // Recolher painéis no desktop → sobra canvas pra fluxos grandes (ignorado no mobile).
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  // Teste manual — dispara o fluxo agora (do nó gatilho), sem esperar cron/evento.
  const [testarAberto, setTestarAberto] = useState(false);
  const [testLeadId, setTestLeadId] = useState('');

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-[110] bg-bg flex items-center justify-center">
        <FullPageSpinner label="Carregando fluxo…" />
      </div>
    );
  }

  const selectedNode = editor.selectedNode;

  return (
    <div className="fixed inset-0 z-[110] bg-bg flex flex-col">
      {/* Top bar */}
      <FluxoToolbar
        editor={editor}
        status={data.status}
        onClose={onClose}
        onTestar={() => setTestarAberto(true)}
        onMobilePanel={(p) => setMobilePanel((cur) => (cur === p ? null : p))}
      />

      {/* Aviso mobile: o editor de fluxo é arrastar-e-soltar (HTML5 DnD + handles
          pequenos), que não funciona no toque. Quem edita fluxo é gestor no desktop —
          no celular o fluxo dá pra visualizar, não pra montar. */}
      <div className="md:hidden flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-alt text-xs text-muted">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>
          Edição de fluxos funciona melhor no computador — montar/conectar blocos usa
          arrastar-e-soltar, difícil no celular.
        </span>
      </div>

      <TestarFluxoModal
        aberto={testarAberto}
        onClose={() => setTestarAberto(false)}
        testLeadId={testLeadId}
        setTestLeadId={setTestLeadId}
        testando={editor.testando}
        onRodar={async () => {
          const ok = await editor.runTeste(testLeadId);
          if (ok) setTestarAberto(false);
        }}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Backdrop dos drawers (só mobile, quando um painel está aberto) */}
        {mobilePanel && (
          <button
            type="button"
            aria-label="Fechar painel"
            className="absolute inset-0 z-10 bg-black/40 md:hidden"
            onClick={() => setMobilePanel(null)}
          />
        )}
        {/* Palette — fixa no desktop (recolhível); drawer pela esquerda no mobile */}
        <PaletteSidebar
          editor={editor}
          mobileAberto={mobilePanel === 'palette'}
          collapsed={paletteCollapsed}
          onToggleCollapse={() => setPaletteCollapsed((v) => !v)}
        />

        {/* Canvas */}
        <FluxoCanvas
          editor={editor}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClickExtra={() => setMobilePanel('inspector')}
          onPaneClickExtra={() => setMobilePanel(null)}
        />

        {/* Inspector — fixo no desktop (recolhível); drawer pela direita no mobile.
            Colapsado (só desktop) vira um rail fino; o drawer mobile segue inteiro. */}
        {inspectorCollapsed ? (
          <aside className="hidden md:flex w-10 shrink-0 border-l border-border bg-bg-alt flex-col items-center py-2 gap-3">
            <button
              type="button"
              onClick={() => setInspectorCollapsed(false)}
              title="Expandir painel"
              className="p-1.5 rounded hover:bg-surface-hover text-muted hover:text-text transition-colors"
            >
              <PanelRight className="h-4 w-4" />
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted [writing-mode:vertical-rl] rotate-180">
              Painel
            </span>
          </aside>
        ) : (
          <aside
            className={`w-[88vw] max-w-[320px] md:w-[300px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto
              absolute inset-y-0 right-0 z-20 shadow-xl transition-transform duration-200
              md:static md:z-auto md:shadow-none md:translate-x-0
              ${mobilePanel === 'inspector' ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="hidden md:flex items-center justify-between px-3 py-2 border-b border-border">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text">
                {selectedNode ? 'Editar nó' : 'Painel'}
              </h3>
              <button
                type="button"
                onClick={() => setInspectorCollapsed(true)}
                title="Recolher painel"
                className="p-1 rounded hover:bg-surface-hover text-muted hover:text-text transition-colors"
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
            {selectedNode ? (
              <NodeInspector
                node={selectedNode}
                onUpdate={editor.updateSelectedNode}
                onDelete={editor.deleteSelectedNode}
                onRemoveSaida={editor.removeSaidaDoNoSelecionado}
                onRenameSaida={editor.renameSaidaDoNoSelecionado}
                onChangeModo={editor.trocarModoDoNoSelecionado}
                onDisparar={editor.dispararManual}
              />
            ) : (
              <FluxoResumoVazio
                nodeCount={editor.nodes.length}
                edgeCount={editor.edges.length}
                triggerTipo={editor.triggerTipo}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Estado vazio do inspector — em vez de só "selecione um nó", dá uma visão-geral
 * do fluxo (disparo + contagem de blocos/conexões) e a dica de como editar.
 */
function FluxoResumoVazio({
  nodeCount,
  edgeCount,
  triggerTipo,
}: {
  nodeCount: number;
  edgeCount: number;
  triggerTipo: TriggerTipo | '';
}) {
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 text-center mt-2">
        <MousePointerClick className="h-6 w-6 text-muted-light" />
        <p className="text-sm text-muted">
          Clique num nó pra editar,
          <br />
          ou arraste um bloco da esquerda.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Resumo do fluxo
        </h4>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Disparo</span>
          <span className="text-text font-medium">
            {triggerTipo ? TRIGGER_LABEL[triggerTipo] : 'Manual'}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Blocos</span>
          <span className="text-text font-medium">{nodeCount}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Conexões</span>
          <span className="text-text font-medium">{edgeCount}</span>
        </div>
      </div>
    </div>
  );
}
