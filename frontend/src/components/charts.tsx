import type { CSSProperties } from 'react';
import { colors } from './styles';
import { formatNumero, formatPercent } from '@/lib/masks';

/**
 * Charts SVG-based, sem dep externa.
 *  - BarChart horizontal (top-N reps, status, etc.)
 *  - Funnel (etapas com largura proporcional)
 *  - Sparkline (mini-trend)
 *  - DonutChart (proporções)
 *
 * Quando precisarmos de coisas mais sofisticadas (eixos, tooltips ricos,
 * zoom), substituir por uma lib (recharts ou nivo). Por ora, suficiente
 * pra MVP e mantém bundle leve.
 */

// ─── Bar chart horizontal ─────────────────────────────────────────────

export interface BarChartDatum {
  label: string;
  value: number;
  sublabel?: string;
  color?: string;
}

export function BarChart({
  data,
  maxBars = 8,
  formatValue,
}: {
  data: BarChartDatum[];
  maxBars?: number;
  formatValue?: (v: number) => string;
}) {
  const truncated = data.slice(0, maxBars);
  const max = Math.max(...truncated.map((d) => d.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {truncated.map((d, i) => {
        const pct = (d.value / max) * 100;
        const fmt = formatValue ? formatValue(d.value) : formatNumero(d.value);
        return (
          <div key={`${d.label}-${i}`} style={{ fontSize: 13 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 3,
                gap: '0.5rem',
              }}
            >
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}
              >
                {d.label}
                {d.sublabel && (
                  <span style={{ color: colors.muted, marginLeft: 6, fontSize: 11 }}>
                    {d.sublabel}
                  </span>
                )}
              </span>
              <strong>{fmt}</strong>
            </div>
            <div
              style={{
                width: '100%',
                height: 8,
                background: colors.border,
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: d.color ?? colors.primary,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        );
      })}
      {data.length === 0 && (
        <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>Sem dados no período.</p>
      )}
    </div>
  );
}

// ─── Funnel (vertical) ────────────────────────────────────────────────

export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

export function Funnel({
  stages,
  formatValue,
}: {
  stages: FunnelStage[];
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const fmt = formatValue ? formatValue(s.value) : formatNumero(s.value);
        return (
          <div
            key={`${s.label}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ width: 130, fontSize: 13, color: colors.muted }}>{s.label}</span>
            <div
              style={{
                flex: 1,
                height: 28,
                background: colors.border,
                borderRadius: 4,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.max(pct, 3)}%`,
                  height: '100%',
                  background: s.color ?? colors.primary,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 8,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  transition: 'width 0.3s ease',
                }}
              >
                {fmt}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sparkline (mini line chart) ──────────────────────────────────────

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = colors.primary,
  style,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}) {
  if (data.length < 2) {
    return <span style={{ color: colors.muted, fontSize: 11 }}>—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} style={style} aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

// ─── Donut (proporções) ──────────────────────────────────────────────

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  slices,
  size = 140,
  thickness = 18,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return (
      <p style={{ color: colors.muted, fontSize: 13, textAlign: 'center', padding: '1rem' }}>
        Sem dados
      </p>
    );
  }

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          {slices.map((s, i) => {
            const dash = (s.value / total) * c;
            const el = (
              <circle
                key={i}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
      </svg>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {slices.map((s) => {
          const pct = formatPercent(total > 0 ? (s.value / total) * 100 : 0, 1);
          return (
            <li
              key={s.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  background: s.color,
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{s.label}</span>
              <strong>{formatNumero(s.value)}</strong>
              <span style={{ color: colors.muted, fontSize: 11, minWidth: 40, textAlign: 'right' }}>
                {pct}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── KPI Card com variação ──────────────────────────────────────────

export function KPICard({
  label,
  value,
  variacao,
  hint,
  color = colors.text,
}: {
  label: string;
  value: string;
  variacao?: number;
  hint?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '0.875rem',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: colors.muted,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color,
          marginTop: 4,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {variacao !== undefined && (
        <div
          style={{
            fontSize: 12,
            color:
              variacao > 0
                ? colors.success
                : variacao < 0
                ? colors.danger
                : colors.muted,
            marginTop: 2,
            fontWeight: 600,
          }}
        >
          {variacao > 0 ? '↑' : variacao < 0 ? '↓' : '·'} {formatPercent(Math.abs(variacao), 1)} vs anterior
        </div>
      )}
      {hint && (
        <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}
