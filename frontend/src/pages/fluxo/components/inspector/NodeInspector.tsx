import { Play, Trash2 } from 'lucide-react';
import { Button, Badge, IconButton, Input, Select, Textarea, Field } from '@/components/ui';
import {
  type TriggerTipo,
  type AcaoTipo,
  type NodePayload,
  type FlowNode,
} from '@/pages/fluxo/lib/types';
import { TRIGGER_LABEL, ACAO_LABEL, TIPO_LABEL, isManualTrigger } from '@/pages/fluxo/lib/metadata';
import { useInspectorData } from '@/pages/fluxo/hooks/useInspectorData';
import { CondicaoEditor } from './CondicaoEditor';
import { WebhookTriggerConfig } from './WebhookTriggerConfig';
import { CronTriggerConfig } from './CronTriggerConfig';
import { LeadEtapaTriggerForm } from './LeadEtapaTriggerForm';
import { DelayForm } from './DelayForm';
import { WhatsAppActionForm } from './WhatsAppActionForm';
import { EmailActionForm } from './EmailActionForm';
import { MoverLeadEtapaForm } from './MoverLeadEtapaForm';
import { CriarTarefaForm } from './CriarTarefaForm';
import { WebhookExternoForm } from './WebhookExternoForm';
import { MudarTagForm } from './MudarTagForm';
import { ConversarIaForm } from './ConversarIaForm';
import { LiberarLoteForm } from './LiberarLoteForm';

/**
 * NodeInspector — dispatcher fino do painel direito.
 *
 * Header (badge do tipo + excluir + Título), seletor de tipo (gatilho/ação),
 * blocos comuns de cada tipo, e o despacho pro form certo por
 * data.tipo / data.triggerTipo / data.acaoTipo. Fecha com o <details>
 * "Config (avançado)" (JSON cru). Props idênticas às de antes.
 *
 * ⚠️ FRONTEIRA: forms config-only recebem só (data, onUpdate, +listas). O
 * CondicaoEditor mexe em SAÍDAS (que afetam ARESTAS) → recebe os callbacks
 * edge-aware onRemoveSaida/onRenameSaida/onChangeModo. Não misturar.
 */
