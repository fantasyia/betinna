import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { formatMoeda } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { Badge, Card } from '@/components/ui';
import { dataBr, rotuloSituacao, type Lista } from './tipos';

/**
 * Atalhos do financeiro (ERP Fase 3 · §7.4): no PEDIDO, a conta a receber
 * dele; na OP, os pagamentos da facção. Só ADMIN/DIRECTOR e só onde o
 * financeiro está ligado — fora disso não renderizam nada.
 */
function useFinanceiroLigado(): boolean {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const status = useApiQuery<{ ativo: boolean }>(gestor ? '/financeiro/status' : null);
  return status.data?.ativo === true;
}

/** Link pra lista do financeiro já filtrada (aba + busca). */
export function linkFinanceiro(aba: 'RECEBER' | 'PAGAR', busca: string): string {
  // Situação TODOS: a conta já paga também aparece pelo atalho.
  return `/financeiro?${new URLSearchParams({ aba, busca, situacao: 'TODOS' }).toString()}`;
}

/** Conta a receber do pedido da vitrine: valor, quanto entrou e a situação. */
export function ContaDoPedido({ pedidoId, numero }: { pedidoId: string; numero: string }) {
  const ligado = useFinanceiroLigado();
  const q = useApiQuery<Lista>(
    ligado ? `/financeiro/titulos?tipo=RECEBER&situacao=TODOS&pedidoId=${encodeURIComponent(pedidoId)}` : null,
  );
  const t = q.data?.titulos[0];
  if (!ligado || !q.data) return null;
  return (
    <Card className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-testid="fin-conta-pedido">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Wallet className="h-4 w-4 text-muted" aria-hidden /> Financeiro
      </span>
      {!t ? (
        <span className="text-muted">Sem conta a receber (pedido sem valor ainda — nasce no pagamento).</span>
      ) : (
        <>
          <span>
            Conta a receber <b className="tabular-nums">{formatMoeda(t.valor)}</b>
          </span>
          <Badge variant={rotuloSituacao(t.situacao, 'RECEBER').tom}>{rotuloSituacao(t.situacao, 'RECEBER').texto}</Badge>
          <span className="text-muted tabular-nums">
            recebido {formatMoeda(t.pago)}
            {t.saldo > 0 ? ` · falta ${formatMoeda(t.saldo)} · vence ${dataBr(String(t.vencimento).slice(0, 10))}` : ''}
          </span>
          <Link to={linkFinanceiro('RECEBER', numero)} className="ml-auto text-sm text-primary hover:underline">
            Abrir no financeiro →
          </Link>
        </>
      )}
    </Card>
  );
}

/** Pagamentos da facção desta OP: um por entrega + o saldo no fechamento. */
export function PagamentosDaFaccao({ opId, numero }: { opId: string; numero: string }) {
  const ligado = useFinanceiroLigado();
  const q = useApiQuery<Lista>(
    ligado ? `/financeiro/titulos?tipo=PAGAR&situacao=TODOS&opId=${encodeURIComponent(opId)}` : null,
  );
  const lista = q.data?.titulos ?? [];
  if (!ligado || lista.length === 0) return null;
  const total = lista.reduce((s, t) => s + (t.status === 'CANCELADO' ? 0 : t.valor), 0);
  const pago = lista.reduce((s, t) => s + t.pago, 0);
  return (
    <Card className="p-4 flex flex-col gap-3" data-testid="fin-pagamentos-op">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Pagamentos da facção</h2>
        <span className="text-sm text-muted tabular-nums">
          {formatMoeda(pago)} pago de {formatMoeda(total)}
        </span>
        <Link to={linkFinanceiro('PAGAR', numero)} className="ml-auto text-sm text-primary hover:underline">
          Abrir no financeiro →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm tabular-nums">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">Lançamento</th>
              <th className="px-2 py-1 text-right font-semibold">Vencimento</th>
              <th className="px-2 py-1 text-right font-semibold">Valor</th>
              <th className="px-2 py-1 text-right font-semibold">Pago</th>
              <th className="px-2 py-1 text-right font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => {
              const r = rotuloSituacao(t.situacao, 'PAGAR');
              return (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-2 py-1.5">{t.descricao}</td>
                  <td className="px-2 py-1.5 text-right">{dataBr(String(t.vencimento).slice(0, 10))}</td>
                  <td className="px-2 py-1.5 text-right">{formatMoeda(t.valor)}</td>
                  <td className="px-2 py-1.5 text-right">{t.pago ? formatMoeda(t.pago) : '—'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Badge variant={r.tom}>{r.texto}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
