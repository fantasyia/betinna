import {
  Briefcase,
  Target,
  Funnel as FunnelIcon,
  Tags,
  PieChart as PieChartIcon,
  Zap,
  Sparkles,
  Activity,
  Megaphone,
} from 'lucide-react';
import { useRole, usePermission } from '@/hooks/usePermission';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * CrmTabs — sub-abas da aba principal "CRM".
 * Inclui (filtradas por permissão/role): Clientes · Funil (Leads) ·
 * Configurar funis · Tags · Segmentação · Fluxos · Templates · Monitor ·
 * Campanhas. (Agenda virou aba principal própria; Fluxos/Templates/Monitor/
 * Campanhas vieram da extinta aba "Automação".)
 *
 * Permissões espelham as definidas em App.tsx ProtectedRoute:
 *  - /clientes                   → permission 'clientes.view'
 *  - /leads                      → todos
 *  - /funis                      → todos (configurações internas filtram)
 *  - /tags                       → permission 'clientes.view'
 *  - /segmentos                  → ADMIN / DIRECTOR / GERENTE
 *  - /fluxos(+templates/monitor) → ADMIN / DIRECTOR / GERENTE
 *  - /campanhas                  → permission 'campanhas.view'
 */
export function CrmTabs() {
  const role = useRole();
  const canClientes = usePermission('clientes.view');
  const canCampanhas = usePermission('campanhas.view');

  const isAdminTier =
    role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';

  const tabs: SubTab[] = [];

  if (canClientes) {
    tabs.push({
      to: '/clientes',
      label: 'Clientes',
      icon: <Briefcase size={14} />,
    });
  }
  tabs.push({ to: '/leads', label: 'Funil', icon: <Target size={14} /> });
  tabs.push({
    to: '/funis',
    label: 'Configurar funis',
    icon: <FunnelIcon size={14} />,
  });
  if (canClientes) {
    tabs.push({ to: '/tags', label: 'Tags', icon: <Tags size={14} /> });
  }
  if (isAdminTier) {
    tabs.push({
      to: '/segmentos',
      label: 'Segmentação',
      icon: <PieChartIcon size={14} />,
    });
  }
  if (isAdminTier) {
    tabs.push({ to: '/fluxos', label: 'Fluxos', icon: <Zap size={14} /> });
    tabs.push({ to: '/fluxos/templates', label: 'Templates', icon: <Sparkles size={14} /> });
    tabs.push({ to: '/fluxos/monitor', label: 'Monitor', icon: <Activity size={14} /> });
  }
  if (canCampanhas) {
    tabs.push({ to: '/campanhas', label: 'Campanhas', icon: <Megaphone size={14} /> });
  }

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de CRM" />;
}
