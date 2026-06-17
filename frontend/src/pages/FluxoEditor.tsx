import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Play, Trash2, AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { Button, Badge, IconButton, Input, Select, Textarea, Field, FullPageSpinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  type TriggerTipo,
  type AcaoTipo,
  type FluxoDetailApi,
  type NodePayload,
  type FlowNode,
} from '@/pages/fluxo/lib/types';
import {
  TRIGGER_LABEL,
  ACAO_LABEL,
  TIPO_LABEL,
  isManualTrigger,
} from '@/pages/fluxo/lib/metadata';
import { montarCron, CRON_DIAS, CRON_TIMEZONES, type CronPreviewResp } from '@/pages/fluxo/lib/cron';
import { RESERVADOS, norm } from '@/pages/fluxo/lib/saidas';
import { NodeCard } from '@/pages/fluxo/components/NodeCard';
import { EdgeRemovivel } from '@/pages/fluxo/components/EdgeRemovivel';
import { FluxoToolbar } from '@/pages/fluxo/components/FluxoToolbar';
import { TestarFluxoModal } from '@/pages/fluxo/components/TestarFluxoModal';
import { PaletteSidebar } from '@/pages/fluxo/components/PaletteSidebar';
import { FluxoCanvas } from '@/pages/fluxo/components/FluxoCanvas';
import { useFluxoEditor } from '@/pages/fluxo/hooks/useFluxoEditor';

// Re-export dos tipos públicos (consumidos por FluxosPage / FluxoTemplatesPage).
// A fonte de verdade agora é @/pages/fluxo/lib/types — mantido aqui pra não
// quebrar quem importa de '@/pages/FluxoEditor'.
export type { FluxoNoTipo, TriggerTipo, AcaoTipo } from '@/pages/fluxo/lib/types';

/**
 * FluxoEditor — editor visual de fluxos de automação com React Flow.
 *
 * Layout (3 colunas):
 *  - Esquerda (palette): GATILHOS / CONDIÇÕES / AÇÕES / TEMPO — drag pro canvas
 *  - Centro (canvas): React Flow com nós custom e edges
 *  - Direita (inspector): edita props do nó selecionado
 *
 * Persistência: PUT /fluxos/:id com `{ nos, arestas, triggerTipo }`.
 * Backend faz full-replace dos nós e arestas (per schema docs).
 */

// Componentes de canvas (NodeCard / EdgeRemovivel) e o contrato de saídas vivem
// em @/pages/fluxo/* — aqui só o registro pro React Flow.
const NODE_TYPES = { fluxo: NodeCard };
const EDGE_TYPES = { removivel: EdgeRemovivel };

// ─── Editor principal ────────────────────────────────────────────

export function FluxoEditor({
  fluxoId,
  onClose,
  onSaved,
}: {
  fluxoId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <FluxoEditorInner fluxoId={fluxoId} onClose={onClose} onSaved={onSaved} />
    </ReactFlowProvider>
  );
}

