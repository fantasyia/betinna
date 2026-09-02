#!/usr/bin/env node
/**
 * betinna-kanban-mcp — MCP server (stdio) que conecta o Claude Code aos
 * Quadros (Kanban estilo Trello) do Betinna.ai.
 *
 * 16 tools com prefixo kanban_ (Parte 5 da spec). Todas chamam a API do
 * Betinna com o Bearer token (bkt_...) — nada de acesso direto ao banco.
 *
 * Caso de uso central: cada sprint/batch vira card; o Claude move os cards
 * ("Em execução" → "Concluído") e comenta o resumo — o Léo acompanha no app.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { api, ApiError } from './api.js';

const server = new McpServer({ name: 'betinna-kanban', version: '1.0.0' });

// ─── Tipos mínimos das respostas da API ─────────────────────────────────

interface Usuario {
  id: string;
  nome: string;
  email: string;
}
interface Etiqueta {
  id: string;
  nome: string | null;
  cor: string;
}
interface CardResumo {
  id: string;
  titulo: string;
  posicao: number;
  dataEntrega: string | null;
  concluido: boolean;
  etiquetas: Array<{ etiqueta: Etiqueta }>;
  membros: Array<{ usuario: Usuario }>;
  checklists: Array<{ itens: Array<{ concluido: boolean }> }>;
}
interface Lista {
  id: string;
  nome: string;
  posicao: number;
  cards: CardResumo[];
}
interface BoardResumo {
  id: string;
  nome: string;
  descricao: string | null;
  membros: Array<{ usuario: Usuario }>;
  _count?: { listas: number };
}
interface BoardCompleto extends BoardResumo {
  listas: Lista[];
  etiquetas: Etiqueta[];
  campos: Array<{ id: string; nome: string; tipo: string; opcoes: string[] | null }>;
}
interface CardCompleto {
  id: string;
  titulo: string;
  descricao: string | null;
  dataEntrega: string | null;
  concluido: boolean;
  lista: { id: string; nome: string; boardId: string };
  etiquetas: Array<{ etiqueta: Etiqueta }>;
  membros: Array<{ usuario: Usuario }>;
  checklists: Array<{
    id: string;
    titulo: string;
    itens: Array<{
      id: string;
      texto: string;
      concluido: boolean;
      posicao: number;
      dataEntrega: string | null;
      responsavel: Usuario | null;
    }>;
  }>;
  comentarios: Array<{ id: string; texto: string; criadoEm: string; autor: Usuario }>;
  anexos: Array<{ id: string; nome: string; tipo: string; url: string; criadoEm: string }>;
  atividades: Array<{ tipo: string; dados: Record<string, unknown>; criadoEm: string; usuario: Usuario }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function erro(message: string) {
  return { content: [{ type: 'text' as const, text: `ERRO: ${message}` }], isError: true };
}

/** Envolve o handler: ApiError vira mensagem acionável, nunca stack trace. */
function seguro<A>(fn: (args: A) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof ApiError) return erro(err.message);
      // #34: erro NÃO-ApiError (bug do próprio server, JSON malformado, etc.)
      // perdia a `cause`, que costuma ser a única pista real do que quebrou.
      if (err instanceof Error) {
        const causa = err.cause;
        const extra =
          causa instanceof Error
            ? ` (causa: ${causa.message})`
            : causa
              ? ` (causa: ${String(causa).slice(0, 200)})`
              : '';
        return erro(`${err.message}${extra}`);
      }
      return erro(String(err));
    }
  };
}

/** Resumo enxuto de um card (spec: respostas enxutas, não o card inteiro). */
function resumirCard(c: CardResumo) {
  let feito = 0;
  let total = 0;
  for (const ck of c.checklists) {
    for (const i of ck.itens) {
      total++;
      if (i.concluido) feito++;
    }
  }
  return {
    id: c.id,
    titulo: c.titulo,
    entrega: c.dataEntrega,
    concluido: c.concluido,
    etiquetas: c.etiquetas.map((e) => e.etiqueta.nome ?? e.etiqueta.cor),
    membros: c.membros.map((m) => m.usuario.nome),
    checklist: total > 0 ? `${feito}/${total}` : null,
  };
}

/** Posição pra inserir no FIM de uma lista. */
function posicaoNoFim(lista: Lista | undefined): number {
  const ultima = lista?.cards[lista.cards.length - 1]?.posicao ?? 0;
  return ultima + 1024;
}

/** boardId de um card (card → lista.boardId). */
async function boardIdDoCard(cardId: string): Promise<{ card: CardCompleto; boardId: string }> {
  const card = await api.get<CardCompleto>(`/kanban/cards/${cardId}`);
  return { card, boardId: card.lista.boardId };
}

/**
 * Resolve uma etiqueta por ID, NOME (case-insensitive) ou COR.
 *
 * Aceitar nome não é conforto: `kanban_ver_board` é a única fonte de IDs e
 * ESTOURA o limite de tokens em quadro grande (o DEV passa de 60k caracteres).
 * Quem não consegue o ID acaba criando o card sem etiqueta — foi o que
 * aconteceu com cards vindos de outras sessões.
 */
function resolverEtiqueta(
  etiquetas: BoardCompleto['etiquetas'],
  busca: string,
): { ok: true; alvo: BoardCompleto['etiquetas'][number] } | { ok: false; erro: string } {
  const porId = etiquetas.find((e) => e.id === busca);
  if (porId) return { ok: true, alvo: porId };

  const porNome = etiquetas.filter((e) => (e.nome ?? '').toLowerCase() === busca.toLowerCase());
  if (porNome.length > 1) {
    return {
      ok: false,
      erro: `Há ${porNome.length} etiquetas chamadas "${busca}". Use o id: ${porNome
        .map((e) => `${e.id} (${e.cor})`)
        .join(', ')}`,
    };
  }
  const alvo = porNome[0] ?? etiquetas.find((e) => e.cor.toLowerCase() === busca.toLowerCase());
  if (alvo) return { ok: true, alvo };

  const disponiveis = etiquetas.map((e) => e.nome ?? e.cor).join(', ') || '(nenhuma)';
  return {
    ok: false,
    erro:
      `Etiqueta "${busca}" não existe no quadro. Disponíveis: ${disponiveis}. ` +
      'Crie com kanban_criar_etiqueta.',
  };
}

/** Resolve e-mail → usuarioId varrendo os membros dos boards acessíveis. */
async function resolverEmail(email: string): Promise<string> {
  const boards = await api.get<BoardResumo[]>('/kanban/boards');
  for (const b of boards) {
    const m = b.membros.find((x) => x.usuario.email.toLowerCase() === email.toLowerCase());
    if (m) return m.usuario.id;
  }
  throw new ApiError(
    `Nenhum membro com e-mail "${email}" nos quadros acessíveis. Convide a pessoa pro quadro no app primeiro.`,
    404,
  );
}

// ─── Tools de LEITURA (readOnlyHint: true) ──────────────────────────────

server.registerTool(
  'kanban_listar_boards',
  {
    description: 'Lista os quadros Kanban acessíveis (id, nome, nº de listas e membros).',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    const boards = await api.get<BoardResumo[]>('/kanban/boards');
    return ok(
      boards.map((b) => ({
        id: b.id,
        nome: b.nome,
        descricao: b.descricao,
        listas: b._count?.listas ?? 0,
        membros: b.membros.map((m) => `${m.usuario.nome} <${m.usuario.email}>`),
      })),
    );
  }),
);

server.registerTool(
  'kanban_ver_board',
  {
    description:
      'Quadro completo: listas na ordem, com os cards resumidos (id, título, entrega, etiquetas, ' +
      'membros, progresso do checklist). Em quadro grande isso ESTOURA o limite de tokens — se ' +
      'você só precisa dos IDs de lista e das etiquetas disponíveis, passe incluirCards=false.',
    inputSchema: {
      boardId: z.string().describe('ID do quadro (use kanban_listar_boards)'),
      incluirCards: z
        .boolean()
        .default(true)
        .describe('false = só listas e etiquetas (resposta curta, pra pegar IDs)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ boardId, incluirCards }: { boardId: string; incluirCards: boolean }) => {
    const b = await api.get<BoardCompleto>(`/kanban/boards/${boardId}`);
    // Sem os cards a resposta cabe sempre. Era o buraco que fazia card nascer
    // sem etiqueta: a ÚNICA fonte de ids falhava por tamanho, e quem não
    // conseguia o id seguia sem etiqueta.
    if (!incluirCards) {
      return ok({
        id: b.id,
        nome: b.nome,
        etiquetasDisponiveis: b.etiquetas.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })),
        membros: b.membros.map((m) => `${m.usuario.nome} <${m.usuario.email}>`),
        listas: b.listas.map((l) => ({ id: l.id, nome: l.nome, cards: l.cards.length })),
      });
    }
    return ok({
      id: b.id,
      nome: b.nome,
      etiquetasDisponiveis: b.etiquetas.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })),
      camposPersonalizados: b.campos.map((c) => ({ nome: c.nome, tipo: c.tipo, opcoes: c.opcoes })),
      listas: b.listas.map((l) => ({
        id: l.id,
        nome: l.nome,
        cards: l.cards.map(resumirCard),
      })),
    });
  }),
);

server.registerTool(
  'kanban_ver_card',
  {
    description:
      'Card completo: descrição, checklists com itens (id, prazo, responsável), comentários e atividade recente.',
    inputSchema: { cardId: z.string().describe('ID do card (use kanban_ver_board)') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ cardId }: { cardId: string }) => {
    const c = await api.get<CardCompleto>(`/kanban/cards/${cardId}`);
    return ok({
      id: c.id,
      titulo: c.titulo,
      descricao: c.descricao,
      lista: c.lista.nome,
      entrega: c.dataEntrega,
      concluido: c.concluido,
      membros: c.membros.map((m) => m.usuario.nome),
      checklists: c.checklists.map((ck) => ({
        id: ck.id,
        titulo: ck.titulo,
        itens: ck.itens.map((i) => ({
          id: i.id,
          texto: i.texto,
          concluido: i.concluido,
          prazo: i.dataEntrega,
          responsavel: i.responsavel?.nome ?? null,
        })),
      })),
      comentarios: c.comentarios.map((cm) => ({
        autor: cm.autor.nome,
        quando: cm.criadoEm,
        texto: cm.texto,
      })),
      anexos: (c.anexos ?? []).map((a) => ({
        id: a.id,
        nome: a.nome,
        tipo: a.tipo,
        ...(a.tipo === 'link' ? { url: a.url } : {}),
      })),
      atividades: c.atividades.map((a) => ({
        quem: a.usuario.nome,
        tipo: a.tipo,
        dados: a.dados,
        quando: a.criadoEm,
      })),
    });
  }),
);

server.registerTool(
  'kanban_meus_itens',
  {
    description:
      'Itens de checklist delegados ao DONO do token, em todos os quadros, ordenados por prazo.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    interface MeuItem {
      id: string;
      texto: string;
      concluido: boolean;
      dataEntrega: string | null;
      checklist: { card: { id: string; titulo: string; lista: { board: { nome: string } } } };
    }
    const itens = await api.get<MeuItem[]>('/kanban/meus-itens');
    return ok(
      itens.map((i) => ({
        itemId: i.id,
        texto: i.texto,
        prazo: i.dataEntrega,
        cardId: i.checklist.card.id,
        card: i.checklist.card.titulo,
        quadro: i.checklist.card.lista.board.nome,
      })),
    );
  }),
);

server.registerTool(
  'kanban_buscar',
  {
    description: 'Busca cards de um quadro por texto (título/descrição).',
    inputSchema: {
      boardId: z.string(),
      texto: z.string().min(1).describe('Texto a procurar'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ boardId, texto }: { boardId: string; texto: string }) => {
    interface CardBusca {
      id: string;
      titulo: string;
      dataEntrega: string | null;
      lista: { nome: string };
    }
    const cards = await api.get<CardBusca[]>(
      `/kanban/boards/${boardId}/busca?q=${encodeURIComponent(texto)}`,
    );
    if (cards.length === 0) return ok({ resultado: 'Nenhum card encontrado', cards: [] });
    return ok(
      cards.map((c) => ({ id: c.id, titulo: c.titulo, lista: c.lista.nome, entrega: c.dataEntrega })),
    );
  }),
);

server.registerTool(
  'kanban_atividade_recente',
  {
    description: 'Últimas ações no quadro (quem fez o quê, quando) — bom pra ler o status.',
    inputSchema: {
      boardId: z.string(),
      limit: z.number().int().min(1).max(100).default(20).describe('Quantas entradas'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ boardId, limit }: { boardId: string; limit: number }) => {
    interface Atividade {
      tipo: string;
      dados: Record<string, unknown>;
      criadoEm: string;
      usuario: Usuario;
    }
    const ativ = await api.get<Atividade[]>(`/kanban/boards/${boardId}/atividades?limit=${limit}`);
    return ok(
      ativ.map((a) => ({ quem: a.usuario.nome, tipo: a.tipo, dados: a.dados, quando: a.criadoEm })),
    );
  }),
);

// ─── Tools de ESCRITA (não-destrutivas; delete não é exposto via MCP) ───

server.registerTool(
  'kanban_criar_board',
  {
    description: 'Cria um quadro novo (respeita o limite de 1 quadro pra representante).',
    inputSchema: {
      nome: z.string().min(1).max(100),
      descricao: z.string().max(2000).optional(),
      cor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe('Cor de fundo #RRGGBB (opcional)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ nome, descricao, cor }: { nome: string; descricao?: string; cor?: string }) => {
    const board = await api.post<BoardResumo>('/kanban/boards', {
      nome,
      descricao,
      ...(cor ? { corFundo: cor } : {}),
    });
    return ok({ id: board.id, nome: board.nome, dica: 'Use kanban_criar_lista pra montar as colunas' });
  }),
);

server.registerTool(
  'kanban_criar_lista',
  {
    description: 'Cria uma lista (coluna) no fim do quadro.',
    inputSchema: { boardId: z.string(), nome: z.string().min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ boardId, nome }: { boardId: string; nome: string }) => {
    const lista = await api.post<{ id: string; nome: string }>(
      `/kanban/boards/${boardId}/listas`,
      { nome },
    );
    return ok({ id: lista.id, nome: lista.nome });
  }),
);

