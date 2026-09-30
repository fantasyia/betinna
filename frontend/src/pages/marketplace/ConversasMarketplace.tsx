import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { useRole } from '@/hooks/usePermission';
import {
  GerenciarRespostasProntas,
  RespostaAutomaticaMl,
  useRespostasProntas,
  type RespostaPronta,
} from '@/pages/marketplace/RespostasProntas';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { StateView } from '@/components/StateView';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import {
  CampoResposta,
  RespostaEnviada,
  hora,
  useMensagensMkt,
} from '@/pages/marketplace/RespostaMarketplace';

/**
 * Lista de conversas de marketplace de UM grupo (pré-venda ou pós-venda) na aba
 * Marketplaces (Léo, 29/09).
 *
 * Pré-venda responde NA PRÓPRIA pergunta (Léo, 29/09: "não precisa abrir no
 * inbox") — a resposta aparece num campo pequeno embaixo. O ML aceita UMA
 * resposta por pergunta, então depois de enviada o campo some. Pós-venda
 * (conversa de ida e volta) segue abrindo na Inbox.
 */
export type GrupoMarketplace = 'pre_venda' | 'pos_venda';

interface ConversaMkt {
  id: string;
  canal: string;
  peerNome?: string | null;
  ultimaMsgPreview?: string | null;
  ultimaMsgEm?: string | null;
  naoLidas?: number;
  tagsInternas?: string[];
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

export function ConversasMarketplace({ grupo }: { grupo: GrupoMarketplace }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<PaginatedResponse<ConversaMkt>>(
    `/inbox?grupo=${grupo}&limit=50`,
  );
  const lista = data?.data ?? [];
  const prontas = useRespostasProntas();
  const role = useRole();
  const podeEditarProntas = role === 'DIRECTOR' || role === 'ADMIN';
  const [gerenciando, setGerenciando] = useState(false);

  return (
    <>
      {grupo === 'pre_venda' && podeEditarProntas && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-border">
          <RespostaAutomaticaMl ligada={prontas.respostaAutomatica} onMudou={prontas.refetch} />
          <Button
            size="sm"
            variant="secondary"
            data-testid="prontas-gerenciar"
            onClick={() => setGerenciando(true)}
          >
            Respostas prontas ({prontas.lista.length})
          </Button>
          <GerenciarRespostasProntas
            open={gerenciando}
            onClose={() => setGerenciando(false)}
            atuais={prontas.lista}
            onSalvo={prontas.refetch}
          />
        </div>
      )}
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && lista.length === 0}
        emptyMessage={VAZIO[grupo]}
        onRetry={refetch}
      >
        <ul className="divide-y divide-border" data-testid={`mkt-lista-${grupo}`}>
          {lista.map((c) =>
            grupo === 'pre_venda' ? (
              <Pergunta key={c.id} c={c} onRespondida={refetch} prontas={prontas.lista} />
            ) : (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid="mkt-conversa"
                  onClick={() => navigate(`/inbox?conversa=${c.id}`)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-hover flex items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <Cabecalho c={c} />
                    <div className="text-[14px] text-text truncate mt-0.5">
                      {c.ultimaMsgPreview ?? '—'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[12px] text-muted">{hora(c.ultimaMsgEm)}</span>
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
            ),
          )}
        </ul>
      </StateView>
    </>
  );
}

/**
 * Há quanto tempo a pergunta espera (card ML, 30/09). O ML não dá prazo pra
 * pergunta, mas o tempo de resposta pesa na conversão: até 1 h é tranquilo,
 * até 12 h pede atenção, passou disso está atrasada.
 */
export function espera(
  iso?: string | null,
  agora = Date.now(),
): { texto: string; nivel: 'ok' | 'atencao' | 'atrasada' } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.floor((agora - t) / 60000));
  const texto =
    min < 60
      ? `há ${min} min`
      : min < 48 * 60
        ? `há ${Math.floor(min / 60)} h`
        : `há ${Math.floor(min / 1440)} dias`;
  const nivel = min < 60 ? 'ok' : min < 12 * 60 ? 'atencao' : 'atrasada';
  return { texto: `Aguardando ${texto}`, nivel };
}

const COR_ESPERA = {
  ok: 'border-border text-muted',
  atencao: 'border-warning text-warning',
  atrasada: 'border-danger text-danger',
} as const;

