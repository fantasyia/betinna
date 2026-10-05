import { Package, Sparkles, Store } from 'lucide-react';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';

/**
 * CatalogoTabs — sub-abas da aba principal "Catálogo".
 * Inclui: Produtos · Meu catálogo · (Vitrine, só onde ela existe).
 *
 * Sem permissões específicas — Produtos e Meu catálogo são acessíveis por todos
 * os papéis autenticados (a filtragem por role acontece dentro de cada uma).
 *
 * "Vitrine" (Fase 1 da vitrine de atacado, 05/10): aparece SÓ pra ADMIN/DIRECTOR
 * de empresa que tem a vitrine ligada. As outras empresas não veem nada novo.
 */
export function CatalogoTabs() {
  const role = useRole();
  const gestor = role === 'ADMIN' || role === 'DIRECTOR';
  const vitrine = useApiQuery<{ id: string } | null>(gestor ? '/vitrine/admin/config' : null);

  const tabs: SubTab[] = [
    { to: '/produtos', label: 'Produtos', icon: <Package size={14} /> },
    { to: '/catalogo', label: 'Meu catálogo', icon: <Sparkles size={14} /> },
    ...(vitrine.data ? [{ to: '/vitrine', label: 'Vitrine', icon: <Store size={14} /> }] : []),
  ];

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Catálogo" />;
}
