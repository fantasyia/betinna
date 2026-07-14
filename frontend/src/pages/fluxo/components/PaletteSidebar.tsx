import { useMemo, useState, type DragEvent } from 'react';
import { Zap, GitBranch, Play, Timer, Search, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Select, Field, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { type TriggerTipo, type PaletteItem } from '@/pages/fluxo/lib/types';
import {
  TRIGGER_LABEL,
  ACAO_ICONS,
  TIPO_ACCENT,
  PALETTE_CATEGORIES,
} from '@/pages/fluxo/lib/metadata';
import { BLOCO_DESC } from '@/pages/fluxo/lib/resumo';
import type { FluxoEditorApi } from '@/pages/fluxo/hooks/useFluxoEditor';

/**
 * PaletteSidebar — o painel esquerdo "Blocos" do editor.
 *
 * Fixo no desktop; drawer pela esquerda no mobile (controlado por mobileAberto).
 * Contém o Select de "Trigger global" + busca + as categorias da paleta (itens
 * arrastáveis). No desktop dá pra recolher pra sobrar canvas (colapsado → rail
 * fino com botão de expandir). A lógica de inserir o Trigger Manual vive no
 * editor (onChangeTriggerGlobal) — aqui só fia o Select.
 */
export function PaletteSidebar({
  editor,
  mobileAberto,
  collapsed = false,
  onToggleCollapse,
}: {
  editor: FluxoEditorApi;
  mobileAberto: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [busca, setBusca] = useState('');

  const categorias = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return PALETTE_CATEGORIES;
    return PALETTE_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter((i) => i.label.toLowerCase().includes(q)),
    })).filter((cat) => cat.items.length > 0);
  }, [busca]);

  // Rail colapsado (só desktop) — barra fina com botão de expandir.
  if (collapsed) {
    return (
      <aside className="hidden md:flex w-10 shrink-0 border-r border-border bg-bg-alt flex-col items-center py-2 gap-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expandir blocos"
          className="p-1.5 rounded hover:bg-surface-hover text-muted hover:text-text transition-colors"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted [writing-mode:vertical-rl] rotate-180">
          Blocos
        </span>
      </aside>
    );
  }

  return (
    <aside
      className={`w-[78vw] max-w-[240px] md:w-[240px] shrink-0 border-r border-border bg-bg-alt overflow-y-auto
        absolute inset-y-0 left-0 z-20 shadow-xl transition-transform duration-200
        md:static md:z-auto md:shadow-none md:translate-x-0
        ${mobileAberto ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="p-3 border-b border-border flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text">Blocos</h3>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Recolher blocos"
              className="hidden md:inline-flex p-1 rounded hover:bg-surface-hover text-muted hover:text-text transition-colors"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
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
        <Input
          size="sm"
          leftIcon={<Search />}
          placeholder="Buscar bloco…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <div className="p-3 flex flex-col gap-4">
        {categorias.length === 0 ? (
          <p className="text-xs text-muted px-1 py-4 text-center">Nenhum bloco encontrado.</p>
        ) : (
          categorias.map((cat) => (
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
          ))
        )}
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
  const desc = item.acaoTipo ? BLOCO_DESC[item.acaoTipo] : BLOCO_DESC[item.tipo];

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/fluxo-node', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={desc ? `${item.label} — ${desc}` : item.label}
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
