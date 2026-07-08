import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Play,
  Pause,
  Archive,
  Edit3,
  Zap,
  Sparkles,
  AlertCircle,
  Activity,
  Upload,
  Download,
  Trash2,
  LayoutGrid,
  List,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatNumero } from '@/lib/masks';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useConfirm } from '@/hooks/useConfirm';
import { usePermission } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FullPageSpinner,
  IconButton,
  Input,
  Select,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/lib/cn';
// PERF: lazy — o editor arrasta @xyflow/react (~200KB + CSS). Import estático baixava o chunk
// ao abrir /fluxos só pra VER a lista; agora só baixa ao clicar Editar.
const FluxoEditor = lazy(() => import('./FluxoEditor').then((m) => ({ default: m.FluxoEditor })));
import type { TriggerTipo as EditorTriggerTipo } from '@/pages/fluxo/lib/types';

/**
 * FluxosPage v2 — lista de fluxos + entry point pro editor visual.
 *
 * Click em "Editar" abre FluxoEditor (fullscreen, React Flow).
 * Click em "Abrir" abre detail modal mostrando métricas + execuções.
 */

type FluxoStatus = 'RASCUNHO' | 'ATIVO' | 'PAUSADO' | 'ARQUIVADO';
type TriggerTipo = EditorTriggerTipo;

interface FluxoListItem {
  id: string;
  nome: string;
  descricao?: string | null;
  status: FluxoStatus;
  triggerTipo?: TriggerTipo | null;
  criadoEm: string;
  atualizadoEm: string;
  _count?: { nos?: number; execucoes?: number };
}

const STATUS_VARIANT: Record<FluxoStatus, 'success' | 'warning' | 'neutral'> = {
  RASCUNHO: 'neutral',
  ATIVO: 'success',
  PAUSADO: 'warning',
  ARQUIVADO: 'neutral',
};

const STATUS_LABEL: Record<FluxoStatus, string> = {
  RASCUNHO: 'Rascunho',
  ATIVO: 'Ativo',
  PAUSADO: 'Pausado',
  ARQUIVADO: 'Arquivado',
};

