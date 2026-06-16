import {
  useReactFlow,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

/**
 * Aresta com botão "×" pra REMOVER a conexão (antes só dava via Backspace —
 * ninguém descobria). Mostra o label (Sim/Não dos ramos de condição) + o botão.
 */
export function EdgeRemovivel({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan flex items-center gap-1"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          {label != null && label !== '' && (
            <span className="rounded bg-surface border border-border px-1.5 py-0.5 text-[10px] font-medium text-text">
              {label}
            </span>
          )}
          <button
            type="button"
            title="Remover conexão"
            aria-label="Remover conexão"
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-danger/40 bg-surface text-danger text-xs leading-none hover:bg-danger hover:text-white transition-colors shadow-sm"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
