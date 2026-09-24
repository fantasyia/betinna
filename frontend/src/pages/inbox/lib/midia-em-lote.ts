import { api } from '@/lib/api';

export interface MidiaUrl {
  url: string;
  mime: string | null;
}

/** Janela pra juntar os pedidos de um mesmo render. */
const JANELA_MS = 16;
/** Espelha `MAX_MIDIAS_POR_LOTE` do backend. */
const MAX_POR_LOTE = 100;

type Pedido = { resolve: (v: MidiaUrl) => void; reject: (e: unknown) => void };

/**
 * Junta os pedidos de mídia que nascem juntos numa requisição só.
 *
 * 🔴 Card 429 (Sentry BETINNA-FRONT-B, 24/09): cada player de mídia buscava a
 * sua URL, todos no mesmo render. Conversa com 50 mídias = 50 GETs no mesmo
 * segundo contra um balde de 10/s que é da EMPRESA — da 11ª em diante, 429, e a
 * mídia ficava "indisponível" até alguém clicar em "tentar de novo".
 *
 * Aqui cada `carregar(id)` entra numa fila; depois de `JANELA_MS` a fila vira
 * UMA chamada `GET /inbox/messages/media?ids=…`. Os players não mudam: cada um
 * continua pedindo a sua mídia e recebendo a sua resposta.
 *
 * Uma mídia que o servidor devolve `null` rejeita só o pedido DELA. Uma falha
 * da requisição rejeita os pedidos daquele lote (e o "tentar de novo" de cada
 * player refaz só o dele).
 */
export function criarCarregadorDeMidia(
  buscarLote: (ids: string[]) => Promise<Record<string, MidiaUrl | null>>,
  opcoes: { janelaMs?: number; maxPorLote?: number } = {},
) {
  const janelaMs = opcoes.janelaMs ?? JANELA_MS;
  const maxPorLote = opcoes.maxPorLote ?? MAX_POR_LOTE;
  let fila = new Map<string, Pedido[]>();
  let agendado: ReturnType<typeof setTimeout> | null = null;

  const disparar = () => {
    agendado = null;
    const atual = fila;
    fila = new Map();
    const ids = [...atual.keys()];
    for (let i = 0; i < ids.length; i += maxPorLote) {
      const lote = ids.slice(i, i + maxPorLote);
      buscarLote(lote).then(
        (itens) => {
          for (const id of lote) {
            const item = itens[id];
            for (const p of atual.get(id) ?? []) {
              if (item) p.resolve(item);
              else p.reject(new Error('Mídia indisponível'));
            }
          }
        },
        (err: unknown) => {
          for (const id of lote) for (const p of atual.get(id) ?? []) p.reject(err);
        },
      );
    }
  };

  return (id: string): Promise<MidiaUrl> =>
    new Promise<MidiaUrl>((resolve, reject) => {
      const pedidos = fila.get(id) ?? [];
      pedidos.push({ resolve, reject });
      fila.set(id, pedidos);
      if (!agendado) agendado = setTimeout(disparar, janelaMs);
    });
}

/** O carregador do app — uma fila compartilhada por todos os players. */
export const carregarMidia = criarCarregadorDeMidia(async (ids) => {
  const r = await api.get<{ itens: Record<string, MidiaUrl | null> }>(
    `/inbox/messages/media?ids=${ids.map(encodeURIComponent).join(',')}`,
  );
  return r.itens;
});
