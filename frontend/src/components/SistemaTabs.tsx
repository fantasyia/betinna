import { UserCircle, Users, Settings, Shield, Plug, KeyRound, Link as LinkIcon } from 'lucide-react';
import { useRole, usePermission, useModulo } from '@/hooks/usePermission';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * SistemaTabs — sub-abas da aba principal "Sistema".
 * Inclui (filtradas por permissão/role): Meu perfil · Usuários ·
 * Configurações · Tokens de API · Integrações empresa · Minhas integrações ·
 * Painel Admin.
 * (Integrações empresa/Minhas integrações vieram da extinta aba "Automação".)
 *
 * Permissões espelham as definidas em App.tsx ProtectedRoute:
 *  - /perfil             → todos os autenticados
 *  - /usuarios           → ADMIN / DIRECTOR / GERENTE
 *  - /configuracoes      → ADMIN
 *  - /integracoes        → ADMIN / DIRECTOR / GERENTE
 *  - /minhas-integracoes → todos os autenticados
 *  - /admin              → permission 'admin.panel'
 *
 * Quando o user não tem permissão pra uma tab, ela desaparece. Se sobra
 * só 1 tab, a barra inteira some (comportamento do SubTabsBar).
 */
export function SistemaTabs() {
  const role = useRole();
  const canAdminPanel = usePermission('admin.panel');

  const isAdminTier =
    role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';
  const canSeeUsuarios = isAdminTier;
  // Mesmo gate da rota e do backend (ADMIN/DIRECTOR). Estava só ADMIN: o
  // DIRECTOR — que É o mandatário do tenant e tem a permissão — não via a aba e
  // só chegava em Configurações digitando a URL.
  const canSeeConfiguracoes = usePermission('configuracoes.empresa');
  // Tokens de API (MCP): o backend gateia por `quadros` — herança de quando a
  // tela morava dentro do Kanban. A aba lê a MESMA matriz viva que a rota, pra
  // não oferecer uma página que responde 403.
  const canSeeTokens = useModulo('quadros').ver;

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
    ...(canSeeTokens
      ? [
          {
            to: '/configuracoes/tokens',
            label: 'Tokens de API',
            icon: <KeyRound size={14} />,
          } as SubTab,
        ]
      : []),
    ...(isAdminTier
      ? [
          {
            to: '/integracoes',
            label: 'Integrações empresa',
            icon: <Plug size={14} />,
          } as SubTab,
        ]
      : []),
    {
      to: '/minhas-integracoes',
      label: 'Minhas integrações',
      icon: <LinkIcon size={14} />,
    },
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
