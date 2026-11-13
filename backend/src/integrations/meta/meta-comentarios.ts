/**
 * Comentários de Facebook (Página) e Instagram (13/11). PURO: parse do webhook e
 * escolha do endpoint de resposta — quem chama a Graph é o service.
 *
 * Webhook:
 *  - IG  → object='instagram', changes[].field='comments'. O id do comentário vem
 *    em `comment_id` (Login do Facebook) ou `id` (Login do Instagram).
 *  - FB  → object='page', changes[].field='feed' com item='comment' e verb='add'.
 *    `feed` traz também post, curtida, share — tudo isso é ignorado aqui.
 *
 * Comentário da PRÓPRIA conta (a resposta que a loja deu) volta pelo mesmo
 * webhook: tem que ser ignorado, senão a IA responde a si mesma em loop.
 */
import type { MessageChannel } from '@prisma/client';

export type CanalComentario = Extract<
  MessageChannel,
  'FACEBOOK_COMENTARIO' | 'INSTAGRAM_COMENTARIO'
>;

export const CANAIS_COMENTARIO: readonly CanalComentario[] = [
  'FACEBOOK_COMENTARIO',
  'INSTAGRAM_COMENTARIO',
];

export function ehCanalComentario(canal: string): canal is CanalComentario {
  return (CANAIS_COMENTARIO as readonly string[]).includes(canal);
}

/** Prefixo do peerId das conversas de comentário (uma por autor × publicação). */
export const PREFIXO_PEER_COMENTARIO = 'cmt:';

export function peerDoComentario(postId: string, autorId: string): string {
  return `${PREFIXO_PEER_COMENTARIO}${postId}:${autorId}`;
}

export interface ComentarioRecebido {
  canal: CanalComentario;
  /** Id do comentário que chegou (idempotência da mensagem). */
  comentarioId: string;
  /**
   * Comentário onde a resposta pública entra. IG só aceita resposta em
   * comentário de 1º nível; no FB a resposta a uma resposta vai pro mesmo fio.
   * Por isso: o pai, quando o comentário já é resposta; senão, ele mesmo.
   */
  alvoId: string;
  postId: string;
  autorId: string;
  autorNome?: string;
  texto: string;
  data?: Date;
  /** Anúncio, quando o comentário foi num post patrocinado (só IG informa). */
  anuncioId?: string;
  anuncioTitulo?: string;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** created_time do FB: epoch em segundos (número) ou ISO. */
function dataDe(v: unknown): Date | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/**
 * Comentários NOVOS de UMA entry. `contaId` = entry.id (pageId no FB, IG user id
 * no IG) — é também o "autor" quando quem comentou foi a própria loja.
 */
export function extrairComentarios(
  object: string,
  contaId: string,
  changes: Array<{ field: string; value: unknown }> | undefined,
): ComentarioRecebido[] {
  const out: ComentarioRecebido[] = [];
  for (const c of changes ?? []) {
    const v = obj(c.value);
    const from = obj(v.from);
    const autorId = str(from.id);
    // Sem autor não há com quem conversar; autor = a própria conta é eco nosso.
    if (!autorId || autorId === contaId) continue;

    if (object === 'instagram' && c.field === 'comments') {
      const comentarioId = str(v.comment_id) ?? str(v.id);
      const media = obj(v.media);
      const postId = str(media.id);
      const texto = str(v.text);
      if (!comentarioId || !postId || !texto) continue;
      const pai = str(v.parent_id);
      out.push({
        canal: 'INSTAGRAM_COMENTARIO',
        comentarioId,
        alvoId: pai ?? comentarioId,
        postId,
        autorId,
        autorNome: str(from.username),
        texto,
        anuncioId: str(media.ad_id),
        anuncioTitulo: str(media.ad_title),
      });
      continue;
    }

    if (object === 'page' && c.field === 'feed') {
      // Só comentário novo: edição, remoção, curtida e post ficam de fora.
      if (v.item !== 'comment' || v.verb !== 'add') continue;
      const comentarioId = str(v.comment_id);
      const postId = str(v.post_id);
      const texto = str(v.message);
      if (!comentarioId || !postId || !texto) continue;
      const pai = str(v.parent_id);
      out.push({
        canal: 'FACEBOOK_COMENTARIO',
        comentarioId,
        // parent_id === post_id quando é comentário de 1º nível.
        alvoId: pai && pai !== postId ? pai : comentarioId,
        postId,
        autorId,
        autorNome: str(from.name),
        texto,
        data: dataDe(v.created_time),
      });
    }
  }
  return out;
}

/** Caminho da Graph pra responder em público. */
export function rotaRespostaPublica(canal: CanalComentario, alvoId: string): string {
  const id = encodeURIComponent(alvoId);
  return canal === 'INSTAGRAM_COMENTARIO' ? `/${id}/replies` : `/${id}/comments`;
}

/** Chaves que a conversa guarda na metadata pra o adapter saber onde responder. */
export const CHAVES_META_COMENTARIO = [
  'comentario_alvo_id',
  'comentario_id',
  'comentario_post_id',
  'comentario_autor_id',
  'comentario_anuncio',
] as const;
