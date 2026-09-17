import { Input, Select, Textarea, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type {
  InspectorContatoWa,
  InspectorUsuario,
} from '@/pages/fluxo/hooks/useInspectorData';
import { WhatsAppMidiaAnexo } from './WhatsAppMidiaAnexo';

/** ENVIAR_WHATSAPP — destinatário (lead/número/contato salvo) + mensagem. */
export function WhatsAppActionForm({
  data,
  onUpdate,
  contatosWa,
  usuarios,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  contatosWa: InspectorContatoWa[] | null;
  usuarios?: InspectorUsuario[];
}) {
  const modo = (data.config.destinatarioModo as string) ?? 'lead';
  const remetente = (data.config.remetenteUsuarioId as string) ?? '';
  return (
    <>
      <Field label="Destinatário">
        <Select
          size="sm"
          data-testid="wa-destinatario"
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
            data-testid="wa-contato"
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

      {/* De QUAL número sai. O app deixa cada rep conectar o WhatsApp pessoal, e
          o fluxo pode falar por ele — sem isto, conversa que chega no celular do
          rep era respondida pelo número da empresa e o cliente via dois números
          na mesma conversa. */}
      <Field
        label="Enviar pelo número de"
        hint={
          remetente
            ? 'Sai pelo WhatsApp pessoal deste usuário. Se ele não estiver conectado, o passo FALHA — não cai pro número da empresa (sairia do remetente errado).'
            : modo === 'lead'
              ? 'Automático: responde pelo mesmo número que recebeu a mensagem — o WhatsApp pessoal do rep quando a conversa chegou por ele, senão o da empresa.'
              : 'Número da empresa. Destinatário fixo (número/contato) é aviso interno — não sai do celular de um rep, a não ser que você escolha abaixo.'
        }
      >
        <Select
          size="sm"
          data-testid="wa-remetente"
          value={remetente}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, remetenteUsuarioId: e.target.value || undefined },
            }))
          }
        >
          <option value="">Automático (recomendado)</option>
          {(usuarios ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome} · {u.role}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Espera antes de enviar (s)"
        hint={
          'Vazio = herda a Persona Bot (o mesmo ritmo do bot). Preencha só pra este nó ' +
          'destoar: a espera da persona foi calibrada pra IA, que leva 5–13s só pra escrever — ' +
          'aqui ela é a espera inteira. Use 0 pra mandar na hora (aviso interno, por exemplo).'
        }
      >
        <Input
          type="number"
          min={0}
          max={60}
          placeholder="herda da persona"
          value={
            typeof data.config.delaySegundos === 'number' ? String(data.config.delaySegundos) : ''
          }
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: {
                ...d.config,
                // Vazio vira `undefined` (= herda). `0` é valor válido e
                // PRECISA sobreviver — é "manda na hora" escolhido de propósito.
                delaySegundos:
                  e.target.value === ''
                    ? undefined
                    : Math.min(60, Math.max(0, Number(e.target.value))),
              },
            }))
          }
          onWheel={(e) => e.currentTarget.blur()}
          data-testid="wa-delay-segundos"
        />
      </Field>

      <Field
        label='Mostrar "digitando…"'
        hint="Vazio = herda a Persona Bot."
      >
        <Select
          size="sm"
          data-testid="wa-mostrar-digitando"
          value={
            typeof data.config.mostrarDigitando === 'boolean'
              ? String(data.config.mostrarDigitando)
              : ''
          }
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: {
                ...d.config,
                mostrarDigitando: e.target.value === '' ? undefined : e.target.value === 'true',
              },
            }))
          }
        >
          <option value="">Herda da persona</option>
          <option value="true">Sim</option>
          <option value="false">Não (espera calada)</option>
        </Select>
      </Field>
    </>
  );
}
