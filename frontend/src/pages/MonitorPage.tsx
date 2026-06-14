import { Activity, Bot, AlertTriangle, Zap } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { AutomacaoTabs } from '@/components/AutomacaoTabs';
import { StateView } from '@/components/StateView';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatNumero } from '@/lib/masks';

interface MonitorEtapa {
  id: string;
  nome: string;
  cor: string;
  tipo: string;
  leads: number;
  slaDias: number | null;
  tempoMedioDias?: number;
}
interface MonitorFunil {
  id: string;
  nome: string;
  cor: string;
  total: number;
  etapas: MonitorEtapa[];
}
interface MonitorResumo {
  funis: MonitorFunil[];
  iaAtivas: number;
  slaVencidos: number;
  fluxosAtivos: number;
  execucoes: { total: number; concluidas: number; falhas: number; aguardando: number };
  disparosHoje?: number;
  custoOpenAi?: { diaIn?: number; diaOut?: number; mesIn?: number; mesOut?: number } | null;
}

/**
 * MonitorPage (orquestração Fase B) — saúde do funil: leads por etapa, conversas
 * de IA ativas, SLAs vencidos e execuções de fluxo.
 */
export default function MonitorPage() {
  const { data, loading, error, refetch } = useApiQuery<MonitorResumo>('/orquestracao/monitor');

  return (
    <PageLayout
      title="Monitor do funil"
      description="Saúde da orquestração: leads por etapa, IA ativa, SLAs e execuções."
    >
      <AutomacaoTabs />
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={<Bot />} label="Conversas IA ativas" value={data.iaAtivas} />
              <Stat
                icon={<AlertTriangle />}
                label="SLAs vencidos"
                value={data.slaVencidos}
                tone={data.slaVencidos > 0 ? 'danger' : undefined}
              />
              <Stat icon={<Zap />} label="Fluxos ativos" value={data.fluxosAtivos} />
              <Stat
                icon={<Activity />}
                label="Execuções (falhas)"
                value={`${data.execucoes.total} (${data.execucoes.falhas})`}
                tone={data.execucoes.falhas > 0 ? 'warning' : undefined}
              />
              <Stat icon={<Zap />} label="Disparos hoje" value={data.disparosHoje ?? 0} />
              <Stat
                icon={<Bot />}
                label="Tokens OpenAI (hoje)"
                value={formatNumero(
                  (data.custoOpenAi?.diaIn ?? 0) + (data.custoOpenAi?.diaOut ?? 0),
                )}
              />
            </div>

            {data.funis.length === 0 ? (
              <Card padding="lg" className="text-sm text-muted text-center">
                Nenhum funil ativo. Crie um funil em Funis pra ver o painel.
              </Card>
            ) : (
              data.funis.map((f) => <FunilCard key={f.id} funil={f} />)
            )}
          </div>
        )}
      </StateView>
    </PageLayout>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: 'danger' | 'warning';
}) {
  return (
    <Card padding="md" className="flex items-center gap-3">
      <div
        className={cn(
          'h-9 w-9 rounded-md flex items-center justify-center shrink-0 [&>svg]:h-4 [&>svg]:w-4',
          tone === 'danger'
            ? 'bg-danger/10 text-danger'
            : tone === 'warning'
              ? 'bg-warning/10 text-warning'
              : 'bg-primary/10 text-primary',
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold text-text tabular tracking-tight leading-none">
          {value}
        </div>
        <div className="text-[11px] text-muted mt-1">{label}</div>
      </div>
    </Card>
  );
}

function FunilCard({ funil }: { funil: MonitorFunil }) {
  const max = Math.max(1, ...funil.etapas.map((e) => e.leads));
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold text-text flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: funil.cor }}
            aria-hidden
          />
          {funil.nome}
        </h3>
        <span className="text-xs text-muted tabular">{funil.total} leads</span>
      </div>
      <div className="flex flex-col gap-2">
        {funil.etapas.map((e) => (
          <div key={e.id} className="flex items-center gap-2">
            <span className="text-xs text-text-subtle w-32 truncate shrink-0" title={e.nome}>
              {e.nome}
            </span>
            <div className="flex-1 h-5 bg-bg-alt rounded overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${(e.leads / max) * 100}%`, background: e.cor, minWidth: e.leads > 0 ? '2px' : 0 }}
              />
            </div>
            <span className="text-xs text-text tabular w-12 text-right shrink-0">{e.leads}</span>
            <span
              className="text-[10px] text-muted tabular w-14 text-right shrink-0"
              title="Tempo médio parado nesta etapa"
            >
              {e.tempoMedioDias ? `~${e.tempoMedioDias}d` : '—'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
