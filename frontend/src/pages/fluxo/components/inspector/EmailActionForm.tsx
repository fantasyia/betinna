import { Input, Textarea, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorUsuario } from '@/pages/fluxo/hooks/useInspectorData';
import { DestinatariosField } from './DestinatariosField';

/** ENVIAR_EMAIL — destinatários (via DestinatariosField) + assunto + corpo HTML. */
export function EmailActionForm({
  data,
  onUpdate,
  usuarios,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  usuarios: InspectorUsuario[];
}) {
  return (
    <>
      <DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />
      <Field label="Assunto">
        <Input
          value={(data.config.assunto as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, assunto: e.target.value } }))
          }
        />
      </Field>
      <Field label="Corpo HTML">
        <Textarea
          rows={6}
          value={(data.config.corpo as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, corpo: e.target.value } }))
          }
        />
      </Field>
    </>
  );
}
