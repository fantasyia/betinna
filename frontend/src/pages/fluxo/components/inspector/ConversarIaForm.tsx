import { Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorPrompt } from '@/pages/fluxo/hooks/useInspectorData';

/** CONVERSAR_IA — prompt + aguardar resposta + timeout + variáveis que a IA grava. */
export function ConversarIaForm({
  data,
  onUpdate,
  prompts,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  prompts: InspectorPrompt[] | null;
}) {
  return (
    <>
      <Field label="Prompt" hint="Da biblioteca de prompts. Vazio = prompt padrão da empresa.">
        <Select
          size="sm"
          value={(data.config.promptId as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, promptId: e.target.value || undefined },
            }))
          }
        >
          <option value="">Prompt padrão da empresa</option>
          {(prompts ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.isPadrao ? ' (padrão)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Aguardar resposta do lead?">
        <Select
          size="sm"
          value={((data.config.aguardarResposta as boolean | undefined) ?? true) ? 'sim' : 'nao'}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, aguardarResposta: e.target.value === 'sim' },
            }))
          }
        >
          <option value="sim">Sim — pausa até o lead responder</option>
          <option value="nao">Não — segue o fluxo</option>
        </Select>
      </Field>
      <Field label="Timeout (horas)">
        <Input
          type="number"
          min={1}
          value={(data.config.timeoutHoras as number) ?? 24}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, timeoutHoras: Number(e.target.value) },
            }))
          }
        />
      </Field>
      {(data.config.aguardarResposta as boolean | undefined) !== false &&
        Number(data.config.timeoutHoras ?? 0) > 0 && (
          <p className="text-[11px] text-muted">
            Com timeout, o nó tem <strong>2 saídas</strong> no canvas: 🟢{' '}
            <strong>classificou</strong> (IA concluiu) e 🟠 <strong>timeout</strong> (passou o
            prazo sem resposta) — conecte cada uma a um caminho.
          </p>
        )}
      <Field
        label="Variáveis que a IA pode gravar"
        hint="Separe por vírgula (ex: classificacao, canal). Vazio = livre."
      >
        <Input
          value={
            Array.isArray(data.config.variaveisGravadas)
              ? (data.config.variaveisGravadas as string[]).join(', ')
              : ''
          }
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: {
                ...d.config,
                variaveisGravadas: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            }))
          }
          placeholder="classificacao, canal, potencial_pedidos"
        />
      </Field>
    </>
  );
}
