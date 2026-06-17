import { Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/** DELAY — quantidade + unidade (minutos/horas/dias). */
export function DelayForm({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  return (
    <>
      <Field label="Aguardar quantidade">
        <Input
          type="number"
          min={1}
          value={(data.config.quantidade as number) ?? 1}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, quantidade: Number(e.target.value) } }))
          }
        />
      </Field>
      <Field label="Unidade">
        <Select
          size="sm"
          value={(data.config.unidade as string) ?? 'minutos'}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, unidade: e.target.value } }))
          }
        >
          <option value="minutos">minutos</option>
          <option value="horas">horas</option>
          <option value="dias">dias</option>
        </Select>
      </Field>
    </>
  );
}
