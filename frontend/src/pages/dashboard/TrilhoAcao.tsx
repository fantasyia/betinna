import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';

/** matchMedia reativo — breakpoints do trilho (1024 / 1600 conforme o card). */
function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setMatch(e.matches);
    mq.addEventListener('change', on);
    setMatch(mq.matches);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * TRILHO DE AÇÃO — a coluna direita FIXA do cockpit. O que exige ação nunca sai
 * da vista enquanto o canvas rola.
 *
 * Breakpoints (do card):
 *  - ≥1600px  → coluna de 340px, sticky.
 *  - 1024–1599 → colapsa numa faixa de ícones; clicar expande num painel lateral.
 *  - <1024    → empilha: o trilho vira o TOPO da página (renderizado antes no DOM).
 */
export function TrilhoAcao({
  children,
  badge = 0,
}: {
  children: ReactNode;
  /** Contagem de pendências — aparece no ícone quando o trilho está colapsado. */
  badge?: number;
}) {
  const largo = useMediaQuery('(min-width: 1600px)');
  const empilhado = useMediaQuery('(max-width: 1023px)');
  const [aberto, setAberto] = useState(false);

  // <1024: sem coluna — os módulos empilham no topo do fluxo normal da página.
  if (empilhado) {
    return <div className="flex flex-col gap-5">{children}</div>;
  }

  // ≥1600: trilho pleno, sticky abaixo da barra de pulso.
  if (largo) {
    return (
      <aside className="w-[340px] shrink-0" data-testid="trilho-acao">
        <div className="sticky top-[76px] flex flex-col gap-5 max-h-[calc(100vh-92px)] overflow-y-auto pr-0.5">
          {children}
        </div>
      </aside>
    );
  }

  // 1024–1599: faixa de ícones; painel expande por cima do canvas.
  return (
    <aside className="w-12 shrink-0" data-testid="trilho-acao-colapsado">
      <div className="sticky top-[76px] flex flex-col items-center gap-1">
        <div className="relative">
          <IconButton
            aria-label="Abrir trilho de ação"
            variant="secondary"
            icon={<BellRing />}
            onClick={() => setAberto(true)}
            data-testid="trilho-expandir"
          />
          {badge > 0 && (
            <span
              className={cn(
                'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full',
                'bg-danger text-white text-[10px] font-bold tabular',
                'flex items-center justify-center pointer-events-none',
              )}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
      </div>

      {aberto && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setAberto(false)}
            aria-hidden
          />
          <div
            className={cn(
              'fixed right-0 top-0 bottom-0 z-50 w-[380px] max-w-[92vw]',
              'bg-bg border-l border-border-strong shadow-xl',
              'flex flex-col gap-5 p-4 overflow-y-auto animate-fade-in',
            )}
            role="dialog"
            aria-label="Trilho de ação"
          >
            <div className="flex items-center justify-end">
              <IconButton
                aria-label="Fechar trilho"
                variant="ghost"
                size="sm"
                icon={<X />}
                onClick={() => setAberto(false)}
              />
            </div>
            {children}
          </div>
        </>
      )}
    </aside>
  );
}
