import { useRef, useState } from 'react';
import { useToast } from '@/components/toast';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { svgParaPng } from '@/lib/grafico-export';
import { formatNumero } from '@/lib/masks';
import { cn } from '@/lib/cn';

/**
 * Kit de gráficos do M8 (dashboard) — SVG puro, sem lib externa.
 *
 * Regras visuais do card (valem em TODA a tela):
 * - UM eixo só; uma pergunta por gráfico.
 * - Cor segue a ENTIDADE (etapas usam a cor cadastrada no funil); série única
 *   não leva legenda — rótulo direto na ponta.
 * - Texto sempre em tom de texto (nunca na cor da série).
 * - Marcas finas: linhas 2px, pontas arredondadas 4px ancoradas na base,
 *   grade recessiva (--chart-grade), rótulo direto seletivo.
 * - Hover: crosshair + tooltip na linha; tooltip por marca nas barras.
 * - Dark mode com passos próprios (--chart-* tem override em html.dark).
 */

// ─── Card com toggle gráfico/tabela + export PNG e CSV ────────────────

export interface TabelaEquivalente<T> {
  colunas: CsvColumn<T>[];
  rows: T[];
}

export function ChartCard<T>({
  titulo,
  subtitulo,
  filename,
  tabela,
  vazio,
  children,
}: {
  /** A PERGUNTA que o gráfico responde ("Leads ao longo do tempo"). */
  titulo: string;
  subtitulo?: string;
  /** Base do nome de arquivo dos exports (sem extensão). */
  filename: string;
  /** Visão de tabela equivalente — acessibilidade + conferência de número. */
  tabela: TabelaEquivalente<T>;
  /** Quando true, mostra estado vazio em vez do gráfico. */
  vazio?: boolean;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const [vista, setVista] = useState<'grafico' | 'tabela'>('grafico');
  const wrapRef = useRef<HTMLDivElement>(null);

  async function exportarPng() {
    const svg = wrapRef.current?.querySelector('svg');
    if (!svg) {
      toast.error('Abra a vista de gráfico pra exportar PNG');
      return;
    }
    try {
      await svgParaPng(svg, `${filename}.png`);
    } catch (err) {
      toast.error('Falha ao exportar PNG', err instanceof Error ? err.message : undefined);
    }
  }

  function exportarCsv() {
    downloadCsv(`${filename}.csv`, toCsv(tabela.rows, tabela.colunas));
    toast.success(`${tabela.rows.length} linhas exportadas (CSV)`);
  }

  const btn =
    'bg-surface text-text border border-border-strong rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer';

  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 min-w-0 flex flex-col h-full">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-semibold leading-tight">{titulo}</h3>
          {subtitulo && <p className="m-0 text-[11px] text-muted">{subtitulo}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex border border-border-strong rounded-md overflow-hidden">
            {(['grafico', 'tabela'] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`${filename}-vista-${v}`}
                onClick={() => setVista(v)}
                className={cn(
                  'px-2 py-0.5 text-[11px] font-medium cursor-pointer border-none',
                  vista === v ? 'bg-primary text-primary-contrast' : 'bg-surface text-muted',
                )}
              >
                {v === 'grafico' ? 'Gráfico' : 'Tabela'}
              </button>
            ))}
          </div>
          <button type="button" className={btn} onClick={exportarPng} data-testid={`${filename}-png`}>
            PNG
          </button>
          <button type="button" className={btn} onClick={exportarCsv} data-testid={`${filename}-csv`}>
            CSV
          </button>
        </div>
      </div>

      {vazio ? (
        // Card vazio ESTICA e centraliza o aviso (flex-1) — acompanha a altura
        // do vizinho com dado, sem deixar buraco embaixo.
        <p className="flex-1 grid place-items-center text-[12px] text-muted m-0 py-3 text-center">
          Sem dados ainda.
        </p>
      ) : vista === 'grafico' ? (
        <div ref={wrapRef} className="relative max-h-[260px] overflow-hidden">
          {children}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr>
                {tabela.colunas.map((c) => (
                  <th
                    key={c.header}
                    className="text-left text-muted font-semibold border-b border-border px-2 py-1"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabela.rows.map((r, i) => (
                <tr key={i}>
                  {tabela.colunas.map((c) => (
                    <td key={c.header} className="border-b border-border px-2 py-1">
                      {c.value(r) ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tooltip compartilhado (div absoluto sobre o svg) ─────────────────

function Tooltip({ x, y, linhas }: { x: number; y: number; linhas: string[] }) {
  return (
    <div
      className="absolute z-10 pointer-events-none bg-surface-elevated border border-border-strong rounded-md px-2 py-1 text-[11px] shadow-md whitespace-nowrap"
      style={{ left: x, top: y, transform: 'translate(-50%, -110%)' }}
    >
      {linhas.map((l, i) => (
        <div key={i} className={i === 0 ? 'font-semibold' : 'text-muted'}>
          {l}
        </div>
      ))}
    </div>
  );
}

const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ─── Linha (1 série, rótulo direto na ponta, crosshair + tooltip) ─────

export function GraficoLinha({
  pontos,
  rotuloSerie,
  altura = 190,
}: {
  pontos: Array<{ dia: string; total: number }>;
  /** Rótulo direto na ponta da linha (1 série não leva legenda). */
  rotuloSerie: string;
  altura?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = altura;
  const M = { top: 14, right: 74, bottom: 22, left: 34 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const max = Math.max(...pontos.map((p) => p.total), 1);
  const px = (i: number) => M.left + (pontos.length > 1 ? (i / (pontos.length - 1)) * iw : iw / 2);
  const py = (v: number) => M.top + ih - (v / max) * ih;
  const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(p.total)}`).join(' ');
  // Ticks Y recessivos (3 linhas) e X esparsos (~5 datas) — grade nunca grita.
  const yTicks = [0, Math.round(max / 2), max];
  const xStep = Math.max(1, Math.ceil(pontos.length / 5));
  const ultimo = pontos[pontos.length - 1];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        style={{ fontFamily: 'var(--font-ui)' }}
        role="img"
        aria-label={rotuloSerie}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((x - M.left) / iw) * (pontos.length - 1));
          setHover(i >= 0 && i < pontos.length ? i : null);
        }}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={py(t)} y2={py(t)} stroke="var(--chart-grade)" strokeWidth={1} />
            <text x={M.left - 6} y={py(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
              {formatNumero(t)}
            </text>
          </g>
        ))}
        {pontos.map((p, i) =>
          i % xStep === 0 ? (
            <text key={p.dia} x={px(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {diaCurto(p.dia)}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line
            x1={px(hover)}
            x2={px(hover)}
            y1={M.top}
            y2={M.top + ih}
            stroke="var(--muted-light)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        <path d={path} fill="none" stroke="var(--chart-linha)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <circle cx={px(hover)} cy={py(pontos[hover].total)} r={4.5} fill="var(--chart-linha)" stroke="var(--surface)" strokeWidth={2} />
        )}
        {ultimo && (
          <text x={px(pontos.length - 1) + 8} y={py(ultimo.total) + 4} fontSize={11} fontWeight={600} fill="var(--text)">
            {rotuloSerie} · {formatNumero(ultimo.total)}
          </text>
        )}
      </svg>
      {hover !== null && (
        <TooltipRelativo idx={hover} n={pontos.length} m={M} w={W} linhas={[diaCurto(pontos[hover].dia), `${formatNumero(pontos[hover].total)} lead${pontos[hover].total === 1 ? '' : 's'}`]} />
      )}
    </div>
  );
}

/** Tooltip posicionado em % do container (o svg é responsivo via viewBox). */
function TooltipRelativo({
  idx,
  n,
  m,
  w,
  linhas,
}: {
  idx: number;
  n: number;
  m: { left: number; right: number };
  w: number;
  linhas: string[];
}) {
  const iw = w - m.left - m.right;
  const xPct = ((m.left + (n > 1 ? (idx / (n - 1)) * iw : iw / 2)) / w) * 100;
  return (
    <div className="absolute inset-x-0 top-0 h-0">
      <div className="relative" style={{ left: `${xPct}%` }}>
        <Tooltip x={0} y={28} linhas={linhas} />
      </div>
    </div>
  );
}

// ─── Barras horizontais (ordenadas; ponta arredondada 4px na base) ────

export function GraficoBarrasH({
  dados,
  formatValor = formatNumero,
  corPadrao = 'var(--chart-barra)',
  sufixoTooltip,
}: {
  dados: Array<{ label: string; valor: number; cor?: string; extra?: string }>;
  formatValor?: (v: number) => string;
  /** Série única = uma cor; cor por item SÓ quando segue a entidade (etapa). */
  corPadrao?: string;
  sufixoTooltip?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const rowH = 24;
  const H = dados.length * rowH + 6;
  const LBL = 170;
  const VAL = 64;
  const iw = W - LBL - VAL;
  const max = Math.max(...dados.map((d) => d.valor), 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ fontFamily: 'var(--font-ui)' }} role="img">
        {dados.map((d, i) => {
          const bw = Math.max((d.valor / max) * iw, d.valor > 0 ? 6 : 0);
          const y = i * rowH + 5;
          const barH = 14;
          // Ancorada na base (esquerda reta), ponta direita arredondada 4px.
          const r = Math.min(4, bw);
          const path = `M${LBL},${y} h${bw - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${bw - r} z`;
          return (
            <g
              key={`${d.label}-${i}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* área de clique maior que a marca */}
              <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" />
              <text x={LBL - 8} y={y + 11} textAnchor="end" fontSize={12} fill="var(--text)">
                {d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label}
              </text>
              {bw > 0 && <path d={path} fill={d.cor ?? corPadrao} opacity={hover === null || hover === i ? 1 : 0.55} />}
              <text x={LBL + bw + 8} y={y + 11} fontSize={12} fontWeight={600} fill="var(--text)">
                {formatValor(d.valor)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && dados[hover] && (
        <div className="absolute inset-x-0 top-0 h-0">
          <div className="relative" style={{ left: '40%' }}>
            <Tooltip
              x={0}
              y={(hover + 1) * 24 + 12}
              linhas={[
                dados[hover].label,
                `${formatValor(dados[hover].valor)}${sufixoTooltip ? ` ${sufixoTooltip}` : ''}`,
                ...(dados[hover].extra ? [dados[hover].extra] : []),
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empilhada diária ok/erro (2px de respiro entre segmentos) ────────

export function GraficoEmpilhadoDiario({
  dados,
  altura = 176,
}: {
  dados: Array<{ dia: string; ok: number; erro: number }>;
  altura?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = altura;
  const M = { top: 26, right: 8, bottom: 22, left: 34 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const max = Math.max(...dados.map((d) => d.ok + d.erro), 1);
  const slot = iw / Math.max(dados.length, 1);
  const bw = Math.max(2, Math.min(18, slot - 3));
  const xStep = Math.max(1, Math.ceil(dados.length / 5));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ fontFamily: 'var(--font-ui)' }} role="img">
        {/* Legenda (2 séries): chip + nome — identidade nunca só pela cor */}
        <g fontSize={11}>
          <rect x={M.left} y={6} width={10} height={10} rx={2} fill="var(--chart-ok)" />
          <text x={M.left + 14} y={15} fill="var(--text)">
            OK
          </text>
          <rect x={M.left + 44} y={6} width={10} height={10} rx={2} fill="var(--chart-erro)" />
          <text x={M.left + 58} y={15} fill="var(--text)">
            Erro
          </text>
        </g>
        {[0, Math.round(max / 2), max].map((t) => {
          const y = M.top + ih - (t / max) * ih;
          return (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y} y2={y} stroke="var(--chart-grade)" strokeWidth={1} />
              <text x={M.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {formatNumero(t)}
              </text>
            </g>
          );
        })}
        {dados.map((d, i) => {
          const x = M.left + i * slot + (slot - bw) / 2;
          const hOk = (d.ok / max) * ih;
          const hErro = (d.erro / max) * ih;
          const base = M.top + ih;
          return (
            <g key={d.dia} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={M.left + i * slot} y={M.top} width={slot} height={ih} fill="transparent" />
              {d.ok > 0 && (
                <rect x={x} y={base - hOk} width={bw} height={hOk} rx={2} fill="var(--chart-ok)" opacity={hover === null || hover === i ? 1 : 0.55} />
              )}
              {d.erro > 0 && (
                // 2px de respiro entre os segmentos da pilha
                <rect x={x} y={base - hOk - (d.ok > 0 ? 2 : 0) - hErro} width={bw} height={hErro} rx={2} fill="var(--chart-erro)" opacity={hover === null || hover === i ? 1 : 0.55} />
              )}
              {i % xStep === 0 && (
                <text x={M.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  {diaCurto(d.dia)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && dados[hover] && (
        <TooltipRelativo
          idx={hover}
          n={dados.length}
          m={M}
          w={W}
          linhas={[diaCurto(dados[hover].dia), `OK: ${formatNumero(dados[hover].ok)}`, `Erro: ${formatNumero(dados[hover].erro)}`]}
        />
      )}
    </div>
  );
}

// ─── Conversão do funil: barras por etapa + taxa entre elas ───────────

export function GraficoConversao({
  etapas,
}: {
  etapas: Array<{ id: string; nome: string; cor: string; entradas: number; taxaAvanco: number | null }>;
}) {
  if (etapas.length === 0) {
    return <p className="text-[13px] text-muted m-0">Sem etapas no funil.</p>;
  }
  const W = 720;
  const rowH = 24;
  const taxaH = 15;
  const LBL = 170;
  const VAL = 64;
  const iw = W - LBL - VAL;
  const max = Math.max(...etapas.map((e) => e.entradas), 1);
  // Linha da etapa + linha da taxa (quando existe) — alturas acumuladas.
  const ys: number[] = [];
  let acc = 4;
  for (const et of etapas) {
    ys.push(acc);
    acc += rowH + (et.taxaAvanco !== null ? taxaH : 0);
  }
  const H = acc + 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ fontFamily: 'var(--font-ui)' }} role="img">
      {etapas.map((et, i) => {
        const y = ys[i];
        const bw = Math.max((et.entradas / max) * iw, et.entradas > 0 ? 6 : 0);
        const barH = 14;
        const r = Math.min(4, bw);
        return (
          <g key={et.id}>
            <text x={LBL - 8} y={y + 12} textAnchor="end" fontSize={12} fill="var(--text)">
              {et.nome.length > 24 ? `${et.nome.slice(0, 23)}…` : et.nome}
            </text>
            {bw > 0 && (
              // Ancorada na base; ponta arredondada 4px. Cor segue a ENTIDADE
              // (cor da etapa cadastrada no funil — filtro não repinta nada).
              <path
                d={`M${LBL},${y + 1} h${bw - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${bw - r} z`}
                fill={et.cor}
              />
            )}
            <text x={LBL + bw + 8} y={y + 12} fontSize={12} fontWeight={600} fill="var(--text)">
              {formatNumero(et.entradas)}
            </text>
            {et.taxaAvanco !== null && (
              <text x={LBL} y={y + rowH + 9} fontSize={11} fill="var(--muted)">
                ↓ {String(et.taxaAvanco).replace('.', ',')}% avançam
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
