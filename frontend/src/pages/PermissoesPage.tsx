import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { cn } from '@/lib/cn';

type Role = 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP';

// Equivalentes Tailwind pixel-idênticos dos objetos legados.
const BTN_SEC =
  'bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';
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
}

export default function PermissoesPage() {
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
          ADMIN sempre tem acesso total (bypass).
        </p>
      </div>

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
    <div className={CARD}>
      <StateView loading={loading} error={error} onRetry={refetch}>
        <header className="flex items-center justify-between mb-2">
          <h2 className="m-0 text-lg">
            Papel:{' '}
            <span
              className="inline-flex items-center rounded-full px-[9px] py-0.5 text-xs font-semibold leading-[1.6] tracking-[0.2px]"
              style={{
                backgroundColor: `color-mix(in srgb, ${ROLE_COLOR[role]} 12%, transparent)`,
                color: ROLE_COLOR[role],
                border: `1px solid color-mix(in srgb, ${ROLE_COLOR[role]} 19%, transparent)`,
              }}
            >
              {role}
            </span>
          </h2>
          <span className="text-xs text-muted">
            {perms.size > 0 &&
              `${Array.from(perms.values()).filter((p) => p.podeVer).length}/${MODULES.length} módulos com acesso`}
          </span>
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
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => {
                const p = perms.get(m) ?? { podeVer: false, podeEditar: false };
                const key = `${role}:${m}`;
                const saving = savingKey === key;
                return (
                  <tr key={m} data-testid={`perm-row-${m}`} className={cn(saving && 'opacity-60')}>
                    <td className="px-3 py-2 border-b border-border">
                      <div className="font-medium">{MODULE_LABEL[m]}</div>
                      <div className="text-[11px] text-muted">{m}</div>
                    </td>
                    <td className="p-2 border-b border-border text-center">
                      <Toggle
                        checked={p.podeVer}
                        onChange={(v) => toggle(m, 'podeVer', v)}
                        disabled={saving}
                        testId={`perm-${m}-ver`}
                      />
                    </td>
                    <td className="p-2 border-b border-border text-center">
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
            className="text-danger text-[13px] mt-3 px-3 py-2 bg-danger/8 rounded-md"
          >
            {saveError}
          </p>
        )}

        <p className="text-xs text-muted mt-3">
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