server.registerTool(
  'kanban_criar_card',
  {
    description:
      'Cria um card no fim de uma lista. Aceita descrição, prazo (ISO), etiquetas (por NOME, cor ' +
      '#RRGGBB ou id) e responsáveis (por E-MAIL). Use o NOME da etiqueta: pegar o id exige ' +
      'kanban_ver_board, que estoura o limite de tokens em quadro grande.',
    inputSchema: {
      listaId: z.string().describe('ID da lista (use kanban_ver_board)'),
      titulo: z.string().min(1).max(200),
      descricao: z.string().max(10000).optional(),
      dataEntrega: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('Prazo ISO, ex: 2026-07-20T12:00:00Z ou 2026-07-20T12:00:00-03:00'),
      etiquetas: z
        .array(z.string())
        .optional()
        .describe('Etiquetas por NOME (ex: "Betinna"), cor #RRGGBB ou id'),
      responsaveis: z
        .array(z.string().email())
        .optional()
        .describe('E-mails de quem fica responsável — NÃO escreva o responsável no título'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      listaId,
      titulo,
      descricao,
      dataEntrega,
      etiquetas,
      responsaveis,
    }: {
      listaId: string;
      titulo: string;
      descricao?: string;
      dataEntrega?: string;
      etiquetas?: string[];
      responsaveis?: string[];
    }) => {
      const card = await api.post<{ id: string; titulo: string }>(`/kanban/listas/${listaId}/cards`, {
        titulo,
        descricao,
        dataEntrega,
      });
      // O card JÁ foi criado. Se aplicar uma etiqueta falhar, NÃO retornamos
      // isError — senão o Claude recria o card e duplica. Reportamos sucesso
      // com aviso do que não colou.
      const avisoEtiquetas: string[] = [];
      // Resolve NOME → id uma vez só: o quadro é o mesmo pra todas as etiquetas.
      const board = etiquetas?.length
        ? await api.get<BoardCompleto>(`/kanban/boards/${(await boardIdDoCard(card.id)).boardId}`)
        : null;
      for (const busca of etiquetas ?? []) {
        const r = board ? resolverEtiqueta(board.etiquetas, busca) : null;
        if (r && !r.ok) {
          avisoEtiquetas.push(r.erro);
          continue;
        }
        const etiquetaId = r?.ok ? r.alvo.id : busca;
        try {
          await api.post(`/kanban/cards/${card.id}/etiquetas/${etiquetaId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          avisoEtiquetas.push(`Etiqueta "${busca}" não aplicada: ${msg}`);
        }
      }
      // Responsável no CAMPO, não no título. Enquanto nao havia como atribuir
      // pelo MCP, as sessoes escreviam o nome no titulo — e o quadro perdia o
      // filtro por membro, que e como se acha "o que e meu".
      const avisoResponsaveis: string[] = [];
      for (const email of responsaveis ?? []) {
        try {
          const usuarioId = await resolverEmail(email);
          await api.post(`/kanban/cards/${card.id}/membros/${usuarioId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          avisoResponsaveis.push(`Responsável "${email}" não atribuído: ${msg}`);
        }
      }
      return ok({
        id: card.id,
        titulo: card.titulo,
        ...(avisoEtiquetas.length > 0 ? { avisoEtiquetas } : {}),
        ...(avisoResponsaveis.length > 0 ? { avisoResponsaveis } : {}),
      });
    },
  ),
);

server.registerTool(
  'kanban_responsavel_card',
  {
    description:
      'Atribui (ou remove, com remover=true) um RESPONSÁVEL a um card existente, por e-mail. ' +
      'Use isto em vez de escrever o nome da pessoa no título: só o campo alimenta o filtro ' +
      '"Membro" do quadro e o kanban_meus_itens.',
    inputSchema: {
      cardId: z.string(),
      email: z.string().email().describe('E-mail de um membro do quadro (kanban_listar_boards)'),
      remover: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ cardId, email, remover }: { cardId: string; email: string; remover: boolean }) => {
    const usuarioId = await resolverEmail(email);
    if (remover) {
      await api.delete(`/kanban/cards/${cardId}/membros/${usuarioId}`);
    } else {
      await api.post(`/kanban/cards/${cardId}/membros/${usuarioId}`);
    }
    return ok({ cardId, email, atribuido: !remover });
  }),
);

server.registerTool(
  'kanban_atualizar_card',
  {
    description:
      'Atualiza título, descrição, prazo, concluído e/ou ARQUIVADO do card. ' +
      'arquivado=true tira o card do quadro sem apagar (REVERSÍVEL: mande false pra restaurar) — ' +
      'é a alternativa segura ao kanban_excluir_card, que é definitivo e leva junto checklists, ' +
      'comentários e anexos.',
    inputSchema: {
      cardId: z.string(),
      titulo: z.string().min(1).max(200).optional(),
      descricao: z.string().max(10000).nullable().optional(),
      dataEntrega: z.string().datetime({ offset: true }).nullable().optional(),
      concluido: z.boolean().optional(),
      arquivado: z
        .boolean()
        .optional()
        .describe('true = arquiva (some do quadro, reversível); false = restaura'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ cardId, ...campos }: { cardId: string; [k: string]: unknown }) => {
    const definidos = Object.fromEntries(
      Object.entries(campos).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(definidos).length === 0) {
      return erro(
        'Informe pelo menos um campo (titulo, descricao, dataEntrega, concluido, arquivado)',
      );
    }
    const card = await api.patch<{ id: string; titulo: string }>(`/kanban/cards/${cardId}`, definidos);
    return ok({ id: card.id, titulo: card.titulo, atualizado: Object.keys(definidos) });
  }),
);

server.registerTool(
  'kanban_excluir_card',
  {
    description:
      'EXCLUI o card DEFINITIVAMENTE (não é arquivar — não tem desfazer). Leva junto, por cascade: ' +
      'checklists+itens, comentários, anexos, etiquetas, membros e campos personalizados. ' +
      '⚠️ Se o card for a ORIGEM de um espelho (tarefa espelhada rep↔Diretor), os ESPELHOS dele ' +
      'também são apagados — a resposta informa quantos. Excluir um espelho não afeta a origem. ' +
      'Use pra limpar card criado por engano/duplicado; pra tirar da vista sem perder, prefira ' +
      'ARQUIVAR (kanban_atualizar_card com arquivado:true — reversível) ou mover pra "Concluído".',
    inputSchema: {
      cardId: z.string().describe('ID do card (use kanban_ver_board / kanban_buscar)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ cardId }: { cardId: string }) => {
    const r = await api.delete<{
      ok: true;
      titulo: string;
      espelhosRemovidos: number;
      arquivosRemovidos: number;
    }>(`/kanban/cards/${cardId}`);
    return ok(r);
  }),
);

server.registerTool(
  'kanban_mover_card',
  {
    description:
      'Move o card pro FIM de outra lista do mesmo quadro (ex: "Em execução" → "Concluído"). Use o NOME ou o ID da lista destino.',
    inputSchema: {
      cardId: z.string(),
      listaDestino: z.string().describe('Nome exato OU id da lista destino'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ cardId, listaDestino }: { cardId: string; listaDestino: string }) => {
    const { boardId } = await boardIdDoCard(cardId);
    const board = await api.get<BoardCompleto>(`/kanban/boards/${boardId}`);
    // Prioriza match exato por id; senão casa por nome (case-insensitive).
    let destino = board.listas.find((l) => l.id === listaDestino);
    if (!destino) {
      const porNome = board.listas.filter(
        (l) => l.nome.toLowerCase() === listaDestino.toLowerCase(),
      );
      if (porNome.length > 1) {
        return erro(
          `Há ${porNome.length} listas chamadas "${listaDestino}" no quadro. ` +
            `Use o ID pra escolher: ${porNome.map((l) => l.id).join(', ')}`,
        );
      }
      destino = porNome[0];
    }
    if (!destino) {
      return erro(
        `Lista "${listaDestino}" não existe no quadro. Listas disponíveis: ${board.listas
          .map((l) => l.nome)
          .join(', ')}`,
      );
    }
    await api.patch(`/kanban/cards/${cardId}/mover`, {
      listaId: destino.id,
      posicao: posicaoNoFim(destino),
    });
    return ok({ cardId, movidoPara: destino.nome });
  }),
);

server.registerTool(
  'kanban_comentar_card',
  {
    description: 'Comenta no card (bom pra registrar o resumo do que foi feito num batch).',
    inputSchema: { cardId: z.string(), texto: z.string().min(1).max(5000) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ cardId, texto }: { cardId: string; texto: string }) => {
    const c = await api.post<{ id: string }>(`/kanban/cards/${cardId}/comentarios`, { texto });
    return ok({ comentarioId: c.id });
  }),
);

const itemChecklistSchema = z.object({
  texto: z.string().min(1).max(500),
  dataEntrega: z.string().datetime({ offset: true }).optional(),
  responsavelEmail: z.string().email().optional().describe('E-mail de um membro do quadro'),
});

server.registerTool(
  'kanban_criar_checklist',
  {
    description:
      'Cria um checklist no card, opcionalmente já com itens — cada item pode ter prazo e responsável (por e-mail). ★',
    inputSchema: {
      cardId: z.string(),
      titulo: z.string().min(1).max(100),
      itens: z.array(itemChecklistSchema).max(100).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      cardId,
      titulo,
      itens,
    }: {
      cardId: string;
      titulo: string;
      itens?: Array<z.infer<typeof itemChecklistSchema>>;
    }) => {
      // Resolve os e-mails ÚNICOS uma vez só (evita N chamadas GET /kanban/boards
      // quando vários itens delegam pra mesma pessoa).
      const emailParaId = new Map<string, string>();
      for (const item of itens ?? []) {
        if (item.responsavelEmail && !emailParaId.has(item.responsavelEmail)) {
          emailParaId.set(item.responsavelEmail, await resolverEmail(item.responsavelEmail));
        }
      }
      const itensResolvidos = [];
      for (const item of itens ?? []) {
        itensResolvidos.push({
          texto: item.texto,
          dataEntrega: item.dataEntrega,
          responsavelId: item.responsavelEmail
            ? emailParaId.get(item.responsavelEmail)
            : undefined,
        });
      }
      const ck = await api.post<{ id: string; itens: Array<{ id: string; texto: string }> }>(
        `/kanban/cards/${cardId}/checklists`,
        { titulo, itens: itensResolvidos },
      );
      return ok({ checklistId: ck.id, itens: ck.itens.map((i) => ({ id: i.id, texto: i.texto })) });
    },
  ),
);

server.registerTool(
  'kanban_marcar_item',
  {
    description: 'Marca/desmarca um item de checklist como concluído.',
    inputSchema: {
      itemId: z.string().describe('ID do item (use kanban_ver_card)'),
      concluido: z.boolean(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ itemId, concluido }: { itemId: string; concluido: boolean }) => {
    await api.patch(`/kanban/checklist-itens/${itemId}`, { concluido });
    return ok({ itemId, concluido });
  }),
);

server.registerTool(
  'kanban_atualizar_item',
  {
    description: 'Atualiza um item de checklist: texto, prazo ★ e/ou responsável ★ (por e-mail).',
    inputSchema: {
      itemId: z.string(),
      texto: z.string().min(1).max(500).optional(),
      dataEntrega: z.string().datetime({ offset: true }).nullable().optional(),
      responsavelEmail: z
        .string()
        .email()
        .nullable()
        .optional()
        .describe('E-mail de um membro do quadro; null remove a delegação'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      itemId,
      texto,
      dataEntrega,
      responsavelEmail,
    }: {
      itemId: string;
      texto?: string;
      dataEntrega?: string | null;
      responsavelEmail?: string | null;
    }) => {
      const payload: Record<string, unknown> = {};
      if (texto !== undefined) payload.texto = texto;
      if (dataEntrega !== undefined) payload.dataEntrega = dataEntrega;
      if (responsavelEmail !== undefined) {
        payload.responsavelId = responsavelEmail === null ? null : await resolverEmail(responsavelEmail);
      }
      if (Object.keys(payload).length === 0) {
        return erro('Informe pelo menos um campo (texto, dataEntrega, responsavelEmail)');
      }
      await api.patch(`/kanban/checklist-itens/${itemId}`, payload);
      return ok({ itemId, atualizado: Object.keys(payload) });
    },
  ),
);

server.registerTool(
  'kanban_definir_campo',
  {
    description:
      'Define o valor de um campo personalizado do card, pelo NOME do campo. ★ (null limpa o valor)',
    inputSchema: {
      cardId: z.string(),
      nomeCampo: z.string().describe('Nome do campo como aparece no quadro'),
      valor: z
        .union([z.string(), z.number(), z.boolean(), z.null()])
        .describe(
          'Valor conforme o tipo do campo. Para campo de DATA, mande data COM hora em ISO ' +
            '(ex: 2026-07-15T12:00:00Z); se mandar só a data (2026-07-15) ela é ancorada ao ' +
            'meio-dia UTC pra evitar erro de fuso. lista_opcoes = uma das opções.',
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      cardId,
      nomeCampo,
      valor,
    }: {
      cardId: string;
      nomeCampo: string;
      valor: string | number | boolean | null;
    }) => {
      const { boardId } = await boardIdDoCard(cardId);
      const board = await api.get<BoardCompleto>(`/kanban/boards/${boardId}`);
      const campo = board.campos.find((c) => c.nome.toLowerCase() === nomeCampo.toLowerCase());
      if (!campo) {
        return erro(
          `Campo "${nomeCampo}" não existe no quadro. Campos: ${
            board.campos.map((c) => c.nome).join(', ') || '(nenhum)'
          }`,
        );
      }
      // Se o campo é data e veio só a data (YYYY-MM-DD), ancora ao meio-dia UTC:
      // salvar meia-noite UTC dá off-by-one no fuso do Brasil (dia anterior).
      let valorFinal = valor;
      if (
        campo.tipo === 'data' &&
        typeof valor === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(valor)
      ) {
        valorFinal = `${valor}T12:00:00Z`;
      }
      await api.put(`/kanban/cards/${cardId}/campos/${campo.id}`, { valor: valorFinal });
      return ok({ cardId, campo: campo.nome, valor: valorFinal });
    },
  ),
);

// ─── Etiquetas, listas e itens (board de conteúdo intuitivo) ─────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

server.registerTool(
  'kanban_criar_etiqueta',
  {
    description:
      'Cria uma etiqueta no quadro (cor #RRGGBB + nome opcional). Use kanban_etiquetar_card pra aplicá-la.',
    inputSchema: {
      boardId: z.string(),
      cor: z.string().regex(HEX_COLOR, 'Cor no formato #RRGGBB'),
      nome: z.string().max(40).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ boardId, cor, nome }: { boardId: string; cor: string; nome?: string }) => {
    const e = await api.post<Etiqueta>(`/kanban/boards/${boardId}/etiquetas`, {
      cor,
      nome: nome ?? null,
    });
    return ok({ id: e.id, nome: e.nome, cor: e.cor });
  }),
);

server.registerTool(
  'kanban_etiquetar_card',
  {
    description:
      'Aplica (ou remove, com remover=true) uma etiqueta num card existente. Aceita NOME, cor #RRGGBB ou id da etiqueta do quadro.',
    inputSchema: {
      cardId: z.string(),
      etiqueta: z.string().describe('Nome exato, cor #RRGGBB ou id da etiqueta (kanban_ver_board)'),
      remover: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({ cardId, etiqueta, remover }: { cardId: string; etiqueta: string; remover: boolean }) => {
      const { boardId } = await boardIdDoCard(cardId);
      const board = await api.get<BoardCompleto>(`/kanban/boards/${boardId}`);
      const r = resolverEtiqueta(board.etiquetas, etiqueta);
      if (!r.ok) return erro(r.erro);
      const alvo = r.alvo;
      if (remover) {
        await api.delete(`/kanban/cards/${cardId}/etiquetas/${alvo.id}`);
      } else {
        await api.post(`/kanban/cards/${cardId}/etiquetas/${alvo.id}`);
      }
      return ok({ cardId, etiqueta: alvo.nome ?? alvo.cor, aplicada: !remover });
    },
  ),
);

server.registerTool(
  'kanban_atualizar_lista',
  {
    description:
      'Renomeia e/ou arquiva/restaura uma lista (coluna) do quadro. Arquivar esconde a lista (não apaga).',
    inputSchema: {
      listaId: z.string().describe('ID da lista (use kanban_ver_board)'),
      nome: z.string().min(1).max(100).optional(),
      arquivada: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({ listaId, nome, arquivada }: { listaId: string; nome?: string; arquivada?: boolean }) => {
      if (nome === undefined && arquivada === undefined) {
        return erro('Informe pelo menos um campo (nome, arquivada)');
      }
      const l = await api.patch<{ id: string; nome: string; arquivada: boolean }>(
        `/kanban/listas/${listaId}`,
        { ...(nome !== undefined ? { nome } : {}), ...(arquivada !== undefined ? { arquivada } : {}) },
      );
      return ok({ id: l.id, nome: l.nome, arquivada: l.arquivada });
    },
  ),
);

server.registerTool(
  'kanban_mover_lista',
  {
    description:
      'Reordena uma lista (coluna) dentro do quadro: informe a posição final desejada (1 = primeira).',
    inputSchema: {
      boardId: z.string(),
      lista: z.string().describe('Nome exato OU id da lista'),
      posicao: z.number().int().min(1).describe('Posição final na ordem das colunas (1-based)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({ boardId, lista, posicao }: { boardId: string; lista: string; posicao: number }) => {
      const board = await api.get<BoardCompleto>(`/kanban/boards/${boardId}`);
      let alvo = board.listas.find((l) => l.id === lista);
      if (!alvo) {
        const porNome = board.listas.filter((l) => l.nome.toLowerCase() === lista.toLowerCase());
        if (porNome.length > 1) {
          return erro(
            `Há ${porNome.length} listas chamadas "${lista}". Use o id: ${porNome.map((l) => l.id).join(', ')}`,
          );
        }
        alvo = porNome[0];
      }
      if (!alvo) {
        return erro(
          `Lista "${lista}" não existe no quadro. Disponíveis: ${board.listas.map((l) => l.nome).join(', ')}`,
        );
      }
      // Posição fracionária entre os vizinhos do slot destino (excluindo a própria lista).
      const outras = board.listas.filter((l) => l.id !== alvo.id).sort((a, b) => a.posicao - b.posicao);
      const idx = Math.min(posicao - 1, outras.length);
      const antes = outras[idx - 1]?.posicao;
      const depois = outras[idx]?.posicao;
      let novaPosicao: number;
      if (antes === undefined && depois === undefined) novaPosicao = 1024;
      else if (antes === undefined) novaPosicao = (depois as number) / 2;
      else if (depois === undefined) novaPosicao = antes + 1024;
      else novaPosicao = (antes + depois) / 2;
      await api.patch(`/kanban/listas/${alvo.id}/mover`, { posicao: novaPosicao });
      return ok({ listaId: alvo.id, nome: alvo.nome, posicaoFinal: posicao });
    },
  ),
);

server.registerTool(
  'kanban_adicionar_itens',
  {
    description:
      'Adiciona itens a um checklist JÁ existente do card — cada item pode ter prazo e responsável (por e-mail). ★',
    inputSchema: {
      checklistId: z.string().describe('ID do checklist (use kanban_ver_card)'),
      itens: z.array(itemChecklistSchema).min(1).max(100),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      checklistId,
      itens,
    }: {
      checklistId: string;
      itens: Array<z.infer<typeof itemChecklistSchema>>;
    }) => {
      // Mesmo padrão do kanban_criar_checklist: resolve e-mails únicos uma vez.
      const emailParaId = new Map<string, string>();
      for (const item of itens) {
        if (item.responsavelEmail && !emailParaId.has(item.responsavelEmail)) {
          emailParaId.set(item.responsavelEmail, await resolverEmail(item.responsavelEmail));
        }
      }
      const criados: Array<{ id: string; texto: string }> = [];
      for (const item of itens) {
        const i = await api.post<{ id: string; texto: string }>(
          `/kanban/checklists/${checklistId}/itens`,
          {
            texto: item.texto,
            dataEntrega: item.dataEntrega,
            responsavelId: item.responsavelEmail ? emailParaId.get(item.responsavelEmail) : undefined,
          },
        );
        criados.push({ id: i.id, texto: i.texto });
      }
      return ok({ checklistId, itens: criados });
    },
  ),
);

server.registerTool(
  'kanban_excluir_checklist',
  {
    description: 'Exclui um checklist inteiro do card (com todos os seus itens). Irreversível.',
    inputSchema: { checklistId: z.string().describe('ID do checklist (use kanban_ver_card)') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ checklistId }: { checklistId: string }) => {
    await api.delete(`/kanban/checklists/${checklistId}`);
    return ok({ checklistId, excluido: true });
  }),
);

server.registerTool(
  'kanban_excluir_item',
  {
    description: 'Exclui um item de checklist. Irreversível.',
    inputSchema: { itemId: z.string().describe('ID do item (use kanban_ver_card)') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ itemId }: { itemId: string }) => {
    await api.delete(`/kanban/checklist-itens/${itemId}`);
    return ok({ itemId, excluido: true });
  }),
);

