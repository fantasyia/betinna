import { Select, Textarea, Checkbox, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';

/**
 * MENSAGEM_CANAL (trigger) — dispara quando chega mensagem no canal.
 *
 * Sem palavras-chave: dispara em TODA mensagem (comportamento legado, roteie por
 * {{canal}} num nó Condição). Com palavras-chave: só dispara quando o texto casa.
 * Config lida pelo backend em fluxo-event-bus (match em memória, sem regex).
 */
export function MensagemCanalTriggerForm({
  data,
  onUpdate,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  const palavras = (data.config.palavrasChave as string[] | undefined) ?? [];
  const modo = (data.config.modo as string | undefined) ?? 'qualquer';

  return (
    <>
      <Field
        label="Palavras-chave (uma por linha)"
        hint="Vazio = dispara em toda mensagem. Preenchido = só quando o texto casa."
      >
        <Textarea
          rows={3}
          value={palavras.join('\n')}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: {
                ...d.config,
                palavrasChave: e.target.value
                  .split('\n')
                  .map((p) => p.trim())
                  .filter(Boolean),
              },
            }))
          }
          placeholder={'cancelar\nquero comprar\n2ª via'}
        />
      </Field>

      {palavras.length > 0 && (
        <>
          <Field label="Como casar" hint="qualquer = ≥1 palavra · todas = todas · exata = texto inteiro">
            <Select
              size="sm"
              value={modo}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, config: { ...d.config, modo: e.target.value } }))
              }
            >
              <option value="qualquer">Qualquer palavra (contém)</option>
              <option value="todas">Todas as palavras</option>
              <option value="exata">Texto exato</option>
            </Select>
          </Field>

          <Checkbox
            label="Diferenciar maiúsculas/minúsculas"
            checked={data.config.caseSensitive === true}
            onChange={(e) =>
              onUpdate((d) => ({ ...d, config: { ...d.config, caseSensitive: e.target.checked } }))
            }
          />
          <Checkbox
            label="Ignorar acentos (2ª via ≈ 2a via)"
            checked={data.config.normalizarAcentos !== false}
            onChange={(e) =>
              onUpdate((d) => ({
                ...d,
                config: { ...d.config, normalizarAcentos: e.target.checked },
              }))
            }
          />
        </>
      )}

      <Checkbox
        label="Só disparar se for um lead conhecido"
        checked={data.config.apenasComLead === true}
        onChange={(e) =>
          onUpdate((d) => ({ ...d, config: { ...d.config, apenasComLead: e.target.checked } }))
        }
      />

      <Checkbox
        label="Só disparar se AINDA NÃO for lead (triagem)"
        checked={data.config.apenasSemLead === true}
        onChange={(e) =>
          onUpdate((d) => ({ ...d, config: { ...d.config, apenasSemLead: e.target.checked } }))
        }
      />

      <p className="text-[11px] text-muted">
        Disponível nas ações: <code className="text-text">{'{{canal}}'}</code> e{' '}
        <code className="text-text">{'{{texto}}'}</code>. Pra rotear por canal, use um nó{' '}
        <strong>Condição</strong> com campo <code className="text-text">canal</code>.
      </p>
    </>
  );
}
