import { Package, Sparkles } from 'lucide-react';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * CatalogoTabs — sub-abas da aba principal "Catálogo".
 * Inclui: Produtos · Meu catálogo.
 *
 * Sem permissões específicas — ambas as páginas são acessíveis por todos
 * os papéis autenticados (a filtragem por role acontece dentro de cada uma).
 */
export function CatalogoTabs() {
  const tabs: SubTab[] = [
    { to: '/produtos', label: 'Produtos', icon: <Package size={14} /> },
    { to: '/catalogo', label: 'Meu catálogo', icon: <Sparkles size={14} /> },
  ];

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Catálogo" />;
}
