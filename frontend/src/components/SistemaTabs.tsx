import { UserCircle, Users, Settings, Shield } from 'lucide-react';
import { useRole, usePermission } from '@/hooks/usePermission';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * SistemaTabs — sub-abas da aba principal "Sistema".
 * Inclui (filtradas por permissão/role): Meu perfil · Usuários ·
 * Configurações · Painel Admin.
 *
 * Permissões espelham as definidas em App.tsx ProtectedRoute:
 *  - /perfil           → todos os autenticados
 *  - /usuarios         → ADMIN / DIRECTOR / GERENTE
 *  - /configuracoes    → ADMIN
 *  - /admin            → permission 'admin.panel'
 *
 * Quando o user não tem permissão pra uma tab, ela desaparece. Se sobra
 * só 1 tab, a barra inteira some (comportamento do SubTabsBar).
 */
export function SistemaTabs() {
  const role = useRole();
  const canAdminPanel = usePermission('admin.panel');

  const canSeeUsuarios =
    role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';
  const canSeeConfiguracoes = role === 'ADMIN';

  const tabs: SubTab[] = [
    { to: '/perfil', label: 'Meu perfil', icon: <UserCircle size={14} /> },
    ...(canSeeUsuarios
      ? [
          {
            to: '/usuarios',
            label: 'Usuários',
            icon: <Users size={14} />,
          } as SubTab,
        ]
      : []),
    ...(canSeeConfiguracoes
      ? [
          {
            to: '/configuracoes',
            label: 'Configurações',
            icon: <Settings size={14} />,
          } as SubTab,
        ]
      : []),
    ...(canAdminPanel
      ? [
          {
            to: '/admin',
            label: 'Painel Admin',
            icon: <Shield size={14} />,
          } as SubTab,
        ]
      : []),
  ];

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Sistema" />;
}
