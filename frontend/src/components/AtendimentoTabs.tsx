import { MessageSquare, AlertTriangle, ShieldAlert, Smartphone } from 'lucide-react';
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
 *  - /whatsapp           → rota LIVRE (a página escolhe a aba pelo papel);
 *                          esta ABA de Atendimento é que exige 'whatsapp.empresa'
 *
 * O Assistente IA (/mullerbot) NÃO está aqui — virou item próprio do menu
 * lateral (PageLayout → SECTIONS), com as sub-abas dele em AssistenteTabs.
 */
export function AtendimentoTabs() {
  const role = useRole();
  // Gate da ABA (não mais o da rota — a rota é livre, porque o REP precisa
  // chegar em /whatsapp pra parear o WhatsApp PESSOAL dele). Estava
  // invertido: GERENTE/REP viam a aba e caíam em /403, e o SAC — que gerencia o
  // WhatsApp empresarial — não via a aba. REP/GERENTE só têm WhatsApp pessoal,
  // que vive em /minhas-integracoes.
  const canWhatsApp = usePermission('whatsapp.empresa');

  const canMarketplaces =
    role === 'ADMIN' ||
    role === 'DIRECTOR' ||
    role === 'GERENTE' ||
    role === 'SAC';

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
  // Assistente IA saiu daqui: virou item PRÓPRIO do menu lateral (PageLayout →
  // SECTIONS). Como as sub-abas dele (Persona/Conhecimento/Auditoria) já vivem
  // em AssistenteTabs, mantê-lo aqui deixaria a mesma seção em dois lugares.

  return <SubTabsBar tabs={tabs} ariaLabel="Sub-abas de Atendimento" />;
}
