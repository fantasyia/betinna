import { Input, Select, Textarea, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorUsuario } from '@/pages/fluxo/hooks/useInspectorData';

/** CRIAR_TAREFA — título + descrição + responsável + prazo (dias a partir de hoje). */
export function CriarTarefaForm({
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
      <Field label="Título da tarefa" hint="Aceita {{nome}}, {{cidade}}…">
        <Input
          value={(data.config.titulo as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, titulo: e.target.value } }))
          }
        />
      </Field>
      <Field label="Descrição (opcional)">
        <Textarea
          rows={3}
          value={(data.config.descricao as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, descricao: e.target.value } }))
          }
        />
      </Field>
      <Field label="Responsável" hint="Vazio = rep do cliente / admin">
        <Select
          size="sm"
          value={(data.config.responsavelId as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, responsavelId: e.target.value || undefined },
            }))
          }
        >
          <option value="">Automático (rep do cliente)</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Prazo (dias a partir de hoje)" hint="0 = hoje">
        <Input
          type="number"
          min={0}
          value={(data.config.diasApartirDeHoje as number) ?? 0}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, diasApartirDeHoje: Number(e.target.value) },
            }))
          }
        />
      </Field>
    </>
  );
}
