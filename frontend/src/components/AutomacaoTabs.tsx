import { Zap, Sparkles, Megaphone, Plug, Link as LinkIcon } from 'lucide-react';
import { useRole, usePermission } from '@/hooks/usePermission';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * AutomacaoTabs — sub-abas da aba principal "Automação".
 * Inclui (filtradas por permissão/role): Fluxos · Templates ·
 * Campanhas · Integrações empresa · Minhas integrações.
 *
 * Permissões espelham as definidas em App.tsx ProtectedRoute:
 *  - /fluxos             → ADMIN / DIRECTOR / GERENTE
 *  - /fluxos/templates   → ADMIN / DIRECTOR / GERENTE
 *  - /campanhas          → permission 'campanhas.view'
 *  - /integracoes        → ADMIN / DIRECTOR / GERENTE
 *  - /minhas-integracoes → todos
 */
export function AutomacaoTabs() {
  const role = useRole();
  const canCampanhas = usePermission('campanhas.view');

  const isAdminTier =
    role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';

  const tabs: SubTab[] = [];

  if (isAdminTier) {
    tabs.push({ to: '/fluxos', label: 'Fluxos', icon: <Zap size={14} /> });
    tabs.push({
      to: '/fluxos/templates',
      label: 'Templates',
      icon: <Sparkles size={14} />,
    });
  }
  if (canCampanhas) {
    tabs.push({
      to: '/campanhas',
      label: 'Campanhas',
      icon: <Megaphone size={14} />,
    });
  }
  if (isAdminTier) {
    tabs.push({
      to: '/integracoes',
      label: 'Integrações empresa',
      icon: <Plug size={14} />,
    });
  }
  tabs.push({
    to: '/minhas-integracoes',
    label: 'Minhas integrações',
    icon: <LinkIcon size={14} />,
  });

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Automação" />;
}
