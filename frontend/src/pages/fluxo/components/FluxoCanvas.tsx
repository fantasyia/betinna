import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import { Play } from 'lucide-react';
import { type FlowNode } from '@/pages/fluxo/lib/types';
import type { FluxoEditorApi } from '@/pages/fluxo/hooks/useFluxoEditor';

/**
 * FluxoCanvas — a área central (React Flow) do editor.
 *
 * Roda DENTRO do ReactFlowProvider (que fica no wrapper FluxoEditor). O wrapper
 * (wrapperRef/onDrop/onDragOver) e todos os handlers vêm do editor. Os side
 * effects de drawer mobile (onNodeClick/onPaneClick abrem/fecham o inspector)
 * são passados via onNodeClickExtra/onPaneClickExtra pra manter comportamento
 * idêntico. JSX verbatim do FluxoEditorInner.
 */
export function FluxoCanvas({
  editor,
  nodeTypes,
  edgeTypes,
  onNodeClickExtra,
  onPaneClickExtra,
}: {
  editor: FluxoEditorApi;
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  onNodeClickExtra: () => void;
  onPaneClickExtra: () => void;
}) {
  return (
    <div
      ref={editor.wrapperRef}
      className="flex-1 relative"
      onDrop={editor.onDrop}
      onDragOver={editor.onDragOver}
    >
      <ReactFlow<FlowNode, Edge>
        nodes={editor.nodes}
        edges={editor.edges}
        onNodesChange={editor.onNodesChange}
        onEdgesChange={editor.onEdgesChange}
        onConnect={editor.onConnect}
        onInit={editor.onInit}
        onNodeClick={(e, n) => {
          editor.onNodeClick(e, n);
          onNodeClickExtra(); // mobile: abre o editor do nó (ignorado no desktop)
        }}
        onPaneClick={() => {
          editor.onPaneClick();
          onPaneClickExtra();
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        colorMode="dark"
        defaultEdgeOptions={{
          type: 'removivel',
          animated: false,
          style: { stroke: 'var(--secondary)', strokeWidth: 2.5 },
        }}
        connectionLineStyle={{ stroke: 'var(--secondary)', strokeWidth: 2.5 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!bg-surface !border !border-border !rounded-md"
        />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          maskColor="rgba(0,0,0,0.5)"
          className="!bg-bg-alt !border !border-border !rounded-md"
        />
      </ReactFlow>

      {editor.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-muted-light flex flex-col items-center gap-2">
            <Play className="h-8 w-8" />
            <p className="text-sm font-medium">Arraste itens da paleta pra começar</p>
            <p className="text-xs text-muted-light">
              Conecte os nós arrastando das bolinhas inferiores às superiores
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
