import { useEffect } from 'react';
import { Activity, Bot, AlertTriangle, Zap, Send, Mail, MessageCircle, Inbox } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import { Card, Badge } from '@/components/ui';
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

interface FilaCampanha {
  id: string;
  nome: string;
  canal: string;
  status: string;
  pendentes: number;
  enviados: number;
  erros: number;
}
interface FilaEnvios {
  campanhas: FilaCampanha[];
  totais: { whatsappPendentes: number; emailPendentes: number };
  sistema: {
    fluxo: { aguardando: number; agendados: number; executando: number; falhas: number };
    campanhaEnvio: { aguardando: number; agendados: number; executando: number; falhas: number };
    deadLetter: number;
  } | null;
}

const CANAL_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-mail',
  WHATSAPP_EMAIL: 'WhatsApp + E-mail',
};
const STATUS_LABEL: Record<string, string> = {
  AGENDADA: 'Agendada',
  ENVIANDO: 'Enviando',
  PAUSADA: 'Pausada',
};

/**
 * MonitorPage (orquestração Fase B) — saúde do funil: leads por etapa, conversas
 * de IA ativas, SLAs vencidos e execuções de fluxo.
 */
export default function MonitorPage() {
  const { data, loading, error, refetch } = useApiQuery<MonitorResumo>('/orquestracao/monitor');
  const filasQuery = useApiQuery<FilaEnvios>('/orquestracao/filas');

  // Fila muda a cada envio — atualiza em background a cada 15s (via refetch,
  // NUNCA cache-buster na URL). Pula quando a aba não está visível.
  const refetchFilas = filasQuery.refetch;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refetchFilas();
    };
    const id = window.setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refetchFilas]);

  return (
    <PageLayout
      title="Monitor do funil"
      description="Saúde da orquestração: fila de envios, leads por etapa, IA ativa, SLAs e execuções."
    >
      <CrmTabs />
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div className="flex flex-col gap-4">
            {filasQuery.data && <FilaEnviosCard fila={filasQuery.data} />}
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

/**
 * Fila de envios — quanto ainda falta disparar: totais por canal, campanhas com
 * pendência e (ADMIN) filas técnicas BullMQ. Atualiza a cada 15s.
 */
function FilaEnviosCard({ fila }: { fila: FilaEnvios }) {
  const { totais, campanhas, sistema } = fila;
  const vazia = totais.whatsappPendentes === 0 && totais.emailPendentes === 0;
  return (
    <Card padding="md" data-testid="fila-envios-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold text-text flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          Fila de envios
        </h3>
        <span className="text-[10px] text-muted">atualiza a cada 15s</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-bg-alt border border-border">
          <MessageCircle className="h-4 w-4 text-success shrink-0" />
          <div>
            <div className="text-lg font-semibold text-text tabular leading-none" data-testid="fila-whatsapp-pendentes">
              {formatNumero(totais.whatsappPendentes)}
            </div>
            <div className="text-[10px] text-muted mt-0.5">WhatsApp na fila</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-bg-alt border border-border">
          <Mail className="h-4 w-4 text-info shrink-0" />
          <div>
            <div className="text-lg font-semibold text-text tabular leading-none" data-testid="fila-email-pendentes">
              {formatNumero(totais.emailPendentes)}
            </div>
            <div className="text-[10px] text-muted mt-0.5">E-mails na fila</div>
          </div>
        </div>
        {sistema && (
          <>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-bg-alt border border-border">
              <Zap className="h-4 w-4 text-primary shrink-0" />
              <div>
                <div className="text-lg font-semibold text-text tabular leading-none">
                  {formatNumero(
                    sistema.fluxo.aguardando + sistema.fluxo.agendados + sistema.fluxo.executando,
                  )}
                </div>
                <div className="text-[10px] text-muted mt-0.5">Passos de fluxo na fila</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-bg-alt border border-border">
              <Inbox
                className={cn(
                  'h-4 w-4 shrink-0',
                  sistema.deadLetter > 0 ? 'text-danger' : 'text-muted',
                )}
              />
              <div>
                <div
                  className={cn(
                    'text-lg font-semibold tabular leading-none',
                    sistema.deadLetter > 0 ? 'text-danger' : 'text-text',
                  )}
                >
                  {formatNumero(sistema.deadLetter)}
                </div>
                <div className="text-[10px] text-muted mt-0.5">Dead-letter (falhas)</div>
              </div>
            </div>
          </>
        )}
      </div>

      {vazia && campanhas.length === 0 ? (
        <div className="text-xs text-muted text-center py-2">
          Nenhum envio pendente. Campanhas agendadas ou em andamento aparecem aqui.
        </div>
      ) : (
        campanhas.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {campanhas.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface border border-border text-xs"
                data-testid={`fila-campanha-${c.id}`}
              >
                <span className="font-medium text-text truncate flex-1" title={c.nome}>
                  {c.nome}
                </span>
                <Badge size="sm" variant="neutral">
                  {CANAL_LABEL[c.canal] ?? c.canal}
                </Badge>
                <Badge size="sm" variant={c.status === 'ENVIANDO' ? 'primary' : 'neutral'}>
                  {STATUS_LABEL[c.status] ?? c.status}
                </Badge>
                <span className="text-warning tabular shrink-0" title="Pendentes de envio">
                  {formatNumero(c.pendentes)} pendentes
                </span>
                <span className="text-muted tabular shrink-0" title="Já enviados">
                  {formatNumero(c.enviados)} enviados
                </span>
                {c.erros > 0 && (
                  <span className="text-danger tabular shrink-0" title="Falhas de envio">
                    {formatNumero(c.erros)} erros
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </Card>
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
