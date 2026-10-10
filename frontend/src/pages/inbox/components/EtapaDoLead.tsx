import { useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useModulo } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';

/**
 * Etapa do funil do lead, mudada DE DENTRO da conversa (Léo, 10/10): quem
 * atende move o lead sem sair do atendimento. Mesma rota e mesma permissão do
 * quadro do funil (`PUT /leads/:id/etapa`, módulo kanban — editar).
 *
 * Só aparece quando a conversa tem lead ligado e ele está num funil. Sem
 * permissão de editar: mostra a etapa, travada.
 */
interface LeadEtapa {
  id: string;
  funil: { id: string; nome: string } | null;
  funilEtapa: { id: string; nome: string } | null;
}
interface FunilEtapas {
  id: string;
  etapas: Array<{ id: string; nome: string; ordem: number; tipo?: string }>;
}

export function EtapaDoLead({ leadId }: { leadId: string }) {
  const perm = useModulo('kanban');
  const toast = useToast();
  const lead = useApiQuery<LeadEtapa>(perm.ver ? `/leads/${leadId}` : null);
  const funilId = lead.data?.funil?.id ?? null;
  const funil = useApiQuery<FunilEtapas>(funilId ? `/funis/${funilId}` : null);
  const [salvando, setSalvando] = useState(false);

  if (!perm.ver || !lead.data || !funil.data) return null;
  const etapas = [...funil.data.etapas].sort((a, b) => a.ordem - b.ordem);
  const atual = lead.data.funilEtapa?.id ?? '';

  async function mover(etapaId: string) {
    const destino = etapas.find((e) => e.id === etapaId);
    if (!destino || etapaId === atual) return;
    setSalvando(true);
    try {
      await api.put(`/leads/${leadId}/etapa`, { funilEtapaId: etapaId });
      toast.success(`Lead movido para ${destino.nome}`);
      lead.refetch();
    } catch (err) {
      toast.error('Não foi possível mover o lead', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <label
      className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap"
      title={`Etapa do lead no funil ${lead.data.funil?.nome ?? ''}`}
    >
      Etapa:
      <select
        data-testid="inbox-etapa-lead"
        value={atual}
        disabled={!perm.editar || salvando}
        onChange={(e) => void mover(e.target.value)}
        className="max-w-[160px] rounded-md border border-border-strong bg-surface px-1.5 py-1 text-[11px] text-text disabled:opacity-60"
      >
        {!atual && <option value="">—</option>}
        {etapas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
