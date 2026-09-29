import { useState } from 'react';
import { Check, Copy, KeyRound, Power, RefreshCcw, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Card } from '@/components/ui';

/**
 * PedidoSiteChaveCard — chave de API SÓ pro checkout do site criar pedido.
 *
 * Separada da chave de leads desde 29/09/2026: a de leads, se vazar, cria lead;
 * esta cria pedido real no ERP. Enquanto não existe, o checkout segue usando a
 * chave de leads; no instante em que é gerada, a de leads para de valer pra
 * pedido — por isso o aviso antes de gerar.
 */

interface ChaveStatus {
  configurada: boolean;
  ativo: boolean;
  prefixo: string | null;
  criadoEm: string | null;
  ultimoUsoEm: string | null;
}

export function PedidoSiteChaveCard() {
  const toast = useToast();
  const { data, refetch } = useApiQuery<ChaveStatus>('/leads-capture/chave-pedidos');
  const [busy, setBusy] = useState(false);
  /** Chave em claro — só existe em memória logo após gerar (mostrada 1x). */
  const [chaveNova, setChaveNova] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const st = data ?? null;

  async function gerar() {
    setBusy(true);
    try {
      const r = await api.post<{ chave: string }>('/leads-capture/chave-pedidos/gerar', {});
      setChaveNova(r.chave);
      toast.success(st?.configurada ? 'Chave de pedidos rotacionada' : 'Chave de pedidos gerada');
      refetch();
    } catch {
      toast.error('Falha ao gerar a chave de pedidos');
    } finally {
      setBusy(false);
    }
  }

  async function desativar() {
    setBusy(true);
    try {
      await api.post('/leads-capture/chave-pedidos/desativar', {});
      setChaveNova(null);
      toast.success('Chave desativada — o checkout para de criar pedidos');
      refetch();
    } catch {
      toast.error('Falha ao desativar');
    } finally {
      setBusy(false);
    }
  }

  function copiar(texto: string) {
    void navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    });
  }

  return (
    <Card padding="md" data-testid="pedido-site-chave-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <ShoppingCart className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="m-0 text-[15px] font-semibold">Pedidos do site (checkout)</h3>
            <p className="m-0 text-xs text-muted">
              Chave própria pro checkout criar pedido no ERP — separada da chave de leads.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {st?.configurada && st.ativo && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void desativar()}
              leftIcon={<Power className="h-3.5 w-3.5" />}
              data-testid="pedidochave-desativar"
            >
              Desativar
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void gerar()}
            leftIcon={
              st?.configurada ? (
                <RefreshCcw className="h-3.5 w-3.5" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )
            }
            data-testid="pedidochave-gerar"
          >
            {st?.configurada ? 'Rotacionar chave' : 'Gerar chave'}
          </Button>
        </div>
      </div>

      {/* Sem chave ainda: avisa o que muda no instante em que gerar */}
      {st && !st.configurada && !chaveNova && (
        <p className="text-xs text-muted mt-3 mb-0" data-testid="pedidochave-aviso">
          Hoje o checkout usa a chave de leads. Ao gerar esta, a de leads{' '}
          <strong className="text-text">para de criar pedidos na hora</strong> — coloque a chave
          nova no servidor do site (<code className="text-text">BETINNA_PEDIDOS_API_KEY</code>)
          logo em seguida.
        </p>
      )}

      {/* Status atual */}
      {st?.configurada && !chaveNova && (
        <p className="text-xs text-muted mt-3 mb-0">
          Chave <code className="text-text">{st.prefixo}</code>{' '}
          {st.ativo ? '· ativa' : '· DESATIVADA'}
          {st.ultimoUsoEm
            ? ` · último uso ${new Date(st.ultimoUsoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
            : ' · nunca usada'}
        </p>
      )}

      {/* Chave nova — mostrada UMA vez */}
      {chaveNova && (
        <div className="mt-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/30">
          <p className="m-0 text-xs font-semibold text-warning">
            Copie agora — a chave não aparece de novo. Vai no servidor do site como{' '}
            <code>BETINNA_PEDIDOS_API_KEY</code>.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <code
              data-testid="pedidochave-chave"
              className="text-[12px] break-all text-text bg-surface px-2 py-1 rounded border border-border flex-1"
            >
              {chaveNova}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copiar(chaveNova)}
              leftIcon={
                copiado ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )
              }
              data-testid="pedidochave-copiar"
            >
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
