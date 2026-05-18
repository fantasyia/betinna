import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Spinner — loading indicator centralizado. */
export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}) {
  const sizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-5 w-5',
    lg: 'h-7 w-7',
    xl: 'h-10 w-10',
  };
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-muted', className)}>
      <Loader2 className={cn(sizes[size], 'animate-spin')} aria-hidden />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Tela cheia de loading — usado em <Suspense fallback>. */
export function FullPageSpinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Spinner size="lg" label={label} />
    </div>
  );
}
