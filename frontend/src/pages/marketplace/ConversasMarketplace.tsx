import { useNavigate } from 'react-router-dom';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { StateView } from '@/components/StateView';
import { cn } from '@/lib/cn';

/**
 * Lista de conversas de marketplace de UM grupo (pré-venda ou pós-venda) na aba
 * Marketplaces (Léo, 29/09). Responder é na Inbox, que já tem o composer e o
 * envio pro canal: o clique abre a conversa lá (`/inbox?conversa=<id>`).
 */
export type GrupoMarketplace = 'pre_venda' | 'pos_venda';

interface ConversaMkt {
  id: string;
  canal: string;
  peerNome?: string | null;
  ultimaMsgPreview?: string | null;
  ultimaMsgEm?: string | null;
  naoLidas?: number;
}

const CANAL_CURTO: Record<string, string> = {
  MARKETPLACE_ML: 'Mercado Livre',
  MARKETPLACE_SHOPEE: 'Shopee',
  MARKETPLACE_AMAZON: 'Amazon',
  MARKETPLACE_TIKTOK: 'TikTok Shop',
};

const VAZIO: Record<GrupoMarketplace, string> = {
  pre_venda: 'Nenhuma pergunta de anúncio esperando resposta.',
  pos_venda: 'Nenhuma mensagem de comprador esperando resposta.',
};

function quando(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ConversasMarketplace({ grupo }: { grupo: GrupoMarketplace }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<PaginatedResponse<ConversaMkt>>(
    `/inbox?grupo=${grupo}&limit=50`,
  );
  const lista = data?.data ?? [];

  return (
    <StateView
      loading={loading}
      error={error}
      empty={!loading && !error && lista.length === 0}
      emptyMessage={VAZIO[grupo]}
      onRetry={refetch}
    >
      <ul className="divide-y divide-border" data-testid={`mkt-lista-${grupo}`}>
        {lista.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              data-testid="mkt-conversa"
              onClick={() => navigate(`/inbox?conversa=${c.id}`)}
              className="w-full text-left px-4 py-3 hover:bg-surface-hover flex items-start gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <span>{CANAL_CURTO[c.canal] ?? c.canal}</span>
                  <span>·</span>
                  <span className="truncate">{c.peerNome ?? 'Comprador'}</span>
                </div>
                <div className="text-[14px] text-text truncate mt-0.5">
                  {c.ultimaMsgPreview ?? '—'}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[12px] text-muted">{quando(c.ultimaMsgEm)}</span>
                {(c.naoLidas ?? 0) > 0 && (
                  <span
                    className={cn(
                      'min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold',
                      'bg-primary text-white inline-flex items-center justify-center',
                    )}
                  >
                    {c.naoLidas}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </StateView>
  );
}
