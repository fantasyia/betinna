import { api } from '@/lib/api';
import type { KBoardCompleto } from './kanban-types';

interface Inalterado {
  inalterado: true;
  assinatura: string;
  imagemFundoUrl?: string | null;
}

type Buscar = <T>(path: string) => Promise<T>;

/**
 * Carrega o quadro — e, quando já tem um em mãos, só baixa de novo se mudou.
 *
 * O polling de 15s baixava o quadro inteiro toda vez: 1,2 MB no DEV, e virou
 * timeout recorrente (BETINNA-FRONT-A). Agora manda a `assinatura` que já tem;
 * se o servidor responder "inalterado", devolve o MESMO objeto de antes — a
 * tela não re-sincroniza as listas e nada pisca.
 *
 * Só a URL assinada do fundo é trocada quando vem diferente: ela expira em 24h,
 * e uma aba aberta mais que isso num quadro parado perderia a imagem.
 */
export async function carregarBoard(
  boardId: string,
  anterior: KBoardCompleto | null,
  buscar: Buscar = api.get,
): Promise<KBoardCompleto> {
  const base = `/kanban/boards/${boardId}`;
  // Quadro de outro id (trocou de quadro na tela) não serve de referência.
  const referencia = anterior?.id === boardId ? anterior : null;
  const path = referencia?.assinatura
    ? `${base}?desde=${encodeURIComponent(referencia.assinatura)}`
    : base;

  const r = await buscar<KBoardCompleto | Inalterado>(path);
  if ('inalterado' in r && r.inalterado) {
    if (!referencia) return buscar<KBoardCompleto>(base);
    if (r.imagemFundoUrl !== undefined && r.imagemFundoUrl !== referencia.imagemFundoUrl) {
      return { ...referencia, imagemFundoUrl: r.imagemFundoUrl };
    }
    return referencia;
  }
  return r as KBoardCompleto;
}
