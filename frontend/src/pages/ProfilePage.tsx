import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { getSession } from '@/lib/auth-store';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select } from '@/components/FormField';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

type UserRole = 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP';
type UserStatus = 'ATIVO' | 'PENDENTE' | 'INATIVO';

interface User {
  id: string;
  nome: string;
  email: string;
  telefone?: string | null;
  role: UserRole;
  status: UserStatus;
  regiao?: string | null;
  tetoDesconto?: number;
  comissaoPadrao?: number;
  gerente?: { id: string; nome: string } | null;
  empresas?: Array<{ id: string; nome: string }>;
  ultimoAcesso?: string | null;
  criadoEm?: string;
}

const ROLE_COLOR: Record<UserRole, string> = {
  ADMIN: '#7c3aed',
  DIRECTOR: colors.primary,
  GERENTE: '#0891b2',
  SAC: colors.warning,
  REP: colors.success,
};
const STATUS_COLOR: Record<UserStatus, string> = {
  ATIVO: colors.success,
  PENDENTE: colors.warning,
  INATIVO: colors.muted,
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

// ─── Component principal: decide entre Profile (próprio) ou Users (admin) ──

export default function ProfilePage() {
  const { id } = useParams<{ id?: string }>();
  const role = useRole();
  const session = getSession();

  const isAdminOrDirector = role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';
  const showList = !id && isAdminOrDirector;
  const targetId = id ?? session?.user.id ?? null;

  if (showList) {
    return <UsersList />;
  }
  if (!targetId) {
    return (
      <PageLayout title="Perfil">
        <p>Sem sessão ativa.</p>
      </PageLayout>
    );
  }
  return <UserDetail userId={targetId} isOwnProfile={targetId === session?.user.id} />;
}

// ─── List (admin) ────────────────────────────────────────────────────

function UsersList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '30' });
    if (search.trim()) qs.set('search', search.trim());
    if (roleFilter) qs.set('role', roleFilter);
    if (statusFilter) qs.set('status', statusFilter);
    return `/users?${qs.toString()}`;
  }, [page, search, roleFilter, statusFilter]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<User>>(listPath);

  const columns: Column<User>[] = [
    {
      key: 'user',
      header: 'Usuário',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600 }}>{u.nome}</div>
          <div style={{ fontSize: 11, color: colors.muted }}>{u.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Papel',
      render: (u) => <span style={badge(ROLE_COLOR[u.role])}>{u.role}</span>,
    },
    { key: 'regiao', header: 'Região', render: (u) => u.regiao ?? '—' },
    {
      key: 'teto',
      header: 'Teto desc.',
      render: (u) =>
        u.role === 'REP' && u.tetoDesconto !== undefined ? `${u.tetoDesconto}%` : '—',
    },
    {
      key: 'comissao',
      header: 'Comissão',
      render: (u) =>
        ['REP', 'GERENTE'].includes(u.role) && u.comissaoPadrao !== undefined
          ? `${u.comissaoPadrao}%`
          : '—',
    },
    {
      key: 'gerente',
      header: 'Gerente',
      render: (u) => u.gerente?.nome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <span style={badge(STATUS_COLOR[u.status])}>{u.status}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (u) => (
        <Link
          to={`/usuarios/${u.id}`}
          data-testid={`user-open-${u.id}`}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12, textDecoration: 'none' }}
        >
          Abrir
        </Link>
      ),
    },
  ];

  return (
    <PageLayout title="Usuários">
      <div style={card}>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Nome, e-mail…"
          />
          <Select
            data-testid="filter-role"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos papéis</option>
            <option value="ADMIN">ADMIN</option>
            <option value="DIRECTOR">DIRECTOR</option>
            <option value="GERENTE">GERENTE</option>
            <option value="SAC">SAC</option>
            <option value="REP">REP</option>
          </Select>
          <Select
            data-testid="filter-status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            <option value="ATIVO">Ativos</option>
            <option value="PENDENTE">Pendentes</option>
            <option value="INATIVO">Inativos</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhum usuário encontrado."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(u) => u.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>
    </PageLayout>
  );
}

// ─── Detail / Profile ────────────────────────────────────────────────

