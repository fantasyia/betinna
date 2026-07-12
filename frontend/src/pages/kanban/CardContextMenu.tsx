import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardMenuAcao {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Item destrutivo (ex.: arquivar) — cor de alerta. */
  danger?: boolean;
  /** Separador acima do item. */
  separador?: boolean;
}

/**
 * Menu de contexto (botão direito) de um card do quadro. Renderiza flutuante na
 * posição do cursor, fecha ao clicar fora / Esc / rolar, e se ajusta pra não
 * estourar a viewport. As ações vêm prontas de quem abre (KanbanBoardPage).
 */
export function CardContextMenu({
  x,
  y,
  itens,
  onFechar,
}: {
  x: number;
  y: number;
  itens: CardMenuAcao[];
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  // Fecha ao clicar fora, Esc ou rolar a página.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onFechar();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onFechar, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onFechar, true);
    };
  }, [onFechar]);

  // Ajusta pra caber na tela (mede o menu depois de montar).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margem = 8;
    const left = Math.min(x, window.innerWidth - width - margem);
    const top = Math.min(y, window.innerHeight - height - margem);
    setPos({ top: Math.max(margem, top), left: Math.max(margem, left) });
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] min-w-[190px] rounded-[10px] border border-border bg-surface-elevated py-1 shadow-lg"
      style={{ top: pos.top, left: pos.left }}
      // Impede o menu nativo do browser em cima do nosso menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      {itens.map((item) => (
        <div key={item.id}>
          {item.separador && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            data-testid={`card-menu-${item.id}`}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-text',
              'hover:bg-surface transition-colors',
              item.danger && 'text-red-500 hover:bg-red-500/10',
            )}
            onClick={() => {
              item.onClick();
              onFechar();
            }}
          >
            <span className="shrink-0 text-muted [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
              {item.icon}
            </span>
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
