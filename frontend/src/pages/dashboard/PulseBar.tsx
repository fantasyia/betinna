import { useNavigate } from 'react-router-dom';
import {
  UserPlus,
  AlertTriangle,
  Zap,
  Activity,
  Inbox,
  CalendarCheck,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { formatNumero } from '@/lib/masks';
import { cn } from '@/lib/cn';
import type { PulsoResumo } from './types';

/**
 * M1 — Barra de pulso (sticky, full-width). 6 stat tiles: número GRANDE +
 * rótulo + estado. NÃO é gráfico. Cada tile é clicável e leva/rola pro módulo
 * correspondente. Status sempre com ÍCONE + TEXTO — nunca cor sozinha.
 */
export function PulseBar({ pulso }: { pulso: PulsoResumo }) {
  const navigate = useNavigate();
  const rolarPara = (id: string) => () =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const execTotal = pulso.execucoes24h.ok + pulso.execucoes24h.erro;

  const tiles: Array<{
    label: string;
    valor: string;
    icon: LucideIcon;
    /** Estado legível (ícone+texto). null = tile neutro, sem selo. */
    estado: { texto: string; tom: 'ok' | 'atencao' | 'grave'; icone: LucideIcon } | null;
    onClick: () => void;
    testid: string;
  }> = [
    {
      label: 'Leads novos (7d)',
      valor: formatNumero(pulso.leadsNovos7d),
      icon: UserPlus,
      estado: null,
      onClick: rolarPara('mod-funil'),
      testid: 'pulso-leads',
    },
    {
      label: 'Estourando SLA',
      valor: formatNumero(pulso.leadsSlaEstourado),
      icon: AlertTriangle,
      estado:
        pulso.leadsSlaEstourado > 0
          ? { texto: 'agir agora', tom: 'grave', icone: AlertTriangle }
          : { texto: 'no prazo', tom: 'ok', icone: CheckCircle2 },
      onClick: rolarPara('mod-precisa'),
      testid: 'pulso-sla',
    },
    {
      label: 'Fluxos ativos',
      valor: `${pulso.fluxos.ativos}/${pulso.fluxos.total}`,
      icon: Zap,
      estado:
        pulso.fluxos.ativos === 0
          ? { texto: 'máquina parada', tom: 'atencao', icone: AlertTriangle }
          : { texto: 'rodando', tom: 'ok', icone: CheckCircle2 },
      onClick: rolarPara('mod-fluxos'),
      testid: 'pulso-fluxos',
    },
    {
      label: 'Execuções 24h',
      valor: formatNumero(execTotal),
      icon: Activity,
      estado:
        pulso.execucoes24h.erro > 0
          ? { texto: `${pulso.execucoes24h.erro} com erro`, tom: 'grave', icone: AlertTriangle }
          : execTotal > 0
            ? { texto: 'sem erros', tom: 'ok', icone: CheckCircle2 }
            : null,
      onClick: rolarPara('mod-fluxos'),
      testid: 'pulso-exec',
    },
    {
      label: '📥 Nutrir',
      valor: formatNumero(pulso.nutrirPendentes),
      icon: Inbox,
      estado:
        pulso.nutrirPendentes > 0
          ? { texto: 'a processar', tom: 'atencao', icone: Inbox }
          : { texto: 'em dia', tom: 'ok', icone: CheckCircle2 },
      onClick: rolarPara('mod-precisa'),
      testid: 'pulso-nutrir',
    },
    {
      label: 'Tarefas hoje',
      valor: formatNumero(pulso.tarefasHoje),
      icon: CalendarCheck,
      estado: null,
      onClick: () => navigate('/agenda'),
      testid: 'pulso-tarefas',
    },
  ];

  return (
    <section
      data-testid="pulse-bar"
      className={cn(
        // Sticky no topo do scroll do dashboard; fundo sólido pra cobrir o canvas.
        'sticky top-0 z-30 -mx-2 px-2 py-2 bg-bg/95 backdrop-blur-sm',
        'grid gap-2 grid-cols-2 sm:grid-cols-3 min-[1280px]:grid-cols-6',
      )}
    >
      {tiles.map((t) => (
        <button
          key={t.testid}
          type="button"
          data-testid={t.testid}
          onClick={t.onClick}
          className={cn(
            'text-left rounded-[10px] border border-border bg-surface px-3.5 py-2.5',
            'hover:border-border-strong hover:bg-surface-hover transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
          )}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <t.icon className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">{t.label}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold tabular text-text leading-none">{t.valor}</span>
            {t.estado && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-medium',
                  t.estado.tom === 'ok' && 'text-success',
                  t.estado.tom === 'atencao' && 'text-warning',
                  t.estado.tom === 'grave' && 'text-danger',
                )}
              >
                <t.estado.icone className="h-3 w-3" aria-hidden />
                {t.estado.texto}
              </span>
            )}
          </div>
        </button>
      ))}
    </section>
  );
}
