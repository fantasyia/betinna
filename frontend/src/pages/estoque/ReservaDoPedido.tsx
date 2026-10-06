import { useState } from 'react';
import { Clock } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { restante, useAgora } from '@/lib/relogio';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card } from '@/components/ui';

/**
 * Reserva de estoque do pedido da vitrine (ERP próprio · entrega 1).
 *
 * Mostra o relógio dos 20 min, "Pagamento recebido" (Pix manual — confirma a
 * reserva e marca o pedido como PAGO) e "Reativar" (reserva expirou e o
 * cliente voltou). Só ADMIN/DIRECTOR, e só onde o estoque próprio está ligado
 * — fora disso o componente não renderiza nada.
 */

interface Reserva {
  pedidoStatus: string;
  reserva: {
    status: 'ATIVA' | 'CONFIRMADA' | 'BAIXADA' | 'LIBERADA';
    expiraEm: string | null;
    pecas: number;
    motivoLiberacao: string | null;
  } | null;
}

const ROTULO: Record<NonNullable<Reserva['reserva']>['status'], { texto: string; tom: 'warning' | 'success' | 'neutral' | 'danger' }> = {
  ATIVA: { texto: 'Reservado, esperando pagamento', tom: 'warning' },
  CONFIRMADA: { texto: 'Pago — reserva garantida', tom: 'success' },
  BAIXADA: { texto: 'Despachado — saiu do estoque', tom: 'neutral' },
  LIBERADA: { texto: 'Reserva liberada', tom: 'danger' },
};

export function ReservaDoPedido({ pedidoId, onMudou }: { pedidoId: string; onMudou: () => void }) {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const status = useApiQuery<{ ativo: boolean }>(gestor ? '/erp/estoque/status' : null);
  const ligado = status.data?.ativo === true;
  const q = useApiQuery<Reserva>(ligado ? `/erp/estoque/pedidos/${pedidoId}/reserva` : null);
  const toast = useToast();
  const [acao, setAcao] = useState<'pago' | 'reativar' | null>(null);
  const r = q.data?.reserva ?? null;
  const agora = useAgora(r?.status === 'ATIVA');
  const relogio = r?.status === 'ATIVA' ? restante(r.expiraEm, agora) : null;

  if (!ligado || !r) return null;

  async function executar(tipo: 'pago' | 'reativar') {
    setAcao(tipo);
    try {
      await api.post(
        `/erp/estoque/pedidos/${pedidoId}/${tipo === 'pago' ? 'pagamento-recebido' : 'reativar'}`,
      );
      toast.success(tipo === 'pago' ? 'Pagamento registrado — reserva garantida' : 'Pedido reativado com 20 min novos');
      q.refetch();
      onMudou();
    } catch (err) {
      toast.error('Não foi possível', apiErrorMessage(err));
    } finally {
      setAcao(null);
    }
  }

  const expirou = r.status === 'LIBERADA' && (r.motivoLiberacao ?? '').startsWith('reserva expirada');
  const rotulo = ROTULO[r.status];

  return (
    <Card variant="outline" padding="md" data-testid="reserva-estoque">
      <div className="flex flex-wrap items-center gap-3">
        <Clock className="h-4 w-4 text-muted shrink-0" />
        <div className="flex flex-col gap-0.5 mr-auto">
          <span className="text-[11px] uppercase tracking-wider text-muted">Estoque · {r.pecas} peças</span>
          <span className="flex items-center gap-2 text-sm">
            <Badge variant={rotulo.tom}>{expirou ? 'Reserva expirou' : rotulo.texto}</Badge>
            {relogio && (
              <b className={`tabular-nums ${relogio.vencido ? 'text-danger' : ''}`} data-testid="reserva-relogio">
                {relogio.vencido ? 'prazo acabou' : `${relogio.texto} pra pagar`}
              </b>
            )}
          </span>
          {r.status === 'LIBERADA' && r.motivoLiberacao && !expirou && (
            <span className="text-xs text-muted">{r.motivoLiberacao}</span>
          )}
        </div>
        {r.status === 'ATIVA' && q.data?.pedidoStatus === 'RASCUNHO' && (
          <Button
            size="sm"
            onClick={() => executar('pago')}
            loading={acao === 'pago'}
            disabled={acao !== null}
            data-testid="reserva-pago"
          >
            Pagamento recebido
          </Button>
        )}
        {expirou && q.data?.pedidoStatus === 'CANCELADO' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => executar('reativar')}
            loading={acao === 'reativar'}
            disabled={acao !== null}
            data-testid="reserva-reativar"
          >
            Reativar pedido
          </Button>
        )}
      </div>
    </Card>
  );
}
