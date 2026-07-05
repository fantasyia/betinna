import { Bot, MessageCircle, Sparkles, BookText, ClipboardList } from 'lucide-react';
import { useRole } from '@/hooks/usePermission';
import { useApiQuery } from '@/hooks/useApiQuery';
import { SubTabsBar, type SubTab } from '@/components/SubTabsBar';

/**
 * AssistenteTabs — sub-navegação DENTRO da seção do assistente (ex-4 abas soltas
 * MullerBot/Persona/Conhecimento/Auditoria, unificadas em 2026-07). Mostra o NOME
 * do bot definido pela empresa (persona.nome, ex.: "SomaBOT") como título da seção.
 *
 * Sub-abas:
 *  - Chat         → /mullerbot               (todos)
 *  - Configuração → /mullerbot/persona       (ADMIN/DIRECTOR)
 *  - Conhecimento → /mullerbot/conhecimento  (ADMIN/DIRECTOR)
 *  - Histórico    → /mullerbot/auditoria     (ADMIN/DIRECTOR/GERENTE/SAC)
 *
 * REP vê só o Chat → SubTabsBar (que some com <2 abas) não renderiza a barra;
 * fica só o nome do bot no topo. Renderizado após o <AtendimentoTabs /> nas
 * páginas do assistente.
 */
export function AssistenteTabs() {
  const role = useRole();
  const canConfig = role === 'ADMIN' || role === 'DIRECTOR';
  const canHistorico =
    role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE' || role === 'SAC';

  const { data: persona } = useApiQuery<{ nome?: string }>('/mullerbot/persona');
  const nome = persona?.nome?.trim() || 'Assistente IA';

  const tabs: SubTab[] = [
    { to: '/mullerbot', label: 'Chat', icon: <MessageCircle size={14} />, testId: 'assist-chat' },
  ];
  if (canConfig) {
    tabs.push({
      to: '/mullerbot/persona',
      label: 'Configuração',
      icon: <Sparkles size={14} />,
      testId: 'assist-config',
    });
    tabs.push({
      to: '/mullerbot/conhecimento',
      label: 'Conhecimento',
      icon: <BookText size={14} />,
      testId: 'assist-conhecimento',
    });
  }
  if (canHistorico) {
    tabs.push({
      to: '/mullerbot/auditoria',
      label: 'Histórico',
      icon: <ClipboardList size={14} />,
      testId: 'assist-historico',
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-primary" data-testid="assistente-nome">
        <Bot size={16} />
        <span className="font-semibold">{nome}</span>
      </div>
      <SubTabsBar tabs={tabs} ariaLabel="Seções do assistente" />
    </div>
  );
}
