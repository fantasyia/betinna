import { Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/** WEBHOOK_EXTERNO — URL + método HTTP. */
export function WebhookExternoForm({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  return (
    <>
      <Field label="URL">
        <Input
          placeholder="https://exemplo.com/hook"
          value={(data.config.url as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, url: e.target.value } }))
          }
        />
      </Field>
      <Field label="Método">
        <Select
          size="sm"
          value={(data.config.method as string) ?? 'POST'}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, method: e.target.value } }))
          }
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
        </Select>
      </Field>
    </>
  );
}
