import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckSquare, RotateCcw, Square, UserCog } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { refreshPermissoes } from '@/lib/permissions-store';
import { cn } from '@/lib/cn';

type Role = 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP';

// Equivalentes Tailwind pixel-idênticos dos objetos legados.
const BTN_SEC =
  'bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';
const BTN_MINI =
  'inline-flex items-center gap-1.5 bg-surface text-text border border-border-strong rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed';
const CARD = 'bg-surface border border-border rounded-[10px] p-6';

const MODULES = [
  'dashboard',
  'kanban',
  'clientes',
  'pedidos',
  'propostas',
  'fluxos',
  'campanhas',
  'inbox',
  'marketplace',
  'ocorrencias',
  'reps',
  'catalogo',
  'comissoes',
  'amostras',
  'metas',
  'relatorios',
  'config',
  'aprovacoes',
  'agenda',
  'integracoes',
  'audit_log',
] as const;

type ModuleName = (typeof MODULES)[number];

const MODULE_LABEL: Record<ModuleName, string> = {
  dashboard: 'Dashboard',
  kanban: 'Leads (Kanban)',
  clientes: 'Clientes',
  pedidos: 'Pedidos',
  propostas: 'Propostas',
  fluxos: 'Fluxos automação',
  campanhas: 'Campanhas',
  inbox: 'Inbox',
  marketplace: 'Marketplaces',
  ocorrencias: 'Ocorrências/SAC',
  reps: 'Representantes',
  catalogo: 'Catálogo',
  comissoes: 'Comissões',
  amostras: 'Amostras',
  metas: 'Metas',
  relatorios: 'Relatórios',
  config: 'Configurações',
  aprovacoes: 'Aprovações',
  agenda: 'Agenda',
  integracoes: 'Integrações',
  audit_log: 'Audit log',
};

const ROLES: Role[] = ['DIRECTOR', 'GERENTE', 'SAC', 'REP'];
// ADMIN não está aqui — tem bypass total no PermissionsGuard

const ROLE_COLOR: Record<Role, string> = {
  ADMIN: '#7c3aed',
  DIRECTOR: '#2563eb',
  GERENTE: '#0891b2',
  SAC: 'var(--warning)',
  REP: 'var(--success)',
};

interface PermissaoRow {
  modulo: string;
  podeVer: boolean;
  podeEditar: boolean;
  /** Só no modo por-usuário: true quando é override individual (≠ padrão do papel). */
  override?: boolean;
}

type Modo = 'papel' | 'usuario';

export default function PermissoesPage() {
  const [modo, setModo] = useState<Modo>('papel');
  const [role, setRole] = useState<Role>('REP');

  return (
    <PageLayout
      title="Permissões granulares"
      actions={
        <Link
          to="/admin"
          data-testid="perm-back-admin"
          className={cn(BTN_SEC, 'no-underline inline-flex items-center gap-1.5')}
        >
          <ArrowLeft size={14} />
          Voltar pro Painel Admin
        </Link>
      }
    >
      <div className="mb-3">
        <p className="m-0 text-muted text-base">
          Configure quais módulos cada papel pode <strong>ver</strong> e <strong>editar</strong>.
          ADMIN sempre tem acesso total (bypass). Na aba <strong>Por usuário</strong> você ajusta
          exceções individuais — o usuário nasce com o padrão do papel.
        </p>
      </div>

      {/* Modo: por papel × por usuário */}
      <div role="tablist" aria-label="Modo de edição" className="flex gap-2 mb-3">
        <ModoTab
          ativo={modo === 'papel'}
          onClick={() => setModo('papel')}
          testId="perm-modo-papel"
          label="Por papel"
        />
        <ModoTab
          ativo={modo === 'usuario'}
          onClick={() => setModo('usuario')}
          testId="perm-modo-usuario"
          label="Por usuário"
          icon={<UserCog size={13} />}
        />
      </div>

      {modo === 'papel' ? (
        <>
          {/* Tabs por role */}
          <div role="tablist" className="flex border-b border-border mb-4">
            {ROLES.map((r) => (
              <RoleTab key={r} role={r} active={r === role} onClick={() => setRole(r)} />
            ))}
            {/* ADMIN como info-only */}
            <div className="py-2.5 px-4 text-[13px] text-muted ml-auto italic">
              ADMIN tem acesso total automaticamente
            </div>
          </div>

          <PermissionMatrix key={role} role={role} />
        </>
      ) : (
        <UserPermissions />
      )}
    </PageLayout>
  );
}

