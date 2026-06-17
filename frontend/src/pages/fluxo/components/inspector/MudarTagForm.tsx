import { Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorTag } from '@/pages/fluxo/hooks/useInspectorData';

/** MUDAR_TAG — operação (adicionar/remover) + tag escolhida da lista. */
export function MudarTagForm({
  data,
  onUpdate,
  tags,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  tags: InspectorTag[] | null;
}) {
  return (
    <>
      <Field label="Operação">
        <Select
          size="sm"
          value={(data.config.operacao as string) ?? 'adicionar'}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, operacao: e.target.value } }))
          }
        >
          <option value="adicionar">Adicionar tag</option>
          <option value="remover">Remover tag</option>
        </Select>
      </Field>
      <Field label="Tag" hint="Escolha uma tag (sempre mostra todas ao clicar)">
        <Select
          size="sm"
          value={(data.config.tagNome as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, tagNome: e.target.value } }))
          }
        >
          <option value="">Selecionar…</option>
          {/* Preserva uma tag salva que não esteja (mais) na lista. */}
          {(data.config.tagNome as string) &&
            !(tags ?? []).some((t) => t.nome === (data.config.tagNome as string)) && (
              <option value={data.config.tagNome as string}>
                {data.config.tagNome as string}
              </option>
            )}
          {(tags ?? []).map((t) => (
            <option key={t.id} value={t.nome}>
              {t.nome}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