server.registerTool(
  'kanban_excluir_anexo',
  {
    description:
      'Remove um anexo (arquivo ou link) do card. Irreversível — o arquivo sai do storage. ' +
      'Pegue o anexoId em kanban_ver_card (campo anexos).',
    inputSchema: { anexoId: z.string().describe('ID do anexo (use kanban_ver_card → anexos)') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ anexoId }: { anexoId: string }) => {
    await api.delete(`/kanban/anexos/${anexoId}`);
    return ok({ anexoId, excluido: true });
  }),
);

server.registerTool(
  'kanban_mover_item',
  {
    description:
      'Reordena um item DENTRO do seu checklist: informe a posição final (1 = primeiro). ' +
      'Precisa do cardId pra localizar os vizinhos.',
    inputSchema: {
      cardId: z.string().describe('ID do card que contém o item'),
      itemId: z.string(),
      posicao: z.number().int().min(1).describe('Posição final no checklist (1-based)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ cardId, itemId, posicao }: { cardId: string; itemId: string; posicao: number }) => {
    const card = await api.get<CardCompleto>(`/kanban/cards/${cardId}`);
    const checklist = card.checklists.find((ck) => ck.itens.some((i) => i.id === itemId));
    if (!checklist) {
      return erro(`Item "${itemId}" não está em nenhum checklist do card ${cardId}.`);
    }
    // Vizinhos ordenados por posição, excluindo o próprio item.
    const outros = checklist.itens
      .filter((i) => i.id !== itemId)
      .sort((a, b) => a.posicao - b.posicao);
    const idx = Math.min(posicao - 1, outros.length);
    const antes = outros[idx - 1]?.posicao;
    const depois = outros[idx]?.posicao;
    let novaPosicao: number;
    if (antes === undefined && depois === undefined) novaPosicao = 1024;
    else if (antes === undefined) novaPosicao = (depois as number) / 2;
    else if (depois === undefined) novaPosicao = antes + 1024;
    else novaPosicao = (antes + depois) / 2;
    await api.patch(`/kanban/checklist-itens/${itemId}`, { posicao: novaPosicao });
    return ok({ itemId, checklist: checklist.titulo, posicaoFinal: posicao });
  }),
);

// Extensão → mimetype dos anexos aceitos pelo backend (ALLOWED_MIMES).
const EXT_MIME: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

server.registerTool(
  'kanban_anexar',
  {
    description:
      'Anexa ao card um ARQUIVO local (caminhoArquivo → upload) OU um LINK (url + nome). ' +
      'Arquivos: HTML/CSS/JS/JSON/SVG, imagens, PDF, CSV/TXT, .docx/.xlsx, .zip (máx 10MB).',
    inputSchema: {
      cardId: z.string(),
      caminhoArquivo: z.string().optional().describe('Caminho ABSOLUTO de um arquivo local'),
      url: z.string().url().optional().describe('URL do link (alternativa ao arquivo)'),
      nome: z.string().max(200).optional().describe('Rótulo do link (obrigatório se url)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      cardId,
      caminhoArquivo,
      url,
      nome,
    }: {
      cardId: string;
      caminhoArquivo?: string;
      url?: string;
      nome?: string;
    }) => {
      if (caminhoArquivo && url) {
        return erro('Escolha um só: caminhoArquivo (arquivo) OU url (link).');
      }
      // ── LINK ──
      if (url) {
        if (!nome) return erro('Pra anexar um link, informe também "nome".');
        const a = await api.post<{ id: string; nome: string; tipo: string }>(
          `/kanban/cards/${cardId}/anexos`,
          { url, nome },
        );
        return ok({ id: a.id, nome: a.nome, tipo: a.tipo });
      }
      // ── ARQUIVO ──
      if (!caminhoArquivo) return erro('Informe caminhoArquivo (arquivo) ou url + nome (link).');
      const ext = extname(caminhoArquivo).toLowerCase();
      const mime = EXT_MIME[ext];
      if (!mime) {
        return erro(
          `Extensão "${ext || '(sem)'}" não suportada. Aceitos: ${Object.keys(EXT_MIME).join(', ')}.`,
        );
      }
      let buf: Buffer;
      try {
        buf = await readFile(caminhoArquivo);
      } catch {
        return erro(`Não consegui ler o arquivo em "${caminhoArquivo}". Use caminho ABSOLUTO.`);
      }
      if (buf.length === 0) return erro('Arquivo vazio.');
      if (buf.length > 10 * 1024 * 1024) return erro('Arquivo muito grande (máx 10MB).');
      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(buf)], { type: mime }), basename(caminhoArquivo));
      const a = await api.postForm<{ id: string; nome: string; tipo: string }>(
        `/kanban/cards/${cardId}/anexos`,
        form,
      );
      return ok({ id: a.id, nome: a.nome, tipo: a.tipo });
    },
  ),
);

// ═══════════════════════════════════════════════════════════════════════
// FLUXOS DE AUTOMAÇÃO (prefixo fluxos_) — docs/mcp-fluxos-PLANO.md
// Mesmo pacote/token; exige escopo "fluxos" no PAT. Escrita SEMPRE não-
// destrutiva: import cria RASCUNHO; ativar/pausar/excluir NÃO expostos.
// ═══════════════════════════════════════════════════════════════════════

const FLUXO_NO_TIPO = z.enum(['TRIGGER', 'CONDICAO', 'ACAO', 'DELAY']);
// ⚠️ MANTER SINCRONIZADO com fluxoAcaoTipoValues do backend (fluxos.dto.ts) E com
// o enum FluxoAcaoTipo do Prisma. Toda ação nova criada no editor precisa entrar
// AQUI também — senão a master não consegue montá-la via fluxos_importar.
// ENVIAR_WHATSAPP · config aceita, além de mensagem/destinatario*:
//   remetenteUsuarioId?: string
// De QUAL número sai. Vazio = automático: responde pelo número que RECEBEU a
// mensagem (WhatsApp pessoal do rep, quando a conversa chegou por ele) se o
// destinatário for o lead; nos modos `numero`/`contato` (aviso interno) sai pela
// empresa. Preenchido = manda pelo WhatsApp pessoal daquele usuário — e se ele
// não estiver conectado o passo FALHA, nunca cai calado pro número da empresa.
const FLUXO_ACAO_TIPO = z.enum([
  'ENVIAR_WHATSAPP',
  'ENVIAR_EMAIL',
  'CRIAR_TAREFA',
  'MUDAR_TAG',
  'MOVER_LEAD_ETAPA',
  'ATRIBUIR_REP',
  'WEBHOOK_EXTERNO',
  'CONVERSAR_IA',
  'LIBERAR_LOTE',
  // PAUSAR_IA faz DUAS coisas OPOSTAS conforme a config:
  //   { }                  → pausa o bot na conversa (botLigado=false)
  //   { religar: true }    → RELIGA: liga o bot, tira a pausa e limpa precisaHumano
  // Não existe `acao: "pausar_ia"` — essa chave é ignorada pelo backend.
  'PAUSAR_IA',
  'CRIAR_LEAD', // promove a conversa a Lead (triagem CTWA), herdando a atribuição
  'TRANSFERIR_ATENDIMENTO', // handoff pro humano: atribui + pausa o bot + notifica
]);
const FLUXO_TRIGGER_TIPO = z.enum([
  'LEAD_CRIADO',
  'LEAD_ETAPA_MUDOU',
  'PEDIDO_APROVADO',
  'PEDIDO_ENTREGUE',
  // Rastreio PASSOU A EXISTIR (vazio → preenchido) — o despacho, dias antes da
  // entrega. É o momento em que o cliente quer o código; o PEDIDO_ENTREGUE
  // avisaria depois de a encomenda ter chegado.
  'PEDIDO_RASTREIO_DISPONIVEL',
  'LEAD_REENGAJOU_SITE',
  'OCORRENCIA_ABERTA',
  'CLIENTE_INATIVO_30D',
  'AMOSTRA_FOLLOWUP',
  'CRON_AGENDADO',
  'LEAD_RESPONDEU',
  'LEAD_SEM_RESPOSTA',
  'IA_CLASSIFICOU',
  'LEAD_RECEBEU_TAG',
  'MENSAGEM_CANAL',
  'WEBHOOK_RECEBIDO',
]);

/** Nó no arquivo de import: `id` é a CHAVE estável referenciada pelas arestas. */
const fluxoNoInput = z.object({
  id: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'Chave LOCAL deste payload (ex: "trigger", "ia1") — serve só pra ligar as arestas. ' +
        'NÃO é persistida: o motor gera ids novos a cada atualização, mesmo que você reenvie ' +
        'os ids atuais. Consequência: id de nó NÃO serve como referência entre sessões/cards — ' +
        'referencie o nó pelo TÍTULO.',
    ),
  tipo: FLUXO_NO_TIPO,
  acaoTipo: FLUXO_ACAO_TIPO.nullable().optional().describe('Obrigatório quando tipo=ACAO'),
  titulo: z.string().min(1).max(100),
  config: z
    .record(z.unknown())
    .optional()
    .describe(
      'Config do nó (varia por tipo/ação). ' +
        'CONDICAO (modo "simples") usa {campo, operador, valor}; (modo "roteador") usa ' +
        '{modo:"roteador", variavel, saidas:[...]}. Campos de lead disponíveis: ' +
        'lead.etapa_id · lead.funil_id · lead.tags · lead.segmento · lead.uf · lead.cidade · ' +
        'lead.score · lead.nome · lead.email · lead.whatsapp · lead.etapa_atual · lead.funil. ' +
        '⚠️ Pra comparar ETAPA use SEMPRE `lead.etapa_id` (id, estável) — NÃO `lead.etapa_atual` ' +
        '(nome): renomear a etapa faz a condição parar de casar SEM erro, o fluxo só desvia pro ' +
        'outro ramo e ninguém percebe. `etapa_atual`/`funil` servem pra texto de mensagem. ' +
        'Trigger MENSAGEM_CANAL aceita: canais (string[], ' +
        'ex: ["WHATSAPP"]), palavrasChave (string[]), modo ("qualquer"|"todas"|"exata"), ' +
        'apenasComLead (bool), apenasSemLead (bool, uso de TRIAGEM), apenasComBotLigado (bool), ' +
        'escopo ("empresa"|"pessoal"|"ambos", default "ambos" — dual-owner D38: "empresa" = só ' +
        'WhatsApp CENTRAL, "pessoal" = só celular dos reps. Fluxo de TRIAGEM geral deve usar ' +
        '"empresa": sem isso, mensagem no WhatsApp pessoal de um rep vira lead na Triagem da empresa). ' +
        'Trigger LEAD_RECEBEU_TAG aceita: tagNome (string) ou tagNomes (string[]) ou tagIds ' +
        '(string[]), e modo ("exato"|"prefixo"|"contem", default "exato"). SEM config nenhuma o ' +
        'fluxo dispara em QUALQUER etiqueta. Etiqueta-dimensão usa ":" (ex: "setor:cadeia-do-frio", ' +
        '"publico:comercio") e o ":" é caractere comum — pra pegar a família inteira use ' +
        'modo "prefixo" com tagNome "setor:". Evite "contem": colide entre slugs parecidos ' +
        '("varejo" casa "varejo-alimentar") e o fluxo errado dispara em silêncio. ' +
        'Trigger LEAD_CRIADO aceita: origens (string[] de Lead.origemCadastro) ou origem (1 valor ' +
        'OU grupo "inbound" = site/whatsapp/click_to_whatsapp/meta_lead_ads/google_lead_form, ' +
        '"outbound" = importacao/manual_rep). "api" fica fora dos grupos — liste explícito. ' +
        'SEM config o fluxo dispara pra QUALQUER lead novo, inclusive lote importado.',
    ),
  posX: z.number().optional(),
  posY: z.number().optional(),
});
const fluxoArestaInput = z.object({
  sourceNoId: z.string().min(1).describe('id (chave) do nó de origem'),
  targetNoId: z.string().min(1).describe('id (chave) do nó de destino'),
  label: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .describe(
      'CONDICAO simples: use "Sim"/"Não" (mesmos labels do editor; o motor também aceita ' +
        '"true"/"false" como alias). CONDICAO modo roteador: o label é o VALOR literal da saída.',
    ),
});

interface FluxoResumo {
  usuarioId?: string | null;
  id: string;
  nome: string;
  status: string;
  triggerTipo: string | null;
  descricao?: string | null;
}

// ─── Leitura ─────────────────────────────────────────────────────────────

