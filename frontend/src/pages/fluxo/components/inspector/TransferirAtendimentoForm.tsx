import { Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorUsuario } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * TRANSFERIR_ATENDIMENTO — passa a conversa do bot pro humano (atrito zero).
 * O atendente é OPCIONAL: escolhido = vai direto pra ele; vazio = cai na FILA e
 * notifica o SAC (mais resiliente com 1 atendente — não trava se a pessoa sair).
 */
export function TransferirAtendimentoForm({
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

  // Atendentes elegíveis: quem opera atendimento (exclui REP, que só vê o WhatsApp dele).
  const atendentes = usuarios.filter((u) => u.role !== 'REP');

  return (
    <>
      <Field
        label="Atendente"
        hint="Deixe em branco pra jogar na FILA (o SAC é notificado e quem estiver livre assume)."
      >
        <Select
          size="sm"
          data-testid="transf-atendente"
          value={(data.config.atendenteId as string) ?? ''}
          onChange={(e) => set('atendenteId', e.target.value)}
        >
          <option value="">Fila (notifica o SAC)</option>
          {atendentes.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome} ({u.role})
            </option>
          ))}
        </Select>
      </Field>

      <p className="text-xs text-muted leading-snug mt-1">
        Ao transferir: o bot é <strong>pausado</strong> nessa conversa (não responde junto do
        humano), a conversa vai pra <strong>Pós-venda</strong> e o destino é notificado. O cliente
        continua no mesmo número.
      </p>
    </>
  );
}
