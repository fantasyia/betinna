import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Skeleton — placeholder durante loading.
 *
 * Shimmer gradient — sutil mas perceptível. Não usa pulse (irrita mais que ajuda).
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-hover',
        'relative overflow-hidden',
        'before:absolute before:inset-0',
        "before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)]",
        'before:bg-[length:200%_100%] before:animate-shimmer',
        className,
      )}
      aria-hidden
      {...props}
    />
  );
}

/** Linha simples — h-3 default. */
export function SkeletonLine({
  width = '100%',
  className,
}: {
  width?: string | number;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn('h-3', className)}
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
    />
  );
}

/** Texto multi-linha (paragraphs). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          width={i === lines - 1 ? '60%' : `${85 + ((i * 7) % 15)}%`}
        />
      ))}
    </div>
  );
}

/** Card skeleton — header + 3 linhas. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface p-4 flex flex-col gap-3', className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 flex flex-col gap-1.5">
          <SkeletonLine width="40%" />
          <SkeletonLine width="60%" className="h-2.5" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}