function FluxoEditorInner({
  fluxoId,
  onClose,
  onSaved,
}: {
  fluxoId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data, loading, refetch } = useApiQuery<FluxoDetailApi>(`/fluxos/${fluxoId}`);

  // Após salvar, mantém o comportamento original: avisa o pai E recarrega o fluxo.
  const handleSaved = useCallback(() => {
    onSaved?.();
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSaved]);

  // O cérebro do editor (estado + handlers + history + hidratação + save).
  const editor = useFluxoEditor({ fluxoId, data, onSaved: handleSaved });

  // Mobile: painéis viram drawers sobrepostos (só um aberto por vez). Em desktop
  // (md+) os painéis são fixos e este estado é ignorado pelo layout.
  const [mobilePanel, setMobilePanel] = useState<'palette' | 'inspector' | null>(null);
  // Teste manual — dispara o fluxo agora (do nó gatilho), sem esperar cron/evento.
  const [testarAberto, setTestarAberto] = useState(false);
  const [testLeadId, setTestLeadId] = useState('');

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-[110] bg-bg flex items-center justify-center">
        <FullPageSpinner label="Carregando fluxo…" />
      </div>
    );
  }

  const selectedNode = editor.selectedNode;

  return (
    <div className="fixed inset-0 z-[110] bg-bg flex flex-col">
      {/* Top bar */}
      <FluxoToolbar
        editor={editor}
        status={data.status}
        onClose={onClose}
        onTestar={() => setTestarAberto(true)}
        onMobilePanel={(p) => setMobilePanel((cur) => (cur === p ? null : p))}
      />

      <TestarFluxoModal
        aberto={testarAberto}
        onClose={() => setTestarAberto(false)}
        testLeadId={testLeadId}
        setTestLeadId={setTestLeadId}
        testando={editor.testando}
        onRodar={async () => {
          const ok = await editor.runTeste(testLeadId);
          if (ok) setTestarAberto(false);
        }}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Backdrop dos drawers (só mobile, quando um painel está aberto) */}
        {mobilePanel && (
          <button
            type="button"
            aria-label="Fechar painel"
            className="absolute inset-0 z-10 bg-black/40 md:hidden"
            onClick={() => setMobilePanel(null)}
          />
        )}
        {/* Palette — fixa no desktop; drawer pela esquerda no mobile */}
        <PaletteSidebar editor={editor} mobileAberto={mobilePanel === 'palette'} />

        {/* Canvas */}
        <FluxoCanvas
          editor={editor}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClickExtra={() => setMobilePanel('inspector')}
          onPaneClickExtra={() => setMobilePanel(null)}
        />

        {/* Inspector — fixo no desktop; drawer pela direita no mobile */}
        <aside
          className={`w-[88vw] max-w-[320px] md:w-[300px] shrink-0 border-l border-border bg-bg-alt overflow-y-auto
            absolute inset-y-0 right-0 z-20 shadow-xl transition-transform duration-200
            md:static md:z-auto md:shadow-none md:translate-x-0
            ${mobilePanel === 'inspector' ? 'translate-x-0' : 'translate-x-full'}`}
        >
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              onUpdate={editor.updateSelectedNode}
              onDelete={editor.deleteSelectedNode}
              onRemoveSaida={editor.removeSaidaDoNoSelecionado}
              onRenameSaida={editor.renameSaidaDoNoSelecionado}
              onChangeModo={editor.trocarModoDoNoSelecionado}
              onDisparar={editor.dispararManual}
            />
          ) : (
            <div className="p-4 text-center flex flex-col items-center gap-2 mt-8">
              <AlertCircle className="h-6 w-6 text-muted-light" />
              <p className="text-sm text-muted">Selecione um nó pra editar</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Inspector (right panel) ────────────────────────────────────

/**
 * Linha editável de uma saída do roteador. Renomeia in-place (commit no Enter/blur);
 * se o pai rejeitar (duplicado/reservado), reverte o texto pro valor anterior.
 */
function SaidaEditavel({
  valor,
  onCommit,
  onRemove,
}: {
  valor: string;
  onCommit: (novo: string) => boolean;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(valor);
  useEffect(() => {
    setDraft(valor);
  }, [valor]);
  const commit = () => {
    const v = draft.trim();
    if (!v || v === valor) {
      setDraft(valor);
      return;
    }
    if (!onCommit(v)) setDraft(valor);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="flex-1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(valor);
          }
        }}
      />
      <IconButton
        aria-label="Remover saída"
        variant="ghost"
        size="sm"
        icon={<Trash2 />}
        onClick={onRemove}
      />
    </div>
  );
}

