import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input, Switch } from '@/components/ui';

/**
 * Tag do Google na vitrine (15/10): GA4 e Google Ads no mesmo gtag. Tudo
 * público (vai na página) — não tem token. A compra sai com o número do
 * pedido, o valor e o e-mail/telefone do cliente (conversões otimizadas).
 */
interface StatusGoogleTag {
  config: { ativo?: boolean; ga4Id?: string | null; adsId?: string | null; compraLabel?: string | null };
}

/**
 * Aceita o `send_to` inteiro colado do Google Ads ("AW-123/abc") ou só o
 * rótulo. Devolve o AW- (se veio) e o rótulo. PURO.
 */
export function lerSendTo(v: string): { adsId: string | null; label: string } {
  const t = v.trim();
  const m = t.match(/^(AW-\d+)\/(.+)$/i);
  return m ? { adsId: m[1].toUpperCase(), label: m[2] } : { adsId: null, label: t };
}

export function GoogleTagConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusGoogleTag>(gestor ? '/vitrine/admin/google-tag' : null);
  const toast = useToast();
  const [ativo, setAtivo] = useState(false);
  const [ga4, setGa4] = useState('');
  const [ads, setAds] = useState('');
  const [compra, setCompra] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const c = q.data.config;
    setAtivo(c.ativo === true);
    setGa4(c.ga4Id ?? '');
    setAds(c.adsId ?? '');
    setCompra(c.adsId && c.compraLabel ? `${c.adsId}/${c.compraLabel}` : (c.compraLabel ?? ''));
  }, [q.data]);

  if (!gestor || !q.data) return null;
  const s = q.data;

  async function salvar() {
    const sendTo = lerSendTo(compra);
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/google-tag', {
        ativo,
        ga4Id: ga4.trim() || null,
        adsId: (ads.trim() || sendTo.adsId) ?? null,
        compraLabel: sendTo.label || null,
      });
      toast.success(ativo ? 'Tag do Google ligada na vitrine' : 'Tag do Google salva (desligada)');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="google-tag-config">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Tag do Google (GA4 e Google Ads)</h2>
        <Badge variant={s.config.ativo ? 'success' : 'neutral'}>{s.config.ativo ? 'Ligada' : 'Desligada'}</Badge>
      </div>
      <p className="text-sm text-muted">
        Mede no Google os mesmos passos do pixel: visitas, produtos vistos, itens no pedido, início do
        pagamento e a compra paga — com o número do pedido, o valor e o e-mail/telefone do cliente
        (conversões otimizadas). O clique do anúncio (gclid) fica gravado no pedido.
      </p>
      <Field label="ID do GA4">
        <Input value={ga4} onChange={(e) => setGa4(e.target.value)} maxLength={24} placeholder="G-XXXXXXXXXX" data-testid="gtag-ga4" />
      </Field>
      <Field label="ID do Google Ads">
        <Input value={ads} onChange={(e) => setAds(e.target.value)} maxLength={20} placeholder="AW-123456789" data-testid="gtag-ads" />
      </Field>
      <Field label="Conversão de compra (send_to ou só o rótulo)">
        <Input
          value={compra}
          onChange={(e) => setCompra(e.target.value)}
          maxLength={90}
          placeholder="AW-123456789/AbCdEf"
          data-testid="gtag-compra"
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Switch label="Ligar a tag na vitrine" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        <Button onClick={salvar} disabled={salvando || (!ga4.trim() && !ads.trim() && !lerSendTo(compra).adsId)} data-testid="gtag-salvar">
          {salvando ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </Card>
  );
}
