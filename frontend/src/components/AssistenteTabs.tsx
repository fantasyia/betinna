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
 *  - Configuração → /mullerbot/persona       (ADMIN/DIRECTOR: bot da empresa;
 *                                             REP: "Meu bot" — o bot PESSOAL dele)
 *  - Conhecimento → /mullerbot/conhecimento  (ADMIN/DIRECTOR)
 *  - Histórico    → /mullerbot/auditoria     (ADMIN/DIRECTOR/GERENTE)
 *
 * ⚠️ É a ÚNICA barra de sub-abas das páginas do assistente. Elas mostravam
 * também o <AtendimentoTabs /> (Inbox / SAC interno / Marketplaces / WhatsApp),
 * resto de quando o assistente era sub-aba de Atendimento. Depois que ele virou
 * item próprio do menu, aquela fila passou a anunciar uma seção em que a página
 * não está — dois níveis de navegação de seções DIFERENTES, empilhados.
 */
export function AssistenteTabs() {
  const role = useRole();
  // REP também configura — o BOT PESSOAL dele (persona + prompts do WhatsApp
  // dele, com a chave OpenAI dele). O backend prende cada papel ao seu escopo.
  const canConfig = role === 'ADMIN' || role === 'DIRECTOR' || role === 'REP';
  const canConhecimento = role === 'ADMIN' || role === 'DIRECTOR';
  // SAC não audita — regra do backend (@Roles ADMIN/DIRECTOR/GERENTE) e da
  // matriz de permissões. A aba aparecia pra ele e o clique caía em /403.
  const canHistorico = role === 'ADMIN' || role === 'DIRECTOR' || role === 'GERENTE';

  const { data: persona } = useApiQuery<{ nome?: string }>('/mullerbot/persona');
  const nome = persona?.nome?.trim() || 'Assistente IA';

  const tabs: SubTab[] = [
    { to: '/mullerbot', label: 'Chat', icon: <MessageCircle size={14} />, testId: 'assist-chat' },
  ];
  if (canConfig) {
    tabs.push({
      to: '/mullerbot/persona',
      label: role === 'REP' ? 'Meu bot' : 'Configuração',
      icon: <Sparkles size={14} />,
      testId: 'assist-config',
    });
  }
  // Conhecimento segue da EMPRESA (catálogo + FAQ) — rep não edita.
  if (canConhecimento) {
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