/** Editor visual da Condição: modo Simples (true/false) ou Roteador (N saídas). */
function CondicaoEditor({
  data,
  onUpdate,
  variaveis,
  onRemoveSaida,
  onRenameSaida,
  onChangeModo,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  variaveis: Array<{ id: string; chave: string }>;
  onRemoveSaida: (valor: string) => void;
  onRenameSaida: (antigo: string, novo: string) => void;
  onChangeModo: (novoModo: string) => void;
}) {
  const toast = useToast();
  const [novaSaida, setNovaSaida] = useState('');
  const modo = (data.config.modo as string) ?? 'simples';
  const saidas = (data.config.saidas as string[]) ?? [];
  const setCfg = (patch: Record<string, unknown>) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, ...patch } }));
  // RESERVADOS / norm vêm do contrato central em @/pages/fluxo/lib/saidas.
  const valido = (v: string, ignorar?: string): boolean => {
    if (saidas.some((s) => s !== ignorar && norm(s) === norm(v))) {
      toast.error('Essa saída já existe (ignorando maiúsculas/espaços)');
      return false;
    }
    if (RESERVADOS.includes(norm(v))) {
      toast.error(`"${v}" é um nome reservado — escolha outro valor pra saída`);
      return false;
    }
    return true;
  };
  const addSaida = () => {
    const v = novaSaida.trim();
    if (!v || !valido(v)) return;
    setCfg({ saidas: [...saidas, v] });
    setNovaSaida('');
  };
  // Renomeia in-place (config + arestas via callback do pai). Retorna se aplicou —
  // a linha editável reverte o texto quando rejeitado (duplicado/reservado).
  const handleRename = (antigo: string, novo: string): boolean => {
    const v = novo.trim();
    if (!v || v === antigo) return false;
    if (!valido(v, antigo)) return false;
    onRenameSaida(antigo, v);
    return true;
  };
  return (
    <>
      <Field label="Modo">
        <Select size="sm" value={modo} onChange={(e) => onChangeModo(e.target.value)}>
          <option value="simples">Simples (Sim / Não)</option>
          <option value="roteador">Roteador (uma saída por valor)</option>
        </Select>
      </Field>
      {modo === 'roteador' ? (
        <>
          <Field
            label="Variável"
            hint="Roteia pelo valor desta variável (ex: classificacao_final)"
          >
            <div>
              <Input
                list="fluxo-variaveis"
                value={(data.config.variavel as string) ?? ''}
                onChange={(e) => setCfg({ variavel: e.target.value })}
                placeholder="classificacao_final"
              />
              <datalist id="fluxo-variaveis">
                {variaveis.map((v) => (
                  <option key={v.id} value={v.chave} />
                ))}
              </datalist>
            </div>
          </Field>
          <Field label="Saídas (valores)" hint="Cada valor vira uma saída. Há sempre a saída 'default'.">
            <div className="flex flex-col gap-1.5">
              {saidas.map((s, i) => (
                <SaidaEditavel
                  key={`${s}-${i}`}
                  valor={s}
                  onCommit={(novo) => handleRename(s, novo)}
                  onRemove={() => onRemoveSaida(s)}
                />
              ))}
              <div className="flex items-center gap-1.5">
                <Input
                  value={novaSaida}
                  onChange={(e) => setNovaSaida(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSaida();
                    }
                  }}
                  placeholder="Ex: Forte Sinergia (Enter)"
                />
                <Button type="button" size="sm" variant="secondary" onClick={addSaida}>
                  +
                </Button>
              </div>
              <span className="text-[11px] text-muted">
                No canvas, conecte cada saída (o rótulo do valor) ao próximo nó.
              </span>
            </div>
          </Field>
        </>
      ) : (
        <>
          <Field label="Variável / campo" hint="Ex: classificacao_final, lead.etapa">
            <div>
              <Input
                list="fluxo-variaveis"
                value={(data.config.campo as string) ?? ''}
                onChange={(e) => setCfg({ campo: e.target.value })}
                placeholder="classificacao_final"
              />
              <datalist id="fluxo-variaveis">
                {variaveis.map((v) => (
                  <option key={v.id} value={v.chave} />
                ))}
              </datalist>
            </div>
          </Field>
          <Field label="Operador">
            <Select
              size="sm"
              value={(data.config.operador as string) ?? 'eq'}
              onChange={(e) => setCfg({ operador: e.target.value })}
            >
              <option value="eq">= igual</option>
              <option value="neq">≠ diferente</option>
              <option value="contains">contém</option>
              <option value="gt">&gt; maior</option>
              <option value="lt">&lt; menor</option>
              <option value="gte">≥ maior ou igual</option>
              <option value="lte">≤ menor ou igual</option>
            </Select>
          </Field>
          <Field label="Valor">
            <Input
              value={((data.config.valor as string | number | undefined) ?? '').toString()}
              onChange={(e) => setCfg({ valor: e.target.value })}
            />
          </Field>
        </>
      )}
    </>
  );
}

