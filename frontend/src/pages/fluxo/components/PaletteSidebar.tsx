import { type DragEvent } from 'react';
import { Zap, GitBranch, Play, Timer } from 'lucide-react';
import { Select, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import { type TriggerTipo, type PaletteItem } from '@/pages/fluxo/lib/types';
import {
  TRIGGER_LABEL,
  ACAO_ICONS,
  TIPO_ACCENT,
  PALETTE_CATEGORIES,
} from '@/pages/fluxo/lib/metadata';
import type { FluxoEditorApi } from '@/pages/fluxo/hooks/useFluxoEditor';

/**
 * PaletteSidebar — o painel esquerdo "Blocos" do editor.
 *
 * Fixo no desktop; drawer pela esquerda no mobile (controlado por mobileAberto).
 * Contém o Select de "Trigger global" + as categorias da paleta (itens
 * arrastáveis). A lógica de inserir o Trigger Manual já vive no editor
 * (onChangeTriggerGlobal) — aqui só fia o Select. JSX verbatim.
 */
export function PaletteSidebar({
  editor,
  mobileAberto,
}: {
  editor: FluxoEditorApi;
  mobileAberto: boolean;
}) {
  return (
    <aside
      className={`w-[78vw] max-w-[240px] md:w-[240px] shrink-0 border-r border-border bg-bg-alt overflow-y-auto
        absolute inset-y-0 left-0 z-20 shadow-xl transition-transform duration-200
        md:static md:z-auto md:shadow-none md:translate-x-0
        ${mobileAberto ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="p-3 border-b border-border">
        <Field label="Trigger global" hint="Quando o fluxo dispara">
          <Select
            size="sm"
            value={editor.triggerTipo}
            onChange={(e) => editor.onChangeTriggerGlobal(e.target.value as TriggerTipo | '')}
          >
            <option value="">Manual (sem trigger)</option>
            {(Object.keys(TRIGGER_LABEL) as TriggerTipo[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="p-3 flex flex-col gap-4">
        {PALETTE_CATEGORIES.map((cat) => (
          <div key={cat.title}>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2 px-1">
              {cat.title}
            </h4>
            <div className="flex flex-col gap-1">
              {cat.items.map((item) => (
                <PaletteItemView key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── Palette item (draggable) ───────────────────────────────────

function PaletteItemView({ item }: { item: PaletteItem }) {
  const Icon =
    item.tipo === 'TRIGGER'
      ? Zap
      : item.tipo === 'CONDICAO'
        ? GitBranch
        : item.tipo === 'DELAY'
          ? Timer
          : item.acaoTipo
            ? ACAO_ICONS[item.acaoTipo]
            : Play;
  const accent = TIPO_ACCENT[item.tipo];

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/fluxo-node', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-grab',
        'border border-border bg-surface',
        'hover:border-border-strong hover:bg-surface-hover transition-colors',
        'active:cursor-grabbing active:scale-95',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
      <span className="text-xs font-medium text-text truncate">{item.label}</span>
    </div>
  );
}
