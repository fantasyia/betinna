import { Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorUsuario } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * ATRIBUIR_REP — define o representante dono do lead.
 * A ação estava na paleta SEM formulário: o config ficava vazio, o runtime não
 * achava representanteId e o nó concluía sem atribuir ninguém (silencioso).
 */
export function AtribuirRepForm({
  data,
  onUpdate,
  usuarios,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  usuarios: InspectorUsuario[];
}) {
  const set = (chave: string, valor: string | undefined) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, [chave]: valor || undefined } }));

  // Só quem carrega carteira pode ser dono do lead.
  const reps = usuarios.filter((u) => u.role === 'REP' || u.role === 'GERENTE');
  const escolhido = (data.config.representanteId as string) ?? '';

  return (
    <>
      <Field
        label="Representante"
        hint="O lead passa a pertencer a esta pessoa (aparece na carteira dela)."
      >
        <Select
          size="sm"
          data-testid="atribuir-rep"
          value={escolhido}
          onChange={(e) => set('representanteId', e.target.value)}
        >
          <option value="">Selecione…</option>
          {reps.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome} ({u.role})
            </option>
          ))}
        </Select>
      </Field>

      {!escolhido && (
        <p className="text-xs text-warning leading-snug mt-1">
          ⚠ Sem representante escolhido o fluxo falha neste passo — escolha alguém antes de ativar.
        </p>
      )}
    </>
  );
}
