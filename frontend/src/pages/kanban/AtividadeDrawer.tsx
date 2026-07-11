import { useEffect } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Avatar, Drawer } from '@/components/ui';
import { StateView } from '@/components/StateView';
import { descreverAtividade, type KAtividade } from './kanban-types';

/** Intervalo do feed "tempo quase real" (spec Parte 4, item 4). */
const POLL_MS = 15_000;

/**
 * Drawer lateral com o feed de atividade do board.
 *
 * Polling a cada 15s ENQUANTO aberto e com a aba visível — é o que faz o
 * Léo ver o Claude Code movendo cards "sozinho" via MCP. Padrão do projeto:
 * pollar com refetch() do TanStack (NUNCA cache-buster `_t=` na URL).
 */
export function AtividadeDrawer({
  boardId,
  open,
  onClose,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<KAtividade[]>(
    open ? `/kanban/boards/${boardId}/atividades?limit=50` : null,
  );

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refetch();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refetch]);

  return (
    <Drawer open={open} onClose={onClose} title="Atividade" side="right">
      <StateView
        loading={loading && !data}
        error={error}
        onRetry={refetch}
        empty={(data ?? []).length === 0}
        emptyMessage="Nenhuma atividade ainda"
      >
        <ul className="flex flex-col gap-2.5" data-testid="kanban-atividade-feed">
          {(data ?? []).map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-xs">
              <Avatar name={a.usuario.nome} src={a.usuario.avatar} size="xs" />
              <div className="flex-1 min-w-0 leading-snug">
                <span className="font-medium text-text">{a.usuario.nome}</span>{' '}
                <span className="text-muted">{descreverAtividade(a)}</span>
                <div className="text-[10px] text-muted opacity-70 mt-0.5">
                  {new Date(a.criadoEm).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </StateView>
    </Drawer>
  );
}