server.registerTool(
  'fluxos_listar',
  {
    description:
      'Lista os fluxos de automação da empresa (id, nome, status, trigger). Fluxos PESSOAIS de ' +
      'usuário ficam FORA por default (padrão dos quadros de rep) — gestão pede com ' +
      'incluirPessoais: true (leitura). Com token de REP, a lista já vem só com os fluxos DELE.',
    inputSchema: {
      status: z
        .enum(['RASCUNHO', 'ATIVO', 'PAUSADO', 'ARQUIVADO'])
        .optional()
        .describe('Filtra por status'),
      search: z.string().optional().describe('Busca por nome'),
      incluirPessoais: z
        .boolean()
        .optional()
        .describe('Gestão: inclui os fluxos pessoais dos usuários (leitura).'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async ({
      status,
      search,
      incluirPessoais,
    }: {
      status?: string;
      search?: string;
      incluirPessoais?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (search) qs.set('search', search);
      if (incluirPessoais) qs.set('incluirPessoais', 'true');
      const q = qs.toString();
      const resp = await api.get<{ data: FluxoResumo[] } | FluxoResumo[]>(
        `/fluxos${q ? `?${q}` : ''}`,
      );
      // O endpoint pagina: { data: [...], pagination } — normaliza os dois formatos.
      const lista = Array.isArray(resp) ? resp : (resp.data ?? []);
      return ok(
        lista.map((f) => ({
          id: f.id,
          nome: f.nome,
          status: f.status,
          trigger: f.triggerTipo,
          ...(f.usuarioId ? { dono: f.usuarioId } : {}),
        })),
      );
    },
  ),
);

server.registerTool(
  'fluxos_ver',
  {
    description: 'Detalhe de um fluxo: nós e arestas do grafo.',
    inputSchema: { fluxoId: z.string().describe('ID do fluxo (use fluxos_listar)') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    const f = await api.get<Record<string, unknown>>(`/fluxos/${fluxoId}`);
    return ok(f);
  }),
);

server.registerTool(
  'fluxos_exportar',
  {
    description: 'Exporta o fluxo como JSON (envelope pronto pra reimportar com fluxos_importar).',
    inputSchema: { fluxoId: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    const json = await api.get<unknown>(`/fluxos/${fluxoId}/exportar`);
    return ok(json);
  }),
);

server.registerTool(
  'fluxos_execucoes',
  {
    description:
      'Histórico de execuções de um fluxo (mais recentes primeiro), COM os passos (logs por nó — ' +
      'é onde está o motivo quando um caso falha). Cada execução inclui contatoId ' +
      '(leadId/clienteId que a disparou) + contatoNome. Default lista só PRODUÇÃO; ' +
      'use origem: "teste" pra ler execução de teste, ou "todas".',
    inputSchema: {
      fluxoId: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
      origem: z
        .enum(['producao', 'teste', 'todas'])
        .optional()
        .describe('Default producao (o painel separa teste de produção de propósito).'),
      status: z
        .enum(['PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO'])
        .optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async ({
      fluxoId,
      limit,
      origem,
      status,
    }: {
      fluxoId: string;
      limit: number;
      origem?: string;
      status?: string;
    }) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (origem) qs.set('origem', origem);
      if (status) qs.set('status', status);
      const resp = await api.get<unknown>(`/fluxos/${fluxoId}/execucoes?${qs.toString()}`);
      return ok(resp);
    },
  ),
);

server.registerTool(
  'fluxos_metricas',
  {
    description: 'Métricas de execução do fluxo (total, taxa de sucesso, etc.).',
    inputSchema: { fluxoId: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    const m = await api.get<unknown>(`/fluxos/${fluxoId}/metricas`);
    return ok(m);
  }),
);

server.registerTool(
  'fluxos_cron_preview',
  {
    description:
      'Valida expressão(ões) cron (5 campos) e devolve as próximas execuções. Não altera nada.',
    inputSchema: {
      expressoes: z
        .array(z.string().max(120))
        .min(1)
        .describe('Uma ou mais expressões cron de 5 campos, ex: ["0 9 * * 1-5"]'),
      timezone: z.string().max(64).optional().describe('Ex: America/Sao_Paulo'),
      pularFeriados: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async ({
      expressoes,
      timezone,
      pularFeriados,
    }: {
      expressoes: string[];
      timezone?: string;
      pularFeriados?: boolean;
    }) => {
      const r = await api.post<unknown>('/fluxos/cron/preview', {
        expressoes,
        timezone,
        pularFeriados,
      });
      return ok(r);
    },
  ),
);

// ─── Escrita (não-destrutiva: RASCUNHO / teste) ──────────────────────────

server.registerTool(
  'fluxos_importar',
  {
    description:
      'Sobe um fluxo a partir do grafo (nós + arestas) → cria como RASCUNHO (nunca ativa). ' +
      'A ativação é decisão do Léo no app. Nós ACAO exigem acaoTipo; arestas referenciam nós pela chave (id).',
    inputSchema: {
      nome: z.string().min(1).max(150),
      descricao: z.string().max(500).optional(),
      triggerTipo: FLUXO_TRIGGER_TIPO.optional(),
      triggerConfig: z.record(z.unknown()).optional().describe('Ex: { "tag": "medicao-solicitada" }'),
      nos: z.array(fluxoNoInput).max(200).describe('Nós do grafo (TRIGGER, ACAO, CONDICAO, DELAY)'),
      arestas: z.array(fluxoArestaInput).max(400).describe('Ligações entre nós (por chave/id)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (args: {
      nome: string;
      descricao?: string;
      triggerTipo?: string;
      triggerConfig?: Record<string, unknown>;
      nos: unknown[];
      arestas: unknown[];
    }) => {
      const f = await api.post<FluxoResumo>('/fluxos/importar', {
        betinnaFluxo: 1,
        tipo: 'fluxo',
        ...args,
      });
      return ok({
        id: f.id,
        nome: f.nome,
        status: f.status,
        dica: 'Criado como RASCUNHO. Revise e ative no app (ativação nunca via MCP).',
      });
    },
  ),
);

server.registerTool(
  'fluxos_atualizar',
  {
    description:
      'Atualiza um fluxo: nome/descrição/trigger e/ou FULL-REPLACE de nós e arestas (quando ' +
      'fornecidos, substituem TODOS os existentes). Funciona em RASCUNHO, ATIVO e PAUSADO — SÓ ' +
      'recusa ARQUIVADO (use fluxos_desarquivar antes). Editar um fluxo ATIVO o rebaixa pra ' +
      'RASCUNHO automaticamente (o Léo reativa depois de revisar). Nunca ativa sozinho.',
    inputSchema: {
      fluxoId: z.string(),
      nome: z.string().min(1).max(150).optional(),
      descricao: z.string().max(500).optional(),
      triggerTipo: FLUXO_TRIGGER_TIPO.optional(),
      triggerConfig: z.record(z.unknown()).optional(),
      nos: z
        .array(fluxoNoInput)
        .optional()
        .describe(
          'Full replace do grafo INTEIRO — envie SEMPRE junto com `arestas` (busque o grafo atual ' +
            'com fluxos_ver antes e mande os dois). Mandar só `nos` é rejeitado: apagaria toda a topologia.',
        ),
      arestas: z
        .array(fluxoArestaInput)
        .optional()
        .describe('Full replace — envie SEMPRE junto com `nos` (ou omita os dois).'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ fluxoId, ...campos }: { fluxoId: string; [k: string]: unknown }) => {
    const definidos = Object.fromEntries(
      Object.entries(campos).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(definidos).length === 0) {
      return erro('Informe pelo menos um campo (nome, descricao, triggerTipo, nos, arestas)');
    }
    const f = await api.put<FluxoResumo>(`/fluxos/${fluxoId}`, definidos);
    return ok({ id: f.id, nome: f.nome, status: f.status, atualizado: Object.keys(definidos) });
  }),
);

server.registerTool(
  'fluxos_definir_gatilho',
  {
    description:
      'Define/atualiza SÓ o nó de GATILHO do fluxo, sem mexer no resto do grafo. Use quando o ' +
      'fluxo nasceu sem nó TRIGGER (não dá pra ATIVAR: o validador recusa) ou pra trocar o filtro ' +
      'do gatilho. Se o nó não existe, cria e liga no nó inicial; se existe, só atualiza a config. ' +
      'Alternativa ao fluxos_atualizar, que faz FULL-REPLACE e exigiria reenviar corpos de e-mail ' +
      'inteiros. Não ativa o fluxo. Ex. de config p/ LEAD_RECEBEU_TAG: { tagNome: "setor:", modo: "prefixo" }.',
    inputSchema: {
      fluxoId: z.string(),
      triggerTipo: FLUXO_TRIGGER_TIPO.optional().describe('Omita pra manter o do fluxo'),
      titulo: z.string().min(1).max(100).optional(),
      config: z.record(z.unknown()).optional().describe('Filtro do gatilho (ver fluxoNoInput.config)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ fluxoId, ...campos }: { fluxoId: string; [k: string]: unknown }) => {
    const definidos = Object.fromEntries(
      Object.entries(campos).filter(([, v]) => v !== undefined),
    );
    const f = await api.post<{ id: string; nome: string; status: string; nos: { tipo: string }[] }>(
      `/fluxos/${fluxoId}/gatilho`,
      definidos,
    );
    return ok({
      id: f.id,
      nome: f.nome,
      status: f.status,
      gatilhos: f.nos.filter((n) => n.tipo === 'TRIGGER').length,
      dica: 'Gatilho definido. Ativação continua sendo no app (nunca via MCP).',
    });
  }),
);

server.registerTool(
  'fluxos_testar',
  {
    description:
      'Dispara uma execução de TESTE manual do fluxo (não é ativação — não liga o gatilho real). ' +
      'Default = modo SECO (nada é enviado). `enviarDeVerdade: true` envia DE VERDADE — use só ' +
      'com destinatário de teste. ⚠️ Execução de teste NUNCA acende outros fluxos (os eventos ' +
      'que ela emite são suprimidos) — pra exercitar uma cadeia, provoque a entrada REAL ' +
      '(ex: fluxo disparador mandando WhatsApp pro número da empresa). ' +
      'Use fluxos_execucoes pra ler o resultado.',
    inputSchema: {
      fluxoId: z.string(),
      contexto: z
        .record(z.unknown())
        .optional()
        .describe('Contexto inicial da execução (ex: { leadId, tag })'),
      enviarDeVerdade: z
        .boolean()
        .default(false)
        .describe('true = envia WhatsApp/e-mail DE VERDADE. Default false (modo seco).'),
      conversationId: z
        .string()
        .optional()
        .describe('Conversa REAL contra a qual testar (chega no contexto da execução).'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      fluxoId,
      contexto,
      enviarDeVerdade,
      conversationId,
    }: {
      fluxoId: string;
      contexto?: Record<string, unknown>;
      enviarDeVerdade?: boolean;
      conversationId?: string;
    }) => {
      // enviarDeVerdade/conversationId são TOP-LEVEL no endpoint (irmãos do
      // contexto) — dentro do contexto eles seriam ignorados em silêncio.
      const r = await api.post<unknown>('/fluxos/testar', {
        fluxoId,
        contexto: contexto ?? {},
        enviarDeVerdade: enviarDeVerdade === true,
        ...(conversationId ? { conversationId } : {}),
      });
      return ok(r);
    },
  ),
);

server.registerTool(
  'fluxos_arquivar',
  {
    description:
      'Arquiva um fluxo (status → ARQUIVADO). Não apaga nada, só tira de circulação (não dispara ' +
      'mais). Reversível via fluxos_desarquivar (→ RASCUNHO, precisa reativar depois). ' +
      '⚠️ Use SÓ pra aposentar fluxo superado de vez — pra parar algo TEMPORARIAMENTE (vai religar ' +
      'em breve), use fluxos_pausar, não este. Arquivar+desarquivar rebaixa o fluxo a RASCUNHO; ' +
      'pausar mantém o histórico "vivo" e volta com 1 clique do Léo na UI.',
    inputSchema: { fluxoId: z.string().describe('ID do fluxo (use fluxos_listar)') },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    await api.delete(`/fluxos/${fluxoId}`);
    return ok({ fluxoId, status: 'ARQUIVADO', reversivel: 'via fluxos_desarquivar' });
  }),
);

server.registerTool(
  'fluxos_desarquivar',
  {
    description:
      'Desarquiva um fluxo (ARQUIVADO → RASCUNHO). Única rota de volta pra um fluxo arquivado — ' +
      'sem isso, arquivar era mão única (incidente real: 2026-08-05, fluxo de triagem arquivado por ' +
      'engano e sem forma de desfazer via API/MCP; precisou recriar o fluxo do zero). ' +
      '⚠️ NÃO ativa de volta — vira RASCUNHO. Ativar é SEMPRE decisão do Léo na UI (ele revisa e ' +
      'clica); não existe tool de MCP pra isso, de propósito.',
    inputSchema: { fluxoId: z.string().describe('ID do fluxo ARQUIVADO (use fluxos_listar)') },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    await api.post(`/fluxos/${fluxoId}/desarquivar`);
    return ok({ fluxoId, status: 'RASCUNHO' });
  }),
);

server.registerTool(
  'fluxos_pausar',
  {
    description:
      'Pausa um fluxo ATIVO (status → PAUSADO). Pra uso TEMPORÁRIO — o fluxo continua na lista ' +
      'normal, com o histórico intacto, e o Léo religa quando quiser com 1 clique na UI (não existe ' +
      'tool de MCP pra religar — ativar é sempre decisão dele). ' +
      'Diferença de fluxos_arquivar: pausar NÃO rebaixa a RASCUNHO — é o botão certo quando a ' +
      'intenção é "desligar por enquanto", não "aposentar". Cancela execuções em andamento ao pausar.',
    inputSchema: { fluxoId: z.string().describe('ID do fluxo ATIVO (use fluxos_listar)') },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    await api.post(`/fluxos/${fluxoId}/pausar`);
    return ok({ fluxoId, status: 'PAUSADO' });
  }),
);

server.registerTool(
  'fluxos_deletar',
  {
    description:
      'Exclui PERMANENTEMENTE um fluxo (apaga nós/arestas). Segurança: SÓ deleta RASCUNHO SEM ' +
      'execuções (histórico) — se tiver execuções ou não for rascunho, recusa e sugere fluxos_arquivar. ' +
      'Bom pra limpar rascunhos de teste/duplicados criados via MCP.',
    inputSchema: { fluxoId: z.string().describe('ID do fluxo RASCUNHO a apagar') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ fluxoId }: { fluxoId: string }) => {
    // Trava de segurança: só hard-delete de RASCUNHO limpo (sem execuções).
    const f = await api.get<{ status?: string; _count?: { execucoes?: number } }>(
      `/fluxos/${fluxoId}`,
    );
    if (f.status !== 'RASCUNHO') {
      return erro(
        `Fluxo está ${f.status ?? '?'} — só dá pra DELETAR rascunho. Use fluxos_arquivar (reversível).`,
      );
    }
    const execs = f._count?.execucoes ?? 0;
    if (execs > 0) {
      return erro(
        `Fluxo tem ${execs} execução(ões) no histórico — não apago (perderia o histórico). Use fluxos_arquivar.`,
      );
    }
    await api.delete(`/fluxos/${fluxoId}/permanente`);
    return ok({ fluxoId, excluido: true });
  }),
);

// ─── Funis (leitura + escrita — escopo "funis") ─────────────────────────
// Base pro email-marketing: o orquestrador precisa enxergar os funis e etapas
// pra decidir a quem/quando escrever. Escrita (criar/renomear/reordenar/
// remover funil e etapa) liberada — card "MCP: escrita de FUNIL e ETAPA": a
// master precisa executar mudança de estrutura sem depender do Léo na UI.
// ⚠️ RENOMEAR é sempre UPDATE (preserva o id) — nunca apagar+recriar: o
// funilEtapaId fica guardado nos nós CRIAR_LEAD/MOVER_LEAD_ETAPA dos fluxos,
// e um id novo quebra o fluxo SILENCIOSAMENTE. `funis_ver` já devolve
// leadsCount + fluxosQueApontam por etapa — confira ANTES de excluir/reordenar.

server.registerTool(
  'funis_listar',
  {
    description:
      'Lista os funis (pipelines) da empresa, com suas etapas. Somente leitura. ' +
      'O funil padrão vem primeiro.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    const resp = await api.get<{ data: unknown[] } | unknown[]>('/funis');
    const lista = Array.isArray(resp) ? resp : (resp.data ?? []);
    return ok(lista);
  }),
);

server.registerTool(
  'funis_ver',
  {
    description:
      'Detalhe de um funil: dados + etapas ordenadas. Cada etapa vem com `leadsCount` ' +
      '(quantos leads estão nela) e `fluxosQueApontam` (fluxos que a referenciam via ' +
      'CRIAR_LEAD/MOVER_LEAD_ETAPA) — confira os dois ANTES de reordenar/excluir uma etapa.',
    inputSchema: { funilId: z.string().describe('ID do funil (use funis_listar)') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ funilId }: { funilId: string }) => {
    const f = await api.get<Record<string, unknown>>(`/funis/${funilId}`);
    return ok(f);
  }),
);

const etapaTipoSchema = z.enum(['ATIVA', 'GANHO', 'PERDIDO']);

