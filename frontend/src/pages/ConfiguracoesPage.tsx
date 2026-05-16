import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select } from '@/components/FormField';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type Plano = 'Free' | 'Pro' | 'Enterprise';

interface Empresa {
  id: string;
  nome: string;
  cnpj?: string | null;
  ramo?: string | null;
  cidade?: string | null;
  uf?: string | null;
  subtitulo?: string | null;
  plano: Plano;
  ativo: boolean;
  criadoEm?: string;
}

const PLANO_COLOR: Record<Plano, string> = {
  Free: colors.muted,
  Pro: '#0891b2',
  Enterprise: '#7c3aed',
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

export default function ConfiguracoesPage() {
  const role = useRole();
  const isAdmin = role === 'ADMIN';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [ativo, setAtivo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Empresa | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (ativo) qs.set('ativo', ativo);
    return `/empresas?${qs.toString()}`;
  }, [page, search, ativo]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Empresa>>(
    isAdmin ? listPath : null,
  );

  async function toggleAtivo(emp: Empresa) {
    try {
      if (emp.ativo) {
        await api.delete(`/empresas/${emp.id}`);
      } else {
        await api.put(`/empresas/${emp.id}/ativar`);
      }
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha');
    }
  }

  if (!isAdmin) {
    return (
      <PageLayout title="Configurações">
        <div style={card}>
          <p>Apenas ADMIN pode acessar configurações de empresas.</p>
        </div>
      </PageLayout>
    );
  }

  const columns: Column<Empresa>[] = [
    {
      key: 'nome',
      header: 'Empresa',
      render: (e) => (
        <div>
          <div style={{ fontWeight: 600 }}>{e.nome}</div>
          {e.cnpj && <div style={{ fontSize: 11, color: colors.muted }}>{e.cnpj}</div>}
          {e.subtitulo && <div style={{ fontSize: 11, color: colors.muted }}>{e.subtitulo}</div>}
        </div>
      ),
    },
    {
      key: 'local',
      header: 'Local',
      render: (e) => (e.cidade ? `${e.cidade}${e.uf ? '/' + e.uf : ''}` : '—'),
    },
    { key: 'ramo', header: 'Ramo', render: (e) => e.ramo ?? '—' },
    {
      key: 'plano',
      header: 'Plano',
      render: (e) => <span style={badge(PLANO_COLOR[e.plano])}>{e.plano}</span>,
    },
    {
      key: 'ativo',
      header: 'Status',
      render: (e) => (
        <button
          type="button"
          data-testid={`emp-toggle-${e.id}`}
          onClick={() => toggleAtivo(e)}
          style={{
            ...badge(e.ativo ? colors.success : colors.muted),
            cursor: 'pointer',
            border: 'none',
            fontFamily: 'inherit',
          }}
        >
          {e.ativo ? 'ativo' : 'inativo'}
        </button>
      ),
    },
    {
      key: 'criado',
      header: 'Criado em',
      render: (e) => fmtDate(e.criadoEm),
    },
    {
      key: 'actions',
      header: '',
      render: (e) => (
        <button
          type="button"
          data-testid={`emp-edit-${e.id}`}
          onClick={() => setEditing(e)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Editar
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Configurações — Empresas"
      actions={
        <button
          type="button"
          data-testid="emp-new"
          onClick={() => setCreating(true)}
          style={btn}
        >
          + Nova empresa
        </button>
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
            placeholder="Nome, CNPJ…"
          />
          <Select
            data-testid="filter-ativo"
            value={ativo}
            onChange={(e) => {
              setAtivo(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            <option value="true">Apenas ativas</option>
            <option value="false">Apenas inativas</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma empresa cadastrada."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(e) => e.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {(creating || editing) && (
        <EmpresaFormModal
          empresa={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

function EmpresaFormModal({
  empresa,
  onClose,
  onSaved,
}: {
  empresa: Empresa | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(empresa);
  const [form, setForm] = useState({
    nome: empresa?.nome ?? '',
    cnpj: empresa?.cnpj ?? '',
    ramo: empresa?.ramo ?? '',
    cidade: empresa?.cidade ?? '',
    uf: empresa?.uf ?? '',
    subtitulo: empresa?.subtitulo ?? '',
    plano: empresa?.plano ?? 'Pro',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      plano: form.plano,
    };
    for (const k of ['cnpj', 'ramo', 'cidade', 'uf', 'subtitulo'] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      if (isEdit && empresa) {
        await api.patch(`/empresas/${empresa.id}`, payload);
      } else {
        await api.post('/empresas', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  async function doDeactivate() {
    if (!empresa) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/empresas/${empresa.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Editar ${empresa?.nome}` : 'Nova empresa'}
      width={620}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          {isEdit && empresa?.ativo && !confirmDel && (
            <button
              type="button"
              data-testid="emp-deactivate"
              onClick={() => setConfirmDel(true)}
              style={btnDanger}
            >
              Desativar
            </button>
          )}
          {isEdit && confirmDel && (
            <>
              <button type="button" onClick={() => setConfirmDel(false)} style={btnSecondary}>
                Voltar
              </button>
              <button
                type="button"
                data-testid="emp-deactivate-confirm"
                onClick={doDeactivate}
                disabled={busy}
                style={btnDanger}
              >
                {busy ? '…' : 'Confirmar desativação'}
              </button>
            </>
          )}
          {!confirmDel && (
            <button
              type="submit"
              form="emp-form"
              data-testid="emp-save"
              disabled={busy || form.nome.trim().length < 2}
              style={{ ...btn, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </>
      }
    >
      <form id="emp-form" onSubmit={submit}>
        <FormField label="Nome" required>
          <Input
            data-testid="emp-nome"
            value={form.nome}
            onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
            required
            minLength={2}
            maxLength={200}
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="CNPJ" hint="00.000.000/0001-00">
            <Input
              value={form.cnpj}
              onChange={(e) => setForm((s) => ({ ...s, cnpj: e.target.value }))}
              placeholder="00.000.000/0001-00"
            />
          </FormField>
          <FormField label="Plano">
            <Select
              value={form.plano}
              onChange={(e) => setForm((s) => ({ ...s, plano: e.target.value as Plano }))}
            >
              <option value="Free">Free</option>
              <option value="Pro">Pro</option>
              <option value="Enterprise">Enterprise</option>
            </Select>
          </FormField>
          <FormField label="Ramo">
            <Input
              value={form.ramo}
              onChange={(e) => setForm((s) => ({ ...s, ramo: e.target.value }))}
            />
          </FormField>
          <FormField label="Subtítulo / Tag">
            <Input
              value={form.subtitulo}
              onChange={(e) => setForm((s) => ({ ...s, subtitulo: e.target.value }))}
            />
          </FormField>
          <FormField label="Cidade">
            <Input
              value={form.cidade}
              onChange={(e) => setForm((s) => ({ ...s, cidade: e.target.value }))}
            />
          </FormField>
          <FormField label="UF">
            <Input
              maxLength={2}
              value={form.uf}
              onChange={(e) => setForm((s) => ({ ...s, uf: e.target.value.toUpperCase() }))}
            />
          </FormField>
        </div>
        {error && (
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
