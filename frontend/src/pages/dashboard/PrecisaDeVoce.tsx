import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Clock,
  XCircle,
  CalendarX,
  Inbox,
  ArrowRight,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tempoDesde, type TriagemItem } from './types';

const TIPO_META: Record<TriagemItem['tipo'], { icone: LucideIcon; label: string; tom: string }> = {
  sla: { icone: AlertTriangle, label: 'SLA', tom: 'text-danger' },
  fluxo_falha: { icone: XCircle, label: 'Fluxo falhou', tom: 'text-danger' },
  card_atrasado: { icone: CalendarX, label: 'Tarefa atrasada', tom: 'text-warning' },
  parado: { icone: Clock, label: 'Parado', tom: 'text-warning' },
  nutrir: { icone: Inbox, label: 'Nutrir', tom: 'text-info' },
};

/**
 * M2 — "Precisa de você" (topo do trilho): fila ÚNICA de triagem ordenada por
 * urgência. Cada linha = entidade + POR QUE está ali + há quanto tempo + UMA
 * ação em 1 clique. Sem linha decorativa — vazio de verdade mostra "tudo em dia".
 */
export function PrecisaDeVoce({ itens }: { itens: TriagemItem[] }) {
  return (
    <Card padding="md" id="mod-precisa" data-testid="precisa-de-voce">
      <CardHeader>
        <CardTitle>Precisa de você</CardTitle>
        <CardDescription>
          {itens.length === 0
            ? 'Nada exigindo ação agora'
            : `${itens.length} ite${itens.length === 1 ? 'm' : 'ns'} por urgência`}
        </CardDescription>
      </CardHeader>

      {itens.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Tudo em dia.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border -mx-1">
          {itens.map((item, i) => {
            const meta = TIPO_META[item.tipo];
            return (
              <li key={`${item.tipo}-${i}`}>
                <Link
                  to={item.link}
                  data-testid="triagem-item"
                  className="flex items-start gap-2.5 px-1 py-2.5 rounded-md hover:bg-surface-hover transition-colors group"
                >
                  <meta.icone className={cn('h-4 w-4 mt-0.5 shrink-0', meta.tom)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-text truncate">{item.titulo}</span>
                      {item.desde && (
                        <span className="text-[11px] text-muted shrink-0 tabular">
                          {tempoDesde(item.desde)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-subtle leading-snug line-clamp-2">
                      {item.motivo}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-3.5 w-3.5 mt-1 shrink-0 text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
