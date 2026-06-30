import { Input, Select, Textarea, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorContatoWa } from '@/pages/fluxo/hooks/useInspectorData';
import { WhatsAppMidiaAnexo } from './WhatsAppMidiaAnexo';

/** ENVIAR_WHATSAPP — destinatário (lead/número/contato salvo) + mensagem. */
export function WhatsAppActionForm({
  data,
  onUpdate,
  contatosWa,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  contatosWa: InspectorContatoWa[] | null;
}) {
  return (
    <>
      <Field label="Destinatário">
        <Select
          size="sm"
          value={(data.config.destinatarioModo as string) ?? 'lead'}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, destinatarioModo: e.target.value },
            }))
          }
        >
          <option value="lead">Lead / cliente da conversa</option>
          <option value="numero">Número específico</option>
          <option value="contato">Contato salvo (inbox)</option>
        </Select>
      </Field>
      {(data.config.destinatarioModo as string) === 'numero' && (
        <Field label="Número (com DDI)" hint="Ex: +55 11 99999-9999">
          <Input
            value={(data.config.destinatarioNumero as string) ?? ''}
            onChange={(e) =>
              onUpdate((d) => ({
                ...d,
                config: { ...d.config, destinatarioNumero: e.target.value },
              }))
            }
            placeholder="+55 11 99999-9999"
          />
        </Field>
      )}
      {(data.config.destinatarioModo as string) === 'contato' && (
        <Field label="Contato" hint="Contatos e grupos de WhatsApp da inbox">
          <Select
            size="sm"
            value={(data.config.destinatarioContato as string) ?? ''}
            onChange={(e) =>
              onUpdate((d) => ({
                ...d,
                config: { ...d.config, destinatarioContato: e.target.value },
              }))
            }
          >
            <option value="">Selecionar…</option>
            {/* Preserva o contato salvo mesmo se a lista ainda não carregou. */}
            {(data.config.destinatarioContato as string) &&
              !(contatosWa ?? []).some(
                (c) => c.id === (data.config.destinatarioContato as string),
              ) && (
                <option value={data.config.destinatarioContato as string}>
                  {data.config.destinatarioContato as string}
                </option>
              )}
            {(contatosWa ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.tipo === 'GRUPO' ? `Grupo · ${c.nome}` : `${c.nome} · ${c.id}`}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        label={data.config.midia ? 'Legenda' : 'Mensagem'}
        hint="Use {{nome}}, {{empresa}} pra variáveis"
      >
        <Textarea
          rows={data.config.midia ? 3 : 5}
          value={(data.config.mensagem as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, mensagem: e.target.value } }))
          }
          placeholder="Olá {{nome}}, tudo bem?"
        />
      </Field>
      <WhatsAppMidiaAnexo data={data} onUpdate={onUpdate} />
    </>
  );
}
