import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { FormField, Input, Select } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';
import { isValidCNPJ, maskCNPJ, maskTelefone, normalizeUF, stripMask } from '@/lib/masks';
import { exportToCsv } from '@/lib/csv';
import { exportToXlsx } from '@/lib/xlsx';
import { exportToDocx } from '@/lib/docx';
import { exportToPdf } from '@/lib/pdf';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

interface RepOpt {
  id: string;
  nome: string;
  email?: string;
}

type ClienteStatus = 'ATIVO' | 'NOVO' | 'PROSPECT' | 'RISCO' | 'CRITICO' | 'INATIVO';
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
  ATIVO: colors.success,
  NOVO: '#0891b2',
  PROSPECT: '#7c3aed',
  RISCO: colors.warning,
  CRITICO: colors.danger,
  INATIVO: colors.muted,
};

const OMIE_COLORS: Record<OmieStatus, string> = {
  ATIVO: colors.success,
  BLOQUEADO: colors.danger,
};

export default function ClientesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const canEdit = usePermission('clientes.edit');
  const canBulk = usePermission('clientes.bulkAssign');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ page: number; total: number } | null>(null);

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

  // Modal de criação rápida (edição vai pra /clientes/:id)
  const [creating, setCreating] = useState(false);
  const onSaved = () => {
    setCreating(false);
    refetch();
  };

  // Bulk selection (apenas quando canBulk)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const currentPageIds = page$?.data.map((c) => c.id) ?? [];
  const allCurrentSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllCurrent() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allCurrentSelected) {
        for (const id of currentPageIds) next.delete(id);
      } else {
        for (const id of currentPageIds) next.add(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  const columns: Column<Cliente>[] = [
    ...(canBulk
      ? [
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                data-testid="bulk-select-all"
                checked={allCurrentSelected}
                onChange={toggleAllCurrent}
                aria-label="Selecionar todos da página"
              />
            ) as React.ReactNode,
            render: (c: Cliente) => (
              <input
                type="checkbox"
                data-testid={`bulk-select-${c.id}`}
                checked={selectedIds.has(c.id)}
                onChange={() => toggleOne(c.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Selecionar ${c.nome}`}
              />
            ),
            width: 32,
          } as Column<Cliente>,
        ]
      : []),
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
      render: (c) => (
        <button
          type="button"
          data-testid={`cliente-open-${c.id}`}
          onClick={() => navigate(`/clientes/${c.id}`)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Abrir
        </button>
      ),
    },
  ];

  async function handleExport(formato: 'csv' | 'xlsx' | 'docx' | 'pdf') {
    setExporting(true);
    setExportProgress(null);
    try {
      const query: Record<string, string> = {};
      if (search.trim()) query.search = search.trim();
      if (status) query.status = status;
      if (omie) query.omieStatus = omie;
      if (lista) query.lista = lista;
      const data = new Date().toISOString().slice(0, 10);
      const columns = [
        { header: 'Nome', value: (c: Cliente) => c.nome },
        { header: 'CNPJ', value: (c: Cliente) => c.cnpj ?? '' },
        { header: 'E-mail', value: (c: Cliente) => c.email ?? '' },
        { header: 'Telefone', value: (c: Cliente) => c.telefone ?? '' },
        { header: 'Cidade', value: (c: Cliente) => c.cidade ?? '' },
        { header: 'UF', value: (c: Cliente) => c.uf ?? '' },
        { header: 'Segmento', value: (c: Cliente) => c.segmento ?? '' },
        { header: 'Status', value: (c: Cliente) => c.status },
        { header: 'OMIE', value: (c: Cliente) => c.omieStatus },
        { header: 'Score', value: (c: Cliente) => c.score },
        { header: 'Representante', value: (c: Cliente) => c.representante?.nome ?? '' },
      ];
      const filename = `clientes-${data}.${formato}`;
      let count = 0;
      if (formato === 'csv') {
        ({ count } = await exportToCsv<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          onProgress: (page, total) => setExportProgress({ page, total }),
          columns,
        }));
      } else if (formato === 'xlsx') {
        ({ count } = await exportToXlsx<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          onProgress: (page, total) => setExportProgress({ page, total }),
          columns,
        }));
      } else if (formato === 'docx') {
        ({ count } = await exportToDocx<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          titulo: 'Lista de Clientes',
          onProgress: (page, total) => setExportProgress({ page, total }),
          columns,
        }));
      } else {
        ({ count } = await exportToPdf<Cliente>({
          endpoint: '/clientes',
          query,
          filename,
          titulo: 'Lista de Clientes',
          columns,
        }));
      }
      toast.success(
        `${count} cliente${count === 1 ? '' : 's'} exportado${count === 1 ? '' : 's'}`,
        `${formato.toUpperCase()} baixado`,
      );
    } catch (err) {
      toast.error('Falha ao exportar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  return (
    <PageLayout
      title="Clientes"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            data-testid="cliente-export-btn"
            onClick={() => handleExport('csv')}
            disabled={exporting}
            style={{
              ...btnSecondary,
              opacity: exporting ? 0.6 : 1,
              cursor: exporting ? 'progress' : 'pointer',
            }}
          >
            {exporting
              ? exportProgress
                ? `Exportando ${exportProgress.page}/${exportProgress.total}…`
                : 'Exportando…'
              : '📥 CSV'}
          </button>
          <button
            type="button"
            data-testid="cliente-export-xlsx-btn"
            onClick={() => handleExport('xlsx')}
            disabled={exporting}
            style={{ ...btnSecondary, opacity: exporting ? 0.6 : 1 }}
          >
            📊 Excel
          </button>
          <button
            type="button"
            data-testid="cliente-export-docx-btn"
            onClick={() => handleExport('docx')}
            disabled={exporting}
            style={{ ...btnSecondary, opacity: exporting ? 0.6 : 1 }}
          >
            📄 Word
          </button>
          <button
            type="button"
            data-testid="cliente-export-pdf-btn"
            onClick={() => handleExport('pdf')}
            disabled={exporting}
            style={{ ...btnSecondary, opacity: exporting ? 0.6 : 1 }}
          >
            📕 PDF
          </button>
          {canEdit && (
            <button
              type="button"
              data-testid="cliente-new-btn"
              onClick={() => setCreating(true)}
              style={btn}
            >
              + Novo cliente
            </button>
          )}
        </div>
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
            <option value="ATIVO">Ativo</option>
            <option value="NOVO">Novo</option>
            <option value="PROSPECT">Prospect</option>
            <option value="RISCO">Em risco</option>
            <option value="CRITICO">Crítico</option>
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

      </div>

      {/* Floating bulk action bar */}
      {canBulk && selectedIds.size > 0 && (
        <div
          data-testid="bulk-bar"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: colors.text,
            color: '#fff',
            borderRadius: 999,
            padding: '0.625rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            zIndex: 100,
            fontSize: 14,
          }}
        >
          <span data-testid="bulk-count">
            <strong>{selectedIds.size}</strong> cliente{selectedIds.size === 1 ? '' : 's'} selecionado{selectedIds.size === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            data-testid="bulk-assign-open"
            onClick={() => setBulkOpen(true)}
            style={{ ...btn, padding: '0.375rem 1rem' }}
          >
            Atribuir representante
          </button>
          <button
            type="button"
            data-testid="bulk-clear"
            onClick={clearSelection}
            style={{
              background: 'transparent',
              border: '1px solid #ffffff66',
              color: '#fff',
              padding: '0.375rem 1rem',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          >
            Limpar
          </button>
        </div>
      )}

      {creating && (
        <ClienteFormModal
          open
          cliente={null}
          onClose={() => setCreating(false)}
          onSaved={onSaved}
        />
      )}
      {bulkOpen && (
        <BulkAssignModal
          clienteIds={Array.from(selectedIds)}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            clearSelection();
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

function BulkAssignModal({
  clienteIds,
  onClose,
  onDone,
}: {
  clienteIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rep, setRep] = useState<RepOpt | null>(null);
  const [removeRep, setRemoveRep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/clientes/atribuir-rep-massa', {
        clienteIds,
        representanteId: removeRep ? null : rep?.id,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  const valid = removeRep || rep !== null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Atribuir rep em ${clienteIds.length} cliente${clienteIds.length === 1 ? '' : 's'}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid="bulk-confirm"
            onClick={submit}
            disabled={busy || !valid}
            style={{ ...btn, opacity: busy || !valid ? 0.6 : 1 }}
          >
            {busy ? 'Aplicando…' : removeRep ? 'Remover rep dos selecionados' : 'Atribuir'}
          </button>
        </>
      }
    >
      <FormField label="Representante" hint={removeRep ? 'Vai remover rep atual de todos' : 'Cada selecionado vai ficar com este rep'}>
        <AsyncCombobox<RepOpt>
          testId="bulk-rep-picker"
          endpoint="/users"
          placeholder="Buscar representante…"
          getLabel={(r) => r.nome}
          getSubLabel={(r) => r.email ?? null}
          getId={(r) => r.id}
          value={rep}
          onChange={(r) => {
            setRep(r);
            if (r) setRemoveRep(false);
          }}
          extraQuery={{ role: 'REP' }}
          disabled={removeRep}
        />
      </FormField>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: 13,
          marginTop: '0.5rem',
        }}
      >
        <input
          type="checkbox"
          data-testid="bulk-remove-rep"
          checked={removeRep}
          onChange={(e) => {
            setRemoveRep(e.target.checked);
            if (e.target.checked) setRep(null);
          }}
        />
        Remover representante (deixar sem rep)
      </label>
      {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>{error}</p>}
    </Modal>
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

    // Validação client-side antes de chamar API
    if (form.cnpj.trim() && !isValidCNPJ(form.cnpj)) {
      setError('CNPJ inválido. Confira os dígitos verificadores.');
      return;
    }
    if (form.uf.trim() && form.uf.trim().length !== 2) {
      setError('UF deve ter 2 letras (ex: SP, RJ).');
      return;
    }
    if (form.telefone.trim() && stripMask(form.telefone).length < 10) {
      setError('Telefone incompleto — informe DDD + número.');
      return;
    }

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
              onChange={(e) => setField('cnpj', maskCNPJ(e.target.value))}
              placeholder="00.000.000/0001-00"
              maxLength={18}
              inputMode="numeric"
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
              onChange={(e) => setField('telefone', maskTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              maxLength={15}
              inputMode="tel"
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
              onChange={(e) => setField('uf', normalizeUF(e.target.value))}
            />
          </FormField>
          <FormField label="Status" htmlFor="f-status">
            <Select
              id="f-status"
              value={form.status}
              onChange={(e) => setField('status', e.target.value as ClienteStatus)}
            >
              <option value="ATIVO">Ativo</option>
              <option value="NOVO">Novo</option>
              <option value="PROSPECT">Prospect</option>
              <option value="RISCO">Em risco</option>
              <option value="CRITICO">Crítico</option>
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
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function doDelete() {
    setBusy(true);
    try {
      await api.delete(`/clientes/${id}`);
      toast.success('Cliente excluído');
      onDeleted();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
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
