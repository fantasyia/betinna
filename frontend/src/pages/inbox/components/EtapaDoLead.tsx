import { useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useModulo } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { Button, Dialog, Field, Textarea } from '@/components/ui';

/**
 * Etapa do funil do lead, mudada DE DENTRO da conversa (Léo, 10/10): quem
 * atende move o lead sem sair do atendimento. Mesma rota e mesma permissão do
 * quadro do funil (`PUT /leads/:id/etapa`, módulo kanban — editar).
 *
 * Só aparece quando a conversa tem lead ligado e ele está num funil. Sem
 * permissão de editar: mostra a etapa, travada.
 *
 * Etapa de GANHO/PERDIDO pede o MOTIVO antes (o backend exige — sem isto o
 * select só mostrava "Motivo é obrigatório" e não havia onde escrever; Léo, 10/10).
 */
interface LeadEtapa {
  id: string;
  nome?: string;
  funil: { id: string; nome: string } | null;
  funilEtapa: { id: string; nome: string } | null;
}
interface EtapaFunil {
  id: string;
  nome: string;
  ordem: number;
  tipo?: string;
}
interface FunilEtapas {
  id: string;
  etapas: EtapaFunil[];
}

const pedeMotivo = (e: EtapaFunil) => e.tipo === 'GANHO' || e.tipo === 'PERDIDO';

export function EtapaDoLead({ leadId }: { leadId: string }) {
  const perm = useModulo('kanban');
  const toast = useToast();
  const lead = useApiQuery<LeadEtapa>(perm.ver ? `/leads/${leadId}` : null);
  const funilId = lead.data?.funil?.id ?? null;
  const funil = useApiQuery<FunilEtapas>(funilId ? `/funis/${funilId}` : null);
  const [salvando, setSalvando] = useState(false);
  // Etapa terminal escolhida, esperando o motivo.
  const [terminal, setTerminal] = useState<EtapaFunil | null>(null);
  const [motivo, setMotivo] = useState('');

  if (!perm.ver || !lead.data || !funil.data) return null;
  const etapas = [...funil.data.etapas].sort((a, b) => a.ordem - b.ordem);
  const atual = lead.data.funilEtapa?.id ?? '';

  async function mover(destino: EtapaFunil, comMotivo?: string) {
    setSalvando(true);
    try {
      await api.put(`/leads/${leadId}/etapa`, {
        funilEtapaId: destino.id,
        ...(comMotivo ? { motivo: comMotivo } : {}),
      });
      toast.success(`Lead movido para ${destino.nome}`);
      setTerminal(null);
      setMotivo('');
      lead.refetch();
    } catch (err) {
      toast.error('Não foi possível mover o lead', apiErrorMessage(err));
    } finally {
      setSalvando(false);
    }
  }

  function escolher(etapaId: string) {
    const destino = etapas.find((e) => e.id === etapaId);
    if (!destino || etapaId === atual) return;
    if (pedeMotivo(destino)) {
      setMotivo('');
      setTerminal(destino);
      return;
    }
    void mover(destino);
  }

  const ganho = terminal?.tipo === 'GANHO';
  return (
    <>
      <label
        className="flex items-center gap-1 text-[11px] text-muted whitespace-nowrap"
        title={`Etapa do lead no funil ${lead.data.funil?.nome ?? ''}`}
      >
        Etapa:
        <select
          data-testid="inbox-etapa-lead"
          value={atual}
          disabled={!perm.editar || salvando}
          onChange={(e) => escolher(e.target.value)}
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
      {terminal && (
        <Dialog
          open
          onClose={() => setTerminal(null)}
          title={`Marcar como ${terminal.nome}?`}
          description={`${lead.data.nome ? `${lead.data.nome} — ` : ''}informe o motivo pra registrar no histórico.`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setTerminal(null)}>
                Cancelar
              </Button>
              <Button
                data-testid="inbox-etapa-motivo-confirmar"
                disabled={motivo.trim().length === 0 || salvando}
                onClick={() => void mover(terminal, motivo.trim())}
                variant={ganho ? 'primary' : 'danger'}
              >
                Confirmar
              </Button>
            </>
          }
        >
          <Field label="Motivo" required>
            <Textarea
              autoFocus
              data-testid="inbox-etapa-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                ganho
                  ? 'Ex: Fechou o pedido depois da proposta.'
                  : 'Ex: Escolheu outro fornecedor pelo preço.'
              }
              rows={4}
            />
          </Field>
        </Dialog>
      )}
    </>
  );
}
