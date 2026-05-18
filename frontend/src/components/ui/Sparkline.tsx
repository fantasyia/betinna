import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/**
 * Sparkline — micro chart inline (SVG puro, sem dependência de lib).
 *
 * Mostra tendência sem precisar de eixos. Pra trends de 7-30 pontos.
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = 'currentColor',
  strokeWidth = 1.5,
  className,
  fill = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  /** Preenche área embaixo da linha (gradiente sutil). */
  fill?: boolean;
}) {
  const { pathLine, pathArea } = useMemo(() => {
    if (data.length < 2) return { pathLine: '', pathArea: '' };

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    const padY = strokeWidth;
    const usableH = height - padY * 2;

    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = padY + (1 - (v - min) / range) * usableH;
      return [x, y] as const;
    });

    const line = points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');

    const area =
      line +
      ` L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z`;

    return { pathLine: line, pathArea: area };
  }, [data, width, height, strokeWidth]);

  if (data.length < 2) return null;

  const gradientId = `spark-grad-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      style={{ color }}
      aria-hidden
    >
      {fill && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={pathArea} fill={`url(#${gradientId})`} />}
      <path
        d={pathLine}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