function ModoTab({
  ativo,
  onClick,
  label,
  testId,
  icon,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  testId: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium cursor-pointer border',
        ativo
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-surface text-muted border-border-strong hover:bg-surface-hover',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function RoleTab({
  role,
  active,
  onClick,
}: {
  role: Role;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`role-tab-${role}`}
      onClick={onClick}
      className={cn(
        'border-b-2 py-2.5 px-4 cursor-pointer text-base -mb-px',
        active ? 'bg-surface font-semibold' : 'bg-transparent border-transparent font-medium text-muted',
      )}
      style={active ? { borderBottomColor: ROLE_COLOR[role], color: ROLE_COLOR[role] } : undefined}
    >
      {role}
    </button>
  );
}

// ─── Matriz compartilhada (papel OU usuário) ────────────────────────────────

interface MatrixCoreProps {
  /** Título do cabeçalho (badge). */
  badge: { label: string; color: string };
  perms: Map<string, { podeVer: boolean; podeEditar: boolean; override?: boolean }>;
  savingKey: string | null;
  saveError: string | null;
  bulkBusy: boolean;
  onToggle: (modulo: string, field: 'podeVer' | 'podeEditar', next: boolean) => void;
  onBulk: (kind: 'ver' | 'tudo' | 'nada') => void;
  /** Modo usuário: reset de override por módulo. */
  onResetModulo?: (modulo: string) => void;
  footer: React.ReactNode;
}