server.registerTool(
  'funis_criar',
  {
    description:
      'Cria um funil (pipeline) novo, com etapas opcionais já no create. Pra adicionar etapa ' +
      'depois, use etapas_criar.',
    inputSchema: {
      nome: z.string().min(1).max(100),
      descricao: z.string().max(500).optional(),
      cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('hex, ex: #201554'),
      triagem: z
        .boolean()
        .optional()
        .describe('true = caixa de entrada bruta, FORA dos KPIs globais do dashboard'),
      etapas: z
        .array(
          z.object({
            nome: z.string().min(1).max(60),
            cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
            tipo: etapaTipoSchema.default('ATIVA'),
            probabilidade: z.number().int().min(0).max(100).default(50),
            slaDias: z.number().int().min(1).max(365).optional(),
          }),
        )
        .optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async (args: Record<string, unknown>) => {
    const f = await api.post<Record<string, unknown>>('/funis', args);
    return ok(f);
  }),
);

server.registerTool(
  'funis_atualizar',
  {
    description:
      'Atualiza dados do funil (nome/descrição/cor/ativo/triagem/visível pro rep). NÃO mexe em etapas.',
    inputSchema: {
      funilId: z.string().describe('ID do funil (use funis_listar)'),
      nome: z.string().min(1).max(100).optional(),
      descricao: z.string().max(500).optional(),
      cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      ativo: z.boolean().optional(),
      triagem: z.boolean().optional().describe('true = fora dos KPIs globais do dashboard'),
      visivelParaRep: z
        .boolean()
        .optional()
        .describe(
          'true = o REP enxerga este funil. Default false: funil novo nasce só pra gestão. ' +
            'Marque nos funis de carteira, senão o rep abre a tela e não vê pipeline nenhum.',
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ funilId, ...body }: { funilId: string } & Record<string, unknown>) => {
    const f = await api.patch<Record<string, unknown>>(`/funis/${funilId}`, body);
    return ok(f);
  }),
);

/**
 * O que acontece quando o SLA da etapa vence. Mesmo shape que o job de gatilhos
 * le (fluxo-triggers.job.ts -> avaliarSlaEtapas).
 *
 * `tag` e a peca que transforma cada etapa no SEU PROPRIO gatilho de "lead
 * parado": a etiqueta carimbada dispara LEAD_RECEBEU_TAG, entao um unico fluxo
 * com filtro por PREFIXO (ex.: `parado:`) atende o funil inteiro, cada etapa no
 * prazo dela.
 */
const acaoSlaSchema = z
  .object({
    tipo: z.enum(['notificar', 'mover', 'tag']),
    etapaDestinoId: z.string().min(1).optional().describe('so tipo=mover'),
    tagNome: z
      .string()
      .min(1)
      .max(60)
      .optional()
      .describe('so tipo=tag — nome da etiqueta a carimbar (ex.: "parado:proposta")'),
  })
  .nullable()
  .describe('Acao quando o SLA da etapa vence. null limpa.');

server.registerTool(
  'etapas_criar',
  {
    description: 'Cria uma etapa nova no funil (vai pro final por padrão — informe `ordem` pra outra posição).',
    inputSchema: {
      funilId: z.string().describe('ID do funil (use funis_listar)'),
      nome: z.string().min(1).max(60),
      cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      tipo: etapaTipoSchema.default('ATIVA'),
      probabilidade: z.number().int().min(0).max(100).default(50),
      ordem: z.number().int().min(0).optional().describe('0 = auto (vai pro final)'),
      slaDias: z.number().int().min(1).max(365).optional(),
      slaHoras: z.number().int().min(1).max(8760).optional(),
      acaoSlaExpirado: acaoSlaSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ funilId, ...body }: { funilId: string } & Record<string, unknown>) => {
    const f = await api.post<Record<string, unknown>>(`/funis/${funilId}/etapas`, body);
    return ok(f);
  }),
);

server.registerTool(
  'etapas_atualizar',
  {
    description:
      'Atualiza uma etapa — nome, cor, ordem, tipo, probabilidade, SLA e a AÇÃO do SLA. ' +
      '⚠️ Isto é sempre um UPDATE: o id da etapa NUNCA muda, então é seguro pra renomear ' +
      '(o funilEtapaId que os fluxos guardam continua válido). NUNCA use etapas_remover + ' +
      'etapas_criar pra "renomear" — isso troca o id e quebra o fluxo que apontava pra ela.',
    inputSchema: {
      funilId: z.string().describe('ID do funil (use funis_listar)'),
      etapaId: z.string().describe('ID da etapa (use funis_ver → etapas)'),
      nome: z.string().min(1).max(60).optional(),
      cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      tipo: etapaTipoSchema.optional(),
      probabilidade: z.number().int().min(0).max(100).optional(),
      ordem: z.number().int().min(0).optional(),
      slaDias: z.number().int().min(1).max(365).nullable().optional(),
      slaHoras: z.number().int().min(1).max(8760).nullable().optional(),
      acaoSlaExpirado: acaoSlaSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      funilId,
      etapaId,
      ...body
    }: { funilId: string; etapaId: string } & Record<string, unknown>) => {
      const f = await api.patch<Record<string, unknown>>(
        `/funis/${funilId}/etapas/${etapaId}`,
        body,
      );
      return ok(f);
    },
  ),
);

server.registerTool(
  'etapas_reordenar',
  {
    description:
      'Reordena TODAS as etapas do funil de uma vez — passe a lista COMPLETA de etapaIds na ' +
      'ordem desejada (use funis_ver pra pegar todos os ids atuais primeiro).',
    inputSchema: {
      funilId: z.string().describe('ID do funil (use funis_listar)'),
      etapaIds: z.array(z.string()).min(1).describe('TODOS os ids do funil, na ordem final'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ funilId, etapaIds }: { funilId: string; etapaIds: string[] }) => {
    const f = await api.put<Record<string, unknown>>(`/funis/${funilId}/etapas/reordenar`, {
      etapaIds,
    });
    return ok(f);
  }),
);

server.registerTool(
  'etapas_remover',
  {
    description:
      'Exclui uma etapa. PROTEGIDO: recusa se houver lead nela OU fluxo (CRIAR_LEAD/' +
      'MOVER_LEAD_ETAPA) apontando pra ela — a mensagem de erro já diz quantos leads/quais ' +
      'fluxos. Resolva isso primeiro (mova os leads, ajuste o fluxo) antes de tentar de novo.',
    inputSchema: {
      funilId: z.string().describe('ID do funil (use funis_listar)'),
      etapaId: z.string().describe('ID da etapa (use funis_ver → etapas)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ funilId, etapaId }: { funilId: string; etapaId: string }) => {
    const f = await api.delete<Record<string, unknown>>(`/funis/${funilId}/etapas/${etapaId}`);
    return ok(f);
  }),
);

server.registerTool(
  'leads_por_etapa',
  {
    description:
      'Lista os leads/contatos DENTRO de uma etapa de um funil, paginado (mais parados primeiro). ' +
      'Retorna leadId, nome, email, telefone, tags[], dataEntrada e representante. Somente leitura. ' +
      'Bom pra "quem está travado em X há N dias".',
    inputSchema: {
      funilId: z.string().describe('ID do funil (use funis_listar)'),
      etapaId: z.string().describe('ID da etapa (use funis_ver → etapas)'),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(30),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async ({
      funilId,
      etapaId,
      page,
      limit,
    }: {
      funilId: string;
      etapaId: string;
      page: number;
      limit: number;
    }) => {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      const resp = await api.get<unknown>(`/funis/${funilId}/etapas/${etapaId}/leads?${qs}`);
      return ok(resp);
    },
  ),
);

server.registerTool(
  'etapa_historico',
  {
    description:
      'Histórico IRREVERSÍVEL de transição de etapas dos leads no funil, paginado. ' +
      'Filtra por funil, lead e/ou período (de/ate ISO). 1 lead → trajetória cronológica (asc); ' +
      'varredura → feed recente (desc). Retorna leadId, leadNome, etapaOrigem/Destino {id,nome}, ' +
      'quem {id,nome} (null=sistema/fluxo), origemMudanca (manual|fluxo|api|criacao|seed) e ocorridoEm. ' +
      'Somente leitura. Responde "como esse lead andou no funil" e "quantas transições nesta campanha/período".',
    inputSchema: {
      funilId: z.string().optional().describe('Filtra por funil (use funis_listar)'),
      leadId: z.string().optional().describe('Trajetória de UM lead (use contatos_ver/leads_por_etapa)'),
      de: z.string().datetime().optional().describe('Início do período (ISO), sobre ocorridoEm'),
      ate: z.string().datetime().optional().describe('Fim do período (ISO)'),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async (args: {
      funilId?: string;
      leadId?: string;
      de?: string;
      ate?: string;
      page: number;
      limit: number;
    }) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) if (v != null) qs.set(k, String(v));
      const resp = await api.get<unknown>(`/funis/etapa-historico?${qs}`);
      return ok(resp);
    },
  ),
);

server.registerTool(
  'atribuicao_por_campanha',
  {
    description:
      'Retorno de atribuição de UMA campanha de marketing (responde "essa campanha vale a pena?"). ' +
      'Passe utmCampaign (ex: "vtcd-industria-alimenticia"); OMITA utmCampaign pra ver os leads SEM ' +
      'atribuição (indicador de vazamento de rastreio). Filtros opcionais: origemCadastro, utmSource, ' +
      'utmMedium, período (dataInicio/dataFim ISO, sobre criadoEm). Retorna totalLeads, leadsPorEtapa ' +
      '[{etapaId,nome,quantidade,valorEstimado}], porOrigemCadastro, valorPonderado (Σ valorEstimado×' +
      'probabilidade/100), valorFechado, ganhos e cicloMedioDias. ' +
      'CAMADA DE CONVERSA (Click-to-WhatsApp): totalConversas, conversasQueViraramLead e ' +
      'taxaConversaParaLead (%) — nem toda conversa de anúncio vira lead, e medir só lead esconde ' +
      'o topo do funil. PERDA vs DESCARTE: `perdidos` é perda COMERCIAL (a oferta não convenceu); ' +
      '`descartadosTriagem` é quem foi descartado na triagem (não era oportunidade) — o primeiro ' +
      'fala da OFERTA, o segundo da QUALIDADE DO TRÁFEGO. Somente leitura, multi-tenant.',
    inputSchema: {
      utmCampaign: z.string().optional().describe('Slug da campanha. Omitido = leads SEM atribuição.'),
      origemCadastro: z
        .string()
        .optional()
        .describe('Filtra por porta de entrada (site|meta_lead_ads|importacao|manual_rep|...)'),
      utmSource: z.string().optional(),
      utmMedium: z.string().optional(),
      dataInicio: z.string().datetime().optional().describe('Início do período (ISO), sobre criadoEm'),
      dataFim: z.string().datetime().optional().describe('Fim do período (ISO)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async (args: {
      utmCampaign?: string;
      origemCadastro?: string;
      utmSource?: string;
      utmMedium?: string;
      dataInicio?: string;
      dataFim?: string;
    }) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) if (v != null) qs.set(k, String(v));
      const resp = await api.get<unknown>(`/funis/atribuicao-campanha?${qs}`);
      return ok(resp);
    },
  ),
);

// ─── Contatos (SOMENTE LEITURA — escopo "contatos" · DADOS PESSOAIS) ─────
// Visão unificada Lead + Cliente + Conversa, deduplicada por telefone (D18).
// Paginada. Sem endpoint de detalhe único: filtre com `search`. NUNCA escreve
// (o token nem consegue: guard barra métodos != GET em /contatos).

