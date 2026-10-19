import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

/**
 * Modo interno (#04/Léo, 19/10): visita da equipe não conta como cliente —
 * sem pixel do Meta, sem Google Ads, GA4 como tráfego interno. Reconhece pelo
 * link aberto no aparelho ou pelos IPs que a equipe já usou no app.
 */
interface StatusInterno {
  codigo: string;
  dominio: string | null;
  slug: string | null;
  doApp: string[];
  manuais: string[];
}

/** Link que marca o aparelho. PURO. */
export function linkInterno(s: Pick<StatusInterno, 'codigo' | 'dominio' | 'slug'>, origem: string): string | null {
  if (s.dominio) return `https://${s.dominio.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/?interno=${s.codigo}`;
  if (s.slug) return `${origem}/v/${encodeURIComponent(s.slug)}?interno=${s.codigo}`;
  return null;
}

export function ModoInternoConfig() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const q = useApiQuery<StatusInterno>(gestor ? '/vitrine/admin/interno' : null);
  const toast = useToast();
  const [ips, setIps] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (q.data) setIps(q.data.manuais.join(', '));
  }, [q.data]);

  if (!gestor || !q.data) return null;
  const s = q.data;
  const link = linkInterno(s, window.location.origin);

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copiado — abra em cada aparelho da equipe');
    } catch {
      toast.error('Não deu pra copiar', link);
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api.put('/vitrine/admin/interno', {
        ips: ips
          .split(/[\s,;]+/)
          .map((x) => x.trim())
          .filter(Boolean),
      });
      toast.success('IPs da equipe salvos');
      q.refetch();
    } catch (err) {
      toast.error('Não foi possível salvar', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4 max-w-xl flex flex-col gap-3" data-testid="modo-interno-config">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-base font-semibold">Modo interno (visitas da equipe)</h2>
        <Badge variant="success">Ligado</Badge>
      </div>
      <p className="text-sm text-muted">
        Quem é da equipe não conta como cliente: sem pixel do Meta, sem Google Ads, e o GA4 recebe como
        tráfego interno. Pedido feito de um aparelho da equipe não manda compra pro Meta nem pro Google.
        Na vitrine aparece um selinho &quot;modo interno&quot;.
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">1. Link pra marcar o aparelho</span>
        <span className="text-xs text-muted">
          Abra UMA vez em cada celular e computador da equipe (vale mesmo no 4G). Pra desmarcar, abra a vitrine
          com ?interno=sair.
        </span>
        {link ? (
          <div className="flex flex-wrap gap-2">
            <Input value={link} readOnly className="flex-1 min-w-0 font-mono text-xs" data-testid="interno-link" />
            <Button variant="secondary" onClick={() => void copiar()} data-testid="interno-copiar">
              Copiar
            </Button>
          </div>
        ) : (
          <span className="text-xs text-warning">Publique a vitrine pra ter o link.</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">2. IPs reconhecidos automaticamente</span>
        <span className="text-xs text-muted">
          Todo IP que alguém da equipe já usou no app (e os que vierem) conta como interno.
        </span>
        <div className="flex flex-wrap gap-1" data-testid="interno-ips-app">
          {s.doApp.length ? (
            s.doApp.map((ip) => (
              <Badge key={ip} variant="neutral">
                {ip}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted">Nenhum ainda.</span>
          )}
        </div>
      </div>
      <Field label="3. Outros IPs da equipe (escritório, casa…) — separe por vírgula">
        <Input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="45.188.178.15" data-testid="interno-ips" />
      </Field>
      <div className="flex justify-end">
        <Button onClick={() => void salvar()} disabled={salvando} data-testid="interno-salvar">
          {salvando ? 'Salvando…' : 'Salvar IPs'}
        </Button>
      </div>
    </Card>
  );
}
