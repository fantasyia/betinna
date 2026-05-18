import { useMemo, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Avatar — circular com fallback de iniciais.
 *
 * Cores das iniciais derivam de hash do nome — mesmo nome sempre tem mesma cor.
 * Suporta src de imagem com fallback automático em erro.
 */

const avatarVariants = cva(
  [
    'inline-flex items-center justify-center shrink-0',
    'rounded-full font-semibold tracking-tight uppercase',
    'select-none overflow-hidden',
  ],
  {
    variants: {
      size: {
        xs: 'h-5 w-5 text-[9px]',
        sm: 'h-7 w-7 text-[11px]',
        md: 'h-9 w-9 text-[13px]',
        lg: 'h-11 w-11 text-base',
        xl: 'h-14 w-14 text-lg',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

/** Paleta de cores estáveis pra iniciais — pares (bg/text). */
const AVATAR_COLORS = [
  ['bg-rose-500/20', 'text-rose-300'],
  ['bg-amber-500/20', 'text-amber-300'],
  ['bg-emerald-500/20', 'text-emerald-300'],
  ['bg-cyan-500/20', 'text-cyan-300'],
  ['bg-blue-500/20', 'text-blue-300'],
  ['bg-violet-500/20', 'text-violet-300'],
  ['bg-pink-500/20', 'text-pink-300'],
  ['bg-fuchsia-500/20', 'text-fuchsia-300'],
  ['bg-teal-500/20', 'text-teal-300'],
  ['bg-orange-500/20', 'text-orange-300'],
];

/** Hash determinístico simples — mesmo input sempre mesma cor. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0]?.slice(0, 2) ?? '?';
  return (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
}

export interface AvatarProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof avatarVariants> {
  /** Nome do user/entidade — usado pra iniciais e cor estável. */
  name?: string | null;
  /** URL da imagem. Se não carregar, cai pras iniciais. */
  src?: string | null;
  /** Mostra dot online no canto inferior direito. */
  online?: boolean;
}

export function Avatar({ name, src, size, online, className, ...props }: AvatarProps) {
  const safeName = name?.trim() || '?';
  const initials = useMemo(() => getInitials(safeName), [safeName]);
  const [bg, text] = AVATAR_COLORS[hashString(safeName) % AVATAR_COLORS.length]!;

  return (
    <div className="relative inline-block">
      <div
        className={cn(avatarVariants({ size }), bg, text, className)}
        title={name ?? undefined}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={name ?? ''}
            className="h-full w-full object-cover"
            onError={(e) => {
              // Cai pras iniciais escondendo a imagem
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          initials
        )}
      </div>
      {online && (
        <span
          className={cn(
            'absolute bottom-0 right-0 block rounded-full border-2 border-bg bg-success',
            size === 'xs' && 'h-1.5 w-1.5',
            size === 'sm' && 'h-2 w-2',
            (!size || size === 'md') && 'h-2.5 w-2.5',
            size === 'lg' && 'h-3 w-3',
            size === 'xl' && 'h-3.5 w-3.5',
          )}
          aria-label="Online"
        />
      )}
    </div>
  );
}
