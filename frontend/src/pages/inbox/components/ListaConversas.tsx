import { Search, Bell, BellOff } from 'lucide-react';
import { StateView } from '@/components/StateView';
import { Card, Input, Select, Tabs } from '@/components/ui';
import type { PaginatedResponse } from '@/hooks/useApiQuery';
import type { ConversationStatus, Conversation } from '@/pages/inbox/lib/types';
import { STATUS_LABEL } from '@/pages/inbox/lib/canais';
import { ConversationItem } from '@/pages/inbox/components/ConversationItem';

/**
 * ListaConversas — região da lista (Card da esquerda) extraída do InboxPage
 * (refactor 2026-06-16). Componente PRESENTACIONAL: toolbar (busca + som +
 * tabs de canal + 3 selects de filtro) + lista scrollable (StateView > ul >
 * ConversationItem). A query/estado de filtros/selectedId continuam no root —
 * aqui só chegam por props. JSX movido VERBATIM.
 */
export function ListaConversas({
  canalTab,
  setCanalTab,
  status,
  setStatus,
  filterMeu,
  setFilterMeu,
  situacao,
  setSituacao,
  search,
  setSearch,
  pageResp,
  loading,
  error,
  refetch,
  selectedId,
  onSelect,
  somLigado,
  alternarSom,
  botGlobalAtivo,
}: {
  canalTab: string;
  setCanalTab: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  filterMeu: string;
  setFilterMeu: (v: string) => void;
  situacao: string;
  setSituacao: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  pageResp: PaginatedResponse<Conversation> | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  somLigado: boolean;
  alternarSom: () => void;
  botGlobalAtivo: boolean;
}) {
  return (
    <Card
      padding="none"
      className="flex flex-col overflow-hidden"
    >
      {/* Search + tabs */}
      <div className="p-3 border-b border-border flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Input
            leftIcon={<Search />}
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <button
            type="button"
            data-testid="inbox-som-toggle"
            onClick={alternarSom}
            title={somLigado ? 'Som de mensagem nova: ligado' : 'Som de mensagem nova: desligado'}
            className="p-2 rounded-md text-muted hover:text-text hover:bg-surface-hover shrink-0"
          >
            {somLigado ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
        </div>
        <Tabs
          items={[
            { value: 'todos', label: 'Todos' },
            { value: 'wa', label: 'WA' },
            { value: 'ig', label: 'IG' },
            { value: 'fb', label: 'FB' },
            { value: 'em', label: 'EM' },
          ]}
          value={canalTab}
          onChange={setCanalTab}
        />
        <div className="grid grid-cols-2 gap-2">
          <Select
            data-testid="inbox-status"
            size="sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {/* Vazio = ativas (não mostra Resolvida/Arquivada). Escolha
                explícita pra ver as resolvidas/arquivadas. */}
            <option value="">Ativas (abertas/pendentes)</option>
            {(Object.keys(STATUS_LABEL) as ConversationStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            data-testid="inbox-meu"
            size="sm"
            value={filterMeu}
            onChange={(e) => setFilterMeu(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="meu">Minhas</option>
            <option value="nao_atribuidas">Não atribuídas</option>
          </Select>
          <Select
            data-testid="inbox-situacao"
            size="sm"
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
            className="col-span-2"
          >
            <option value="">Qualquer situação</option>
            <option value="precisa_humano">🧑 Precisa de humano</option>
            <option value="nao_lidas">🔵 Não lidas (cliente esperando)</option>
          </Select>
        </div>
      </div>

      {/* Lista scrollable. Polling roda silenciosamente em background
          (a cada POLL_INTERVAL_MS) — sem indicador visual pra não distrair. */}
      <div className="flex-1 overflow-y-auto">
        <StateView
          loading={loading && !pageResp}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma conversa nesse filtro."
          onRetry={refetch}
        >
          {pageResp && (
            <ul className="flex flex-col">
              {pageResp.data.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  active={c.id === selectedId}
                  botGlobalAtivo={botGlobalAtivo}
                  onClick={onSelect}
                />
              ))}
            </ul>
          )}
        </StateView>
      </div>
    </Card>
  );
}
