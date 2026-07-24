import { type ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/masks';
import { Card } from './Card';
import { Sparkline } from './Sparkline';

/**
 * Stat — KPI card.
 *
 * Mostra valor primário grande + label + (opcional) delta vs período anterior +
 * (opcional) sparkline. Padrão de dashboard SaaS.
 */
type IconTone = 'primary' | 'secondary' | 'magenta' | 'blue' | 'success' | 'warning' | 'danger' | 'info';

const TONE_BG: Record<IconTone, string> = {
  primary: 'bg-primary/15 text-primary',
  secondary: 'bg-secondary/20 text-secondary-hover',
  magenta: 'bg-magenta/15 text-magenta',
  blue: 'bg-blue/15 text-blue',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
};

export function Stat({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  icon,
  iconTone = 'primary',
  trend,
  spark,
  sparkColor = 'currentColor',
  dense = false,
  className,
}: {
  label: string;
  /** Valor formatado (ex: "R$ 24.530" ou "127"). */
  value: ReactNode;
  hint?: ReactNode;
  /** Variação percentual (-100 a +Infinity). Positivo = verde, negativo = vermelho. */
  delta?: number;
  /** Label do delta (ex: "vs mês anterior"). */
  deltaLabel?: string;
  icon?: ReactNode;
  /** Cor do bg do quadrado do ícone. Default: primary. */
  iconTone?: IconTone;
  /** Sobrepõe automatic trend from delta. */
  trend?: 'up' | 'down' | 'flat';
  spark?: number[];
  sparkColor?: string;
  /** Versão compacta (dashboard denso): menos padding/gap, valor menor. */
  dense?: boolean;
  className?: string;
}) {
  const computedTrend: 'up' | 'down' | 'flat' =
    trend ?? (typeof delta === 'number' ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') : 'flat');

  const TrendIcon =
    computedTrend === 'up' ? TrendingUp : computedTrend === 'down' ? TrendingDown : Minus;

  const deltaColor =
    computedTrend === 'up'
      ? 'text-success'
      : computedTrend === 'down'
        ? 'text-danger'
        : 'text-muted';

  return (
    <Card
      variant="default"
      padding={dense ? 'sm' : 'md'}
      className={cn('flex flex-col', dense ? 'gap-1.5' : 'gap-3', className)}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-text-subtle min-w-0">
          {icon && (
            <span
              className={cn(
                'flex items-center justify-center rounded-md shrink-0',
                dense ? 'h-6 w-6' : 'h-7 w-7',
                TONE_BG[iconTone],
                '[&>svg]:h-3.5 [&>svg]:w-3.5',
              )}
            >
              {icon}
            </span>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider truncate">
            {label}
          </span>
        </div>
        {typeof delta === 'number' && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-semibold tabular',
              deltaColor,
            )}
            title={deltaLabel}
          >
            <TrendIcon className="h-3 w-3" />
            {delta > 0 ? '+' : ''}
            {formatPercent(delta, 1)}
          </span>
        )}
      </header>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span
            className={cn(
              'font-semibold text-text tabular tracking-tight',
              dense ? 'text-xl' : 'text-2xl',
            )}
          >
            {value}
          </span>
          {hint && <span className="text-xs text-muted">{hint}</span>}
        </div>
        {spark && spark.length > 1 && (
          <div style={{ color: sparkColor }}>
            <Sparkline data={spark} width={88} height={dense ? 24 : 28} fill strokeWidth={1.5} />
          </div>
        )}
      </div>
    </Card>
  );
}
