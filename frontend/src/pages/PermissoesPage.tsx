import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { alpha, badge, card, colors } from '@/components/styles';

type Role = 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP';

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
  SAC: colors.warning,
  REP: colors.success,
};

interface PermissaoRow {
  modulo: string;
  podeVer: boolean;
  podeEditar: boolean;
}

export default function PermissoesPage() {
  const [role, setRole] = useState<Role>('REP');

  return (
    <PageLayout title="Permissões granulares">
      <div style={{ marginBottom: '0.75rem' }}>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>
          Configure quais módulos cada papel pode <strong>ver</strong> e <strong>editar</strong>.
          ADMIN sempre tem acesso total (bypass).
        </p>
      </div>

      {/* Tabs por role */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${colors.border}`,
          marginBottom: '1rem',
        }}
      >
        {ROLES.map((r) => (
          <RoleTab key={r} role={r} active={r === role} onClick={() => setRole(r)} />
        ))}
        {/* ADMIN como info-only */}
        <div
          style={{
            padding: '0.625rem 1rem',
            fontSize: 13,
            color: colors.muted,
            marginLeft: 'auto',
            fontStyle: 'italic',
          }}
        >
          ADMIN tem acesso total automaticamente
        </div>
      </div>

      <PermissionMatrix key={role} role={role} />
    </PageLayout>
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
      style={{
        background: active ? colors.surface : 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? ROLE_COLOR[role] : 'transparent'}`,
        padding: '0.625rem 1rem',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: active ? ROLE_COLOR[role] : colors.muted,
        fontWeight: active ? 600 : 500,
        fontSize: 14,
        marginBottom: -1,
      }}
    >
      {role}
    </button>
  );
}

function PermissionMatrix({ role }: { role: Role }) {
  const { data, loading, error, refetch } = useApiQuery<PermissaoRow[] | { data: PermissaoRow[] }>(
    `/permissions/${role}`,
  );

  // Local state pra otimismo + edição
  const [perms, setPerms] = useState<Map<string, { podeVer: boolean; podeEditar: boolean }>>(
    new Map(),
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync inicial quando dados chegam
  useEffect(() => {
    const arr: PermissaoRow[] = Array.isArray(data) ? data : data?.data ?? [];
    const map = new Map<string, { podeVer: boolean; podeEditar: boolean }>();
    for (const p of arr) {
      map.set(p.modulo, { podeVer: p.podeVer, podeEditar: p.podeEditar });
    }
    // Garante que todos os módulos do catálogo aparecem (mesmo que ausentes na DB)
    for (const m of MODULES) {
      if (!map.has(m)) {
        map.set(m, { podeVer: false, podeEditar: false });
      }
    }
    setPerms(map);
  }, [data]);

  async function toggle(modulo: string, field: 'podeVer' | 'podeEditar', next: boolean) {
    const current = perms.get(modulo) ?? { podeVer: false, podeEditar: false };
    const updated = { ...current, [field]: next };
    // Regra: se desativa Ver, também desativa Editar
    if (field === 'podeVer' && !next) updated.podeEditar = false;
    // Regra: se ativa Editar, também ativa Ver
    if (field === 'podeEditar' && next) updated.podeVer = true;

    const key = `${role}:${modulo}`;
    setSavingKey(key);
    setSaveError(null);

    // Optimistic
    const prevMap = new Map(perms);
    setPerms((m) => new Map(m).set(modulo, updated));

    try {
      await api.put(`/permissions/${role}`, {
        modulo,
        podeVer: updated.podeVer,
        podeEditar: updated.podeEditar,
      });
    } catch (err) {
      // Rollback
      setPerms(prevMap);
      setSaveError(
        `${modulo}: ${err instanceof ApiError ? err.message : 'Falha ao salvar'}`,
      );
      setTimeout(() => setSaveError(null), 4000);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div style={card}>
      <StateView loading={loading} error={error} onRetry={refetch}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.5rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16 }}>
            Papel: <span style={{ ...badge(ROLE_COLOR[role]), fontSize: 12 }}>{role}</span>
          </h2>
          <span style={{ fontSize: 12, color: colors.muted }}>
            {perms.size > 0 &&
              `${Array.from(perms.values()).filter((p) => p.podeVer).length}/${MODULES.length} módulos com acesso`}
          </span>
        </header>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    borderBottom: `1px solid ${colors.border}`,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    color: colors.muted,
                    fontWeight: 600,
                  }}
                >
                  Módulo
                </th>
                <th
                  style={{
                    width: 100,
                    textAlign: 'center',
                    padding: '0.5rem',
                    borderBottom: `1px solid ${colors.border}`,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    color: colors.muted,
                    fontWeight: 600,
                  }}
                >
                  Ver
                </th>
                <th
                  style={{
                    width: 100,
                    textAlign: 'center',
                    padding: '0.5rem',
                    borderBottom: `1px solid ${colors.border}`,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    color: colors.muted,
                    fontWeight: 600,
                  }}
                >
                  Editar
                </th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => {
                const p = perms.get(m) ?? { podeVer: false, podeEditar: false };
                const key = `${role}:${m}`;
                const saving = savingKey === key;
                return (
                  <tr
                    key={m}
                    data-testid={`perm-row-${m}`}
                    style={{ opacity: saving ? 0.6 : 1 }}
                  >
                    <td
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{MODULE_LABEL[m]}</div>
                      <div style={{ fontSize: 11, color: colors.muted }}>{m}</div>
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        borderBottom: `1px solid ${colors.border}`,
                        textAlign: 'center',
                      }}
                    >
                      <Toggle
                        checked={p.podeVer}
                        onChange={(v) => toggle(m, 'podeVer', v)}
                        disabled={saving}
                        testId={`perm-${m}-ver`}
                      />
                    </td>
                    <td
                      style={{
                        padding: '0.5rem',
                        borderBottom: `1px solid ${colors.border}`,
                        textAlign: 'center',
                      }}
                    >
                      <Toggle
                        checked={p.podeEditar}
                        onChange={(v) => toggle(m, 'podeEditar', v)}
                        disabled={saving || !p.podeVer}
                        testId={`perm-${m}-editar`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {saveError && (
          <p
            data-testid="perm-error"
            style={{
              color: colors.danger,
              fontSize: 13,
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: alpha(colors.danger, 8),
              borderRadius: 6,
            }}
          >
            {saveError}
          </p>
        )}

        <p style={{ fontSize: 12, color: colors.muted, marginTop: '0.75rem' }}>
          Alterações salvam automaticamente. <strong>Editar</strong> requer <strong>Ver</strong>{' '}
          ativo. Mudanças refletem imediatamente — usuários afetados precisam fazer logout/login
          pra recarregar permissões da sessão.
        </p>
      </StateView>
    </div>
  );
}

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
      style={{
        display: 'inline-block',
        width: 44,
        height: 22,
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        data-testid={testId}
        style={{
          opacity: 0,
          width: 0,
          height: 0,
          position: 'absolute',
        }}
      />
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? colors.success : '#cbd0d9',
          borderRadius: 11,
          transition: 'background 0.15s',
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 24 : 2,
          width: 18,
          height: 18,
          background: '#fff',
          borderRadius: '50%',
          transition: 'left 0.15s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </label>
  );
}
