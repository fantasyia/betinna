import { useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlertCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { FullPageSpinner } from '@/components/ui';
import { type FluxoDetailApi } from '@/pages/fluxo/lib/types';
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
        {/* Palette — fixa no desktop; drawer pela esquerda no mobile */}
        <PaletteSidebar editor={editor} mobileAberto={mobilePanel === 'palette'} />

        {/* Canvas */}
        <FluxoCanvas
          editor={editor}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClickExtra={() => setMobilePanel('inspector')}
          onPaneClickExtra={() => setMobilePanel(null)}
        />

        {/* Inspector — fixo no desktop; drawer pela direita no mobile */}
        <aside
          className={`w-[88vw] max-w-[320px] md:w-[300px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto
            absolute inset-y-0 right-0 z-20 shadow-xl transition-transform duration-200
            md:static md:z-auto md:shadow-none md:translate-x-0
            ${mobilePanel === 'inspector' ? 'translate-x-0' : 'translate-x-full'}`}
        >
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
            <div className="p-4 text-center flex flex-col items-center gap-2 mt-8">
              <AlertCircle className="h-6 w-6 text-muted-light" />
              <p className="text-sm text-muted">Selecione um nó pra editar</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
