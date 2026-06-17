import { Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapaOpt } from '@/pages/fluxo/hooks/useInspectorData';

/** MOVER_LEAD_ETAPA — escolhe a etapa de destino (de qualquer funil). */
export function MoverLeadEtapaForm({
  data,
  onUpdate,
  etapasOpts,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  etapasOpts: InspectorEtapaOpt[];
}) {
  return (
    <Field label="Etapa de destino" hint="Etapa do funil pra onde o lead vai">
      <Select
        size="sm"
        value={(data.config.funilEtapaId as string) ?? ''}
        onChange={(e) =>
          onUpdate((d) => ({
            ...d,
            config: { ...d.config, funilEtapaId: e.target.value || undefined },
          }))
        }
      >
        <option value="">Selecionar etapa…</option>
        {etapasOpts.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
