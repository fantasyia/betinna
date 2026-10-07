import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatPercent } from '@/lib/masks';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card } from '@/components/ui';

/**
 * Pagamento online da vitrine (checkout Asaas) — entrega 1: ligar a conta.
 *
 * A chave fica em Integrações → Asaas (só a diretoria). Aqui: "Ativar" confere
 * a chave, lê as taxas da conta e cadastra no Asaas o aviso de pagamento.
 * A cobrança (Pix e cartão) na vitrine é a entrega 2.
 */
export interface StatusCheckout {
  conectado: boolean;
  ambiente: 'sandbox' | 'producao' | null;
  ativo: boolean;
  avisoCadastrado: boolean;
  taxas: {
    cartao: { fixa: number; umaVez: number; ateSeis: number; ateDoze: number };
    pix: { percentual: number | null; fixa: number | null; minima: number | null; maxima: number | null };
  } | null;
  taxasLidasEm: string | null;
}

const ROTULO_AMBIENTE = { sandbox: 'Teste (sandbox)', producao: 'Produção' } as const;

export function PagamentoOnline() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusCheckout>(gestor ? '/checkout/status' : null);
  const toast = useToast();
  const [acao, setAcao] = useState<'ativar' | 'desativar' | null>(null);
  const s = q.data;
  if (!gestor || !s) return null;

  async function executar(tipo: 'ativar' | 'desativar') {
    setAcao(tipo);
    try {
      await api.post(`/checkout/${tipo}`);
      toast.success(tipo === 'ativar' ? 'Pagamento online ativado' : 'Pagamento online desligado');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível', apiErrorMessage(err));
    } finally {
      setAcao(null);
    }
  }

  const t = s.taxas?.cartao;
  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="pagamento-online">
      <div className="flex flex-wrap items-center gap-2">
        <CreditCard className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Pagamento online (Asaas)</h2>
        {s.ambiente && <Badge variant={s.ambiente === 'producao' ? 'success' : 'warning'}>{ROTULO_AMBIENTE[s.ambiente]}</Badge>}
        <Badge variant={s.ativo ? 'success' : 'neutral'}>{s.ativo ? 'Ativo' : 'Desligado'}</Badge>
      </div>

      {!s.conectado ? (
        <p className="text-sm text-muted">
          Primeiro conecte a conta do Asaas da empresa em{' '}
          <Link to="/integracoes" className="text-primary hover:underline">
            Integrações → Asaas
          </Link>{' '}
          (cole a chave da API; a de teste começa com <code>$aact_hmlg_</code>).
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Pix: preço da vitrine. Cartão à vista: preço da vitrine (a empresa cobre a taxa). Parcelado: o cliente
            paga a taxa do Asaas da faixa de parcelas.
          </p>
          {t && (
            <div className="grid grid-cols-3 gap-2 text-sm tabular-nums" data-testid="pagamento-taxas">
              <div className="rounded-[10px] border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">Cartão 1x</div>
                {formatPercent(t.umaVez, 2)} + R$ {t.fixa.toFixed(2).replace('.', ',')}
              </div>
              <div className="rounded-[10px] border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">2x a 6x</div>
                {formatPercent(t.ateSeis, 2)}
              </div>
              <div className="rounded-[10px] border border-border p-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">7x a 12x</div>
                {formatPercent(t.ateDoze, 2)}
              </div>
            </div>
          )}
          <p className="text-xs text-muted">
            {s.avisoCadastrado
              ? 'Aviso de pagamento cadastrado no Asaas — o pedido vai confirmar sozinho quando pagar.'
              : '"Ativar" confere a chave, lê as taxas da conta e cadastra no Asaas o aviso de pagamento.'}
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => void executar('ativar')}
              loading={acao === 'ativar'}
              data-testid="pagamento-ativar"
            >
              {s.ativo ? 'Atualizar taxas e aviso' : 'Ativar pagamento online'}
            </Button>
            {s.ativo && (
              <Button variant="ghost" onClick={() => void executar('desativar')} loading={acao === 'desativar'}>
                Desligar
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
