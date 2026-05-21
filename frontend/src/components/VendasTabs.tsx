import {
  ShoppingCart,
  CheckSquare,
  FileText,
  Gift,
  Wallet,
  Target as TargetIcon,
} from 'lucide-react';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * VendasTabs — sub-abas da aba principal "Vendas".
 * Inclui: Pedidos · Aprovações · Propostas · Amostras · Comissões · Metas.
 *
 * Todas as rotas são acessíveis pra usuários autenticados (cada página
 * faz filtragem interna por papel, ex: REP só vê próprias comissões).
 */
export function VendasTabs() {
  const tabs: SubTab[] = [
    { to: '/pedidos', label: 'Pedidos', icon: <ShoppingCart size={14} /> },
    { to: '/aprovacoes', label: 'Aprovações', icon: <CheckSquare size={14} /> },
    { to: '/propostas', label: 'Propostas', icon: <FileText size={14} /> },
    { to: '/amostras', label: 'Amostras', icon: <Gift size={14} /> },
    { to: '/comissoes', label: 'Comissões', icon: <Wallet size={14} /> },
    { to: '/metas', label: 'Metas', icon: <TargetIcon size={14} /> },
  ];

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Vendas" />;
}
