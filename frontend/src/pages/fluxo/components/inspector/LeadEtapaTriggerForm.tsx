import { Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapa, InspectorFunil } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * LEAD_ETAPA_MUDOU (trigger) — funil → para-etapa / de-etapa (dependentes).
 *
 * Dropdowns dependentes: trocar o funil LIMPA paraEtapa/deEtapa (podem não
 * existir no novo funil). PRESERVA essa limpeza — é config-only via onUpdate.
 */
export function LeadEtapaTriggerForm({
  data,
  onUpdate,
  funis,
  etapasDoFunil,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  funis: InspectorFunil[] | null;
  etapasDoFunil: (funilId?: string) => InspectorEtapa[];
}) {
  return (
    <>
      <Field label="Funil" hint="Qual funil observar">
        <Select
          size="sm"
          value={(data.config.funil as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              // trocar o funil limpa as etapas (podem não existir no novo)
              config: {
                ...d.config,
                funil: e.target.value || undefined,
                paraEtapa: undefined,
                deEtapa: undefined,
              },
            }))
          }
        >
          <option value="">Selecionar funil…</option>
          {(funis ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Para etapa" hint="Dispara quando o lead ENTRA nesta etapa">
        <Select
          size="sm"
          value={(data.config.paraEtapa as string) ?? ''}
          disabled={!data.config.funil}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, paraEtapa: e.target.value || undefined } }))
          }
        >
          <option value="">
            {data.config.funil ? 'Selecionar etapa…' : 'Escolha o funil primeiro'}
          </option>
          {etapasDoFunil(data.config.funil as string | undefined).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="De etapa (opcional)"
        hint="Só dispara se veio desta etapa. Vazio = qualquer origem"
      >
        <Select
          size="sm"
          value={(data.config.deEtapa as string) ?? ''}
          disabled={!data.config.funil}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, deEtapa: e.target.value || undefined } }))
          }
        >
          <option value="">Qualquer origem</option>
          {etapasDoFunil(data.config.funil as string | undefined).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
