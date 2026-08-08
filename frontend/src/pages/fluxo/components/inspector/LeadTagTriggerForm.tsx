import { Select, Field, Input } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorTag } from '@/pages/fluxo/hooks/useInspectorData';

type Modo = 'exato' | 'prefixo' | 'contem';

/**
 * LEAD_RECEBEU_TAG (trigger) — QUAL etiqueta dispara o fluxo.
 *
 * Antes não havia filtro nenhum: o fluxo rodava a cada etiqueta aplicada a
 * qualquer lead. Com etiqueta-DIMENSÃO (`publico:comercio`, `setor:cadeia-do-frio`)
 * isso mandava a régua de um setor pra todos os outros, em silêncio.
 *
 * `exato` é o default de propósito — `contem` colide entre slugs parecidos
 * ("varejo" casa "varejo-alimentar"). `prefixo` é o modo das famílias: pega a
 * dimensão inteira ("setor:").
 */
export function LeadTagTriggerForm({
  data,
  onUpdate,
  tags,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  tags: InspectorTag[] | null;
}) {
  const modo = ((data.config.modo as Modo) ?? 'exato') as Modo;
  const tagNome = (data.config.tagNome as string) ?? '';

  return (
    <>
      <Field
        label="Comparação"
        hint={
          modo === 'exato'
            ? 'Só a etiqueta escolhida — sem risco de casar parecida'
            : modo === 'prefixo'
              ? 'Família inteira: qualquer etiqueta que COMECE com o texto (ex: "setor:")'
              : '⚠️ Trecho em qualquer posição — "varejo" também casa "varejo-alimentar"'
        }
      >
        <Select
          size="sm"
          value={modo}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              // trocar o modo limpa o alvo: escolher da lista e digitar prefixo
              // são coisas diferentes, e um valor herdado casaria errado calado.
              config: { ...d.config, modo: e.target.value as Modo, tagNome: undefined },
            }))
          }
        >
          <option value="exato">Etiqueta exata</option>
          <option value="prefixo">Começa com (família de etiquetas)</option>
          <option value="contem">Contém o trecho</option>
        </Select>
      </Field>

      {modo === 'exato' ? (
        <Field label="Etiqueta" hint="Vazio = qualquer etiqueta dispara o fluxo">
          <Select
            size="sm"
            data-testid="tag-trigger-nome-select"
            value={tagNome}
            onChange={(e) =>
              onUpdate((d) => ({
                ...d,
                config: { ...d.config, tagNome: e.target.value || undefined },
              }))
            }
          >
            <option value="">Qualquer etiqueta</option>
            {/* Preserva uma etiqueta salva que não esteja (mais) na lista. */}
            {tagNome && !(tags ?? []).some((t) => t.nome === tagNome) && (
              <option value={tagNome}>{tagNome}</option>
            )}
            {(tags ?? []).map((t) => (
              <option key={t.id} value={t.nome}>
                {t.nome}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field
          label={modo === 'prefixo' ? 'Começa com' : 'Contém'}
          hint="Vazio = qualquer etiqueta dispara o fluxo"
        >
          <Input
            data-testid="tag-trigger-nome-input"
            value={tagNome}
            placeholder={modo === 'prefixo' ? 'setor:' : 'frio'}
            onChange={(e) =>
              onUpdate((d) => ({
                ...d,
                config: { ...d.config, tagNome: e.target.value || undefined },
              }))
            }
          />
        </Field>
      )}
    </>
  );
}
