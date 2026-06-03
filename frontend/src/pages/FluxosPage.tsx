import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { AutomacaoTabs } from '@/components/AutomacaoTabs';
import { StateView } from '@/components/StateView';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { FluxoEditor, type TriggerTipo as EditorTriggerTipo } from './FluxoEditor';

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
  const role = useRole();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canEdit = ['ADMIN', 'DIRECTOR'].includes(role ?? '');

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
  const [status, setStatus] = useState('');
  const [triggerTipo, setTriggerTipo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    if (triggerTipo) qs.set('triggerTipo', triggerTipo);
    return `/fluxos?${qs.toString()}`;
  }, [page, search, status, triggerTipo]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<FluxoListItem>>(listPath);

  async function callAction(id: string, action: 'ativar' | 'pausar' | 'arquivar') {
    try {
      if (action === 'arquivar') {
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
      <FluxoEditor
        fluxoId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={refetch}
      />
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
      <AutomacaoTabs />
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
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
                {pageResp.data.map((f) => (
                  <FluxoCard
                    key={f.id}
                    fluxo={f}
                    canEdit={canEdit}
                    onEdit={() => setEditingId(f.id)}
                    onAction={(a) => callAction(f.id, a)}
                    onExport={() => onExport(f)}
                  />
                ))}
              </div>
              {pageResp.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-bg-alt">
                  <span className="text-xs text-muted tabular">
                    Página {pageResp.pagination.page} de {pageResp.pagination.totalPages} ·{' '}
                    {pageResp.pagination.total.toLocaleString('pt-BR')} no total
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
}: {
  fluxo: FluxoListItem;
  canEdit: boolean;
  onEdit: () => void;
  onAction: (a: 'ativar' | 'pausar' | 'arquivar') => void;
  onExport: () => void;
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
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit && fluxo.status === 'RASCUNHO' && (
            <Tooltip content="Ativar fluxo">
              <IconButton
                aria-label="Ativar"
                variant="ghost"
                size="sm"
                icon={<Play className="text-success" />}
                data-testid={`fluxo-ativar-${fluxo.id}`}
                onClick={() => onAction('ativar')}
              />
            </Tooltip>
          )}
          {canEdit && fluxo.status === 'ATIVO' && (
            <Tooltip content="Pausar fluxo">
              <IconButton
                aria-label="Pausar"
                variant="ghost"
                size="sm"
                icon={<Pause className="text-warning" />}
                data-testid={`fluxo-pausar-${fluxo.id}`}
                onClick={() => onAction('pausar')}
              />
            </Tooltip>
          )}
          {canEdit && fluxo.status === 'PAUSADO' && (
            <Tooltip content="Retomar fluxo">
              <IconButton
                aria-label="Retomar"
                variant="ghost"
                size="sm"
                icon={<Play className="text-success" />}
                data-testid={`fluxo-retomar-${fluxo.id}`}
                onClick={() => onAction('ativar')}
              />
            </Tooltip>
          )}
          {canEdit && fluxo.status !== 'ARQUIVADO' && (
            <Tooltip content="Arquivar">
              <IconButton
                aria-label="Arquivar"
                variant="ghost"
                size="sm"
                icon={<Archive />}
                onClick={() => onAction('arquivar')}
              />
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip content="Exportar (.json)">
              <IconButton
                aria-label="Exportar"
                variant="ghost"
                size="sm"
                icon={<Download />}
                onClick={onExport}
                data-testid={`fluxo-exportar-${fluxo.id}`}
              />
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip content="Editar no canvas">
              <IconButton
                aria-label="Editar"
                variant="ghost"
                size="sm"
                icon={<Edit3 />}
                onClick={onEdit}
                data-testid={`fluxo-open-${fluxo.id}`}
              />
            </Tooltip>
          )}
        </div>
      </footer>

      {fluxo._count?.execucoes !== undefined && fluxo._count.execucoes > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <Activity className="h-3 w-3" />
          {fluxo._count.execucoes.toLocaleString('pt-BR')} execuções
        </div>
      )}
    </Card>
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

// Re-export legacy types pra TypeScript não quebrar imports antigos
export type { FluxoStatus, TriggerTipo };

// Mark unused helpers tossing them in
const _unused = cn;
void _unused;