function UserDetail({ userId, isOwnProfile }: { userId: string; isOwnProfile: boolean }) {
  const role = useRole();
  const canEdit = role === 'ADMIN' || (isOwnProfile && role !== null);
  const isAdmin = role === 'ADMIN';
  const canSetTeto = isAdmin; // backend: ADMIN only
  const canSetComissao = isAdmin || role === 'DIRECTOR';

  const { data, loading, error, refetch } = useApiQuery<User>(`/users/${userId}`);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tetoModalOpen, setTetoModalOpen] = useState(false);
  const [comissaoModalOpen, setComissaoModalOpen] = useState(false);

  async function reenviarConvite() {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/users/${data.id}/reenviar-convite`);
      alert('Convite reenviado.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout
      title={data ? data.nome : 'Perfil'}
      actions={
        !isOwnProfile && (role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE') ? (
          <Link to="/usuarios" style={{ ...btnSecondary, textDecoration: 'none' }}>
            ← Voltar pra lista
          </Link>
        ) : undefined
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1rem', alignItems: 'start' }}>
            <div style={card}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={badge(ROLE_COLOR[data.role])}>{data.role}</span>
                <span style={badge(STATUS_COLOR[data.status])}>{data.status}</span>
                {isOwnProfile && (
                  <span style={{ fontSize: 12, color: colors.muted }}>(este sou eu)</span>
                )}
              </div>

              <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: 14 }}>
                <Info label="Nome">{data.nome}</Info>
                <Info label="E-mail">{data.email}</Info>
                <Info label="Telefone">{data.telefone ?? '—'}</Info>
                <Info label="Região">{data.regiao ?? '—'}</Info>
                {data.role === 'REP' && (
                  <>
                    <Info label="Teto desconto">{data.tetoDesconto ?? 0}%</Info>
                    <Info label="Gerente">{data.gerente?.nome ?? 'sem gerente'}</Info>
                  </>
                )}
                {['REP', 'GERENTE'].includes(data.role) && (
                  <Info label="Comissão %">{data.comissaoPadrao ?? 0}%</Info>
                )}
                <Info label="Último acesso">{fmtDate(data.ultimoAcesso)}</Info>
                <Info label="Criado em">{fmtDate(data.criadoEm)}</Info>
              </dl>

              {data.empresas && data.empresas.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: 'uppercase',
                      color: colors.muted,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Empresas vinculadas
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {data.empresas.map((e) => (
                      <span key={e.id} style={badge(colors.primary)}>
                        {e.nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {actionError && (
                <p style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>
                  {actionError}
                </p>
              )}
            </div>

            {/* Sidebar de ações */}
            <div style={card}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Ações</h3>
              {canEdit && (
                <button
                  type="button"
                  data-testid="user-edit-btn"
                  onClick={() => setEditing(true)}
                  style={{ ...btn, width: '100%', marginBottom: '0.5rem' }}
                >
                  Editar dados
                </button>
              )}
              {canSetTeto && data.role === 'REP' && (
                <button
                  type="button"
                  data-testid="user-teto-btn"
                  onClick={() => setTetoModalOpen(true)}
                  style={{ ...btnSecondary, width: '100%', marginBottom: '0.5rem' }}
                >
                  Definir teto desconto
                </button>
              )}
              {canSetComissao && ['REP', 'GERENTE'].includes(data.role) && (
                <button
                  type="button"
                  data-testid="user-comissao-btn"
                  onClick={() => setComissaoModalOpen(true)}
                  style={{ ...btnSecondary, width: '100%', marginBottom: '0.5rem' }}
                >
                  Definir comissão %
                </button>
              )}
              {isAdmin && data.status === 'PENDENTE' && (
                <button
                  type="button"
                  data-testid="user-resend-btn"
                  onClick={reenviarConvite}
                  disabled={busy}
                  style={{ ...btnSecondary, width: '100%' }}
                >
                  {busy ? 'Enviando…' : 'Reenviar convite'}
                </button>
              )}

              {isOwnProfile && (
                <div
                  style={{
                    marginTop: '1rem',
                    paddingTop: '0.75rem',
                    borderTop: `1px solid ${colors.border}`,
                    fontSize: 12,
                    color: colors.muted,
                  }}
                >
                  Suas integrações pessoais (OpenAI, WhatsApp, Calendar):
                  <br />
                  <Link to="/minhas-integracoes" style={{ color: colors.primary }}>
                    Minhas integrações →
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </StateView>

      {editing && data && (
        <EditUserModal
          user={data}
          isOwnProfile={isOwnProfile}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refetch();
          }}
        />
      )}
      {tetoModalOpen && data && (
        <SetTetoModal
          user={data}
          onClose={() => setTetoModalOpen(false)}
          onSaved={() => {
            setTetoModalOpen(false);
            refetch();
          }}
        />
      )}
      {comissaoModalOpen && data && (
        <SetComissaoModal
          user={data}
          onClose={() => setComissaoModalOpen(false)}
          onSaved={() => {
            setComissaoModalOpen(false);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: colors.muted,
          marginBottom: 2,
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────

function EditUserModal({
  user,
  isOwnProfile,
  onClose,
  onSaved,
}: {
  user: User;
  isOwnProfile: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const role = useRole();
  const isAdmin = role === 'ADMIN';
  // ADMIN pode mudar role/status; user comum só campos básicos do próprio
  const canChangeRole = isAdmin && !isOwnProfile;

  const [form, setForm] = useState({
    nome: user.nome,
    telefone: user.telefone ?? '',
    regiao: user.regiao ?? '',
    role: user.role,
    status: user.status,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só ADMIN pode salvar — usuário comum tem que pedir pra ADMIN
  // (endpoint PATCH /users/:id é restrito a ADMIN; sem `/users/me`)
  const canSave = isAdmin;

  useEffect(() => {
    if (!canSave) {
      setError('Apenas ADMIN pode editar usuários no momento. Peça pro admin alterar.');
    }
  }, [canSave]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { nome: form.nome.trim() };
    if (form.telefone.trim()) payload.telefone = form.telefone.trim();
    if (form.regiao.trim()) payload.regiao = form.regiao.trim();
    if (canChangeRole) {
      payload.role = form.role;
      payload.status = form.status;
    }
    try {
      await api.patch(`/users/${user.id}`, payload);
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
      title="Editar usuário"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {canSave && (
            <button
              type="submit"
              form="user-edit-form"
              data-testid="user-save-btn"
              disabled={busy || form.nome.trim().length < 2}
              style={btn}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </>
      }
    >
      <form id="user-edit-form" onSubmit={submit}>
        <FormField label="Nome" required>
          <Input
            value={form.nome}
            onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
            required
            minLength={2}
            maxLength={150}
            disabled={!canSave}
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Telefone">
            <Input
              value={form.telefone}
              onChange={(e) => setForm((s) => ({ ...s, telefone: e.target.value }))}
              disabled={!canSave}
            />
          </FormField>
          <FormField label="Região">
            <Input
              value={form.regiao}
              onChange={(e) => setForm((s) => ({ ...s, regiao: e.target.value }))}
              disabled={!canSave}
            />
          </FormField>
          {canChangeRole && (
            <>
              <FormField label="Papel">
                <Select
                  value={form.role}
                  onChange={(e) => setForm((s) => ({ ...s, role: e.target.value as UserRole }))}
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="DIRECTOR">DIRECTOR</option>
                  <option value="GERENTE">GERENTE</option>
                  <option value="SAC">SAC</option>
                  <option value="REP">REP</option>
                </Select>
              </FormField>
              <FormField label="Status">
                <Select
                  value={form.status}
                  onChange={(e) => setForm((s) => ({ ...s, status: e.target.value as UserStatus }))}
                >
                  <option value="ATIVO">Ativo</option>
                  <option value="PENDENTE">Pendente</option>
                  <option value="INATIVO">Inativo</option>
                </Select>
              </FormField>
            </>
          )}
        </div>
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}

// ─── Set teto desconto ───────────────────────────────────────────────

function SetTetoModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [teto, setTeto] = useState(user.tetoDesconto ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/users/${user.id}/teto-desconto`, { tetoDesconto: teto });
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
      title={`Teto de desconto — ${user.nome}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid="teto-save"
            disabled={busy}
            onClick={submit}
            style={btn}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14, color: colors.muted }}>
        Desconto máximo que o rep pode aplicar sem aprovação. Acima disso, o pedido entra em
        fluxo de aprovação via Gerente/Diretor.
      </p>
      <FormField label="Teto desconto (%)" htmlFor="teto-input">
        <Input
          id="teto-input"
          data-testid="teto-input"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={teto}
          onChange={(e) => setTeto(Number(e.target.value))}
        />
      </FormField>
      {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}

// ─── Set comissão ─────────────────────────────────────────────────────

function SetComissaoModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [com, setCom] = useState(user.comissaoPadrao ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/users/${user.id}/comissao`, { comissaoPercentual: com });
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
      title={`Comissão — ${user.nome}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid="comissao-save"
            disabled={busy}
            onClick={submit}
            style={btn}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14, color: colors.muted }}>
        {user.role === 'REP'
          ? '% de comissão sobre o total dos pedidos próprios do rep.'
          : '% de comissão do GERENTE sobre o total de vendas dos REPs sob a gerência dele.'}
      </p>
      <FormField label="Comissão (%)" htmlFor="com-input">
        <Input
          id="com-input"
          data-testid="comissao-input"
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={com}
          onChange={(e) => setCom(Number(e.target.value))}
        />
      </FormField>
      {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
    </Modal>
  );
}
