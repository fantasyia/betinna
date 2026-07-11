/**
 * Tipos e helpers do módulo Quadros (Kanban estilo Trello).
 * Espelham as respostas do backend (/kanban/*).
 */

export interface KUsuarioResumo {
  id: string;
  nome: string;
  email: string;
  avatar: string | null;
}

export interface KEtiqueta {
  id: string;
  boardId: string;
  nome: string | null;
  cor: string;
}

export interface KCardResumo {
  id: string;
  listaId: string;
  titulo: string;
  descricao: string | null;
  posicao: number;
  dataInicio: string | null;
  dataEntrega: string | null;
  concluido: boolean;
  corCapa: string | null;
  arquivado: boolean;
  etiquetas: Array<{ etiqueta: KEtiqueta }>;
  membros: Array<{ usuario: KUsuarioResumo }>;
  checklists: Array<{ itens: Array<{ concluido: boolean }> }>;
  _count: { comentarios: number; anexos: number };
}

export interface KLista {
  id: string;
  boardId: string;
  nome: string;
  posicao: number;
  arquivada: boolean;
  cards: KCardResumo[];
}

export interface KBoardResumo {
  id: string;
  nome: string;
  descricao: string | null;
  corFundo: string;
  imagemFundo: string | null;
  /** Signed URL (24h) resolvida pelo backend quando há imagem. */
  imagemFundoUrl?: string | null;
  criadoPorId: string;
  criadoPor: KUsuarioResumo;
  membros: Array<{ usuario: KUsuarioResumo; papel: string }>;
  _count?: { listas: number };
  atualizadoEm: string;
}

export interface KBoardCompleto extends KBoardResumo {
  listas: KLista[];
  etiquetas: KEtiqueta[];
  campos: Array<{
    id: string;
    nome: string;
    tipo: string;
    opcoes: string[] | null;
  }>;
}

// ─── Card completo (modal) ────────────────────────────────────────────

export interface KChecklistItem {
  id: string;
  checklistId: string;
  texto: string;
  concluido: boolean;
  posicao: number;
  dataEntrega: string | null;
  responsavelId: string | null;
  responsavel: KUsuarioResumo | null;
}

export interface KChecklist {
  id: string;
  cardId: string;
  titulo: string;
  posicao: number;
  itens: KChecklistItem[];
}

export interface KComentario {
  id: string;
  cardId: string;
  autorId: string;
  texto: string;
  criadoEm: string;
  autor: KUsuarioResumo;
}

export interface KAnexo {
  id: string;
  cardId: string;
  nome: string;
  url: string;
  tipo: string;
  criadoEm: string;
}

export interface KAtividade {
  id: string;
  tipo: string;
  dados: Record<string, unknown>;
  criadoEm: string;
  usuario: KUsuarioResumo;
}

export interface KCampoBoard {
  id: string;
  nome: string;
  tipo: string;
  opcoes: string[] | null;
}

export interface KCampoValor {
  id: string;
  campoId: string;
  cardId: string;
  valor: unknown;
  campo: KCampoBoard;
}

export interface KCardCompleto {
  id: string;
  listaId: string;
  titulo: string;
  descricao: string | null;
  posicao: number;
  dataInicio: string | null;
  dataEntrega: string | null;
  concluido: boolean;
  corCapa: string | null;
  arquivado: boolean;
  lista: { id: string; nome: string; boardId: string };
  etiquetas: Array<{ etiqueta: KEtiqueta }>;
  membros: Array<{ usuario: KUsuarioResumo }>;
  checklists: KChecklist[];
  comentarios: KComentario[];
  anexos: KAnexo[];
  campoValores: KCampoValor[];
  atividades: KAtividade[];
}

