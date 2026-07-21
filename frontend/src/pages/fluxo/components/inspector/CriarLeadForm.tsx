import { Input, Select, Field } from '@/components/ui';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapaOpt } from '@/pages/fluxo/hooks/useInspectorData';

/**
 * CRIAR_LEAD — vira lead a conversa de WhatsApp (a triagem).
 *
 * O inbound de WhatsApp não cria lead nenhum. Este bloco é o que promove a
 * conversa a lead HERDANDO a campanha que a trouxe (Click-to-WhatsApp).
 */
export function CriarLeadForm({
  data,
  onUpdate,
  etapasOpts,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  etapasOpts: InspectorEtapaOpt[];
}) {
  const set = (chave: string, valor: string | undefined) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, [chave]: valor || undefined } }));

  return (
    <>
      <Field
        label="Etapa onde o lead nasce"
        hint="Normalmente a primeira etapa do funil de triagem."
      >
        <Select
          size="sm"
          data-testid="criar-lead-etapa"
          value={(data.config.funilEtapaId as string) ?? ''}
          onChange={(e) => set('funilEtapaId', e.target.value)}
        >
          <option value="">Selecionar etapa…</option>
          {etapasOpts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Tag no lead criado"
        hint="Opcional. Útil pra separar o que entrou pela triagem."
      >
        <Input
          size="sm"
          data-testid="criar-lead-tag"
          value={(data.config.tagNome as string) ?? ''}
          onChange={(e) => set('tagNome', e.target.value)}
          placeholder="Ex: triagem-whatsapp"
        />
      </Field>

      <p className="text-xs text-muted leading-snug mt-1">
        A campanha do anúncio que trouxe a conversa é copiada pro lead automaticamente. Se o
        contato já for lead, o bloco só liga os dois — não cria duplicado.
      </p>
    </>
  );
}
