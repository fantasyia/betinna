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
      {/* 23/10: lead sem e-mail segue a régua em vez de parar o fluxo com erro. */}
      <label className="flex items-start gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid="email-sem-email-pular"
          checked={data.config.semEmail === 'pular'}
          onChange={(e) =>
            onUpdate((d) => {
              const { semEmail: _s, ...resto } = d.config as Record<string, unknown>;
              return { ...d, config: e.target.checked ? { ...resto, semEmail: 'pular' } : resto };
            })
          }
        />
        <span>
          Sem e-mail, pular este envio e seguir o fluxo
          <small className="block text-muted">
            Desmarcado, o fluxo para com erro quando o contato não tem e-mail.
          </small>
        </span>
      </label>
    </>
  );
}
