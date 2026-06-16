import { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, Clock, MessageSquare, Timer, Users } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Card, Stat } from '@/components/ui';
import type { Metricas } from '../lib/types';
import { formatTempoResposta } from '../lib/format';

/**
 * MetricasPanel — KPIs de atendimento (só gerência; nunca REP, que nem chega a
 * montar este componente). Cabeçalho colapsável; o fetch de `/inbox/metricas`
 * só dispara quando o painel está aberto (evita chamada inútil quando fechado).
 * Começa aberto — é informação de relance que a gerência quer ver ao entrar.
 */
export function MetricasPanel() {
  const [aberto, setAberto] = useState(true);
  // Só busca quando aberto (path null = useApiQuery não dispara).
  const { data, loading, error } = useApiQuery<Metricas>(aberto ? '/inbox/metricas' : null);

  return (
    <Card padding="none" data-testid="inbox-metricas" className="overflow-hidden">
      <button
        type="button"
        data-testid="inbox-metricas-toggle"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
      >
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <strong className="text-sm tracking-tight text-text flex-1">
          Métricas de atendimento
        </strong>
        {aberto ? (
          <ChevronUp className="h-4 w-4 text-muted shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted shrink-0" />
        )}
      </button>

      {aberto && (
        <div className="px-4 pb-4 border-t border-border pt-4">
          {loading && !data && (
            <div className="text-sm text-muted py-2">Carregando métricas…</div>
          )}
          {error && !data && (
            <div className="text-sm text-muted py-2">
              Não foi possível carregar as métricas.
            </div>
          )}
          {data && <MetricasConteudo m={data} />}
        </div>
      )}
    </Card>
  );
}

/** Conteúdo do painel quando os dados chegaram — cards + lista por atendente. */
function MetricasConteudo({ m }: { m: Metricas }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div data-testid="inbox-metricas-abertas">
          <Stat
            label="Abertas"
            value={m.conversas.abertas}
            icon={<MessageSquare />}
            iconTone="info"
            hint={`${m.conversas.pendentes} pendentes · ${m.conversas.resolvidas} resolvidas`}
          />
        </div>
        <div data-testid="inbox-metricas-aguardando">
          <Stat
            label="Aguardando resposta"
            value={m.aguardando.total}
            icon={<Clock />}
            iconTone={m.aguardando.estourado > 0 ? 'danger' : 'success'}
            hint={
              <span>
                no prazo{' '}
                <strong className="text-success tabular">{m.aguardando.dentroDoPrazo}</strong>
                {' · '}fora{' '}
                <strong className="text-danger tabular">{m.aguardando.estourado}</strong>
              </span>
            }
          />
        </div>
        <div data-testid="inbox-metricas-tmr">
          <Stat
            label="Tempo médio 1ª resposta"
            value={formatTempoResposta(m.tempoMedioPrimeiraRespostaSegundos)}
            icon={<Timer />}
            iconTone="secondary"
            hint={`SLA ${m.aguardando.slaMinutos}min`}
          />
        </div>
        <div data-testid="inbox-metricas-total">
          <Stat
            label="Total de conversas"
            value={m.conversas.total}
            icon={<Users />}
            iconTone="primary"
            hint={`${m.conversas.arquivadas} arquivadas`}
          />
        </div>
      </div>

      {/* Por atendente — vem ordenado por aguardando desc; limita visual a 8. */}
      {m.porAtendente.length > 0 && (
        <div data-testid="inbox-metricas-atendentes">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Por atendente
          </div>
          <ul className="flex flex-col gap-1">
            {m.porAtendente.slice(0, 8).map((a) => (
              <li
                key={a.atendenteId ?? 'sem-atendente'}
                className="flex items-center justify-between gap-3 text-sm py-1.5 px-2.5 rounded-[10px] bg-bg-alt"
              >
                <span className="text-text truncate">{a.atendenteNome}</span>
                <span className="shrink-0 text-xs text-muted tabular">
                  abertas <strong className="text-text">{a.abertas}</strong>
                  {' · '}aguardando{' '}
                  <strong className={a.aguardando > 0 ? 'text-warning' : 'text-text'}>
                    {a.aguardando}
                  </strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
