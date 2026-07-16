import { Input, Select, Field } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { NodePayload } from '@/pages/fluxo/lib/types';
import type { InspectorEtapaOpt, InspectorTag } from '@/pages/fluxo/hooks/useInspectorData';

/** LIBERAR_LOTE — move N leads de uma etapa de origem pra destino, com filtros. */
export function LiberarLoteForm({
  data,
  onUpdate,
  etapasOpts,
  tags,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  etapasOpts: InspectorEtapaOpt[];
  tags: InspectorTag[] | null;
}) {
  return (
    <>
      <Field label="Etapa de origem">
        <Select
          size="sm"
          value={(data.config.etapaOrigemId as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, etapaOrigemId: e.target.value } }))
          }
        >
          <option value="">Selecionar…</option>
          {etapasOpts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Etapa de destino">
        <Select
          size="sm"
          value={(data.config.etapaDestinoId as string) ?? ''}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, etapaDestinoId: e.target.value } }))
          }
        >
          <option value="">Selecionar…</option>
          {etapasOpts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Quantidade"
        hint="Quantos liberar por execução — ou o MÁXIMO na etapa de destino (veja abaixo)"
      >
        <Input
          type="number"
          min={1}
          max={500}
          value={(data.config.quantidade as number) ?? 50}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, quantidade: Number(e.target.value) },
            }))
          }
        />
      </Field>
      <Field
        label="Validar capacidade da etapa de destino"
        hint="Trata a quantidade como o MÁXIMO na etapa de destino: só libera quando um lead SAIR de lá. Ex: 1 = mantém 1 lead na abordagem por vez."
      >
        <Select
          data-testid="liberar-respeitar-capacidade"
          value={(data.config.respeitarCapacidadeDestino as boolean | undefined) ? 'sim' : 'nao'}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, respeitarCapacidadeDestino: e.target.value === 'sim' },
            }))
          }
        >
          <option value="nao">Não — quantidade é só o lote por execução</option>
          <option value="sim">Sim — não exceder a quantidade na etapa de destino</option>
        </Select>
      </Field>
      <Field label="Critério de ordem" hint="Em que ordem os leads saem da origem">
        <Select
          size="sm"
          value={(data.config.criterioOrdem as string) ?? 'antigos'}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, criterioOrdem: e.target.value } }))
          }
        >
          <option value="antigos">Mais antigos primeiro</option>
          <option value="novos">Mais novos primeiro</option>
          <option value="custom">Por campo customizado</option>
        </Select>
      </Field>
      {(data.config.criterioOrdem as string) === 'custom' && (
        <div className="flex gap-2">
          <Field label="Campo (variável)" hint="ex: prioridade_leo">
            <Input
              value={(data.config.campoOrdem as string) ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, config: { ...d.config, campoOrdem: e.target.value } }))
              }
              placeholder="prioridade_leo"
            />
          </Field>
          <Field label="Direção">
            <Select
              size="sm"
              value={(data.config.ordemDir as string) ?? 'asc'}
              onChange={(e) =>
                onUpdate((d) => ({ ...d, config: { ...d.config, ordemDir: e.target.value } }))
              }
            >
              <option value="asc">Crescente (ASC)</option>
              <option value="desc">Decrescente (DESC)</option>
            </Select>
          </Field>
        </div>
      )}
      <Field
        label="Só leads com tag"
        hint="Clique pra marcar — só entram leads com QUALQUER uma delas (vazio = todos; ex: Reaquecer + Sem Resposta no cron de reaquecimento)"
      >
        <div className="flex flex-wrap gap-1.5">
          {(tags ?? []).length === 0 && (
            <span className="text-[11px] text-muted">Nenhuma tag cadastrada</span>
          )}
          {(tags ?? []).map((t) => {
            const sel = ((data.config.filtroComTag as string[]) ?? []).includes(t.nome);
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`lote-comtag-${t.id}`}
                onClick={() =>
                  onUpdate((d) => {
                    const atual = (d.config.filtroComTag as string[]) ?? [];
                    const next = atual.includes(t.nome)
                      ? atual.filter((n) => n !== t.nome)
                      : [...atual, t.nome];
                    return { ...d, config: { ...d.config, filtroComTag: next } };
                  })
                }
                className={cn(
                  'text-[11px] px-2 py-1 rounded-md border transition-colors',
                  sel
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-text border-border hover:border-border-strong',
                )}
              >
                {t.nome}
              </button>
            );
          })}
        </div>
      </Field>
      <Field
        label="Excluir leads com tag"
        hint="Clique pra marcar — leads com qualquer uma são ignorados (ex: pausado)"
      >
        <div className="flex flex-wrap gap-1.5">
          {(tags ?? []).length === 0 && (
            <span className="text-[11px] text-muted">Nenhuma tag cadastrada</span>
          )}
          {(tags ?? []).map((t) => {
            const sel = ((data.config.filtroExcluiTag as string[]) ?? []).includes(t.nome);
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`lote-excluitag-${t.id}`}
                onClick={() =>
                  onUpdate((d) => {
                    const atual = (d.config.filtroExcluiTag as string[]) ?? [];
                    const next = atual.includes(t.nome)
                      ? atual.filter((n) => n !== t.nome)
                      : [...atual, t.nome];
                    return { ...d, config: { ...d.config, filtroExcluiTag: next } };
                  })
                }
                className={cn(
                  'text-[11px] px-2 py-1 rounded-md border transition-colors',
                  sel
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-text border-border hover:border-border-strong',
                )}
              >
                {t.nome}
              </button>
            );
          })}
        </div>
      </Field>
      <Field
        label="Só liberar leads com WhatsApp"
        hint="Pula leads sem número — não joga na etapa de abordagem quem a IA não consegue contatar"
      >
        <Select
          value={(data.config.filtroSoComWhatsapp as boolean | undefined) ? 'sim' : 'nao'}
          onChange={(e) =>
            onUpdate((d) => ({
              ...d,
              config: { ...d.config, filtroSoComWhatsapp: e.target.value === 'sim' },
            }))
          }
        >
          <option value="nao">Não — libera todos da etapa</option>
          <option value="sim">Sim — só quem tem número de WhatsApp</option>
        </Select>
      </Field>
    </>
  );
}