interface ResumoAnuncio {
  id: string;
  titulo: string | null;
  link: string | null;
  status: string | null;
}

/** Título do anúncio com link pro ML (abre em outra aba). */
function Anuncio({ itemId }: { itemId: string }) {
  const { data } = useApiQuery<ResumoAnuncio>(`/integracoes/mercadolivre/anuncios/${itemId}`);
  const link = data?.link ?? null;
  const titulo = data?.titulo ?? itemId;
  const pausado = data?.status && data.status !== 'active';
  return (
    <div className="text-[12px] text-muted mt-0.5 truncate" data-testid="mkt-anuncio">
      📦{' '}
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {titulo}
        </a>
      ) : (
        titulo
      )}
      {pausado && (
        <span className="text-warning">
          {' '}
          · anúncio {data?.status === 'paused' ? 'pausado' : data?.status}
        </span>
      )}
    </div>
  );
}

function Cabecalho({ c }: { c: ConversaMkt }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <span>{CANAL_CURTO[c.canal] ?? c.canal}</span>
      <span>·</span>
      <span className="truncate">{c.peerNome ?? 'Comprador'}</span>
    </div>
  );
}

/** Uma pergunta de anúncio: o texto do comprador, a resposta (se já houver) e o campo. */
function Pergunta({
  c,
  onRespondida,
  prontas,
}: {
  c: ConversaMkt;
  onRespondida: () => void;
  prontas: RespostaPronta[];
}) {
  const { lista, refetch } = useMensagensMkt(c.id);
  const perguntas = lista.filter((m) => m.direction === 'INBOUND' && m.tipo !== 'SYSTEM');
  const itemId = perguntas.find((m) => m.meta?.ml_item_id)?.meta?.ml_item_id;
  const respostas = lista.filter((m) => m.direction === 'OUTBOUND');
  const enviada = respostas.find((m) => m.status !== 'FAILED');
  // Tentativa que falhou só aparece enquanto não houver uma que foi.
  const falha = enviada ? null : respostas.filter((m) => m.status === 'FAILED').at(-1);
  const esperaPergunta = espera(perguntas[0]?.criadoEm ?? c.ultimaMsgEm);

  return (
    <li className="px-4 py-3" data-testid="mkt-pergunta">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Cabecalho c={c} />
          {!enviada && c.tagsInternas?.some((t) => t.toLowerCase() === 'humano') && (
            <span
              data-testid="mkt-humano"
              className="shrink-0 rounded-full border border-warning px-2 text-[11px] font-semibold text-warning"
              title="A IA não achou a resposta no anúncio — precisa de um humano"
            >
              👤 Humano
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!enviada && esperaPergunta && (
            <span
              data-testid="mkt-espera"
              className={cn(
                'rounded-full border px-2 text-[11px] font-semibold',
                COR_ESPERA[esperaPergunta.nivel],
              )}
            >
              ⏱ {esperaPergunta.texto}
            </span>
          )}
          <span className="text-[12px] text-muted">{hora(c.ultimaMsgEm)}</span>
        </div>
      </div>
      {itemId && <Anuncio itemId={itemId} />}
      {(perguntas.length ? perguntas.map((m) => m.conteudo) : [c.ultimaMsgPreview ?? '—']).map(
        (t, i) => (
          <div key={i} className="text-[14px] text-text mt-0.5 whitespace-pre-wrap">
            {t}
          </div>
        ),
      )}
      {enviada ? (
        <RespostaEnviada m={enviada} />
      ) : (
        <>
          {falha && <RespostaEnviada m={falha} />}
          <CampoResposta
            conversationId={c.id}
            testId="mkt-pergunta"
            placeholder="Escreva a resposta pro comprador…"
            prontas={prontas}
            sugerir={async () => {
              const r = await api.post<{ texto: string | null; precisaHumano: boolean }>(
                `/integracoes/mercadolivre/perguntas/${c.id}/sugerir-resposta`,
              );
              // marcada pra humano: recarrega a lista pra etiqueta aparecer
              if (r.precisaHumano) onRespondida();
              return r.texto;
            }}
            onEnviada={() => {
              refetch();
              onRespondida();
            }}
          />
        </>
      )}
    </li>
  );
}