const TRIGGERS: Record<TriggerTipo, string> = {
  LEAD_CRIADO: 'Lead criado',
  LEAD_ETAPA_MUDOU: 'Lead mudou de etapa',
  PEDIDO_APROVADO: 'Pedido aprovado',
  PEDIDO_ENTREGUE: 'Pedido entregue',
  OCORRENCIA_ABERTA: 'Ocorrência aberta',
  CLIENTE_INATIVO_30D: 'Cliente inativo 30 dias',
  AMOSTRA_FOLLOWUP: 'Amostra follow-up',
  CRON_AGENDADO: 'Cron agendado',
  LEAD_RESPONDEU: 'Lead respondeu',
  LEAD_SEM_RESPOSTA: 'Lead sem resposta',
  IA_CLASSIFICOU: 'IA classificou',
  LEAD_RECEBEU_TAG: 'Lead recebeu tag',
  MENSAGEM_CANAL: 'Mensagem chegou (canal)',
  WEBHOOK_RECEBIDO: 'Webhook recebido',
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

/** Nome de arquivo seguro a partir do nome do fluxo. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'fluxo'
  );
}

/** Serializa em JSON e dispara o download no navegador. */
function baixarJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FluxosPage() {
  const canEdit = usePermission('fluxos.edit');
  const toast = useToast();
  const [confirm, ConfirmDialog] = useConfirm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Suporte a ?edit=<id> (vindo de Templates após criar fluxo)
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId) {
      setEditingId(editId);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const searchDebounced = useDebouncedValue(search, 300); // #46: sem debounce a lista piscava por tecla
  const [status, setStatus] = useState('');
  const [triggerTipo, setTriggerTipo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Visão: cards (grid) ou lista (linhas compactas) — persistida por usuário.
  const [visao, setVisao] = useState<'card' | 'lista'>(() => {
    try {
      return localStorage.getItem('fluxos_visao') === 'lista' ? 'lista' : 'card';
    } catch {
      return 'card';
    }
  });
  function mudarVisao(v: 'card' | 'lista') {
    setVisao(v);
    try {
      localStorage.setItem('fluxos_visao', v);
    } catch {
      // best-effort
    }
  }
  const [verExecucoes, setVerExecucoes] = useState<FluxoListItem | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (searchDebounced.trim()) qs.set('search', searchDebounced.trim());
    if (status) qs.set('status', status);
    if (triggerTipo) qs.set('triggerTipo', triggerTipo);
    return `/fluxos?${qs.toString()}`;
  }, [page, searchDebounced, status, triggerTipo]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<FluxoListItem>>(listPath);

  async function callAction(id: string, action: 'ativar' | 'pausar' | 'arquivar' | 'excluir') {
    try {
      if (action === 'excluir') {
        const ok = await confirm({
          title: 'Excluir fluxo?',
          message:
            'O fluxo, seus nós, conexões e todo o histórico de execuções serão apagados permanentemente. Não dá pra desfazer.',
          confirmLabel: 'Excluir',
          variant: 'danger',
        });
        if (!ok) return;
        await api.delete(`/fluxos/${id}/permanente`);
        toast.success('Fluxo excluído');
      } else if (action === 'arquivar') {
        await api.delete(`/fluxos/${id}`);
        toast.success('Fluxo arquivado');
      } else {
        await api.post(`/fluxos/${id}/${action}`);
        toast.success(`Fluxo ${action === 'ativar' ? 'ativado' : 'pausado'}`);
      }
      refetch();
    } catch (err) {
      toast.error('Falha na operação', err instanceof ApiError ? err.message : undefined);
    }
  }

  // ─── Import / Export por arquivo (.json) ──────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error('O arquivo não é um JSON válido');
      }
      const r = await api.post<{ id: string; nome: string }>('/fluxos/importar', parsed);
      toast.success('Fluxo importado', `"${r.nome}" criado como rascunho — revise e ative.`);
      refetch();
      setEditingId(r.id);
    } catch (err) {
      toast.error(
        'Falha ao importar fluxo',
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : undefined,
      );
    } finally {
      setImporting(false);
    }
  }

  async function onExport(f: FluxoListItem) {
    try {
      const data = await api.get<unknown>(`/fluxos/${f.id}/exportar`);
      baixarJson(`${slugify(f.nome)}.fluxo.json`, data);
    } catch (err) {
      toast.error('Falha ao exportar', err instanceof ApiError ? err.message : undefined);
    }
  }

  if (editingId) {
    return (
      <Suspense fallback={<FullPageSpinner />}>
        <FluxoEditor fluxoId={editingId} onClose={() => setEditingId(null)} onSaved={refetch} />
      </Suspense>
    );
  }

  return (
    <PageLayout
      title="Fluxos de automação"
      description="Construa workflows visuais que disparam ações com base em gatilhos."
      actions={
        canEdit ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => void onImportFile(e)}
              className="hidden"
              data-testid="fluxo-import-input"
            />
            <Button
              variant="secondary"
              data-testid="fluxo-import-btn"
              loading={importing}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              onClick={() => fileRef.current?.click()}
            >
              Importar
            </Button>
            <Button
              variant="secondary"
              leftIcon={<Sparkles className="h-3.5 w-3.5" />}
              onClick={() => navigate('/fluxos/templates')}
            >
              Templates
            </Button>
            <Button
              data-testid="fluxo-new"
              onClick={() => setCreating(true)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Novo fluxo
            </Button>
          </>
        ) : undefined
      }
    >
      <CrmTabs />
      <Card padding="none">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
          <Input
            leftIcon={<Search />}
            placeholder="Buscar por nome…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-md flex-1"
          />
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            {(Object.keys(STATUS_LABEL) as FluxoStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="filter-trigger"
            value={triggerTipo}
            onChange={(e) => {
              setTriggerTipo(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos triggers</option>
            {(Object.keys(TRIGGERS) as TriggerTipo[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGERS[t]}
              </option>
            ))}
          </Select>
          {/* Toggle de visão: cards ou lista */}
          <div className="ml-auto inline-flex rounded-md border border-border-strong overflow-hidden">
            <Tooltip content="Ver em cards">
              <IconButton
                aria-label="Visão em cards"
                variant={visao === 'card' ? 'secondary' : 'ghost'}
                size="sm"
                icon={<LayoutGrid />}
                onClick={() => mudarVisao('card')}
                data-testid="fluxos-visao-card"
              />
            </Tooltip>
            <Tooltip content="Ver em lista">
              <IconButton
                aria-label="Visão em lista"
                variant={visao === 'lista' ? 'secondary' : 'ghost'}
                size="sm"
                icon={<List />}
                onClick={() => mudarVisao('lista')}
                data-testid="fluxos-visao-lista"
              />
            </Tooltip>
          </div>
        </div>

        <StateView loading={loading} error={error} onRetry={refetch}>
          {pageResp && pageResp.data.length === 0 && (
            <EmptyState
              icon={<Zap />}
              title="Nenhum fluxo cadastrado"
              description="Crie seu primeiro fluxo de automação ou comece de um template pronto."
              action={
                canEdit ? (
                  <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                    Novo fluxo
                  </Button>
                ) : undefined
              }
              className="m-6 border-0"
            />
          )}
          {pageResp && pageResp.data.length > 0 && (
            <>
              {visao === 'lista' ? (
                <div>
                  {pageResp.data.map((f) => (
                    <FluxoRow
                      key={f.id}
                      fluxo={f}
                      canEdit={canEdit}
                      onEdit={() => setEditingId(f.id)}
                      onAction={(a) => callAction(f.id, a)}
                      onExport={() => onExport(f)}
                      onVerExecucoes={() => setVerExecucoes(f)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
                  {pageResp.data.map((f) => (
                    <FluxoCard
                      key={f.id}
                      fluxo={f}
                      canEdit={canEdit}
                      onEdit={() => setEditingId(f.id)}
                      onAction={(a) => callAction(f.id, a)}
                      onExport={() => onExport(f)}
                      onVerExecucoes={() => setVerExecucoes(f)}
                    />
                  ))}
                </div>
              )}
              {pageResp.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-bg-alt">
                  <span className="text-xs text-muted tabular">
                    Página {pageResp.pagination.page} de {pageResp.pagination.totalPages} ·{' '}
                    {formatNumero(pageResp.pagination.total)} no total
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pageResp.pagination.page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pageResp.pagination.page >= pageResp.pagination.totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </StateView>
      </Card>

      {creating && (
        <CreateFluxoModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            refetch();
            setEditingId(id);
          }}
        />
      )}
      {verExecucoes && (
        <ExecucoesModal fluxo={verExecucoes} onClose={() => setVerExecucoes(null)} />
      )}
      {ConfirmDialog}
    </PageLayout>
  );
}

// ─── Fluxo card ──────────────────────────────────────────────────

function FluxoCard({
  fluxo,
  canEdit,
  onEdit,
  onAction,
  onExport,
  onVerExecucoes,
}: {
  fluxo: FluxoListItem;
  canEdit: boolean;
  onEdit: () => void;
  onAction: (a: 'ativar' | 'pausar' | 'arquivar' | 'excluir') => void;
  onExport: () => void;
  onVerExecucoes: () => void;
}) {
  return (
    <Card
      padding="md"
      variant="interactive"
      onClick={onEdit}
      className="flex flex-col gap-3 group"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-text tracking-tight truncate">
            {fluxo.nome}
          </h3>
          {fluxo.descricao && (
            <p className="text-xs text-muted line-clamp-2 mt-0.5">{fluxo.descricao}</p>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[fluxo.status]}>{STATUS_LABEL[fluxo.status]}</Badge>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        {fluxo.triggerTipo ? (
          <Badge variant="info" size="sm" className="inline-flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {TRIGGERS[fluxo.triggerTipo]}
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">Manual</Badge>
        )}
        {fluxo._count?.nos !== undefined && (
          <span className="text-[11px] text-muted-light">
            {fluxo._count.nos} {fluxo._count.nos === 1 ? 'nó' : 'nós'}
          </span>
        )}
      </div>

      <footer className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-[11px] text-muted">Atualizado {fmtDate(fluxo.atualizadoEm)}</span>
        <FluxoAcoes
          fluxo={fluxo}
          canEdit={canEdit}
          onAction={onAction}
          onExport={onExport}
          onEdit={onEdit}
        />
      </footer>

      {fluxo._count?.execucoes !== undefined && fluxo._count.execucoes > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onVerExecucoes();
          }}
          className="flex items-center gap-1.5 text-[11px] text-muted hover:text-primary underline-offset-2 hover:underline w-fit"
          data-testid={`fluxo-execucoes-${fluxo.id}`}
        >
          <Activity className="h-3 w-3" />
          {formatNumero(fluxo._count.execucoes)} execuções — ver erros
        </button>
      )}
    </Card>
  );
}

// ─── Ações do fluxo (reusadas no card e na linha da lista) ───────

function FluxoAcoes({
  fluxo,
  canEdit,
  onAction,
  onExport,
  onEdit,
  tooltipSide = 'top',
}: {
  fluxo: FluxoListItem;
  canEdit: boolean;
  onAction: (a: 'ativar' | 'pausar' | 'arquivar' | 'excluir') => void;
  onExport: () => void;
  onEdit: () => void;
  /** Na LISTA os ícones ficam colados na borda direita — tooltip pra cima
   *  estoura o viewport e o scrollbar faz o layout "dançar"; usar 'left'. */
  tooltipSide?: 'top' | 'left';
}) {
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {canEdit && fluxo.status === 'RASCUNHO' && (
        <Tooltip content="Ativar fluxo" side={tooltipSide}>
          <IconButton aria-label="Ativar" variant="ghost" size="sm" icon={<Play className="text-success" />} data-testid={`fluxo-ativar-${fluxo.id}`} onClick={() => onAction('ativar')} />
        </Tooltip>
      )}
      {canEdit && fluxo.status === 'ATIVO' && (
        <Tooltip content="Pausar fluxo" side={tooltipSide}>
          <IconButton aria-label="Pausar" variant="ghost" size="sm" icon={<Pause className="text-warning" />} data-testid={`fluxo-pausar-${fluxo.id}`} onClick={() => onAction('pausar')} />
        </Tooltip>
      )}
      {canEdit && fluxo.status === 'PAUSADO' && (
        <Tooltip content="Retomar fluxo" side={tooltipSide}>
          <IconButton aria-label="Retomar" variant="ghost" size="sm" icon={<Play className="text-success" />} data-testid={`fluxo-retomar-${fluxo.id}`} onClick={() => onAction('ativar')} />
        </Tooltip>
      )}
      {canEdit && fluxo.status !== 'ARQUIVADO' && (
        <Tooltip content="Arquivar" side={tooltipSide}>
          <IconButton aria-label="Arquivar" variant="ghost" size="sm" icon={<Archive />} onClick={() => onAction('arquivar')} />
        </Tooltip>
      )}
      {canEdit && (
        <Tooltip content="Excluir permanentemente" side={tooltipSide}>
          <IconButton aria-label="Excluir" variant="ghost" size="sm" className="text-danger hover:bg-danger/10" icon={<Trash2 />} onClick={() => onAction('excluir')} data-testid={`fluxo-excluir-${fluxo.id}`} />
        </Tooltip>
      )}
      {canEdit && (
        <Tooltip content="Exportar (.json)" side={tooltipSide}>
          <IconButton aria-label="Exportar" variant="ghost" size="sm" icon={<Download />} onClick={onExport} data-testid={`fluxo-exportar-${fluxo.id}`} />
        </Tooltip>
      )}
      {canEdit && (
        <Tooltip content="Editar no canvas" side={tooltipSide}>
          <IconButton aria-label="Editar" variant="ghost" size="sm" icon={<Edit3 />} onClick={onEdit} data-testid={`fluxo-open-${fluxo.id}`} />
        </Tooltip>
      )}
    </div>
  );
}

// ─── Linha da lista (visão compacta, alternativa aos cards) ──────

function FluxoRow({
  fluxo,
  canEdit,
  onEdit,
  onAction,
  onExport,
  onVerExecucoes,
}: {
  fluxo: FluxoListItem;
  canEdit: boolean;
  onEdit: () => void;
  onAction: (a: 'ativar' | 'pausar' | 'arquivar' | 'excluir') => void;
  onExport: () => void;
  onVerExecucoes: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-alt cursor-pointer border-b border-border last:border-b-0"
      onClick={onEdit}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text truncate">{fluxo.nome}</span>
          <Badge variant={STATUS_VARIANT[fluxo.status]} size="sm">
            {STATUS_LABEL[fluxo.status]}
          </Badge>
        </div>
        {fluxo.descricao && <p className="text-xs text-muted truncate mt-0.5">{fluxo.descricao}</p>}
      </div>
      <div className="hidden md:flex items-center shrink-0 w-40">
        {fluxo.triggerTipo ? (
          <Badge variant="info" size="sm" className="inline-flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" />
            {TRIGGERS[fluxo.triggerTipo]}
          </Badge>
        ) : (
          <Badge variant="outline" size="sm">Manual</Badge>
        )}
      </div>
      <span className="hidden lg:block text-[11px] text-muted shrink-0 w-36 text-right">
        {fluxo._count?.execucoes !== undefined && fluxo._count.execucoes > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onVerExecucoes();
            }}
            className="hover:text-primary hover:underline"
            data-testid={`fluxo-execucoes-${fluxo.id}`}
          >
            {formatNumero(fluxo._count.execucoes)} exec.
          </button>
        ) : (
          <>Atualizado {fmtDate(fluxo.atualizadoEm)}</>
        )}
      </span>
      <div className="shrink-0">
        <FluxoAcoes fluxo={fluxo} canEdit={canEdit} onAction={onAction} onExport={onExport} onEdit={onEdit} tooltipSide="left" />
      </div>
    </div>
  );
}

// ─── Create modal ─────────────────────────────────────────────

function CreateFluxoModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [triggerTipo, setTriggerTipo] = useState<TriggerTipo | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { nome: nome.trim(), nos: [], arestas: [] };
    if (descricao.trim()) payload.descricao = descricao.trim();
    if (triggerTipo) payload.triggerTipo = triggerTipo;
    try {
      const r = await api.post<{ id: string }>('/fluxos', payload);
      onSaved(r.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Novo fluxo de automação"
      description="Crie o rascunho. Depois abra no editor visual pra montar o grafo."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="fluxo-form"
            data-testid="fluxo-save"
            disabled={nome.trim().length === 0}
            loading={busy}
          >
            Criar e abrir editor
          </Button>
        </>
      }
    >
      <form id="fluxo-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nome" required>
          <Input
            data-testid="fluxo-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={1}
            maxLength={150}
            autoFocus
            placeholder="Ex: Cliente esfriando — reativação 21d"
          />
        </Field>
        <Field label="Descrição">
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="O que esse fluxo faz?"
          />
        </Field>
        <Field label="Trigger" hint="Quando o fluxo dispara">
          <Select
            data-testid="fluxo-trigger"
            value={triggerTipo}
            onChange={(e) => setTriggerTipo(e.target.value as TriggerTipo | '')}
          >
            <option value="">Sem trigger (manual)</option>
            {(Object.keys(TRIGGERS) as TriggerTipo[]).map((t) => (
              <option key={t} value={t}>
                {TRIGGERS[t]}
              </option>
            ))}
          </Select>
        </Field>
        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ─── Execuções modal (logs por passo + erros) ───────────────────

type ExecStatus = 'EM_EXECUCAO' | 'AGUARDANDO' | 'CONCLUIDO' | 'FALHOU' | 'CANCELADO';
type LogStatus = 'CONCLUIDO' | 'FALHOU';

interface ExecLog {
  id: string;
  noTitulo: string;
  status: LogStatus;
  erroMsg?: string | null;
  output?: Record<string, unknown> | null;
  iniciadoEm: string;
}
interface ExecItem {
  id: string;
  status: ExecStatus;
  criadoEm: string;
  terminouEm?: string | null;
  contexto?: Record<string, unknown> | null;
  logs: ExecLog[];
}

const EXEC_VARIANT: Record<ExecStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  EM_EXECUCAO: 'neutral',
  AGUARDANDO: 'warning',
  CONCLUIDO: 'success',
  FALHOU: 'danger',
  CANCELADO: 'neutral',
};
const EXEC_LABEL: Record<ExecStatus, string> = {
  EM_EXECUCAO: 'Em execução',
  AGUARDANDO: 'Aguardando lead',
  CONCLUIDO: 'Concluída',
  FALHOU: 'Falhou',
  CANCELADO: 'Cancelada',
};

function fmtData(s?: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return s;
  }
}

