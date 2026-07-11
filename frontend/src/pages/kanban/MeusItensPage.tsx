import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckSquare } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Button, Card, Checkbox } from '@/components/ui';
import { cn } from '@/lib/cn';

interface MeuItem {
  id: string;
  texto: string;
  concluido: boolean;
  dataEntrega: string | null;
  checklist: {
    id: string;
    titulo: string;
    card: {
      id: string;
      titulo: string;
      lista: {
        nome: string;
        board: { id: string; nome: string; corFundo: string };
      };
    };
  };
}

type Grupo = 'Vencidos' | 'Hoje' | 'Esta semana' | 'Depois' | 'Sem prazo';
const ORDEM_GRUPOS: Grupo[] = ['Vencidos', 'Hoje', 'Esta semana', 'Depois', 'Sem prazo'];

const COR_GRUPO: Record<Grupo, string> = {
  Vencidos: 'text-red-500',
  Hoje: 'text-amber-500',
  'Esta semana': 'text-primary',
  Depois: 'text-muted',
  'Sem prazo': 'text-muted',
};

function grupoDe(item: MeuItem): Grupo {
  if (!item.dataEntrega) return 'Sem prazo';
  const prazo = new Date(item.dataEntrega);
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const fimHoje = new Date(inicioHoje);
  fimHoje.setDate(fimHoje.getDate() + 1);
  const fimSemana = new Date(inicioHoje);
  fimSemana.setDate(fimSemana.getDate() + 7);

  if (prazo < inicioHoje) return 'Vencidos';
  if (prazo < fimHoje) return 'Hoje';
  if (prazo < fimSemana) return 'Esta semana';
  return 'Depois';
}

/**
 * ★ "Meus itens" (Premium): todos os itens de checklist delegados a mim,
 * entre todos os quadros da empresa, agrupados por prazo. É o painel
 * pessoal de "o que eu tenho que fazer".
 */
export default function MeusItensPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<MeuItem[]>('/kanban/meus-itens');

  const grupos = useMemo(() => {
    const mapa = new Map<Grupo, MeuItem[]>();
    for (const item of data ?? []) {
      const g = grupoDe(item);
      mapa.set(g, [...(mapa.get(g) ?? []), item]);
    }
    return ORDEM_GRUPOS.filter((g) => mapa.has(g)).map((g) => ({
      nome: g,
      itens: mapa.get(g) as MeuItem[],
    }));
  }, [data]);

  async function concluir(item: MeuItem, concluido: boolean) {
    try {
      await api.patch(`/kanban/checklist-itens/${item.id}`, { concluido });
      refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <PageLayout
      title="Meus itens"
      description="Itens de checklist delegados a você, em todos os quadros, por prazo"
      actions={
        <Button
          variant="ghost"
          leftIcon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate('/kanban')}
        >
          Quadros
        </Button>
      }
    >
      <StateView
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={(data ?? []).length === 0}
        emptyMessage="Nada delegado a você no momento. 🎉"
      >
        <div className="flex flex-col gap-4 max-w-3xl">
          {grupos.map((grupo) => (
            <section key={grupo.nome} data-testid={`meus-itens-${grupo.nome}`}>
              <h3
                className={cn(
                  'text-xs font-semibold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1.5',
                  COR_GRUPO[grupo.nome],
                )}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {grupo.nome} ({grupo.itens.length})
              </h3>
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {grupo.itens.map((item) => {
                    const board = item.checklist.card.lista.board;
                    return (
                      <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                        <Checkbox
                          checked={item.concluido}
                          onChange={(e) => void concluir(item, e.target.checked)}
                        />
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() =>
                            navigate(`/kanban/${board.id}?card=${item.checklist.card.id}`)
                          }
                          data-testid={`meu-item-${item.id}`}
                        >
                          <div
                            className={cn(
                              'text-sm text-text truncate',
                              item.concluido && 'line-through text-muted',
                            )}
                          >
                            {item.texto}
                          </div>
                          <div className="text-[11px] text-muted flex items-center gap-1.5 mt-0.5">
                            <span
                              className="h-2 w-2 rounded-full inline-block shrink-0"
                              style={{ background: board.corFundo }}
                            />
                            {board.nome} · {item.checklist.card.titulo} ·{' '}
                            {item.checklist.card.lista.nome}
                          </div>
                        </button>
                        {item.dataEntrega && (
                          <span className="text-xs text-muted whitespace-nowrap">
                            {new Date(item.dataEntrega).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      </StateView>
    </PageLayout>
  );
}