/** Campo de destinatários do e-mail: usuário / papel / e-mail fixo / variável. */
function DestinatariosField({
  data,
  onUpdate,
  usuarios,
}: {
  data: NodePayload;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
  usuarios: Array<{ id: string; nome: string; role: string }>;
}) {
  const [novoEmail, setNovoEmail] = useState('');
  const lista = (data.config.destinatarios as string[]) ?? [];
  const PAPEIS = ['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP'];
  const setLista = (next: string[]) =>
    onUpdate((d) => ({ ...d, config: { ...d.config, destinatarios: next } }));
  const add = (tok: string) => {
    const v = tok.trim();
    if (v && !lista.includes(v)) setLista([...lista, v]);
  };
  const rotulo = (tok: string) => {
    if (tok.startsWith('user:')) {
      const u = usuarios.find((x) => x.id === tok.slice(5));
      return u ? `👤 ${u.nome}` : tok;
    }
    if (tok.startsWith('papel:')) return `🏷️ ${tok.slice(6)}`;
    return tok;
  };
  return (
    <Field label="Destinatários" hint="Usuário, papel, e-mail fixo ou {{variável}}">
      <div className="flex flex-col gap-1.5">
        {lista.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lista.map((tok, i) => (
              <span
                key={`${tok}-${i}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border bg-surface"
              >
                {rotulo(tok)}
                <button
                  type="button"
                  aria-label="Remover destinatário"
                  onClick={() => setLista(lista.filter((_, j) => j !== i))}
                  className="text-muted hover:text-danger"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <Select
          size="sm"
          value=""
          onChange={(e) => {
            if (e.target.value) add(e.target.value);
          }}
        >
          <option value="">+ adicionar usuário / papel…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={`user:${u.id}`}>
              👤 {u.nome}
            </option>
          ))}
          {PAPEIS.map((p) => (
            <option key={p} value={`papel:${p}`}>
              🏷️ Papel: {p}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            value={novoEmail}
            onChange={(e) => setNovoEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(novoEmail);
                setNovoEmail('');
              }
            }}
            placeholder="e-mail fixo ou {{variavel}} (Enter)"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              add(novoEmail);
              setNovoEmail('');
            }}
          >
            +
          </Button>
        </div>
      </div>
    </Field>
  );
}

function NodeInspector({
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
  // Listas pros seletores das ações novas (orquestração Fase B).
  const { data: tags } = useApiQuery<Array<{ id: string; nome: string }>>('/tags');
  const { data: prompts } = useApiQuery<Array<{ id: string; nome: string; isPadrao?: boolean }>>(
    '/mullerbot/prompts',
  );
  const { data: funis } = useApiQuery<
    Array<{ id: string; nome: string; etapas: Array<{ id: string; nome: string }> }>
  >('/funis');
  const etapasOpts = (funis ?? []).flatMap((f) =>
    (f.etapas ?? []).map((e) => ({ id: e.id, label: `${f.nome} · ${e.nome}` })),
  );
  // Usuários (responsável/destinatário) + variáveis customizadas (roteador/condição).
  const { data: usersResp } = useApiQuery<{
    data: Array<{ id: string; nome: string; role: string }>;
  }>('/users?limit=100&status=ATIVO');
  const usuarios = usersResp?.data ?? [];
  const { data: variaveisData } = useApiQuery<
    Array<{ id: string; chave: string }> | { data: Array<{ id: string; chave: string }> }
  >('/orquestracao/variaveis');
  const variaveis = Array.isArray(variaveisData) ? variaveisData : (variaveisData?.data ?? []);
  // Contatos WhatsApp da inbox — pro destinatário "contato salvo" do Enviar WhatsApp.
  const { data: contatosWa } = useApiQuery<
    Array<{ id: string; nome: string; tipo: 'CONTATO' | 'GRUPO' }>
  >('/inbox/contatos-whatsapp');
  /** Etapas de UM funil — pros dropdowns dependentes do funil escolhido. */
  const etapasDoFunil = (funilId?: string) =>
    (funis ?? []).find((f) => f.id === funilId)?.etapas ?? [];
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
          <>
            <Field label="Funil" hint="Qual funil observar">
              <Select
                size="sm"
                value={(data.config.funil as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    // trocar o funil limpa as etapas (podem não existir no novo)
                    config: {
                      ...d.config,
                      funil: e.target.value || undefined,
                      paraEtapa: undefined,
                      deEtapa: undefined,
                    },
                  }))
                }
              >
                <option value="">Selecionar funil…</option>
                {(funis ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Para etapa" hint="Dispara quando o lead ENTRA nesta etapa">
              <Select
                size="sm"
                value={(data.config.paraEtapa as string) ?? ''}
                disabled={!data.config.funil}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, paraEtapa: e.target.value || undefined } }))
                }
              >
                <option value="">
                  {data.config.funil ? 'Selecionar etapa…' : 'Escolha o funil primeiro'}
                </option>
                {etapasDoFunil(data.config.funil as string | undefined).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="De etapa (opcional)"
              hint="Só dispara se veio desta etapa. Vazio = qualquer origem"
            >
              <Select
                size="sm"
                value={(data.config.deEtapa as string) ?? ''}
                disabled={!data.config.funil}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, deEtapa: e.target.value || undefined } }))
                }
              >
                <option value="">Qualquer origem</option>
                {etapasDoFunil(data.config.funil as string | undefined).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </>
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

        {data.tipo === 'DELAY' && (
          <>
            <Field label="Aguardar quantidade">
              <Input
                type="number"
                min={1}
                value={(data.config.quantidade as number) ?? 1}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, quantidade: Number(e.target.value) } }))
                }
              />
            </Field>
            <Field label="Unidade">
              <Select
                size="sm"
                value={(data.config.unidade as string) ?? 'minutos'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, unidade: e.target.value } }))
                }
              >
                <option value="minutos">minutos</option>
                <option value="horas">horas</option>
                <option value="dias">dias</option>
              </Select>
            </Field>
          </>
        )}

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
            <Field label="Mensagem" hint="Use {{nome}}, {{empresa}} pra variáveis">
              <Textarea
                rows={5}
                value={(data.config.mensagem as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, mensagem: e.target.value } }))
                }
                placeholder="Olá {{nome}}, tudo bem?"
              />
            </Field>
          </>
        )}

        {data.acaoTipo === 'ENVIAR_EMAIL' && (
          <>
            <DestinatariosField data={data} onUpdate={onUpdate} usuarios={usuarios} />
            <Field label="Assunto">
              <Input
                value={(data.config.assunto as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, assunto: e.target.value } }))
                }
              />
            </Field>
            <Field label="Corpo HTML">
              <Textarea
                rows={6}
                value={(data.config.corpo as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, corpo: e.target.value } }))
                }
              />
            </Field>
          </>
        )}

        {data.acaoTipo === 'MOVER_LEAD_ETAPA' && (
          <Field label="Etapa de destino" hint="Etapa do funil pra onde o lead vai">
            <Select
              size="sm"
              value={(data.config.funilEtapaId as string) ?? ''}
              onChange={(e) =>
                onUpdate((d) => ({
                  ...d,
                  config: { ...d.config, funilEtapaId: e.target.value || undefined },
                }))
              }
            >
              <option value="">Selecionar etapa…</option>
              {etapasOpts.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {data.acaoTipo === 'CRIAR_TAREFA' && (
          <>
            <Field label="Título da tarefa" hint="Aceita {{nome}}, {{cidade}}…">
              <Input
                value={(data.config.titulo as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, titulo: e.target.value } }))
                }
              />
            </Field>
            <Field label="Descrição (opcional)">
              <Textarea
                rows={3}
                value={(data.config.descricao as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, descricao: e.target.value } }))
                }
              />
            </Field>
            <Field label="Responsável" hint="Vazio = rep do cliente / admin">
              <Select
                size="sm"
                value={(data.config.responsavelId as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, responsavelId: e.target.value || undefined },
                  }))
                }
              >
                <option value="">Automático (rep do cliente)</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prazo (dias a partir de hoje)" hint="0 = hoje">
              <Input
                type="number"
                min={0}
                value={(data.config.diasApartirDeHoje as number) ?? 0}
                onChange={(e) =>
                  onUpdate((d) => ({
                    ...d,
                    config: { ...d.config, diasApartirDeHoje: Number(e.target.value) },
                  }))
                }
              />
            </Field>
          </>
        )}

        {data.acaoTipo === 'WEBHOOK_EXTERNO' && (
          <>
            <Field label="URL">
              <Input
                placeholder="https://exemplo.com/hook"
                value={(data.config.url as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, url: e.target.value } }))
                }
              />
            </Field>
            <Field label="Método">
              <Select
                size="sm"
                value={(data.config.method as string) ?? 'POST'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, method: e.target.value } }))
                }
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
              </Select>
            </Field>
          </>
        )}

        {data.acaoTipo === 'MUDAR_TAG' && (
          <>
            <Field label="Operação">
              <Select
                size="sm"
                value={(data.config.operacao as string) ?? 'adicionar'}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, operacao: e.target.value } }))
                }
              >
                <option value="adicionar">Adicionar tag</option>
                <option value="remover">Remover tag</option>
              </Select>
            </Field>
            <Field label="Tag" hint="Escolha uma tag (sempre mostra todas ao clicar)">
              <Select
                size="sm"
                value={(data.config.tagNome as string) ?? ''}
                onChange={(e) =>
                  onUpdate((d) => ({ ...d, config: { ...d.config, tagNome: e.target.value } }))
                }
              >
                <option value="">Selecionar…</option>
                {/* Preserva uma tag salva que não esteja (mais) na lista. */}
                {(data.config.tagNome as string) &&
                  !(tags ?? []).some((t) => t.nome === (data.config.tagNome as string)) && (
                    <option value={data.config.tagNome as string}>
                      {data.config.tagNome as string}
                    </option>
                  )}
                {(tags ?? []).map((t) => (
                  <option key={t.id} value={t.nome}>
                    {t.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {data.acaoTipo === 'CONVERSAR_IA' && (
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
        )}

        {data.acaoTipo === 'LIBERAR_LOTE' && (
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
            <Field label="Quantidade por execução" hint="Anti-sobrecarga — ex: 50 leads/vez">
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

// ─── Helpers ────────────────────────────────────────────────────

function WebhookTriggerConfig() {
  const toast = useToast();
  const { data: webhooks, refetch } = useApiQuery<
    Array<{ id: string; nome: string; token: string }>
  >('/orquestracao/webhooks');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

  async function criar() {
    if (!nome.trim()) return;
    setBusy(true);
    try {
      await api.post('/orquestracao/webhooks', { nome: nome.trim() });
      setNome('');
      refetch();
    } catch (err) {
      toast.error('Falha ao criar webhook', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  async function remover(id: string) {
    try {
      await api.delete(`/orquestracao/webhooks/${id}`);
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted">
        Crie um webhook e cole a URL no sistema externo. Cada POST dispara este fluxo — o
        corpo do request vira <code className="text-text">{'{{custom.*}}'}</code>.
      </p>
      <div className="flex gap-1.5">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do webhook"
        />
        <Button size="sm" loading={busy} disabled={!nome.trim()} onClick={() => void criar()}>
          Criar
        </Button>
      </div>
      {(webhooks ?? []).map((w) => {
        const url = `${apiBase}/webhooks/fluxo/${w.token}`;
        return (
          <div key={w.id} className="rounded-md border border-border p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text">{w.nome}</span>
              <button
                type="button"
                onClick={() => void remover(w.id)}
                className="text-danger hover:underline"
              >
                remover
              </button>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <code className="flex-1 truncate text-muted">{url}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(url);
                  toast.success('URL copiada');
                }}
                className="text-primary hover:underline shrink-0"
              >
                copiar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Cron agendado (SPEC 1) ──────────────────────────────────────
// montarCron / CRON_DIAS / CRON_TIMEZONES / CronPreviewResp → @/pages/fluxo/lib/cron

function CronTriggerConfig({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (updater: (data: NodePayload) => NodePayload) => void;
}) {
  const avancado = config.cronAvancado === true;
  const freq = (config.cronFreq as string) ?? 'dias_uteis';
  const horario = (config.cronHorario as string) ?? '09:00';
  const dias = (config.cronDias as string[]) ?? ['1'];
  const diaMes = (config.cronDiaMes as string) ?? '1';
  const timezone = (config.timezone as string) ?? 'America/Sao_Paulo';
  const expressao = (config.expressao as string) ?? '';

  const [preview, setPreview] = useState<CronPreviewResp | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Inicializa a expressão no modo wizard se ainda não houver.
  useEffect(() => {
    if (!avancado && !expressao.trim()) {
      onUpdate((d) => ({
        ...d,
        config: { ...d.config, expressao: montarCron(freq, horario, dias, diaMes) },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview (debounced) das próximas execuções.
  useEffect(() => {
    if (!expressao.trim()) {
      setPreview(null);
      return;
    }
    let cancel = false;
    setCarregando(true);
    const t = setTimeout(() => {
      api
        .post<CronPreviewResp>('/fluxos/cron/preview', { expressao, timezone })
        .then((r) => {
          if (!cancel) setPreview(r);
        })
        .catch(() => {
          if (!cancel) setPreview({ valido: false, erro: 'Falha ao validar', proximas: [] });
        })
        .finally(() => {
          if (!cancel) setCarregando(false);
        });
    }, 400);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [expressao, timezone]);

  // Patch do wizard: atualiza o campo E recalcula a expressão.
  function patchWizard(patch: Record<string, unknown>) {
    onUpdate((d) => {
      const c = { ...d.config, ...patch };
      const expr = montarCron(
        (c.cronFreq as string) ?? freq,
        (c.cronHorario as string) ?? horario,
        (c.cronDias as string[]) ?? dias,
        (c.cronDiaMes as string) ?? diaMes,
      );
      return { ...d, config: { ...c, expressao: expr } };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Quando disparar
        </span>
        <button
          type="button"
          className="text-[11px] text-primary hover:underline"
          onClick={() => onUpdate((d) => ({ ...d, config: { ...d.config, cronAvancado: !avancado } }))}
        >
          {avancado ? '← Modo simples' : 'Avançado (cron) →'}
        </button>
      </div>

      {!avancado ? (
        <>
          <Field label="Frequência">
            <Select size="sm" value={freq} onChange={(e) => patchWizard({ cronFreq: e.target.value })}>
              <option value="todo_dia">Todo dia</option>
              <option value="dias_uteis">Dias úteis (seg–sex)</option>
              <option value="fim_de_semana">Fim de semana (sáb/dom)</option>
              <option value="dias_especificos">Dias específicos da semana</option>
              <option value="dia_do_mes">Um dia do mês</option>
            </Select>
          </Field>
          {freq === 'dias_especificos' && (
            <Field label="Dias da semana">
              <div className="flex flex-wrap gap-1">
                {CRON_DIAS.map((d) => {
                  const sel = dias.includes(d.v);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      onClick={() =>
                        patchWizard({
                          cronDias: sel ? dias.filter((x) => x !== d.v) : [...dias, d.v],
                        })
                      }
                      className={cn(
                        'text-[11px] px-2 py-1 rounded-md border transition-colors',
                        sel
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface text-text border-border hover:border-border-strong',
                      )}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          {freq === 'dia_do_mes' && (
            <Field label="Dia do mês" hint="1 a 31">
              <Input
                type="number"
                min={1}
                max={31}
                value={diaMes}
                onChange={(e) => patchWizard({ cronDiaMes: e.target.value })}
              />
            </Field>
          )}
          <Field label="Horário">
            <Input
              type="time"
              value={horario}
              onChange={(e) => patchWizard({ cronHorario: e.target.value })}
            />
          </Field>
        </>
      ) : (
        <Field label="Expressão cron" hint="Ex: 0 9 * * 1-5 (9h, dias úteis) · */15 * * * * (a cada 15min)">
          <Input
            value={expressao}
            onChange={(e) =>
              onUpdate((d) => ({ ...d, config: { ...d.config, expressao: e.target.value } }))
            }
            placeholder="min hora dia mês dia-semana"
          />
        </Field>
      )}

      <Field label="Fuso horário">
        <Select
          size="sm"
          value={timezone}
          onChange={(e) =>
            onUpdate((d) => ({ ...d, config: { ...d.config, timezone: e.target.value } }))
          }
        >
          {CRON_TIMEZONES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.l}
            </option>
          ))}
        </Select>
      </Field>

      {/* Preview das próximas execuções */}
      <div className="rounded-md border border-border bg-bg-alt p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-1">
          Próximas execuções
        </div>
        {carregando ? (
          <p className="text-[11px] text-muted">Calculando…</p>
        ) : preview?.valido ? (
          <ul className="flex flex-col gap-0.5">
            {preview.proximas.map((p) => (
              <li key={p.iso} className="text-[11px] text-text tabular">
                🕘 {p.label}
              </li>
            ))}
          </ul>
        ) : preview ? (
          <p className="text-[11px] text-danger">⚠ {preview.erro ?? 'Expressão inválida'}</p>
        ) : (
          <p className="text-[11px] text-muted">Defina a frequência acima.</p>
        )}
      </div>
      <p className="text-[10px] text-muted">
        O fluxo precisa estar <strong>Ativo</strong> pra rodar no horário. Latência de até ~30min.
      </p>
    </div>
  );
}