/** Resumo do histórico: contagens por status + leads distintos processados. */
function ExecResumo({ execs }: { execs: ExecItem[] }) {
  const total = execs.length;
  const concluidas = execs.filter((e) => e.status === 'CONCLUIDO').length;
  const falhas = execs.filter((e) => e.status === 'FALHOU').length;
  const aguardando = execs.filter((e) => e.status === 'AGUARDANDO').length;
  const leads = new Set(
    execs
      .map((e) => (e.contexto && typeof e.contexto.leadId === 'string' ? e.contexto.leadId : null))
      .filter((x): x is string => Boolean(x)),
  ).size;

  const itens: Array<{ label: string; valor: number; cor?: string }> = [
    { label: 'Execuções', valor: total },
    { label: 'Concluídas', valor: concluidas, cor: 'text-success' },
    { label: 'Falhas', valor: falhas, cor: falhas > 0 ? 'text-danger' : undefined },
    { label: 'Aguardando', valor: aguardando, cor: aguardando > 0 ? 'text-warning' : undefined },
    { label: 'Leads', valor: leads },
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-3" data-testid="exec-resumo">
      {itens.map((it) => (
        <div
          key={it.label}
          className="flex-1 min-w-[80px] rounded-md border border-border bg-bg-alt px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wide text-muted">{it.label}</div>
          <div className={cn('text-lg font-bold tabular', it.cor ?? 'text-text')}>
            {formatNumero(it.valor)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecucoesModal({ fluxo, onClose }: { fluxo: FluxoListItem; onClose: () => void }) {
  const { data, loading, error, refetch } = useApiQuery<PaginatedResponse<ExecItem>>(
    `/fluxos/${fluxo.id}/execucoes?limit=30`,
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Execuções — ${fluxo.nome}`}
      description="Cada execução é uma passada do fluxo por um lead. Passos em vermelho falharam; o motivo aparece embaixo."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => refetch()}>
            Atualizar
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {!data || data.data.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            title="Nenhuma execução ainda"
            description="Quando o fluxo disparar pra um lead, a execução aparece aqui."
            className="border-0"
          />
        ) : (
        <>
        <ExecResumo execs={data.data} />
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {data.data.map((ex) => {
            const leadId =
              ex.contexto && typeof ex.contexto.leadId === 'string'
                ? (ex.contexto.leadId as string)
                : null;
            const falhou = ex.logs.filter((l) => l.status === 'FALHOU');
            return (
              <div key={ex.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge variant={EXEC_VARIANT[ex.status]}>{EXEC_LABEL[ex.status]}</Badge>
                  <span className="text-[11px] text-muted tabular">{fmtData(ex.criadoEm)}</span>
                </div>
                {leadId && (
                  <p className="text-[11px] text-muted mb-2">
                    Lead: <code className="text-text">{leadId}</code>
                  </p>
                )}
                {ex.logs.length === 0 ? (
                  <p className="text-[11px] text-muted">Sem passos registrados.</p>
                ) : (
                  <ol className="flex flex-col gap-1">
                    {ex.logs.map((l) => {
                      const motivo =
                        l.output && typeof l.output.motivo === 'string'
                          ? (l.output.motivo as string)
                          : null;
                      const ruim = l.status === 'FALHOU';
                      return (
                        <li
                          key={l.id}
                          className={cn(
                            'text-xs rounded-md px-2 py-1.5 border',
                            ruim
                              ? 'bg-danger/5 border-danger/30'
                              : motivo
                                ? 'bg-warning/5 border-warning/30'
                                : 'bg-bg-alt border-border',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-text">{l.noTitulo}</span>
                            <span
                              className={cn(
                                'text-[10px] uppercase tracking-wide',
                                ruim ? 'text-danger' : 'text-muted',
                              )}
                            >
                              {ruim ? 'falhou' : motivo ? 'pulado' : 'ok'}
                            </span>
                          </div>
                          {l.erroMsg && (
                            <p className="mt-0.5 text-danger break-words">{l.erroMsg}</p>
                          )}
                          {!l.erroMsg && motivo && (
                            <p className="mt-0.5 text-warning break-words">{motivo}</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {falhou.length === 0 && ex.status === 'CONCLUIDO' && ex.logs.length > 0 && (
                  <p className="mt-2 text-[11px] text-success">Concluída sem erros.</p>
                )}
              </div>
            );
          })}
        </div>
        </>
        )}
      </StateView>
    </Dialog>
  );
}

// Re-export legacy types pra TypeScript não quebrar imports antigos
export type { FluxoStatus, TriggerTipo };

