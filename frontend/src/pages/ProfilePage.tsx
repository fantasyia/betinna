import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { getSession } from '@/lib/auth-store';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select } from '@/components/FormField';
import { useToast } from '@/components/toast';
import { maskTelefone } from '@/lib/masks';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';
import { startOnboarding } from '@/components/OnboardingTour';

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

// ─── Component principal: decide entre Profile (próprio) ou Users (lista) ──
//
// Roteamento (fix R4 — 2026-05-21):
//   /perfil           → SEMPRE meu próprio detalhe (mesmo se for ADMIN)
//   /usuarios         → SEMPRE lista de usuários (com permissão de role)
//   /usuarios/:id     → detalhe de outro usuário (admin abrindo)
//
// Antes a regra dependia só do `id`, então admin/director/gerente caíam
// em UsersList em AMBAS as rotas — daí a sensação de 'tudo igual'.

export default function ProfilePage() {
  const { id } = useParams<{ id?: string }>();
  const role = useRole();
  const session = getSession();
  const location = useLocation();

  // Decide visualização baseado na ROTA, não na role:
  // - /usuarios sem id → lista (se tem permissão de gerenciar usuários)
  // - /perfil ou /perfil/:id ou /usuarios/:id → detalhe
  const isUsuariosRoute = location.pathname.startsWith('/usuarios');
  const isAdminOrDirector = role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';
  const showList = isUsuariosRoute && !id && isAdminOrDirector;
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
  const role = useRole();
  const canInvite = role === 'ADMIN' || role === 'DIRECTOR';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);

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
    <PageLayout
      title="Usuários"
      actions={
        canInvite ? (
          <button
            type="button"
            data-testid="user-invite-btn"
            onClick={() => setCreating(true)}
            style={btn}
          >
            + Novo usuário
          </button>
        ) : undefined
      }
    >
      <SistemaTabs />
      {creating && (
        <ConvidarUsuarioModal
          callerRole={role}
          callerEmpresaId={getSession()?.user.empresaIdAtiva ?? null}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refetch();
          }}
        />
      )}
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
  const toast = useToast();
  const canEdit = role === 'ADMIN' || (isOwnProfile && role !== null);
  const isAdmin = role === 'ADMIN';
  // D46+D48: teto-desconto e comissão = DIRECTOR (mandatário do tenant) OU
  // ADMIN (master da plataforma). Outros papéis bloqueados.
  const canSetTeto = role === 'DIRECTOR' || role === 'ADMIN';
  const canSetComissao = role === 'DIRECTOR' || role === 'ADMIN';

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
      toast.success('Convite reenviado', `E-mail enviado pra ${data.email}`);
    } catch (err) {
      const motivo = err instanceof ApiError ? err.message : 'Erro inesperado';
      // Log estruturado pra diagnóstico.
      console.error('[convite] falha ao reenviar', { userId: data.id, email: data.email, motivo });
      setActionError(motivo);
      toast.error(
        `Não foi possível enviar o e-mail para ${data.email}`,
        `${motivo} Verifique e tente novamente.`,
        { sticky: true, action: { label: 'Tentar novamente', onClick: () => void reenviarConvite() } },
      );
    } finally {
      setBusy(false);
    }
  }

  async function desativarUsuario() {
    if (!data) return;
    const confirm = window.confirm(
      `Desativar ${data.nome}?\n\nO usuário NÃO poderá mais fazer login, ` +
        `mas o histórico (pedidos, comissões, audit log) é preservado. ` +
        `Você pode reativar depois.`,
    );
    if (!confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/users/${data.id}`);
      toast.success('Usuário desativado', `${data.nome} não poderá mais entrar.`);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao desativar');
    } finally {
      setBusy(false);
    }
  }

  async function reativarUsuario() {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.put(`/users/${data.id}/ativar`);
      toast.success('Usuário reativado', `${data.nome} pode entrar novamente.`);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao reativar');
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
      <SistemaTabs />
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
                  style={{ ...btnSecondary, width: '100%', marginBottom: '0.5rem' }}
                >
                  {busy ? 'Enviando…' : 'Reenviar convite'}
                </button>
              )}

              {/* Desativar/Reativar — só ADMIN, nunca pra si próprio */}
              {isAdmin && !isOwnProfile && data.status !== 'INATIVO' && (
                <button
                  type="button"
                  data-testid="user-deactivate-btn"
                  onClick={desativarUsuario}
                  disabled={busy}
                  style={{
                    ...btnSecondary,
                    width: '100%',
                    color: colors.danger,
                    borderColor: colors.danger,
                    marginTop: '0.5rem',
                  }}
                >
                  {busy ? 'Aguarde…' : 'Desativar usuário'}
                </button>
              )}
              {isAdmin && !isOwnProfile && data.status === 'INATIVO' && (
                <button
                  type="button"
                  data-testid="user-reactivate-btn"
                  onClick={reativarUsuario}
                  disabled={busy}
                  style={{
                    ...btnSecondary,
                    width: '100%',
                    color: colors.success,
                    borderColor: colors.success,
                    marginTop: '0.5rem',
                  }}
                >
                  {busy ? 'Aguarde…' : 'Reativar usuário'}
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
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      data-testid="restart-tour-btn"
                      onClick={startOnboarding}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: colors.primary,
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 12,
                        textAlign: 'left',
                      }}
                    >
                      🎓 Reiniciar tour de onboarding
                    </button>
                  </div>
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
  // Banner informativo (linha sutil) em vez de error trancante.
  // Antes: useEffect setava setError() logo na montagem → modal abria com
  // mensagem "erro" e usuário achava que algo quebrou. Agora é um aviso
  // calmo e o botão Cancelar continua funcionando normalmente.

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
        {!canSave && (
          <div
            style={{
              padding: '0.625rem 0.75rem',
              marginBottom: '0.875rem',
              background: '#fef3c7',
              border: '1px solid #facc15',
              borderRadius: 6,
              fontSize: 13,
              color: '#78350f',
            }}
          >
            Apenas ADMIN pode salvar alterações. Você pode visualizar os campos
            abaixo, mas precisa pedir pro admin alterar.
          </div>
        )}
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
              onChange={(e) => setForm((s) => ({ ...s, telefone: maskTelefone(e.target.value) }))}
              disabled={!canSave}
              placeholder="(00) 00000-0000"
              maxLength={15}
              inputMode="tel"
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

// ─── Convidar novo usuário (U2 lote 4 — 2026-05-22) ──────────────────
//
// Modal usado pelo botão "+ Novo usuário" da UsersList. Faz POST /users —
// backend cria no Supabase Auth e dispara e-mail de convite. Regras de
// escopo no backend:
//   - ADMIN: pode convidar qualquer papel pra qualquer(s) empresa(s)
//   - DIRECTOR: só pra empresa ativa dele, e NÃO pode criar ADMIN/DIRECTOR
//
// Frontend reflete isso na UI: pra DIRECTOR esconde 'ADMIN' e 'DIRECTOR'
// nas opções de papel; e força empresaIds = [empresa ativa do caller].

interface EmpresaOpt {
  id: string;
  nome: string;
}

function ConvidarUsuarioModal({
  callerRole,
  callerEmpresaId,
  onClose,
  onCreated,
}: {
  callerRole: UserRole | null;
  callerEmpresaId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const isDirector = callerRole === 'DIRECTOR';
  const { data: empresas } = useApiQuery<EmpresaOpt[]>('/empresas/minhas');

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [novoRole, setNovoRole] = useState<UserRole>('REP');
  const [regiao, setRegiao] = useState('');
  const [empresaIds, setEmpresaIds] = useState<string[]>(
    callerEmpresaId ? [callerEmpresaId] : [],
  );
  const [tetoDesconto, setTetoDesconto] = useState<number>(5);
  const [comissaoPadrao, setComissaoPadrao] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // DIRECTOR só pode convidar GERENTE/SAC/REP — esconde ADMIN/DIRECTOR
  const rolesPermitidos: UserRole[] = isDirector
    ? ['GERENTE', 'SAC', 'REP']
    : ['DIRECTOR', 'GERENTE', 'SAC', 'REP'];

  function toggleEmpresa(id: string) {
    setEmpresaIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (nome.trim().length < 2) {
      setErr('Nome obrigatório (mínimo 2 caracteres).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr('E-mail inválido.');
      return;
    }
    if (empresaIds.length === 0) {
      setErr('Selecione pelo menos uma empresa.');
      return;
    }
    if (novoRole === 'REP' && !regiao.trim()) {
      setErr('Região é obrigatória para representantes.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        nome: nome.trim(),
        email: email.trim(),
        role: novoRole,
        empresaIds,
      };
      if (telefone.trim()) payload.telefone = telefone.trim();
      if (regiao.trim()) payload.regiao = regiao.trim();
      if (novoRole === 'REP') {
        payload.tetoDesconto = tetoDesconto;
      }
      if (novoRole === 'REP' || novoRole === 'GERENTE') {
        payload.comissaoPadrao = comissaoPadrao;
      }
      const created = await api.post<{ emailAviso?: string }>('/users', payload);
      if (created?.emailAviso) {
        // Usuário criado, mas o e-mail não saiu — avisa em vez de "sucesso" falso.
        console.error('[convite] usuário criado mas e-mail falhou', {
          email: email.trim(),
          motivo: created.emailAviso,
        });
        toast.warning(
          `Usuário criado, mas o e-mail não saiu para ${email.trim()}`,
          `${created.emailAviso} Reenvie o convite pelo perfil do usuário.`,
          { sticky: true },
        );
      } else {
        toast.success(
          'Convite enviado',
          `O usuário receberá um e-mail em ${email.trim()} pra criar a senha.`,
        );
      }
      onCreated();
    } catch (e2) {
      const motivo = e2 instanceof ApiError ? e2.message : 'Falha ao convidar usuário';
      console.error('[convite] falha ao convidar usuário', { email: email.trim(), motivo });
      setErr(motivo);
      toast.error(
        `Não foi possível convidar ${email.trim()}`,
        `${motivo} Verifique e tente novamente.`,
        { action: { label: 'Tentar novamente', onClick: () => void submit(e) } },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Convidar novo usuário"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="invite-user-form"
            data-testid="user-invite-save"
            disabled={busy}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Enviando…' : 'Enviar convite'}
          </button>
        </>
      }
    >
      <form id="invite-user-form" onSubmit={submit}>
        <FormField label="Nome" htmlFor="inv-nome" required>
          <Input
            id="inv-nome"
            data-testid="user-invite-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome completo"
            autoFocus
            required
          />
        </FormField>
        <FormField label="E-mail" htmlFor="inv-email" required>
          <Input
            id="inv-email"
            data-testid="user-invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@empresa.com"
            required
          />
        </FormField>
        <FormField label="Telefone (opcional)" htmlFor="inv-tel">
          <Input
            id="inv-tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="+55 11 91234-5678"
          />
        </FormField>
        <FormField label="Papel" htmlFor="inv-role" required>
          <Select
            id="inv-role"
            data-testid="user-invite-role"
            value={novoRole}
            onChange={(e) => setNovoRole(e.target.value as UserRole)}
          >
            {rolesPermitidos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </FormField>
        {novoRole === 'REP' && (
          <FormField
            label="Região"
            htmlFor="inv-regiao"
            required
            hint="Ex: SP-Capital, Sul, Norte… (usado em segmentação e relatórios)"
          >
            <Input
              id="inv-regiao"
              value={regiao}
              onChange={(e) => setRegiao(e.target.value)}
              placeholder="SP-Capital"
            />
          </FormField>
        )}
        {/* Empresas: ADMIN escolhe; DIRECTOR vê só sua empresa ativa (fixo) */}
        <FormField label="Empresa(s) vinculada(s)" required>
          {isDirector ? (
            <div
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: 13,
                background: colors.surfaceHover,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                color: colors.muted,
              }}
            >
              {empresas?.find((e) => e.id === callerEmpresaId)?.nome ?? 'Sua empresa ativa'}
              <div style={{ fontSize: 11, marginTop: 4 }}>
                DIRECTOR só pode convidar pra empresa ativa.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 160,
                overflowY: 'auto',
                padding: '0.5rem',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
              }}
            >
              {(empresas ?? []).map((emp) => (
                <label
                  key={emp.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={empresaIds.includes(emp.id)}
                    onChange={() => toggleEmpresa(emp.id)}
                  />
                  {emp.nome}
                </label>
              ))}
              {empresas && empresas.length === 0 && (
                <span style={{ fontSize: 12, color: colors.muted }}>
                  Nenhuma empresa disponível.
                </span>
              )}
            </div>
          )}
        </FormField>
        {novoRole === 'REP' && (
          <FormField label="Teto de desconto (%)" htmlFor="inv-teto">
            <Input
              id="inv-teto"
              type="number"
              min={0}
              max={100}
              value={tetoDesconto}
              onChange={(e) => setTetoDesconto(Number(e.target.value))}
            />
          </FormField>
        )}
        {(novoRole === 'REP' || novoRole === 'GERENTE') && (
          <FormField
            label="Comissão padrão (%)"
            htmlFor="inv-com"
            hint={
              novoRole === 'GERENTE'
                ? 'Sobre o total dos REPs sob gerência'
                : 'Sobre os pedidos próprios'
            }
          >
            <Input
              id="inv-com"
              type="number"
              min={0}
              max={100}
              value={comissaoPadrao}
              onChange={(e) => setComissaoPadrao(Number(e.target.value))}
            />
          </FormField>
        )}
        {err && (
          <p
            data-testid="user-invite-error"
            style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}
          >
            {err}
          </p>
        )}
      </form>
    </Modal>
  );
}
