import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { FormField, Input, Select } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type ClienteStatus = 'NOVO' | 'PROSPECT' | 'ATIVO' | 'INATIVO';
type OmieStatus = 'ATIVO' | 'BLOQUEADO';

interface Cliente {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status: ClienteStatus;
  omieStatus: OmieStatus;
  score: number;
  representante?: { id: string; nome: string } | null;
  tags?: Array<{ id: string; nome: string; cor?: string | null }>;
  criadoEm?: string;
}

interface Lista {
  id: string;
  nome: string;
  descricao?: string;
}

const STATUS_COLORS: Record<ClienteStatus, string> = {
  NOVO: colors.warning,
  PROSPECT: '#0891b2',
  ATIVO: colors.success,
  INATIVO: colors.muted,
};

const OMIE_COLORS: Record<OmieStatus, string> = {
  ATIVO: colors.success,
  BLOQUEADO: colors.danger,
};

export default function ClientesPage() {
  const canEdit = usePermission('clientes.edit');
  const canBulk = usePermission('clientes.bulkAssign');

  // Filtros / paginação
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [omie, setOmie] = useState<string>('');
  const [lista, setLista] = useState<string>('');

  // Path memoizado pra useApiQuery re-fetch quando filtros mudam
  const listPath = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '20');
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    if (omie) qs.set('omieStatus', omie);
    if (lista) qs.set('lista', lista);
    return `/clientes?${qs.toString()}`;
  }, [page, search, status, omie, lista]);

  const {
    data: page$,
    loading,
    error,
    refetch,
  } = useApiQuery<PaginatedResponse<Cliente>>(listPath);
  const { data: listasMeta } = useApiQuery<Lista[]>('/clientes/listas');

  // Modal de criação/edição
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [creating, setCreating] = useState(false);
  const closeModal = () => {
    setEditing(null);
    setCreating(false);
  };
  const onSaved = () => {
    closeModal();
    refetch();
  };

  const columns: Column<Cliente>[] = [
    {
      key: 'nome',
      header: 'Cliente',
      render: (c) => (
        <div>
          <div style={{ fontWeight: 600 }}>{c.nome}</div>
          {c.cnpj && (
            <div style={{ fontSize: 12, color: colors.muted }}>{c.cnpj}</div>
          )}
        </div>
      ),
    },
    {
      key: 'local',
      header: 'Local',
      render: (c) =>
        c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'rep',
      header: 'Representante',
      render: (c) =>
        c.representante?.nome ?? <em style={{ color: colors.muted }}>sem rep</em>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <span style={badge(STATUS_COLORS[c.status])}>{c.status}</span>,
    },
    {
      key: 'omie',
      header: 'OMIE',
      render: (c) => (
        <span style={badge(OMIE_COLORS[c.omieStatus])}>{c.omieStatus}</span>
      ),
    },
    {
      key: 'score',
      header: 'Score',
      render: (c) => <span style={{ fontWeight: 600 }}>{c.score}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (c) =>
        canEdit ? (
          <button
            type="button"
            data-testid={`cliente-edit-${c.id}`}
            onClick={() => setEditing(c)}
            style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
          >
            Editar
          </button>
        ) : null,
    },
  ];

  return (
    <PageLayout
      title="Clientes"
      actions={
        canEdit ? (
          <button
            type="button"
            data-testid="cliente-new-btn"
            onClick={() => setCreating(true)}
            style={btn}
          >
            + Novo cliente
          </button>
        ) : null
      }
    >
      <div style={card}>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Nome, CNPJ, email…"
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
            <option value="NOVO">Novo</option>
            <option value="PROSPECT">Prospect</option>
            <option value="ATIVO">Ativo</option>
            <option value="INATIVO">Inativo</option>
          </Select>
          <Select
            data-testid="filter-omie"
            value={omie}
            onChange={(e) => {
              setOmie(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos OMIE</option>
            <option value="ATIVO">Ativos OMIE</option>
            <option value="BLOQUEADO">Bloqueados OMIE</option>
          </Select>
          <Select
            data-testid="filter-lista"
            value={lista}
            onChange={(e) => {
              setLista(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Listas dinâmicas</option>
            {listasMeta?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (page$?.data.length ?? 0) === 0}
          emptyMessage="Nenhum cliente encontrado com esses filtros."
          onRetry={refetch}
        >
          {page$ && (
            <>
              <Table
                data={page$.data}
                columns={columns}
                rowKey={(c) => c.id}
              />
              <Pagination pagination={page$.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>

        {canBulk && (
          <p style={{ fontSize: 12, color: colors.muted, marginTop: '0.5rem' }}>
            Dica: você tem permissão de atribuição em massa. (UI em sessão futura.)
          </p>
        )}
      </div>

      {(creating || editing) && (
        <ClienteFormModal
          open
          cliente={editing}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
    </PageLayout>
  );
}

// ─── Modal de form ───────────────────────────────────────────────────────

interface FormState {
  nome: string;
  cnpj: string;
  email: string;
  telefone: string;
  cidade: string;
  uf: string;
  segmento: string;
  status: ClienteStatus;
  omieStatus: OmieStatus;
  score: number;
  prazoPagamento: number;
}

function emptyForm(c?: Cliente | null): FormState {
  return {
    nome: c?.nome ?? '',
    cnpj: c?.cnpj ?? '',
    email: c?.email ?? '',
    telefone: c?.telefone ?? '',
    cidade: c?.cidade ?? '',
    uf: c?.uf ?? '',
    segmento: c?.segmento ?? '',
    status: c?.status ?? 'NOVO',
    omieStatus: c?.omieStatus ?? 'ATIVO',
    score: c?.score ?? 50,
    prazoPagamento: 30,
  };
}

function ClienteFormModal({
  open,
  cliente,
  onClose,
  onSaved,
}: {
  open: boolean;
  cliente: Cliente | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(cliente);
  const [form, setForm] = useState<FormState>(emptyForm(cliente));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // Strip campos vazios opcionais — backend Zod aceita undefined, não ''
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      status: form.status,
      omieStatus: form.omieStatus,
      score: form.score,
      prazoPagamento: form.prazoPagamento,
    };
    const optional = ['cnpj', 'email', 'telefone', 'cidade', 'uf', 'segmento'] as const;
    for (const k of optional) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }

    try {
      if (isEdit && cliente) {
        await api.patch(`/clientes/${cliente.id}`, payload);
      } else {
        await api.post('/clientes', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar cliente' : 'Novo cliente'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="cliente-form"
            data-testid="cliente-save-btn"
            disabled={saving || form.nome.trim().length < 2}
            style={{ ...btn, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="cliente-form" onSubmit={handleSubmit}>
        <FormField label="Nome" required htmlFor="f-nome">
          <Input
            id="f-nome"
            data-testid="cliente-nome-input"
            value={form.nome}
            onChange={(e) => setField('nome', e.target.value)}
            required
            minLength={2}
            maxLength={200}
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="CNPJ" htmlFor="f-cnpj" hint="00.000.000/0001-00">
            <Input
              id="f-cnpj"
              value={form.cnpj}
              onChange={(e) => setField('cnpj', e.target.value)}
              placeholder="00.000.000/0001-00"
            />
          </FormField>
          <FormField label="Segmento" htmlFor="f-seg">
            <Input
              id="f-seg"
              value={form.segmento}
              onChange={(e) => setField('segmento', e.target.value)}
            />
          </FormField>
          <FormField label="E-mail" htmlFor="f-email">
            <Input
              id="f-email"
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
            />
          </FormField>
          <FormField label="Telefone" htmlFor="f-tel">
            <Input
              id="f-tel"
              value={form.telefone}
              onChange={(e) => setField('telefone', e.target.value)}
            />
          </FormField>
          <FormField label="Cidade" htmlFor="f-cidade">
            <Input
              id="f-cidade"
              value={form.cidade}
              onChange={(e) => setField('cidade', e.target.value)}
            />
          </FormField>
          <FormField label="UF" htmlFor="f-uf">
            <Input
              id="f-uf"
              maxLength={2}
              value={form.uf}
              onChange={(e) => setField('uf', e.target.value.toUpperCase())}
            />
          </FormField>
          <FormField label="Status" htmlFor="f-status">
            <Select
              id="f-status"
              value={form.status}
              onChange={(e) => setField('status', e.target.value as ClienteStatus)}
            >
              <option value="NOVO">Novo</option>
              <option value="PROSPECT">Prospect</option>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </Select>
          </FormField>
          <FormField label="OMIE" htmlFor="f-omie">
            <Select
              id="f-omie"
              value={form.omieStatus}
              onChange={(e) => setField('omieStatus', e.target.value as OmieStatus)}
            >
              <option value="ATIVO">Ativo</option>
              <option value="BLOQUEADO">Bloqueado</option>
            </Select>
          </FormField>
          <FormField label="Score (0–100)" htmlFor="f-score">
            <Input
              id="f-score"
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(e) => setField('score', Number(e.target.value))}
            />
          </FormField>
          <FormField label="Prazo pagamento (dias)" htmlFor="f-prazo">
            <Input
              id="f-prazo"
              type="number"
              min={0}
              max={180}
              value={form.prazoPagamento}
              onChange={(e) => setField('prazoPagamento', Number(e.target.value))}
            />
          </FormField>
        </div>
        {error && (
          <div
            data-testid="form-error"
            style={{
              ...card,
              borderColor: colors.danger,
              color: colors.danger,
              padding: '0.5rem 0.75rem',
              marginTop: '0.5rem',
            }}
          >
            {error}
          </div>
        )}
      </form>
      {isEdit && cliente && (
        <details style={{ marginTop: '1rem', fontSize: 12, color: colors.muted }}>
          <summary>Ações avançadas</summary>
          <DeleteClienteButton id={cliente.id} onDeleted={onSaved} />
        </details>
      )}
    </Modal>
  );
}

function DeleteClienteButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function doDelete() {
    setBusy(true);
    try {
      await api.delete(`/clientes/${id}`);
      onDeleted();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha ao excluir');
    } finally {
      setBusy(false);
    }
  }
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{ ...btnDanger, marginTop: '0.5rem' }}
      >
        Excluir cliente
      </button>
    );
  }
  return (
    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <span style={{ color: colors.danger }}>Confirmar exclusão?</span>
      <button type="button" disabled={busy} onClick={doDelete} style={btnDanger}>
        {busy ? '…' : 'Sim, excluir'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} style={btnSecondary}>
        Cancelar
      </button>
    </div>
  );
}
