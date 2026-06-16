import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ExternalLink, Hash, Mail, MapPin, Phone, Receipt } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Avatar, Button, Drawer } from '@/components/ui';
import { cn } from '@/lib/cn';

interface ClienteCtx {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status?: string | null;
  representante?: { nome: string } | null;
  _count?: { pedidos?: number; propostas?: number; amostras?: number };
}

export function ClienteContextDrawer({
  clienteId,
  onClose,
  onCriarPedido,
}: {
  clienteId: string;
  onClose: () => void;
  onCriarPedido: () => void;
}) {
  const navigate = useNavigate();
  const { data, loading } = useApiQuery<ClienteCtx>(`/clientes/${clienteId}`);

  return (
    <Drawer open onClose={onClose} title="Cliente" width="sm">
      {loading || !data ? (
        <div className="flex flex-col gap-3">
          <div className="h-16 rounded-md bg-surface-hover animate-pulse" />
          <div className="h-32 rounded-md bg-surface-hover animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar name={data.nome} size="xl" />
            <div className="min-w-0">
              <h3 className="text-md font-semibold text-text truncate">{data.nome}</h3>
              {data.segmento && <p className="text-xs text-muted m-0">{data.segmento}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <CtxRow icon={<Hash />} value={data.cnpj} mono />
            <CtxRow icon={<Phone />} value={data.telefone} />
            <CtxRow icon={<Mail />} value={data.email} />
            <CtxRow
              icon={<MapPin />}
              value={data.cidade ? `${data.cidade}${data.uf ? '/' + data.uf : ''}` : null}
            />
            <CtxRow icon={<Building2 />} value={data.representante?.nome ?? null} label="Representante" />
          </div>

          {data._count && (
            <div className="grid grid-cols-3 gap-2">
              <CtxStat label="Pedidos" value={data._count.pedidos ?? 0} />
              <CtxStat label="Propostas" value={data._count.propostas ?? 0} />
              <CtxStat label="Amostras" value={data._count.amostras ?? 0} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              data-testid="inbox-cliente-pedido"
              onClick={onCriarPedido}
              leftIcon={<Receipt className="h-3.5 w-3.5" />}
            >
              Criar pedido
            </Button>
            <Button
              variant="secondary"
              data-testid="inbox-cliente-abrir"
              onClick={() => navigate(`/clientes/${clienteId}`)}
              leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              Abrir ficha completa
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function CtxRow({
  icon,
  value,
  label,
  mono,
}: {
  icon: ReactNode;
  value?: string | null;
  label?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 w-4 h-4 text-muted [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      {label && <span className="text-muted text-xs">{label}:</span>}
      <span className={cn('text-text truncate', mono && 'tabular')}>{value}</span>
    </div>
  );
}

function CtxStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-bg-alt px-2 py-2 text-center">
      <div className="text-lg font-semibold text-text tabular">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
