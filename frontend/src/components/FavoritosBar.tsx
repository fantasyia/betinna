import { Link } from 'react-router-dom';
import { Star, X } from 'lucide-react';
import { useFavoritos, removeFavorito } from '@/lib/favoritos';
import { cn } from '@/lib/cn';

/**
 * F6 (Lote 8) — Barra de acesso rápido aos favoritos do usuário.
 *
 * Aparece no topo de toda página (logo abaixo do cabeçalho). Cada favorito
 * é um chip clicável (vai pra rota) com um × pra remover. Some quando o
 * usuário não tem favoritos. A fonte é o store em `@/lib/favoritos`.
 */
export function FavoritosBar() {
  const favoritos = useFavoritos();
  if (favoritos.length === 0) return null;

  return (
    <div data-testid="favoritos-bar" className="flex items-center gap-2 flex-wrap mb-5">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted shrink-0">
        <Star size={12} className="text-warning" fill="currentColor" />
        Favoritos
      </span>
      {favoritos.map((f) => (
        <span
          key={f.to}
          className={cn(
            'inline-flex items-center rounded-full overflow-hidden',
            'border border-border bg-surface text-sm',
          )}
        >
          <Link
            to={f.to}
            data-testid={`favorito-chip-${f.to.replace(/\//g, '-')}`}
            className="px-3 py-1 text-text-subtle hover:text-primary transition-colors"
          >
            {f.label}
          </Link>
          <button
            type="button"
            aria-label={`Remover ${f.label} dos favoritos`}
            onClick={() => removeFavorito(f.to)}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-1.5 py-1 text-muted hover:text-danger transition-colors"
          >
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}
