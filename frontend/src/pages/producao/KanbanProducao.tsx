import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatNumero } from '@/lib/masks';
import { useToast } from '@/components/toast';

/**
 * Kanban da produção (Léo, 14/10): uma coluna por ETAPA de produção — onde a
 * OP está no chão de fábrica. Arrasta o card (computador) ou usa o "Mover
 * para" (celular). As ações da OP também avançam sozinhas: risco pronto →
 * Impressão Risco, corte → Corte, envio pra facção → Costura, recebimento →
 * Acabamento, fechar → Concluído. A etapa NÃO mexe em estoque nem custo —
 * isso segue nas ações da OP.
 */

export interface OpDoKanban {
  id: string;
  numero: string;
  status: string;
  /** Antes da migration de 14/10 a API não mandava: vale o rascunho. */
  etapa?: string;
  modelo: { nome: string };
  faccao: { nome: string } | null;
  prazo: string | null;
  planejada: number;
  cortada: number;
  aReceber: number;
  atrasada: boolean;
}

/** As etapas, na ordem do chão de fábrica (Léo, 14/10). */
export const ETAPAS: Array<{ etapa: string; titulo: string }> = [
  { etapa: 'RASCUNHO', titulo: 'Rascunho' },
  { etapa: 'IMPRESSAO_RISCO', titulo: 'Impressão Risco' },
  { etapa: 'CORTE', titulo: 'Corte' },
  { etapa: 'COSTURA', titulo: 'Costura' },
  { etapa: 'ACABAMENTO', titulo: 'Acabamento' },
  { etapa: 'CONFERENCIA', titulo: 'Conferência' },
  { etapa: 'CONCLUIDO', titulo: 'Concluído' },
];

/** OPs por etapa (cancelada fica fora); atrasada primeiro, depois o prazo mais curto. PURO. */
export function colunasDoKanban<T extends OpDoKanban>(
  ops: T[],
): Array<{ etapa: string; titulo: string; ops: T[] }> {
  const prazo = (o: T) => (o.prazo ? new Date(o.prazo).getTime() : Number.POSITIVE_INFINITY);
  const vivas = ops.filter((o) => o.status !== 'CANCELADA');
  return ETAPAS.map((e) => ({
    ...e,
    ops: vivas
      .filter((o) => (o.etapa ?? 'RASCUNHO') === e.etapa)
      .sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || prazo(a) - prazo(b)),
  }));
}

export function KanbanProducao({ ops, onMudou }: { ops: OpDoKanban[]; onMudou: () => void }) {
  const toast = useToast();
  // Mudança otimista: o card já aparece na coluna nova enquanto a API responde.
  const [local, setLocal] = useState<Record<string, string>>({});
  const [sobre, setSobre] = useState<string | null>(null);
  const comLocal = ops.map((o) => (local[o.id] ? { ...o, etapa: local[o.id] } : o));
  const colunas = colunasDoKanban(comLocal);

  async function mover(op: OpDoKanban, etapa: string) {
    if ((op.etapa ?? 'RASCUNHO') === etapa) return;
    setLocal((x) => ({ ...x, [op.id]: etapa }));
    try {
      await api.patch(`/erp/ops/${op.id}/etapa`, { etapa });
      onMudou();
    } catch (err) {
      toast.error('Não foi possível mudar a etapa', apiErrorMessage(err));
    } finally {
      setLocal((x) => {
        const { [op.id]: _fora, ...resto } = x;
        return resto;
      });
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="ops-kanban">
      {colunas.map((c) => (
        <section
          key={c.etapa}
          onDragOver={(e) => {
            e.preventDefault();
            setSobre(c.etapa);
          }}
          onDragLeave={() => setSobre((s) => (s === c.etapa ? null : s))}
          onDrop={(e) => {
            e.preventDefault();
            setSobre(null);
            const op = comLocal.find((o) => o.id === e.dataTransfer.getData('text/plain'));
            if (op) void mover(op, c.etapa);
          }}
          className={cn(
            'flex w-60 shrink-0 flex-col gap-2 rounded-[10px] border bg-bg-alt p-2',
            sobre === c.etapa ? 'border-primary' : 'border-border',
          )}
          data-testid={`kanban-coluna-${c.etapa}`}
        >
          <header className="flex items-baseline justify-between px-1">
            <h3 className="text-sm font-semibold">{c.titulo}</h3>
            <span className="text-xs text-muted tabular-nums">{c.ops.length}</span>
          </header>
          {c.ops.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-muted">Nenhuma OP</p>
          ) : (
            c.ops.map((op) => (
              <article
                key={op.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', op.id)}
                className={cn(
                  'flex cursor-grab flex-col gap-1 rounded-[10px] border bg-surface p-2.5 text-sm',
                  op.atrasada ? 'border-danger/60' : 'border-border',
                )}
                data-testid={`kanban-op-${op.id}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <Link to={`/producao/${op.id}`} className="font-semibold hover:underline">
                    {op.numero}
                  </Link>
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
                <select
                  value={op.etapa ?? 'RASCUNHO'}
                  onChange={(e) => void mover(op, e.target.value)}
                  className="mt-1 h-8 rounded-[10px] border border-border bg-transparent px-1.5 text-xs"
                  aria-label={`Mover ${op.numero} para`}
                  data-testid={`kanban-mover-${op.id}`}
                >
                  {ETAPAS.map((e) => (
                    <option key={e.etapa} value={e.etapa}>
                      {e.titulo}
                    </option>
                  ))}
                </select>
              </article>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
