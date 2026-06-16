import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/cn';
import {
  ACAO_LABEL,
  TRIGGER_LABEL,
  TIPO_LABEL,
  TIPO_ACCENT,
  pickIcon,
  isManualTrigger,
} from '../lib/metadata';
import { saidasDoNo } from '../lib/saidas';
import type { FlowNode } from '../lib/types';

/**
 * NodeCard — nó custom do React Flow.
 *
 * As saídas (handles source) vêm de saidasDoNo(data) — o contrato centralizado.
 * O `id` de cada handle vira o label da aresta no onConnect.
 */
export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const tipo = data.tipo;
  const Icon = pickIcon(data);
  const accent = TIPO_ACCENT[tipo];
  const saidas = saidasDoNo(data);

  return (
    <div
      className={cn(
        'relative rounded-lg border bg-surface min-w-[180px] shadow-md',
        'transition-all duration-100',
        selected ? 'border-primary shadow-lg ring-2 ring-primary/30' : 'border-border-strong',
      )}
    >
      {/* Top connection (todos exceto TRIGGER) */}
      {tipo !== 'TRIGGER' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2 !h-2 !bg-primary !border-bg !border-2"
        />
      )}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border" style={{ borderTopColor: accent, borderTopWidth: 3, borderTopStyle: 'solid', borderRadius: 'inherit' }}>
        <span
          className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
          style={{ background: accent + '20', color: accent }}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
          {TIPO_LABEL[tipo]}
        </span>
        {isManualTrigger(data) && (
          <span className="ml-auto rounded-full bg-success/15 text-success border border-success/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
            Manual
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="text-sm font-medium text-text leading-tight">{data.titulo}</div>
        {isManualTrigger(data) ? (
          <div className="text-[10px] text-muted mt-1">
            {(data.config?.descricao as string)?.trim() || 'Disparo só na mão (▶️ Disparar agora)'}
          </div>
        ) : (
          (data.acaoTipo || data.triggerTipo) && (
            <div className="text-[10px] text-muted mt-1">
              {data.acaoTipo
                ? ACAO_LABEL[data.acaoTipo]
                : data.triggerTipo
                  ? TRIGGER_LABEL[data.triggerTipo]
                  : ''}
            </div>
          )
        )}
      </div>
      {/* Saídas: CONDICAO simples = true/false; CONDICAO roteador = N saídas +
          default; CONVERSAR_IA = classificou/timeout/erro (ou main/erro); demais
          = 1. O `id` do handle vira o label da aresta. Lógica em saidasDoNo(). */}
      {saidas.map((s, i) => (
        <Handle
          key={s.id ?? `main-${i}`}
          type="source"
          position={Position.Bottom}
          id={s.id}
          className={`!w-2 !h-2 ${s.cor} !border-bg !border-2`}
          style={s.pos != null ? { left: s.pos } : undefined}
        />
      ))}
      {/* Rótulos flutuantes (só CONVERSAR_IA usa) */}
      {saidas.map((s, i) =>
        s.rotulo ? (
          <div
            key={`rot-${s.id ?? `main-${i}`}`}
            className={`absolute top-full mt-0.5 -translate-x-1/2 text-[9px] leading-none ${s.txt} whitespace-nowrap pointer-events-none`}
            style={s.pos != null ? { left: s.pos } : undefined}
          >
            {s.rotulo}
          </div>
        ) : null,
      )}
    </div>
  );
}