export function NodeInspector({
  node,
  onUpdate,
  onDelete,
  onRemoveSaida,
  onRenameSaida,
  onChangeModo,
  onDisparar,
}: {
  node: FlowNode;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  onDelete: () => void;
  onRemoveSaida: (valor: string) => void;
  onRenameSaida: (antigo: string, novo: string) => void;
  onChangeModo: (novoModo: string) => void;
  onDisparar: () => void;
}) {
  const { data } = node;
  const { tags, prompts, funis, usuarios, variaveis, contatosWa, etapasOpts, etapasDoFunil } =
    useInspectorData();

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <Badge variant="neutral">{TIPO_LABEL[data.tipo]}</Badge>
          <IconButton
            aria-label="Excluir nó"
            variant="danger"
            size="sm"
            icon={<Trash2 />}
            onClick={onDelete}
          />
        </div>
        <Field label="Título" required>
          <Input
            value={data.titulo}
            onChange={(e) => onUpdate((d) => ({ ...d, titulo: e.target.value }))}
          />
        </Field>
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        {data.tipo === 'TRIGGER' && (
          <Field label="Tipo de gatilho">
            <Select
              size="sm"
              value={data.triggerTipo ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, triggerTipo: (e.target.value || undefined) as TriggerTipo | undefined }))
              }
            >
              <option value="">Manual (disparo na mão)</option>
              {(Object.keys(TRIGGER_LABEL) as TriggerTipo[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {/* Trigger Manual — descrição (documentação) + botão Disparar agora. */}
        {data.tipo === 'TRIGGER' && isManualTrigger(data) && (
          <>
            <Field
              label="Descrição"
              hint="Quando o operador deve disparar esse fluxo (documentação)"
            >
              <Textarea
                rows={2}
                value={(data.config.descricao as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, descricao: e.target.value } }))
                }
                placeholder="Ex: rodar quando o lote de prospecção do dia estiver pronto"
              />
            </Field>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Play className="h-3.5 w-3.5" />}
              onClick={onDisparar}
              data-testid="trigger-manual-disparar"
            >
              Disparar agora
            </Button>
            <p className="text-[11px] text-muted">
              Roda o fluxo inteiro na hora (salva sozinho antes). Não pede lead — ideal pra fluxos
              de lote. Acompanhe o resultado em <strong>Fluxos › "ver erros"</strong>.
            </p>
          </>
        )}

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'MENSAGEM_CANAL' && (
          <p className="text-[11px] text-muted">
            O fluxo recebe <code className="text-text">{'{{canal}}'}</code>{' '}
            (whatsapp/instagram/...). Use um nó <strong>Condição</strong> com campo{' '}
            <code className="text-text">canal</code> pra rotear por canal.
          </p>
        )}

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'WEBHOOK_RECEBIDO' && (
          <WebhookTriggerConfig />
        )}

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'CRON_AGENDADO' && (
          <CronTriggerConfig config={data.config} onUpdate={onUpdate} />
        )}

        {data.tipo === 'TRIGGER' && data.triggerTipo === 'LEAD_ETAPA_MUDOU' && (
          <LeadEtapaTriggerForm
            data={data}
            onUpdate={onUpdate}
            funis={funis}
            etapasDoFunil={etapasDoFunil}
          />
        )}

        {data.tipo === 'ACAO' && (
          <Field label="Tipo de ação">
            <Select
              size="sm"
              value={data.acaoTipo ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, acaoTipo: (e.target.value || undefined) as AcaoTipo | undefined }))
              }
            >
              <option value="">Selecionar…</option>
              {(Object.keys(ACAO_LABEL) as AcaoTipo[]).map((t) => (
                <option key={t} value={t}>
                  {ACAO_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {data.tipo === 'DELAY' && <DelayForm data={data} onUpdate={onUpdate} />}

        {data.tipo === 'CONDICAO' && (
          <CondicaoEditor
            data={data}
            onUpdate={onUpdate}
            variaveis={variaveis}
            onRemoveSaida={onRemoveSaida}
            onRenameSaida={onRenameSaida}
            onChangeModo={onChangeModo}
          />
        )}

        {data.acaoTipo === 'ENVIAR_WHATSAPP' && (
          <WhatsAppActionForm data={data} onUpdate={onUpdate} contatosWa={contatosWa} />
        )}

        {data.acaoTipo === 'ENVIAR_EMAIL' && (
          <EmailActionForm data={data} onUpdate={onUpdate} usuarios={usuarios} />
        )}

        {data.acaoTipo === 'MOVER_LEAD_ETAPA' && (
          <MoverLeadEtapaForm data={data} onUpdate={onUpdate} etapasOpts={etapasOpts} />
        )}

        {data.acaoTipo === 'CRIAR_TAREFA' && (
          <CriarTarefaForm data={data} onUpdate={onUpdate} usuarios={usuarios} />
        )}

        {data.acaoTipo === 'WEBHOOK_EXTERNO' && (
          <WebhookExternoForm data={data} onUpdate={onUpdate} />
        )}

        {data.acaoTipo === 'MUDAR_TAG' && (
          <MudarTagForm data={data} onUpdate={onUpdate} tags={tags} />
        )}

        {data.acaoTipo === 'CONVERSAR_IA' && (
          <ConversarIaForm data={data} onUpdate={onUpdate} prompts={prompts} />
        )}

        {data.acaoTipo === 'LIBERAR_LOTE' && (
          <LiberarLoteForm data={data} onUpdate={onUpdate} etapasOpts={etapasOpts} tags={tags} />
        )}

        {/* Raw config debug — colapsado */}
        <details className="mt-3 text-xs">
          <summary className="text-muted cursor-pointer select-none">Config (avançado)</summary>
          <pre className="mt-2 p-2 rounded-md bg-bg border border-border overflow-x-auto font-mono text-[10px]">
            {JSON.stringify(data.config, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
