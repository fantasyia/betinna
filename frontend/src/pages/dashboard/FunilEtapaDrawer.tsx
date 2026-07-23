import { Link } from 'react-router-dom';
import { ArrowRight, Target } from 'lucide-react';
import { Button, Drawer, EmptyState, Spinner } from '@/components/ui';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { formatTelefone } from '@/lib/phone';
import { tempoDesde } from './types';

interface LeadDaEtapa {
  leadId: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  dataEntrada: string;
  representante: { id: string; nome: string } | null;
}

/**
 * M5 — clicar numa etapa do funil abre a LISTA de leads dela (mais parados
 * primeiro — a ordenação já vem do endpoint). Reusa GET /funis/:id/etapas/:etapaId/leads.
 */
export function FunilEtapaDrawer({
  funilId,
  etapaId,
  etapaNome,
  onClose,
}: {
  funilId: string;
  etapaId: string;
  etapaNome: string;
  onClose: () => void;
}) {
  const { data, loading } = useApiQuery<PaginatedResponse<LeadDaEtapa>>(
    `/funis/${funilId}/etapas/${etapaId}/leads?page=1&limit=20`,
  );
  const leads = data?.data ?? [];

  return (
    <Drawer open onClose={onClose} title={etapaNome} description="Mais parados primeiro" width="sm">
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner /> Carregando leads…
        </div>
      ) : leads.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Target />}
          title="Etapa vazia"
          description="Nenhum lead aqui agora."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {leads.map((l) => (
            <li key={l.leadId} className="py-2.5" data-testid="etapa-lead">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-text truncate">{l.nome}</span>
                <span className="text-[11px] text-muted tabular shrink-0">
                  {tempoDesde(l.dataEntrada)}
                </span>
              </div>
              <p className="text-xs text-muted truncate">
                {l.telefone ? formatTelefone(l.telefone) : (l.email ?? '—')}
                {l.representante ? ` · ${l.representante.nome}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Link to="/leads">
          <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="h-3 w-3" />}>
            Abrir o funil completo
          </Button>
        </Link>
      </div>
    </Drawer>
  );
}
