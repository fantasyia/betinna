import {
  MessageSquare,
  AlertTriangle,
  ShieldAlert,
  Smartphone,
  Bot,
  Sparkles,
} from 'lucide-react';
import { useRole, usePermission } from '@/hooks/usePermission';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * AtendimentoTabs — sub-abas da aba principal "Atendimento".
 *
 * Histórico:
 *  - R5 (lote 3): criado com 2 sub-abas (SAC interno + Marketplaces).
 *  - N1.7 (lote 9): expandido pra incluir Inbox, WhatsApp, MullerBot,
 *    Persona Bot — todas que faziam parte da seção "Atendimento" da
 *    sidebar antiga viraram sub-abas aqui.
 *
 * Permissões espelham as definidas em App.tsx ProtectedRoute:
 *  - /inbox              → todos
 *  - /ocorrencias        → todos (SAC interno)
 *  - /incidentes         → ADMIN/DIRECTOR/GERENTE/SAC
 *  - /whatsapp           → permission 'whatsapp.pessoal'
 *  - /mullerbot          → todos
 *  - /mullerbot/persona  → ADMIN/DIRECTOR
 */
export function AtendimentoTabs() {
  const role = useRole();
  const canWhatsApp = usePermission('whatsapp.pessoal');

  const canMarketplaces =
    role === 'ADMIN' ||
    role === 'DIRECTOR' ||
    role === 'GERENTE' ||
    role === 'SAC';
  const canPersona = role === 'ADMIN' || role === 'DIRECTOR';

  const tabs: SubTab[] = [];

  tabs.push({ to: '/inbox', label: 'Inbox', icon: <MessageSquare size={14} /> });
  tabs.push({
    to: '/ocorrencias',
    label: 'SAC interno',
    icon: <AlertTriangle size={14} />,
  });
  if (canMarketplaces) {
    tabs.push({
      to: '/incidentes',
      label: 'Marketplaces',
      icon: <ShieldAlert size={14} />,
    });
  }
  if (canWhatsApp) {
    tabs.push({
      to: '/whatsapp',
      label: 'WhatsApp',
      icon: <Smartphone size={14} />,
    });
  }
  tabs.push({ to: '/mullerbot', label: 'MullerBot', icon: <Bot size={14} /> });
  if (canPersona) {
    tabs.push({
      to: '/mullerbot/persona',
      label: 'Persona Bot',
      icon: <Sparkles size={14} />,
    });
  }

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Atendimento" />;
}
