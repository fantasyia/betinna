import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { formatNumero } from '@/lib/masks';

/**
 * Kanban da produção (Léo, 14/10): uma coluna por ETAPA da OP, pra ver de
 * relance quais OPs estão em cada uma. Não arrasta: mudar de etapa pede dados
 * (tecido no corte, facção e quantidades no envio…), então o card abre a OP e
 * a mudança acontece lá.
 */

export interface OpDoKanban {
  id: string;
  numero: string;
  status: string;
  modelo: { nome: string };
  faccao: { nome: string } | null;
  prazo: string | null;
  planejada: number;
  cortada: number;
  aReceber: number;
  atrasada: boolean;
}

/** As etapas, na ordem do chão de fábrica. Cancelada fica de fora do quadro. */
export const ETAPAS: Array<{ status: string; titulo: string }> = [
  { status: 'RASCUNHO', titulo: 'A cortar' },
  { status: 'CORTADA', titulo: 'Cortada' },
  { status: 'NA_FACCAO', titulo: 'Na facção' },
  { status: 'RECEBENDO', titulo: 'Recebendo' },
  { status: 'FECHADA', titulo: 'Fechada' },
];

/** OPs por etapa; dentro da coluna, atrasada primeiro e depois o prazo mais curto. PURO. */
export function colunasDoKanban<T extends OpDoKanban>(ops: T[]): Array<{ status: string; titulo: string; ops: T[] }> {
  const prazo = (o: T) => (o.prazo ? new Date(o.prazo).getTime() : Number.POSITIVE_INFINITY);
  return ETAPAS.map((e) => ({
    ...e,
    ops: ops
      .filter((o) => o.status === e.status)
      .sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || prazo(a) - prazo(b)),
  }));
}

export function KanbanProducao({ ops }: { ops: OpDoKanban[] }) {
  const colunas = colunasDoKanban(ops);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="ops-kanban">
      {colunas.map((c) => (
        <section
          key={c.status}
          className="flex w-64 shrink-0 flex-col gap-2 rounded-[10px] border border-border bg-bg-alt p-2"
          data-testid={`kanban-coluna-${c.status}`}
        >
          <header className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-semibold">{c.titulo}</h3>
            <span className="text-xs text-muted tabular-nums">{c.ops.length}</span>
          </header>
          {c.ops.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-muted">Nenhuma OP</p>
          ) : (
            c.ops.map((op) => (
              <Link
                key={op.id}
                to={`/producao/${op.id}`}
                className={cn(
                  'flex flex-col gap-1 rounded-[10px] border bg-surface p-2.5 text-sm hover:border-primary',
                  op.atrasada ? 'border-danger/60' : 'border-border',
                )}
                data-testid={`kanban-op-${op.id}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <b>{op.numero}</b>
                  <span className="text-xs text-muted tabular-nums">{formatNumero(op.planejada)} pç</span>
                </div>
                <span className="truncate">{op.modelo.nome}</span>
                {op.faccao && <span className="truncate text-xs text-muted">Facção: {op.faccao.nome}</span>}
                {op.aReceber > 0 && (
                  <span className="text-xs tabular-nums">A receber: {formatNumero(op.aReceber)}</span>
                )}
                {op.prazo && (
                  <span className={cn('text-xs', op.atrasada ? 'font-semibold text-danger' : 'text-muted')}>
                    Prazo {new Date(op.prazo).toLocaleDateString('pt-BR')}
                    {op.atrasada && ' · atrasada'}
                  </span>
                )}
              </Link>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