function MatrixCore({
  badge,
  perms,
  savingKey,
  saveError,
  bulkBusy,
  onToggle,
  onBulk,
  onResetModulo,
  footer,
}: MatrixCoreProps) {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="m-0 text-lg">
          {onResetModulo ? 'Usuário:' : 'Papel:'}{' '}
          <span
            className="inline-flex items-center rounded-full px-[9px] py-0.5 text-xs font-semibold leading-[1.6] tracking-[0.2px]"
            style={{
              backgroundColor: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
              color: badge.color,
              border: `1px solid color-mix(in srgb, ${badge.color} 19%, transparent)`,
            }}
          >
            {badge.label}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {/* Seleção em massa */}
          <button
            type="button"
            className={BTN_MINI}
            disabled={bulkBusy}
            onClick={() => onBulk('ver')}
            data-testid="perm-bulk-ver"
            title="Todos os módulos com Ver (sem Editar)"
          >
            <CheckSquare size={13} />
            Marcar todos (Ver)
          </button>
          <button
            type="button"
            className={BTN_MINI}
            disabled={bulkBusy}
            onClick={() => onBulk('tudo')}
            data-testid="perm-bulk-tudo"
            title="Todos os módulos com Ver + Editar"
          >
            <CheckSquare size={13} />
            Marcar todos (Ver+Editar)
          </button>
          <button
            type="button"
            className={BTN_MINI}
            disabled={bulkBusy}
            onClick={() => onBulk('nada')}
            data-testid="perm-bulk-nada"
            title="Remove Ver e Editar de todos os módulos"
          >
            <Square size={13} />
            Desmarcar todos
          </button>
          <span className="text-xs text-muted ml-1">
            {perms.size > 0 &&
              `${Array.from(perms.values()).filter((p) => p.podeVer).length}/${MODULES.length} módulos com acesso`}
          </span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 border-b border-border text-[11px] uppercase text-muted font-semibold">
                Módulo
              </th>
              <th className="w-[100px] text-center p-2 border-b border-border text-[11px] uppercase text-muted font-semibold">
                Ver
              </th>
              <th className="w-[100px] text-center p-2 border-b border-border text-[11px] uppercase text-muted font-semibold">
                Editar
              </th>
              {onResetModulo && (
                <th className="w-[110px] text-center p-2 border-b border-border text-[11px] uppercase text-muted font-semibold">
                  Origem
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => {
              const p = perms.get(m) ?? { podeVer: false, podeEditar: false };
              const saving = savingKey === m;
              return (
                <tr key={m} data-testid={`perm-row-${m}`} className={cn(saving && 'opacity-60')}>
                  <td className="px-3 py-2 border-b border-border">
                    <div className="font-medium">{MODULE_LABEL[m]}</div>
                    <div className="text-[11px] text-muted">{m}</div>
                  </td>
                  <td className="p-2 border-b border-border text-center">
                    <Toggle
                      checked={p.podeVer}
                      onChange={(v) => onToggle(m, 'podeVer', v)}
                      disabled={saving || bulkBusy}
                      testId={`perm-${m}-ver`}
                    />
                  </td>
                  <td className="p-2 border-b border-border text-center">
                    <Toggle
                      checked={p.podeEditar}
                      onChange={(v) => onToggle(m, 'podeEditar', v)}
                      disabled={saving || bulkBusy || !p.podeVer}
                      testId={`perm-${m}-editar`}
                    />
                  </td>
                  {onResetModulo && (
                    <td className="p-2 border-b border-border text-center">
                      {p.override ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-warning cursor-pointer bg-transparent border-none hover:underline"
                          onClick={() => onResetModulo(m)}
                          disabled={saving || bulkBusy}
                          data-testid={`perm-${m}-reset`}
                          title="Remove a exceção — volta ao padrão do papel"
                        >
                          <RotateCcw size={11} />
                          exceção
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted">padrão</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {saveError && (
        <p
          data-testid="perm-error"
          className="text-danger text-[13px] mt-3 px-3 py-2 bg-danger/8 rounded-md"
        >
          {saveError}
        </p>
      )}

      {footer}
    </>
  );
}

// ─── Modo POR PAPEL ─────────────────────────────────────────────────────────

function PermissionMatrix({ role }: { role: Role }) {
  const { data, loading, error, refetch } = useApiQuery<PermissaoRow[]>(`/permissions/${role}`);

  const [perms, setPerms] = useState<Map<string, { podeVer: boolean; podeEditar: boolean }>>(
    new Map(),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const arr: PermissaoRow[] = Array.isArray(data) ? data : [];
    const map = new Map<string, { podeVer: boolean; podeEditar: boolean }>();
    for (const p of arr) map.set(p.modulo, { podeVer: p.podeVer, podeEditar: p.podeEditar });
    for (const m of MODULES) {
      if (!map.has(m)) map.set(m, { podeVer: false, podeEditar: false });
    }
    setPerms(map);
  }, [data]);

  async function salvar(modulo: string, podeVer: boolean, podeEditar: boolean) {
    await api.put(`/permissions/${role}`, { modulo, podeVer, podeEditar });
  }

  async function toggle(modulo: string, field: 'podeVer' | 'podeEditar', next: boolean) {
    const current = perms.get(modulo) ?? { podeVer: false, podeEditar: false };
    const updated = { ...current, [field]: next };
    if (field === 'podeVer' && !next) updated.podeEditar = false;
    if (field === 'podeEditar' && next) updated.podeVer = true;

    setSavingKey(modulo);
    setSaveError(null);
    const prevMap = new Map(perms);
    setPerms((m) => new Map(m).set(modulo, updated));
    try {
      await salvar(modulo, updated.podeVer, updated.podeEditar);
      void refreshPermissoes();
    } catch (err) {
      setPerms(prevMap);
      setSaveError(`${modulo}: ${err instanceof ApiError ? err.message : 'Falha ao salvar'}`);
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSavingKey(null);
    }
  }

  async function bulk(kind: 'ver' | 'tudo' | 'nada') {
    const podeVer = kind !== 'nada';
    const podeEditar = kind === 'tudo';
    setBulkBusy(true);
    setSaveError(null);
    const prevMap = new Map(perms);
    setPerms(new Map(MODULES.map((m) => [m, { podeVer, podeEditar }])));
    try {
      const results = await Promise.allSettled(
        MODULES.map((m) => salvar(m, podeVer, podeEditar)),
      );
      const falhas = results.filter((r) => r.status === 'rejected').length;
      if (falhas > 0) {
        setSaveError(`${falhas} módulo(s) falharam ao salvar — recarregando`);
        refetch();
      }
      void refreshPermissoes();
    } catch {
      setPerms(prevMap);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className={CARD}>
      <StateView loading={loading} error={error} onRetry={refetch}>
        <MatrixCore
          badge={{ label: role, color: ROLE_COLOR[role] }}
          perms={perms}
          savingKey={savingKey}
          saveError={saveError}
          bulkBusy={bulkBusy}
          onToggle={toggle}
          onBulk={bulk}
          footer={
            <p className="text-xs text-muted mt-3">
              Alterações salvam automaticamente. <strong>Editar</strong> requer <strong>Ver</strong>{' '}
              ativo. O menu dos usuários afetados atualiza em até 1 minuto (ou na hora, ao focar a
              janela) — sem precisar de logout. Exceções individuais (aba Por usuário) prevalecem
              sobre o papel.
            </p>
          }
        />
      </StateView>
    </div>
  );
}

// ─── Modo POR USUÁRIO ───────────────────────────────────────────────────────

interface UsuarioLite {
  id: string;
  nome: string;
  email: string;
  role: Role;
  status?: string;
}

function UserPermissions() {
  const { data: usersResp, loading: loadingUsers } = useApiQuery<{ data: UsuarioLite[] }>(
    '/users?limit=100',
  );
  const usuarios = useMemo(
    () => (usersResp?.data ?? []).filter((u) => u.role !== 'ADMIN'),
    [usersResp],
  );
  const [usuarioId, setUsuarioId] = useState<string>('');

  useEffect(() => {
    if (!usuarioId && usuarios.length > 0) setUsuarioId(usuarios[0].id);
  }, [usuarios, usuarioId]);

  const usuario = usuarios.find((u) => u.id === usuarioId) ?? null;

  return (
    <div className={CARD}>
      <div className="mb-4 max-w-md">
        <label className="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">
          Usuário
        </label>
        <select
          data-testid="perm-user-select"
          value={usuarioId}
          onChange={(e) => setUsuarioId(e.target.value)}
          className="w-full border border-border-strong rounded-md px-3 py-2 text-[13px] bg-surface text-text"
        >
          {loadingUsers && <option value="">Carregando…</option>}
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome} — {u.role} ({u.email})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted mt-1.5 m-0">
          O usuário nasce com o padrão do papel. Toggles aqui criam <strong>exceções</strong> só
          pra ele (marcadas na coluna Origem); “exceção” com <RotateCcw size={10} className="inline" />{' '}
          volta ao padrão.
        </p>
      </div>

      {usuario && <UserMatrix key={usuario.id} usuario={usuario} />}
      {!loadingUsers && usuarios.length === 0 && (
        <p className="text-muted text-sm">Nenhum usuário (não-ADMIN) encontrado.</p>
      )}
    </div>
  );
}

function UserMatrix({ usuario }: { usuario: UsuarioLite }) {
  const { data, loading, error, refetch } = useApiQuery<{
    usuarioId: string;
    role: Role;
    permissoes: PermissaoRow[];
  }>(`/permissions/usuario/${usuario.id}`);

  const [perms, setPerms] = useState<
    Map<string, { podeVer: boolean; podeEditar: boolean; override?: boolean }>
  >(new Map());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const arr = data?.permissoes ?? [];
    const map = new Map<string, { podeVer: boolean; podeEditar: boolean; override?: boolean }>();
    for (const p of arr) {
      map.set(p.modulo, { podeVer: p.podeVer, podeEditar: p.podeEditar, override: p.override });
    }
    for (const m of MODULES) {
      if (!map.has(m)) map.set(m, { podeVer: false, podeEditar: false, override: false });
    }
    setPerms(map);
  }, [data]);

  async function toggle(modulo: string, field: 'podeVer' | 'podeEditar', next: boolean) {
    const current = perms.get(modulo) ?? { podeVer: false, podeEditar: false };
    const updated = { ...current, [field]: next, override: true };
    if (field === 'podeVer' && !next) updated.podeEditar = false;
    if (field === 'podeEditar' && next) updated.podeVer = true;

    setSavingKey(modulo);
    setSaveError(null);
    const prevMap = new Map(perms);
    setPerms((m) => new Map(m).set(modulo, updated));
    try {
      await api.put(`/permissions/usuario/${usuario.id}`, {
        modulo,
        podeVer: updated.podeVer,
        podeEditar: updated.podeEditar,
      });
      void refreshPermissoes();
    } catch (err) {
      setPerms(prevMap);
      setSaveError(`${modulo}: ${err instanceof ApiError ? err.message : 'Falha ao salvar'}`);
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSavingKey(null);
    }
  }

  async function resetModulo(modulo: string) {
    setSavingKey(modulo);
    setSaveError(null);
    try {
      await api.delete(`/permissions/usuario/${usuario.id}/${modulo}`);
      refetch();
      void refreshPermissoes();
    } catch (err) {
      setSaveError(`${modulo}: ${err instanceof ApiError ? err.message : 'Falha ao restaurar'}`);
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSavingKey(null);
    }
  }

  async function bulk(kind: 'ver' | 'tudo' | 'nada') {
    const podeVer = kind !== 'nada';
    const podeEditar = kind === 'tudo';
    setBulkBusy(true);
    setSaveError(null);
    setPerms(new Map(MODULES.map((m) => [m, { podeVer, podeEditar, override: true }])));
    try {
      const results = await Promise.allSettled(
        MODULES.map((m) =>
          api.put(`/permissions/usuario/${usuario.id}`, { modulo: m, podeVer, podeEditar }),
        ),
      );
      const falhas = results.filter((r) => r.status === 'rejected').length;
      if (falhas > 0) {
        setSaveError(`${falhas} módulo(s) falharam ao salvar — recarregando`);
      }
      refetch();
      void refreshPermissoes();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <StateView loading={loading} error={error} onRetry={refetch}>
      <MatrixCore
        badge={{ label: `${usuario.nome} (${usuario.role})`, color: ROLE_COLOR[usuario.role] }}
        perms={perms}
        savingKey={savingKey}
        saveError={saveError}
        bulkBusy={bulkBusy}
        onToggle={toggle}
        onBulk={bulk}
        onResetModulo={resetModulo}
        footer={
          <p className="text-xs text-muted mt-3">
            Exceções valem só pra <strong>{usuario.nome}</strong> e prevalecem sobre o papel{' '}
            {usuario.role}. “Marcar/Desmarcar todos” cria exceção em todos os módulos. O painel do
            usuário atualiza em até 1 minuto — módulo sem “Ver” some do menu dele e a página aberta
            redireciona (sem tela vazia).
          </p>
        }
      />
    </StateView>
  );
}

// ─── Toggle ─────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        'inline-block w-11 h-[22px] relative',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        data-testid={testId}
        className="opacity-0 w-0 h-0 absolute"
      />
      <span
        className={cn(
          'absolute inset-0 rounded-[11px] transition-colors duration-150',
          checked ? 'bg-success' : 'bg-[#cbd0d9]',
        )}
      />
      <span
        className={cn(
          'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-[left] duration-150 shadow-[0_1px_3px_rgba(0,0,0,0.2)]',
          checked ? 'left-6' : 'left-0.5',
        )}
      />
    </label>
  );
}
