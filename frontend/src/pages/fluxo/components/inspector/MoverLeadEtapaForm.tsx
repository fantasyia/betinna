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
    <>
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

      {/* Sem isto, mover pra etapa em que o lead JÁ está não acende o fluxo de
          destino — foi o que deixou o C2 sem assumir o lead do Canal Reps. */}
      <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer select-none">
        <input
          type="checkbox"
          data-testid="mover-reacender"
          checked={data.config.reacenderSeJaEstaNaEtapa === true}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, reacenderSeJaEstaNaEtapa: e.target.checked },
            }))
          }
        />
        Acender o fluxo de destino mesmo se o lead já estiver nesta etapa
      </label>
    </>
  );
}