server.registerTool(
  'contatos_listar',
  {
    description:
      'Lista contatos da empresa (Lead + Cliente + Conversa unificados e deduplicados por ' +
      'telefone), paginado. Contém DADOS PESSOAIS — use só o necessário. Somente leitura.',
    inputSchema: {
      page: z.number().int().min(1).default(1).describe('Página (1-based)'),
      limit: z.number().int().min(1).max(100).default(30).describe('Itens por página (máx 100)'),
      search: z.string().optional().describe('Busca por nome, telefone ou e-mail'),
      tipo: z
        .enum(['LEAD', 'CLIENTE', 'CONVERSA'])
        .optional()
        .describe('Filtra contatos que SÃO desse tipo (um contato pode ter vários)'),
      representanteId: z.string().optional().describe('Filtra pela carteira de um representante'),
      sortBy: z.enum(['recente', 'nome']).default('recente'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async (args: {
      page: number;
      limit: number;
      search?: string;
      tipo?: string;
      representanteId?: string;
      sortBy: string;
    }) => {
      const qs = new URLSearchParams();
      qs.set('page', String(args.page));
      qs.set('limit', String(args.limit));
      qs.set('sortBy', args.sortBy);
      if (args.search) qs.set('search', args.search);
      if (args.tipo) qs.set('tipo', args.tipo);
      if (args.representanteId) qs.set('representanteId', args.representanteId);
      const resp = await api.get<unknown>(`/contatos?${qs.toString()}`);
      return ok(resp);
    },
  ),
);

server.registerTool(
  'contatos_ver',
  {
    description:
      'Detalhe de UM contato (Lead+Cliente+Conversa unificados) por leadId, clienteId, telefone OU ' +
      'email. Retorna nome, telefone, email, tipos[], tags[], funis[{funilId, funilNome, etapaId, ' +
      'etapaNome, dataEntrada}] e representante. DADOS PESSOAIS — só o necessário. Somente leitura. ' +
      'Traz também `nomeOrigem` — de qual campo o `nome` veio (cliente | lead.contatoNome | ' +
      'lead.nome | conversa | telefone | email | nenhum). É o jeito de conferir se o contatoNome ' +
      'do lead foi gravado: sem isso, lead COM e SEM contatoNome devolvem o mesmo `nome`.',
    inputSchema: {
      leadId: z.string().optional(),
      clienteId: z.string().optional(),
      telefone: z.string().optional().describe('Telefone (casa pelos 8 últimos dígitos)'),
      email: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async (args: { leadId?: string; clienteId?: string; telefone?: string; email?: string }) => {
      if (!args.leadId && !args.clienteId && !args.telefone && !args.email) {
        return erro('Informe leadId, clienteId, telefone ou email.');
      }
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) if (v) qs.set(k, String(v));
      const resp = await api.get<unknown>(`/contatos/detalhe?${qs.toString()}`);
      // `== null` cobre null E undefined: contato inexistente volta com corpo
      // vazio, e o cliente HTTP traduz isso pra `undefined`. Com `=== null` a
      // ausência escapava e o operador recebia erro de runtime — impossível
      // distinguir "não existe" de "servidor quebrou".
      if (resp == null) {
        return ok({ encontrado: false, buscadoPor: Object.fromEntries(qs) });
      }
      return ok(resp);
    },
  ),
);

// ─── CRM (ESCRITA — escopo "crm") ───────────────────────────────────────
// Ações de CRM sobre um contato. Exige token com escopo "crm" (marque em
// Quadros → Tokens de API). Adicionar tag dispara o gatilho LEAD_RECEBEU_TAG.

server.registerTool(
  'contatos_tags',
  {
    description:
      'Adiciona e/ou remove tags (por NOME) de um contato (Lead + Cliente), identificado por ' +
      'leadId, clienteId OU telefone. Adicionar tag DISPARA fluxos (LEAD_RECEBEU_TAG). Cria a tag ' +
      'se não existir. Retorna a lista de tags atualizada. Exige escopo "crm".',
    inputSchema: {
      leadId: z.string().optional(),
      clienteId: z.string().optional(),
      telefone: z.string().optional().describe('Casa pelos 8 últimos dígitos'),
      adicionar: z.array(z.string()).default([]).describe('Nomes de tags a adicionar'),
      remover: z.array(z.string()).default([]).describe('Nomes de tags a remover'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (args: {
      leadId?: string;
      clienteId?: string;
      telefone?: string;
      adicionar: string[];
      remover: string[];
    }) => {
      if (!args.leadId && !args.clienteId && !args.telefone) {
        return erro('Informe leadId, clienteId ou telefone.');
      }
      if (args.adicionar.length === 0 && args.remover.length === 0) {
        return erro('Informe ao menos uma tag em "adicionar" ou "remover".');
      }
      const r = await api.post<unknown>('/crm/contato/tags', args);
      return ok(r);
    },
  ),
);

server.registerTool(
  'contatos_atualizar_etapa',
  {
    description:
      'Move um LEAD de etapa dentro de um funil (ação de CRM). Dispara os fluxos da etapa destino ' +
      '(LEAD_ETAPA_MUDOU). Retorna a etapa anterior e a nova. Exige escopo "crm".',
    inputSchema: {
      leadId: z.string().describe('ID do lead (use contatos_ver / leads_por_etapa)'),
      etapaId: z.string().describe('ID da etapa DESTINO (use funis_ver → etapas)'),
      funilId: z.string().optional().describe('Opcional — valida que a etapa é desse funil'),
      motivo: z.string().max(300).optional(),
      etapaDesde: z
        .string()
        .datetime()
        .optional()
        .describe(
          'TESTE: data RETROATIVA de entrada na etapa (ISO). Faz o SLA vencer sem esperar ' +
            'dias reais — ex: 10 dias atrás → o job pega na rodada seguinte. Recusa futuro.',
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (args: {
      leadId: string;
      etapaId: string;
      funilId?: string;
      motivo?: string;
      etapaDesde?: string;
    }) => {
      const r = await api.post<unknown>('/crm/contato/etapa', args);
      return ok(r);
    },
  ),
);

server.registerTool(
  'contatos_atribuir_rep',
  {
    description:
      'Atribui (ou DESATRIBUI, com representanteId: null) o representante de um LEAD. ' +
      'Valida que o rep existe e é da empresa — mesmas regras da UI. O desatribuir existe ' +
      'pra alternar o mesmo lead entre "com dono" e "sem dono" nos testes de fluxo. ' +
      'Exige escopo "crm".',
    inputSchema: {
      leadId: z.string().describe('ID do lead (use contatos_ver / leads_por_etapa)'),
      representanteId: z
        .string()
        .nullable()
        .describe('ID do usuário REP (usuarios_listar) — null desatribui'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async (args: { leadId: string; representanteId: string | null }) => {
    const r = await api.post<unknown>('/crm/contato/representante', args);
    return ok(r);
  }),
);

server.registerTool(
  'leads_excluir',
  {
    description:
      'APAGA leads DEFINITIVAMENTE, por lista explícita de ids (1 a 50). Serve pra limpar resíduo ' +
      'de teste de fluxo. Não existe versão por filtro nem "apagar todos": monte a lista com ' +
      '`leads_por_etapa` e confira antes. Recusa lead SEM FUNIL (esses são a base de prospecção ' +
      'importada, ~30 mil contatos na mesma tabela). É tudo-ou-nada: se um id não resolver ou ' +
      'estiver fora de funil, NADA é apagado. Não tem desfazer. Exige escopo "crm".',
    inputSchema: {
      leadIds: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe('Ids EXATOS, obtidos numa leitura (leads_por_etapa / contatos_ver).'),
      confirmoExclusaoDe: z
        .number()
        .int()
        .positive()
        .describe('Repita aqui quantos ids DISTINTOS você está mandando. Se não bater, recusa.'),
      motivo: z.string().max(300).optional().describe('Fica no log de auditoria.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(
    async (args: { leadIds: string[]; confirmoExclusaoDe: number; motivo?: string }) => {
      // A checagem de verdade é do backend (que enxerga funil e tenant); esta é
      // só pra devolver o número certo sem gastar uma ida ao servidor.
      const distintos = new Set(args.leadIds).size;
      if (distintos !== args.confirmoExclusaoDe) {
        return erro(
          `Você mandou ${distintos} id(s) distinto(s) e confirmou ${args.confirmoExclusaoDe}. ` +
            'Confira a lista — divergência aqui costuma ser lista montada errada.',
        );
      }
      const r = await api.post<unknown>('/crm/contato/excluir', args);
      return ok(r);
    },
  ),
);

// ─── Prompts da IA (escopo "prompts" — biblioteca de prompts do bot) ─────
// Ver/criar/editar os prompts referenciados por promptId nos nós "Conversar
// com IA" dos fluxos. Exige token com escopo "prompts". Editar o TEXTO versiona
// automaticamente (rollback disponível no app).

type PromptResumo = {
  id: string;
  nome: string;
  descricao?: string | null;
  isPadrao?: boolean;
  ativo?: boolean;
  versao?: number;
};
type PromptCompleto = PromptResumo & {
  texto: string;
  modelo?: string | null;
  temperatura?: number | null;
};

server.registerTool(
  'prompts_listar',
  {
    description:
      'Lista os prompts da IA da empresa (id, nome, descrição, versão, se é padrão/ativo). Os prompts ' +
      'são referenciados por promptId nos nós "Conversar com IA" dos fluxos. Exige escopo "prompts".',
    inputSchema: { search: z.string().optional().describe('Filtro por nome/descrição') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ search }: { search?: string }) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    const ps = await api.get<PromptResumo[]>(`/mullerbot/prompts${qs}`);
    return ok(
      ps.map((p) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao ?? null,
        versao: p.versao,
        isPadrao: p.isPadrao,
        ativo: p.ativo,
      })),
    );
  }),
);

server.registerTool(
  'prompts_ver',
  {
    description:
      'Retorna o conteúdo COMPLETO de um prompt da IA (inclui o TEXTO, o modelo e a temperatura) ' +
      'MAIS o `usadoEm`: quais fluxos/nós referenciam este promptId. Confira o `usadoEm` antes de ' +
      'editar o texto — prompt compartilhado muda o comportamento de TODOS os fluxos da lista. ' +
      'Exige escopo "prompts".',
    inputSchema: { promptId: z.string().describe('ID do prompt') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ promptId }: { promptId: string }) => {
    const p = await api.get<
      PromptCompleto & {
        usadoEm?: Array<{
          fluxoId: string;
          fluxoNome: string;
          fluxoStatus: string;
          noTitulo: string;
        }>;
      }
    >(`/mullerbot/prompts/${promptId}`);
    return ok(p);
  }),
);

server.registerTool(
  'prompts_criar',
  {
    description:
      'Cria um prompt novo da IA e retorna o promptId (pra plugar no nó "Conversar com IA"). Exige escopo "prompts".',
    inputSchema: {
      nome: z.string().describe('Nome do prompt (único na empresa)'),
      texto: z.string().describe('Conteúdo / system prompt (até 100k chars)'),
      descricao: z.string().optional(),
      modelo: z
        .string()
        .optional()
        .describe('Modelo OpenAI deste prompt. Vazio = usa o da empresa/persona.'),
      temperatura: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe(
          'Aleatoriedade (0–2). ⚠️ Modelos de RACIOCÍNIO (gpt-5.x) REJEITAM este parâmetro — a ' +
            'chamada é refeita sem ele e o valor não tem efeito nenhum. Onde vale: classificador ' +
            'que grava valor literal quer BAIXA (0–0.4); 0.7+ é temperatura de REDAÇÃO. Pra ' +
            'blindar a classificação de verdade, declare os valores aceitos na variável do nó ' +
            '("nome: A | B | C") — vira enum e o modelo não CONSEGUE sair da lista.',
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (args: {
      nome: string;
      texto: string;
      descricao?: string;
      modelo?: string;
      temperatura?: number;
    }) => {
      const p = await api.post<PromptCompleto>('/mullerbot/prompts', args);
      return ok({ id: p.id, nome: p.nome, versao: p.versao });
    },
  ),
);

server.registerTool(
  'prompts_atualizar',
  {
    description:
      'Edita um prompt existente (o "up" do prompt na plataforma). Mudar o TEXTO versiona automaticamente ' +
      '(rollback fica disponível no app). Passe só os campos a alterar. ' +
      'Pra mudança CIRÚRGICA use `substituir` em vez de reenviar o texto inteiro — prompt grande ' +
      'reenviado à mão é onde nasce linha comida. Exige escopo "prompts".',
    inputSchema: {
      promptId: z.string().describe('ID do prompt a editar'),
      nome: z.string().optional(),
      texto: z
        .string()
        .optional()
        .describe('Substitui o prompt INTEIRO. Pra trocar uma linha, prefira `substituir`.'),
      substituir: z
        .array(z.object({ de: z.string(), para: z.string() }))
        .optional()
        .describe(
          'Busca-e-substituição no texto atual, mesmo contrato de um editor de arquivo: cada `de` ' +
            'tem que casar EXATAMENTE UMA vez. Zero ocorrências ou mais de uma → erro e NADA é ' +
            'gravado (nem as substituições anteriores da mesma chamada). Inclua contexto ao redor ' +
            'pra deixar único. Não pode vir junto com `texto`. Retorna tamanho antes/depois.',
        ),
      descricao: z.string().optional(),
      modelo: z
        .string()
        .optional()
        .describe(
          'Modelo OpenAI deste prompt. Nome inválido volta com a LISTA dos aceitos no erro. ' +
            'Vazio = usa o da empresa/persona.',
        ),
      temperatura: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe(
          'Aleatoriedade (0–2). ⚠️ Modelos de RACIOCÍNIO (gpt-5.x) REJEITAM este parâmetro — a ' +
            'chamada é refeita sem ele e o valor não tem efeito nenhum. Onde vale: classificador ' +
            'que grava valor literal quer BAIXA (0–0.4); 0.7+ é temperatura de REDAÇÃO. Pra ' +
            'blindar a classificação de verdade, declare os valores aceitos na variável do nó ' +
            '("nome: A | B | C") — vira enum e o modelo não CONSEGUE sair da lista.',
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      promptId,
      ...rest
    }: {
      promptId: string;
      nome?: string;
      texto?: string;
      substituir?: Array<{ de: string; para: string }>;
      descricao?: string;
      modelo?: string;
      temperatura?: number;
    }) => {
      const definidos = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(definidos).length === 0) {
        return erro(
          'Informe ao menos um campo (nome, texto, substituir, descricao, modelo ou temperatura).',
        );
      }
      if (rest.texto !== undefined && rest.substituir?.length) {
        return erro(
          'Mande `texto` (substitui o prompt inteiro) OU `substituir` (troca trechos), não os dois.',
        );
      }
      const p = await api.patch<PromptCompleto & { tamanhoAntes?: number; tamanhoDepois?: number }>(
        `/mullerbot/prompts/${promptId}`,
        definidos,
      );
      // Devolve modelo/temperatura EFETIVOS: quem acabou de ajustar precisa ver
      // o que ficou valendo, não só "ok" (o backend pode normalizar/recusar).
      return ok({
        id: p.id,
        nome: p.nome,
        versao: p.versao,
        modelo: p.modelo ?? null,
        temperatura: p.temperatura ?? null,
        // Tamanho antes/depois só vem na edição por trecho — é como conferir que
        // a troca foi a esperada sem baixar o prompt inteiro de volta.
        ...(p.tamanhoAntes !== undefined
          ? {
              tamanhoAntes: p.tamanhoAntes,
              tamanhoDepois: p.tamanhoDepois,
              delta: (p.tamanhoDepois ?? 0) - p.tamanhoAntes,
            }
          : {}),
      });
    },
  ),
);

server.registerTool(
  'prompts_deletar',
  {
    description:
      'Apaga um prompt da biblioteca. ⚠️ Rode `prompts_ver` antes: se o `usadoEm` não estiver ' +
      'vazio, os nós daqueles fluxos ficam apontando pra um prompt que não existe mais (o nó ' +
      'passa a rotear pela saída de erro). Exige escopo "prompts".',
    inputSchema: { promptId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ promptId }: { promptId: string }) => {
    await api.delete(`/mullerbot/prompts/${encodeURIComponent(promptId)}`);
    return ok({ removido: promptId });
  }),
);

// ─── Config do BOT de atendimento (escopo "prompts") ────────────────────
// A config do BOT (nome + modelo OpenAI + system prompt completo) é editável por
// aqui, no mesmo escopo "prompts". Diferente dos prompts_* (biblioteca de prompts
// de FLUXO): isto é a config do bot em si — o classificador da triagem. NÃO
// versiona (é 1 config só por empresa, ajustada e estabilizada); pra histórico use
// os prompts de fluxo. Exige token com escopo "prompts".

type BotConfig = {
  nome: string;
  modelo?: string | null;
  promptCustom?: string | null;
  tomVoz?: string;
  saudacao?: string | null;
  ativo?: boolean;
  instrucoes?: string | null;
};

server.registerTool(
  'bot_config_ver',
  {
    description:
      'Retorna a config COMPLETA do bot de atendimento da empresa: nome, modelo OpenAI e o system ' +
      'prompt completo (promptCustom) + tom/saudação. É a config da tela "Prompt do Muller". ' +
      'Exige escopo "prompts".',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    const c = await api.get<BotConfig>('/mullerbot/persona');
    return ok({
      nome: c.nome,
      modelo: c.modelo ?? null,
      promptCustom: c.promptCustom ?? null,
      tomVoz: c.tomVoz ?? null,
      saudacao: c.saudacao ?? null,
      ativo: c.ativo ?? true,
    });
  }),
);

server.registerTool(
  'bot_config_atualizar',
  {
    description:
      'Edita a config do bot de atendimento — passe SÓ o que muda (nome, modelo e/ou promptCustom); ' +
      'o resto fica como está. O modelo é validado contra a lista viva da OpenAI da empresa (modelo ' +
      'inexistente é barrado); modelo vazio volta pro padrão do servidor. NÃO versiona. Exige escopo "prompts".',
    inputSchema: {
      nome: z.string().max(60).optional().describe('Nome do bot'),
      modelo: z
        .string()
        .max(60)
        .nullable()
        .optional()
        .describe('Modelo OpenAI (ex: gpt-4o-mini); null/"" = padrão do servidor'),
      promptCustom: z
        .string()
        .max(50000)
        .nullable()
        .optional()
        .describe('System prompt COMPLETO do bot (usado tal e qual)'),
      saudacao: z.string().max(280).nullable().optional(),
      ativo: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (rest: {
      nome?: string;
      modelo?: string | null;
      promptCustom?: string | null;
      saudacao?: string | null;
      ativo?: boolean;
    }) => {
      const definidos = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(definidos).length === 0) {
        return erro('Informe ao menos um campo (nome, modelo, promptCustom, saudacao ou ativo).');
      }
      const c = await api.patch<BotConfig>('/mullerbot/persona', definidos);
      return ok({ nome: c.nome, modelo: c.modelo ?? null, promptCustom: c.promptCustom ?? null });
    },
  ),
);

// ─── Usuários (leitura — a master descobre userId/role) ──────────────────
//
// PAPÉIS (role) VÁLIDOS no Betinna — use estes valores EXATOS (em maiúsculas):
//   ADMIN     = master da plataforma (bypass total)
//   DIRECTOR  = diretor/mandatário do tenant (acesso total ao tenant)
//   GERENTE   = gestão operacional (sem config/integrações)
//   SAC       = atendimento (inbox marketplaces + ocorrências)
//   REP       = representante (só a própria carteira)
// É este o valor que vai em `notificarRoles` do TRANSFERIR_ATENDIMENTO (ex.: ["SAC"]).

interface UsuarioLite {
  id: string;
  nome: string;
  email: string;
  role: string;
  status: string;
}

function projetarUsuario(u: Record<string, unknown>): UsuarioLite {
  return {
    id: String(u.id ?? ''),
    nome: String(u.nome ?? ''),
    email: String(u.email ?? ''),
    role: String(u.role ?? ''),
    status: String(u.status ?? ''),
  };
}

server.registerTool(
  'usuarios_listar',
  {
    description:
      'Lista usuários da empresa (id, nome, email, papel/role, status), paginado. Serve pra ' +
      'a master DESCOBRIR o userId de uma pessoa e apontar nós de fluxo que apontam pra gente: ' +
      'TRANSFERIR_ATENDIMENTO (atendenteId), CRIAR_TAREFA (responsavelId), ATRIBUIR_REP. ' +
      'PAPÉIS/role válidos (use exatos): ADMIN, DIRECTOR, GERENTE, SAC, REP — são os mesmos ' +
      'valores de `notificarRoles` do TRANSFERIR_ATENDIMENTO. Contém DADOS PESSOAIS. Somente leitura.',
    inputSchema: {
      search: z
        .string()
        .optional()
        .describe('Busca por nome ou e-mail (parcial, case-insensitive)'),
      role: z
        .enum(['ADMIN', 'DIRECTOR', 'GERENTE', 'SAC', 'REP'])
        .optional()
        .describe('Filtra por papel'),
      status: z
        .enum(['ATIVO', 'PENDENTE', 'INATIVO'])
        .optional()
        .describe('Filtra por status (PENDENTE = convite não aceito ainda)'),
      page: z.number().int().min(1).default(1).describe('Página (1-based)'),
      limit: z.number().int().min(1).max(100).default(30).describe('Itens por página (máx 100)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async (args: {
      search?: string;
      role?: string;
      status?: string;
      page: number;
      limit: number;
    }) => {
      const qs = new URLSearchParams();
      qs.set('page', String(args.page));
      qs.set('limit', String(args.limit));
      if (args.search) qs.set('search', args.search);
      if (args.role) qs.set('role', args.role);
      if (args.status) qs.set('status', args.status);
      const resp = await api.get<{ data?: Array<Record<string, unknown>>; pagination?: unknown }>(
        `/users?${qs.toString()}`,
      );
      const arr = Array.isArray(resp?.data) ? resp.data : [];
      return ok({ usuarios: arr.map(projetarUsuario), pagination: resp?.pagination });
    },
  ),
);

server.registerTool(
  'usuarios_ver',
  {
    description:
      'Detalha UM usuário por id OU por e-mail (id/nome/email/role/status). Atalho pro caso comum ' +
      'da master: "qual o userId do fulano@email?". Informe `id` OU `email` (um dos dois). Somente leitura.',
    inputSchema: {
      id: z.string().optional().describe('userId (uuid). Use este OU email.'),
      email: z.string().optional().describe('E-mail exato do usuário. Use este OU id.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async (args: { id?: string; email?: string }) => {
    if (!args.id && !args.email) return erro('Informe `id` ou `email`.');
    if (args.id) {
      const u = await api.get<Record<string, unknown>>(`/users/${encodeURIComponent(args.id)}`);
      return ok(projetarUsuario(u));
    }
    // Por e-mail: busca e casa exato (case-insensitive).
    const alvo = args.email!.trim().toLowerCase();
    const resp = await api.get<{ data?: Array<Record<string, unknown>> }>(
      `/users?search=${encodeURIComponent(args.email!)}&limit=20`,
    );
    const arr = Array.isArray(resp?.data) ? resp.data : [];
    const match = arr.find((u) => String(u.email ?? '').toLowerCase() === alvo);
    if (!match) return erro(`Nenhum usuário com o e-mail exato "${args.email}".`);
    return ok(projetarUsuario(match));
  }),
);

// ═══════════════════════════════════════════════════════════════════════
// BASE DE CONHECIMENTO — RAG do bot (escopo "conhecimento")
// ═══════════════════════════════════════════════════════════════════════
//
// Duas entidades, com permissões DIFERENTES sobre a mesma coisa:
//  • DOCUMENTO (PDF/DOCX/MD/TXT) — o texto é extraído e vira trechos indexados.
//      - `usarComoFonte`: o CONTEÚDO alimenta a resposta do bot;
//      - `podeEnviar`: o bot ANEXA o arquivo na conversa do cliente.
//    São permissões independentes. Um material interno pode não merecer nenhuma.
//  • TRECHO manual (chunk) — FAQ/regra escrita à mão, sem arquivo.

type DocumentoResumo = {
  id: string;
  titulo: string;
  fileName?: string;
  mimetype?: string;
  tamanhoBytes?: number;
  podeEnviar?: boolean;
  totalChunks?: number;
  chunksAtivos?: number;
  erroExtracao?: string | null;
};

const projetarDocumento = (d: DocumentoResumo) => ({
  id: d.id,
  titulo: d.titulo,
  arquivo: d.fileName,
  trechos: d.totalChunks ?? 0,
  // O que o bot pode fazer com ele — as duas permissões, sempre explícitas.
  usaComoFonte: (d.chunksAtivos ?? d.totalChunks ?? 0) > 0,
  anexaArquivoNaConversa: d.podeEnviar === true,
  ...(d.erroExtracao ? { erroExtracao: d.erroExtracao } : {}),
});

server.registerTool(
  'conhecimento_documentos_listar',
  {
    description:
      'Lista os DOCUMENTOS da base de conhecimento com o que o bot pode fazer com cada um: ' +
      '`usaComoFonte` (o conteúdo alimenta respostas) e `anexaArquivoNaConversa` (o bot manda o ' +
      'arquivo pro cliente). Exige escopo "conhecimento".',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    const docs = await api.get<DocumentoResumo[]>('/conhecimento/documentos');
    return ok((Array.isArray(docs) ? docs : []).map(projetarDocumento));
  }),
);

server.registerTool(
  'conhecimento_documento_subir',
  {
    description:
      'Sobe um DOCUMENTO pra base de conhecimento (o texto é extraído e indexado pra busca). ' +
      'Aceita .md/.txt como texto plano — material escrito em markdown sobe como está, sem virar ' +
      'PDF. Passe `conteudo` (texto) OU `dataBase64` (binário). Exige escopo "conhecimento".',
    inputSchema: {
      titulo: z.string().describe('Título do documento na base'),
      conteudo: z
        .string()
        .optional()
        .describe('Texto/markdown do documento. Use ISTO pra material escrito (o caminho normal).'),
      fileName: z
        .string()
        .optional()
        .describe('Nome do arquivo. Default: <titulo>.md quando você passa `conteudo`.'),
      mimetype: z.string().optional().describe('Default: text/markdown com `conteudo`.'),
      dataBase64: z
        .string()
        .optional()
        .describe('Binário em base64 (PDF/DOCX). Só quando NÃO é texto.'),
      podeEnviar: z
        .boolean()
        .optional()
        .describe(
          'Libera o bot a ANEXAR ESTE ARQUIVO na conversa do CLIENTE. Default false. ' +
            'Subir documento é rotina; liberar envio de arquivo não é — exige também ' +
            '`confirmoEnvioAoCliente: true`.',
        ),
      confirmoEnvioAoCliente: z
        .boolean()
        .optional()
        .describe('Confirmação explícita exigida quando `podeEnviar: true`.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (args: {
      titulo: string;
      conteudo?: string;
      fileName?: string;
      mimetype?: string;
      dataBase64?: string;
      podeEnviar?: boolean;
      confirmoEnvioAoCliente?: boolean;
    }) => {
      if (!args.conteudo && !args.dataBase64) {
        return erro('Informe `conteudo` (texto/markdown) ou `dataBase64` (binário).');
      }
      // GUARDA: liberar o bot a mandar arquivo pro cliente não pode ser efeito
      // colateral de um upload. Um playbook interno marcado por engano vira
      // entrega de estratégia comercial pra quem pode ser concorrente.
      if (args.podeEnviar && !args.confirmoEnvioAoCliente) {
        return erro(
          'podeEnviar=true faz o BOT ANEXAR ESTE ARQUIVO na conversa do cliente. ' +
            'Se é isso mesmo, repita com `confirmoEnvioAoCliente: true`. ' +
            'Material interno (playbook, tabela de custo, argumentário) NAO deve ir.',
        );
      }
      const ehTexto = !args.dataBase64;
      const doc = await api.post<DocumentoResumo>('/conhecimento/documento', {
        titulo: args.titulo,
        fileName: args.fileName ?? (ehTexto ? `${args.titulo}.md` : 'arquivo'),
        mimetype: args.mimetype ?? (ehTexto ? 'text/markdown' : 'application/octet-stream'),
        dataBase64: args.dataBase64 ?? Buffer.from(args.conteudo!, 'utf-8').toString('base64'),
        podeEnviar: args.podeEnviar === true,
      });
      return ok(projetarDocumento(doc));
    },
  ),
);

server.registerTool(
  'conhecimento_documento_atualizar',
  {
    description:
      'Renomeia um documento e/ou liga-desliga as DUAS permissões: `usarComoFonte` (o conteúdo ' +
      'alimenta as respostas — liga/desliga todos os trechos de uma vez) e `podeEnviar` (o bot ' +
      'anexa o arquivo na conversa). Exige escopo "conhecimento".',
    inputSchema: {
      documentoId: z.string(),
      titulo: z.string().optional(),
      usarComoFonte: z
        .boolean()
        .optional()
        .describe('false = o conteúdo PARA de alimentar respostas (documento sai da base).'),
      podeEnviar: z
        .boolean()
        .optional()
        .describe('true = o bot ANEXA o arquivo pro cliente. Exige `confirmoEnvioAoCliente`.'),
      confirmoEnvioAoCliente: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      documentoId,
      confirmoEnvioAoCliente,
      ...rest
    }: {
      documentoId: string;
      titulo?: string;
      usarComoFonte?: boolean;
      podeEnviar?: boolean;
      confirmoEnvioAoCliente?: boolean;
    }) => {
      if (rest.podeEnviar && !confirmoEnvioAoCliente) {
        return erro(
          'podeEnviar=true faz o BOT ANEXAR ESTE ARQUIVO na conversa do cliente. ' +
            'Se é isso mesmo, repita com `confirmoEnvioAoCliente: true`.',
        );
      }
      const definidos = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(definidos).length === 0) {
        return erro('Informe titulo, usarComoFonte ou podeEnviar.');
      }
      const doc = await api.patch<DocumentoResumo>(
        `/conhecimento/documento/${encodeURIComponent(documentoId)}`,
        definidos,
      );
      return ok(projetarDocumento(doc));
    },
  ),
);

server.registerTool(
  'conhecimento_documento_remover',
  {
    description:
      'Remove um documento da base (e os trechos indexados dele). Pra apenas TIRAR das respostas ' +
      'sem perder o arquivo, use `conhecimento_documento_atualizar` com `usarComoFonte: false`. ' +
      'Exige escopo "conhecimento".',
    inputSchema: { documentoId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ documentoId }: { documentoId: string }) => {
    await api.delete(`/conhecimento/documento/${encodeURIComponent(documentoId)}`);
    return ok({ removido: documentoId });
  }),
);

server.registerTool(
  'conhecimento_listar',
  {
    description:
      'Lista os TRECHOS da base — o que o bot efetivamente consulta. Por padrão inclui os ' +
      'derivados de DOCUMENTO (é o que responde "o que o bot sabe hoje?"); passe ' +
      '`somenteManuais: true` pra ver só os escritos à mão. `ativo: false` = fora das ' +
      'respostas. Exige escopo "conhecimento".',
    inputSchema: {
      search: z.string().optional(),
      somenteManuais: z
        .boolean()
        .optional()
        .describe('Só os trechos escritos à mão (esconde os derivados de documento).'),
      incluirConfig: z
        .boolean()
        .optional()
        .describe('Inclui os trechos gerados da configuração da empresa.'),
      limit: z.number().int().positive().max(200).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(
    async (args: {
      search?: string;
      somenteManuais?: boolean;
      incluirConfig?: boolean;
      limit?: number;
    }) => {
    const qs = new URLSearchParams({ limit: String(args.limit ?? 100) });
    if (args.search) qs.set('search', args.search);
    if (args.incluirConfig) qs.set('incluirConfig', 'true');
    // Default INCLUI os de documento — a pergunta natural é "o que o bot sabe".
    if (!args.somenteManuais) qs.set('incluirDocumentos', 'true');
    const r = await api.get<{
      data?: Array<{
        id: string;
        titulo: string;
        conteudo: string;
        categoria?: string | null;
        fonte?: string;
        ativo?: boolean;
      }>;
      pagination?: { total?: number };
    }>(`/conhecimento?${qs.toString()}`);
    const itens = (r?.data ?? []).map((c) => ({
      id: c.id,
      titulo: c.titulo,
      categoria: c.categoria ?? null,
      fonte: c.fonte,
      ativo: c.ativo !== false,
      previa: c.conteudo.length > 160 ? `${c.conteudo.slice(0, 160)}…` : c.conteudo,
    }));
    return ok({ total: r?.pagination?.total ?? itens.length, itens });
    },
  ),
);

server.registerTool(
  'conhecimento_criar',
  {
    description:
      'Cria um TRECHO manual na base (FAQ, regra, condição comercial) — sem arquivo. ' +
      'Exige escopo "conhecimento".',
    inputSchema: {
      titulo: z.string(),
      conteudo: z.string().describe('Até 5000 caracteres.'),
      categoria: z.string().optional(),
      ativo: z.boolean().optional().describe('false = já nasce fora das respostas.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async (args: { titulo: string; conteudo: string; categoria?: string; ativo?: boolean }) => {
      const c = await api.post<{ id: string; titulo: string }>('/conhecimento', args);
      return ok({ id: c.id, titulo: c.titulo });
    },
  ),
);

server.registerTool(
  'conhecimento_atualizar',
  {
    description:
      'Edita um TRECHO manual (texto, categoria) ou liga/desliga ele nas respostas (`ativo`). ' +
      'Exige escopo "conhecimento".',
    inputSchema: {
      chunkId: z.string(),
      titulo: z.string().optional(),
      conteudo: z.string().optional(),
      categoria: z.string().optional(),
      ativo: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(
    async ({
      chunkId,
      ...rest
    }: {
      chunkId: string;
      titulo?: string;
      conteudo?: string;
      categoria?: string;
      ativo?: boolean;
    }) => {
      const definidos = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(definidos).length === 0) {
        return erro('Informe ao menos um campo (titulo, conteudo, categoria ou ativo).');
      }
      const c = await api.patch<{ id: string; titulo: string; ativo?: boolean }>(
        `/conhecimento/${encodeURIComponent(chunkId)}`,
        definidos,
      );
      return ok({ id: c.id, titulo: c.titulo, ativo: c.ativo !== false });
    },
  ),
);

server.registerTool(
  'conhecimento_remover',
  {
    description:
      'Remove um TRECHO manual. Pra só tirar das respostas sem apagar, use ' +
      '`conhecimento_atualizar` com `ativo: false`. Exige escopo "conhecimento".',
    inputSchema: { chunkId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ chunkId }: { chunkId: string }) => {
    await api.delete(`/conhecimento/${encodeURIComponent(chunkId)}`);
    return ok({ removido: chunkId });
  }),
);

// ═══════════════════════════════════════════════════════════════════════
// ETIQUETAS DE LEAD (escopo "tags")
// ═══════════════════════════════════════════════════════════════════════
//
// ⚠️ NÃO confundir com `kanban_criar_etiqueta`, que é etiqueta de QUADRO.
// Estas são as tags do CRM — as que os nós MUDAR_TAG aplicam e as CONDICAO
// testam com `lead.tags contains`.
//
// Por que listar importa: os dois lados comparam por TEXTO LITERAL. Escrever
// "Sem resposta (triagem)" sem o ⚫, ou "Nao industrial" com til, CRIA uma tag
// nova e a condição nunca casa — sem erro, sem log. Mesma família do bug de
// comparar etapa por nome. Conferir o nome exato antes de escrever no fluxo é
// mais barato que caçar o fluxo mudo depois.

server.registerTool(
  'tags_listar',
  {
    description:
      'Lista as ETIQUETAS DE LEAD da empresa (nome EXATO, cor, quantos contatos usam). Use ANTES ' +
      'de escrever um nome de tag num nó MUDAR_TAG ou numa CONDICAO `lead.tags contains` — os ' +
      'dois comparam por texto literal, e um acento a mais cria tag nova em silêncio. ' +
      'NÃO é a etiqueta de quadro (essa é kanban_*). Exige escopo "tags".',
    inputSchema: {
      search: z.string().optional().describe('Filtra por trecho do nome.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async (args: { search?: string }) => {
    const qs = args.search ? `?search=${encodeURIComponent(args.search)}` : '';
    type TagApi = {
      id: string;
      nome: string;
      cor?: string;
      categoria?: string | null;
      _count?: { clientes?: number; leads?: number };
    };
    const r = await api.get<TagApi[] | { data?: TagApi[] }>(`/tags${qs}`);
    const arr = Array.isArray(r) ? r : (r?.data ?? []);
    // LEADS e clientes são contagens separadas. Mostrar só `clientes` faria uma
    // tag com 315 leads aparecer como "0 usos" — e a master decidiria renomear
    // ou apagar achando que não tem ninguém nela.
    return ok(
      arr.map((t) => ({
        id: t.id,
        nome: t.nome,
        cor: t.cor,
        categoria: t.categoria ?? null,
        leads: t._count?.leads ?? 0,
        clientes: t._count?.clientes ?? 0,
      })),
    );
  }),
);

server.registerTool(
  'tags_criar',
  {
    description:
      'Cria uma ETIQUETA DE LEAD com o nome EXATO informado. Use quando o fluxo precisa de uma ' +
      'tag que ainda não existe — criar aqui e copiar o nome pro nó evita a divergência de ' +
      'escrita. Exige escopo "tags".',
    inputSchema: {
      nome: z.string().describe('Nome exato, com acento/emoji se for o caso.'),
      cor: z.string().optional().describe('Hex #RRGGBB. Default: #7c3aed.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async (args: { nome: string; cor?: string }) => {
    const t = await api.post<{ id: string; nome: string; cor?: string }>('/tags', args);
    return ok({ id: t.id, nome: t.nome, cor: t.cor });
  }),
);

server.registerTool(
  'tags_renomear',
  {
    description:
      'Renomeia (ou recolore) uma etiqueta de LEAD. ⚠️ Renomear NÃO atualiza os fluxos: todo nó ' +
      'MUDAR_TAG e toda CONDICAO que citam o nome antigo param de casar. Ajuste os fluxos junto. ' +
      'Exige escopo "tags".',
    inputSchema: {
      tagId: z.string(),
      nome: z.string().optional(),
      cor: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ tagId, ...rest }: { tagId: string; nome?: string; cor?: string }) => {
    const definidos = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(definidos).length === 0) return erro('Informe `nome` ou `cor`.');
    const t = await api.patch<{ id: string; nome: string; cor?: string }>(
      `/tags/${encodeURIComponent(tagId)}`,
      definidos,
    );
    return ok({ id: t.id, nome: t.nome, cor: t.cor });
  }),
);

server.registerTool(
  'tags_remover',
  {
    description:
      'APAGA uma etiqueta de LEAD da empresa (some de todo contato que a tinha). Recusa por ' +
      'padrão se a tag estiver EM USO — pra apagar mesmo assim, repita com ' +
      '`confirmoRemocaoComUsos: true`. ⚠️ Nó MUDAR_TAG e CONDICAO que citam o nome NÃO são ' +
      'ajustados: o MUDAR_TAG recria a tag do zero e a CONDICAO passa a nunca casar. ' +
      'Exige escopo "tags".',
    inputSchema: {
      tagId: z.string().describe('Id da tag (use tags_listar).'),
      confirmoRemocaoComUsos: z
        .boolean()
        .optional()
        .describe('Obrigatório quando a tag tem lead ou cliente — apagar tira a tag de todos.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ tagId, confirmoRemocaoComUsos }: { tagId: string; confirmoRemocaoComUsos?: boolean }) => {
    // Lê ANTES de apagar: o caso de uso real é a faxina depois de uma auditoria
    // (tag torta, 0 leads), e aí apagar é inofensivo. Mas a mesma chamada em cima
    // de uma tag com 315 leads desfaz uma classificação inteira sem volta — e
    // quem chama não tem como saber a diferença sem conferir. Então a tool
    // confere por conta própria, em vez de confiar na memória de quem pediu.
    const t = await api.get<{
      id: string;
      nome: string;
      _count?: { clientes?: number; leads?: number };
    }>(`/tags/${encodeURIComponent(tagId)}`);
    const leads = t._count?.leads ?? 0;
    const clientes = t._count?.clientes ?? 0;
    if (leads + clientes > 0 && confirmoRemocaoComUsos !== true) {
      return erro(
        `A etiqueta "${t.nome}" está EM USO: ${leads} lead(s) e ${clientes} cliente(s) a perdem ` +
          'se você apagar, e não tem desfazer. Se é isso mesmo, repita com ' +
          '`confirmoRemocaoComUsos: true`. Se o objetivo era só corrigir o nome, use ' +
          'tags_renomear.',
      );
    }
    await api.delete(`/tags/${encodeURIComponent(tagId)}`);
    return ok({ removida: t.nome, id: t.id, tinhaLeads: leads, tinhaClientes: clientes });
  }),
);

// ═══════════════════════════════════════════════════════════════════════
// INBOX — SOMENTE LEITURA (escopo "inbox")
// ═══════════════════════════════════════════════════════════════════════
//
// Serve pra ANALISAR: ler o que o lead disse na triagem que levou a uma
// classificação errada e devolver isso como ajuste de prompt. Sem isso, todo QA
// de fluxo depende de alguém abrir a conversa na tela.
//
// ⛔ De propósito NÃO existe tool de responder nem de atribuir: mandar mensagem
// pro cliente não é papel de agente, e transferir conversa é decisão de quem
// atende. O backend também barra — PAT em /inbox só aceita GET.
//
// ⚠️ É conversa de cliente (PII). Use pra investigar um lead específico, não pra
// varrer a base.

server.registerTool(
  'inbox_conversas_listar',
  {
    description:
      'Lista conversas do Inbox (id, contato, canal, status, última mensagem). SOMENTE LEITURA. ' +
      'Use `search` ou `clienteId` pra chegar na conversa de um lead específico em vez de varrer. ' +
      'Exige escopo "inbox".',
    inputSchema: {
      search: z.string().optional().describe('Nome/telefone do contato ou trecho da última msg.'),
      canal: z.string().optional().describe('WHATSAPP, INSTAGRAM, FACEBOOK…'),
      status: z.string().optional().describe('ABERTA, PENDENTE, RESOLVIDA…'),
      limit: z.number().int().positive().max(50).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async (args: { search?: string; canal?: string; status?: string; limit?: number }) => {
    const qs = new URLSearchParams({ limit: String(args.limit ?? 20) });
    if (args.search) qs.set('search', args.search);
    if (args.canal) qs.set('canal', args.canal);
    if (args.status) qs.set('status', args.status);
    const r = await api.get<{
      data?: Array<{
        id: string;
        canal: string;
        status: string;
        peerNome?: string | null;
        peerId: string;
        ultimaMsgEm?: string | null;
        ultimaMsgPreview?: string | null;
        naoLidas?: number;
        leadId?: string | null;
      }>;
      pagination?: { total?: number };
    }>(`/inbox?${qs.toString()}`);
    const itens = (r?.data ?? []).map((c) => ({
      conversationId: c.id,
      contato: c.peerNome ?? c.peerId,
      canal: c.canal,
      status: c.status,
      leadId: c.leadId ?? null,
      ultimaMsgEm: c.ultimaMsgEm ?? null,
      previa: c.ultimaMsgPreview ?? null,
    }));
    return ok({ total: r?.pagination?.total ?? itens.length, conversas: itens });
  }),
);

server.registerTool(
  'inbox_conversa_zerar',
  {
    description:
      'ZERA uma conversa: apaga as mensagens da thread e reseta a memória do bot (o contato ' +
      'permanece). DESTRUTIVO e irreversível — apagar histórico de conversa REAL é estrago ' +
      'sério; a razão de existir é o reset entre casos de TESTE (mesmo número de origem = ' +
      'mesma conversa). Exige confirmo: true. Escopo "inbox".',
    inputSchema: {
      conversationId: z.string(),
      confirmo: z
        .literal(true)
        .describe('Obrigatório: confirma que a conversa pode ter o histórico apagado.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ conversationId }: { conversationId: string; confirmo: true }) => {
    const r = await api.delete<unknown>(
      `/inbox/${encodeURIComponent(conversationId)}/mensagens`,
    );
    return ok(r);
  }),
);

server.registerTool(
  'canais_conectados',
  {
    description:
      'Instâncias de WhatsApp da empresa: tipo (empresa/pessoal), dono, NÚMERO pareado e status ' +
      'de conexão (open/connecting/close). Responde "qual é o número da empresa?" e "o WhatsApp ' +
      'do rep está conectado?" sem abrir a tela. SOMENTE LEITURA. Escopo "inbox".',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    const r = await api.get<unknown>('/inbox/canais-conectados');
    return ok(r);
  }),
);

server.registerTool(
  'inbox_mensagens_ver',
  {
    description:
      'Lê o histórico de mensagens de UMA conversa (quem falou, quando, o quê). SOMENTE LEITURA — ' +
      'não existe tool pra responder nem atribuir, e o backend recusa. Use pra entender o que o ' +
      'lead disse antes de uma classificação errada. Exige escopo "inbox".',
    inputSchema: {
      conversationId: z.string(),
      limit: z.number().int().positive().max(200).optional().describe('Default 50, mais recentes.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ conversationId, limit }: { conversationId: string; limit?: number }) => {
    type Msg = {
      id: string;
      direction: string;
      conteudo?: string | null;
      tipo?: string;
      criadoEm: string;
      enviadaPorBot?: boolean;
      autor?: { nome?: string } | null;
    };
    const r = await api.get<Msg[] | { data?: Msg[] }>(
      `/inbox/${encodeURIComponent(conversationId)}/mensagens?limit=${String(limit ?? 50)}`,
    );
    // O api.get JÁ desembrulha o envelope ({success,data}) — e este endpoint
    // devolve o ARRAY direto em data. O `r?.data` aqui era um SEGUNDO
    // desembrulho: array não tem .data, então a tool devolvia sempre vazio
    // numa conversa cheia de mensagem (4º bloqueador do card 🤖). O
    // Array.isArray cobre os dois formatos, como as outras tools de lista.
    const lista: Msg[] = Array.isArray(r) ? r : (r?.data ?? []);
    const msgs = lista.map((m) => ({
      quem:
        m.direction === 'INBOUND'
          ? 'lead'
          : m.enviadaPorBot
            ? 'bot'
            : (m.autor?.nome ?? 'equipe'),
      quando: m.criadoEm,
      tipo: m.tipo,
      texto: m.conteudo ?? '',
    }));
    return ok({ conversationId, total: msgs.length, mensagens: msgs });
  }),
);

// ─── Boot ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// ─── CAMPANHAS (e-mail marketing) ────────────────────────────────────────────
//
// O ciclo que isto destrava: o agente ESCREVE o e-mail aqui, SOBE pro app, e o
// Léo dispara na tela. O disparo fica de fora de propósito — o guard barra
// `disparar`, `agendar` e `reenviar-erros` por rota exata. Os três fazem e-mail
// sair pra base real e não têm desfazer; revisar é trabalho de agente, apertar o
// botão é decisão de gente.

server.registerTool(
  'campanha_template_listar',
  {
    description:
      'Lista os TEMPLATES de campanha da empresa (nome, canal, assunto). Use antes de criar, ' +
      'pra reaproveitar em vez de duplicar. Exige escopo "campanhas".',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async () => {
    type TemplateApi = {
      id: string;
      nome: string;
      canal?: string;
      assunto?: string | null;
      descricao?: string | null;
      atualizadoEm?: string;
    };
    const r = await api.get<TemplateApi[] | { data?: TemplateApi[] }>('/campanha-templates');
    const arr = Array.isArray(r) ? r : (r?.data ?? []);
    return ok(
      arr.map((t) => ({
        id: t.id,
        nome: t.nome,
        canal: t.canal ?? 'EMAIL',
        assunto: t.assunto ?? null,
        descricao: t.descricao ?? null,
        atualizadoEm: t.atualizadoEm,
      })),
    );
  }),
);

server.registerTool(
  'campanha_template_criar',
  {
    description:
      'Cria um TEMPLATE de campanha (o e-mail pronto pra reusar). O HTML vai em mensagemEmail. ' +
      'NÃO envia nada — quem dispara é o Léo, na tela do app. Exige escopo "campanhas".',
    inputSchema: {
      nome: z.string().describe('Nome do template (é como ele aparece na lista).'),
      canal: z.enum(['EMAIL', 'WHATSAPP']).optional().describe('Default EMAIL.'),
      assunto: z.string().optional().describe('Assunto do e-mail. Até 80 caracteres entrega melhor.'),
      mensagemEmail: z.string().optional().describe('Corpo em HTML. Markup simples — cliente de e-mail ignora CSS complexo.'),
      mensagemWa: z.string().optional().describe('Texto, quando o canal é WHATSAPP.'),
      descricao: z.string().optional().describe('Pra que serve — ajuda a achar depois.'),
      objetivo: z.string().optional().describe('Contexto pra personalização por IA.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async (args: Record<string, unknown>) => {
    const t = await api.post<{ id: string; nome: string }>('/campanha-templates', args);
    return ok({ id: t.id, nome: t.nome, criado: true });
  }),
);

server.registerTool(
  'campanha_template_atualizar',
  {
    description:
      'Atualiza um TEMPLATE existente (assunto, corpo, nome). Manda só os campos que mudam. ' +
      'Exige escopo "campanhas".',
    inputSchema: {
      templateId: z.string().describe('ID do template (use campanha_template_listar).'),
      nome: z.string().optional(),
      assunto: z.string().optional(),
      mensagemEmail: z.string().optional(),
      mensagemWa: z.string().optional(),
      descricao: z.string().optional(),
      objetivo: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async (args: { templateId: string } & Record<string, unknown>) => {
    const { templateId, ...resto } = args;
    const t = await api.patch<{ id: string; nome: string }>(
      `/campanha-templates/${templateId}`,
      resto,
    );
    return ok({ id: t.id, nome: t.nome, atualizado: true });
  }),
);

server.registerTool(
  'campanhas_listar',
  {
    description:
      'Lista as CAMPANHAS da empresa com status (rascunho, agendada, enviando, concluída) e ' +
      'números de envio. Exige escopo "campanhas".',
    inputSchema: {
      status: z.string().optional().describe('Filtra por status (ex.: RASCUNHO).'),
      limit: z.number().optional().describe('Default 20.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async (args: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (args.status) qs.set('status', args.status);
    qs.set('limit', String(args.limit ?? 20));
    type CampanhaApi = {
      id: string;
      nome: string;
      canal?: string;
      status?: string;
      assunto?: string | null;
      agendadoPara?: string | null;
      _count?: { destinatarios?: number };
    };
    const r = await api.get<{ data?: CampanhaApi[] } | CampanhaApi[]>(`/campanhas?${qs.toString()}`);
    const arr = Array.isArray(r) ? r : (r?.data ?? []);
    return ok(
      arr.map((c) => ({
        id: c.id,
        nome: c.nome,
        canal: c.canal,
        status: c.status,
        assunto: c.assunto ?? null,
        agendadoPara: c.agendadoPara ?? null,
        destinatarios: c._count?.destinatarios ?? 0,
      })),
    );
  }),
);

server.registerTool(
  'campanha_criar_rascunho',
  {
    description:
      'Cria uma CAMPANHA em rascunho, com o conteúdo já dentro. Não agenda e não dispara — o ' +
      'envio é feito pelo Léo na tela (o token nem consegue chamar disparar/agendar). ' +
      'Segmentação vazia = toda a base ativa; confirme com ele antes de deixar assim. ' +
      'Exige escopo "campanhas".',
    inputSchema: {
      nome: z.string().describe('Nome interno da campanha.'),
      canal: z.enum(['EMAIL', 'WHATSAPP']).optional().describe('Default EMAIL.'),
      assunto: z.string().optional().describe('Assunto do e-mail.'),
      mensagemEmail: z.string().optional().describe('Corpo em HTML.'),
      mensagemWa: z.string().optional().describe('Texto, quando WHATSAPP.'),
      segTagIds: z.array(z.string()).optional().describe('Etiquetas de lead que definem o público.'),
      objetivo: z.string().optional().describe('Contexto pra personalização por IA.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async (args: Record<string, unknown>) => {
    const c = await api.post<{ id: string; nome: string; status?: string }>('/campanhas', {
      canal: 'EMAIL',
      ...args,
    });
    return ok({
      id: c.id,
      nome: c.nome,
      status: c.status,
      aviso: 'Rascunho criado. O disparo é na tela do app — o token não envia.',
    });
  }),
);


server.registerTool(
  'campanha_template_excluir',
  {
    description:
      'EXCLUI um TEMPLATE de campanha DEFINITIVAMENTE (não é arquivar — não tem desfazer). ' +
      'Use pra limpar template criado por engano, de teste ou duplicado. Campanhas que já foram ' +
      'criadas a partir dele NÃO são afetadas: o conteúdo é copiado pra campanha no momento em ' +
      'que ela nasce. Exige escopo "campanhas".',
    inputSchema: {
      templateId: z.string().describe('ID do template (use campanha_template_listar).'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ templateId }: { templateId: string }) => {
    await api.delete(`/campanha-templates/${templateId}`);
    return ok({ templateId, excluido: true });
  }),
);

server.registerTool(
  'campanha_excluir',
  {
    description:
      'EXCLUI uma CAMPANHA definitivamente. Só funciona em RASCUNHO ou CANCELADA — o servidor ' +
      'recusa campanha enviada ou em envio, porque apagar levaria junto o histórico de quem ' +
      'recebeu (e o engajamento pendurado nele). Use pra limpar rascunho de teste. ' +
      'Exige escopo "campanhas".',
    inputSchema: {
      campanhaId: z.string().describe('ID da campanha (use campanhas_listar).'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  seguro(async ({ campanhaId }: { campanhaId: string }) => {
    await api.delete(`/campanhas/${campanhaId}`);
    return ok({ campanhaId, excluida: true });
  }),
);

console.error(
  '[betinna-kanban-mcp] conectado — kanban_* + fluxos_* + funis_/contatos_/crm + prompts_* + ' +
    'bot_config_* + usuarios_* + conhecimento_* (base do RAG) + tags_* (etiquetas de LEAD) + ' +
    'inbox_* (SÓ leitura) + campanha_* (conteúdo; NÃO dispara)',
);