/** Descrição legível de uma atividade pro feed (fallback = tipo cru). */
export function descreverAtividade(a: KAtividade): string {
  const d = a.dados as Record<string, string | undefined>;
  switch (a.tipo) {
    case 'board_criado':
      return 'criou o quadro';
    case 'board_atualizado':
      return 'atualizou o quadro';
    case 'board_arquivado':
      return 'arquivou o quadro';
    case 'membro_adicionado':
      return `adicionou ${d.membroNome ?? 'membro'} ao quadro`;
    case 'membro_removido':
      return 'removeu um membro do quadro';
    case 'lista_criada':
      return `criou a lista "${d.nome ?? ''}"`;
    case 'lista_renomeada':
      return `renomeou "${d.de ?? ''}" para "${d.para ?? ''}"`;
    case 'lista_arquivada':
      return `arquivou a lista "${d.nome ?? ''}"`;
    case 'lista_restaurada':
      return `restaurou a lista "${d.nome ?? ''}"`;
    case 'lista_movida':
      return `moveu a lista "${d.nome ?? ''}"`;
    case 'card_criado':
      return `criou o card "${d.titulo ?? ''}"`;
    case 'card_atualizado':
      return `atualizou o card "${d.titulo ?? ''}"`;
    case 'card_movido':
      return `moveu "${d.titulo ?? ''}" de ${d.deListaNome ?? '?'} para ${d.paraListaNome ?? '?'}`;
    case 'card_concluido':
      return `concluiu "${d.titulo ?? ''}"`;
    case 'card_reaberto':
      return `reabriu "${d.titulo ?? ''}"`;
    case 'card_arquivado':
      return `arquivou "${d.titulo ?? ''}"`;
    case 'card_restaurado':
      return `restaurou "${d.titulo ?? ''}"`;
    case 'card_etiquetado':
      return 'adicionou uma etiqueta';
    case 'card_etiqueta_removida':
      return 'removeu uma etiqueta';
    case 'card_membro_adicionado':
      return `atribuiu ${d.membroNome ?? 'membro'} ao card`;
    case 'card_membro_removido':
      return 'removeu um membro do card';
    case 'checklist_criado':
      return `criou o checklist "${d.titulo ?? ''}"`;
    case 'checklist_removido':
      return `removeu o checklist "${d.titulo ?? ''}"`;
    case 'checklist_item_criado':
      return `adicionou o item "${d.texto ?? ''}"`;
    case 'checklist_item_concluido':
      return `concluiu o item "${d.texto ?? ''}"`;
    case 'checklist_item_reaberto':
      return `reabriu o item "${d.texto ?? ''}"`;
    case 'checklist_item_removido':
      return `removeu o item "${d.texto ?? ''}"`;
    case 'item_delegado':
      return `delegou "${d.texto ?? ''}" para ${d.responsavelNome ?? '?'}`;
    case 'item_delegacao_removida':
      return `removeu a delegação de "${d.texto ?? ''}"`;
    case 'etiqueta_criada':
      return `criou a etiqueta "${d.nome ?? ''}"`;
    case 'campo_criado':
      return `criou o campo "${d.nome ?? ''}"`;
    case 'campo_valor_definido':
      return `definiu "${d.campoNome ?? ''}"`;
    case 'campo_valor_removido':
      return `limpou "${d.campoNome ?? ''}"`;
    case 'comentario':
      return 'comentou';
    case 'comentario_removido':
      return 'removeu um comentário';
    case 'anexo_adicionado':
      return `anexou "${d.nome ?? ''}"`;
    case 'anexo_removido':
      return `removeu o anexo "${d.nome ?? ''}"`;
    default:
      return a.tipo.replaceAll('_', ' ');
  }
}

/** Paleta de cores de fundo do quadro (estilo Trello + cores da marca). */
export const BOARD_CORES = [
  '#0079BF', // azul Trello (default)
  '#201554', // navy Betinna
  '#2bcae5', // cyan Betinna
  '#bd1fbf', // magenta Betinna
  '#5C88DA', // blue Betinna
  '#519839', // verde
  '#B04632', // terracota
  '#89609E', // roxo
  '#CD5A91', // rosa
  '#4BBF6B', // verde claro
  '#00AECC', // ciano
  '#838C91', // cinza
] as const;

/** Posição fracionária entre vizinhos (mesma técnica do backend). */
export function posicaoEntre(antes: number | null, depois: number | null): number {
  if (antes === null && depois === null) return 1024;
  if (antes === null) return (depois as number) / 2;
  if (depois === null) return antes + 1024;
  return (antes + depois) / 2;
}

/** Status do prazo pro badge do card: verde concluído / amarelo próximo / vermelho vencido. */
export function statusPrazo(
  dataEntrega: string | null,
  concluido: boolean,
): 'concluido' | 'vencido' | 'proximo' | 'normal' | null {
  if (!dataEntrega) return null;
  if (concluido) return 'concluido';
  const prazo = new Date(dataEntrega).getTime();
  const agora = new Date();
  // Só vencido se a entrega for ANTES do início do dia local de HOJE.
  // (a data vem como meio-dia UTC, então comparar por timestamp exato marcava
  //  como "vencido" um card que entrega HOJE já às 9h da manhã BRT).
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  if (prazo < inicioHoje) return 'vencido';
  if (prazo - agora.getTime() < 48 * 60 * 60 * 1000) return 'proximo'; // < 48h
  return 'normal';
}

/** Progresso agregado dos checklists do card (pro badge "3/7"). */
export function progressoChecklist(card: KCardResumo): { feito: number; total: number } | null {
  let feito = 0;
  let total = 0;
  for (const ck of card.checklists) {
    for (const item of ck.itens) {
      total += 1;
      if (item.concluido) feito += 1;
    }
  }
  return total > 0 ? { feito, total } : null;
}
