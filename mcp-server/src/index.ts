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
      dataEntrega: string | null;
      responsavel: Usuario | null;
    }>;
  }>;
  comentarios: Array<{ id: string; texto: string; criadoEm: string; autor: Usuario }>;
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
      return erro(err instanceof Error ? err.message : String(err));
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
      'Quadro completo: listas na ordem, com os cards resumidos (id, título, entrega, etiquetas, membros, progresso do checklist).',
    inputSchema: { boardId: z.string().describe('ID do quadro (use kanban_listar_boards)') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ boardId }: { boardId: string }) => {
    const b = await api.get<BoardCompleto>(`/kanban/boards/${boardId}`);
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
      'Cria um card no fim de uma lista. Aceita descrição, prazo (ISO) e IDs de etiquetas do quadro.',
    inputSchema: {
      listaId: z.string().describe('ID da lista (use kanban_ver_board)'),
      titulo: z.string().min(1).max(200),
      descricao: z.string().max(10000).optional(),
      dataEntrega: z.string().datetime().optional().describe('Prazo ISO, ex: 2026-07-20T12:00:00Z'),
      etiquetas: z.array(z.string()).optional().describe('IDs de etiquetas (kanban_ver_board)'),
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
    }: {
      listaId: string;
      titulo: string;
      descricao?: string;
      dataEntrega?: string;
      etiquetas?: string[];
    }) => {
      const card = await api.post<{ id: string; titulo: string }>(`/kanban/listas/${listaId}/cards`, {
        titulo,
        descricao,
        dataEntrega,
      });
      for (const etiquetaId of etiquetas ?? []) {
        await api.post(`/kanban/cards/${card.id}/etiquetas/${etiquetaId}`);
      }
      return ok({ id: card.id, titulo: card.titulo });
    },
  ),
);

server.registerTool(
  'kanban_atualizar_card',
  {
    description: 'Atualiza título, descrição, prazo e/ou status de concluído do card.',
    inputSchema: {
      cardId: z.string(),
      titulo: z.string().min(1).max(200).optional(),
      descricao: z.string().max(10000).nullable().optional(),
      dataEntrega: z.string().datetime().nullable().optional(),
      concluido: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ cardId, ...campos }: { cardId: string; [k: string]: unknown }) => {
    const definidos = Object.fromEntries(
      Object.entries(campos).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(definidos).length === 0) {
      return erro('Informe pelo menos um campo (titulo, descricao, dataEntrega, concluido)');
    }
    const card = await api.patch<{ id: string; titulo: string }>(`/kanban/cards/${cardId}`, definidos);
    return ok({ id: card.id, titulo: card.titulo, atualizado: Object.keys(definidos) });
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
    const destino =
      board.listas.find((l) => l.id === listaDestino) ??
      board.listas.find((l) => l.nome.toLowerCase() === listaDestino.toLowerCase());
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
  dataEntrega: z.string().datetime().optional(),
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
      const itensResolvidos = [];
      for (const item of itens ?? []) {
        itensResolvidos.push({
          texto: item.texto,
          dataEntrega: item.dataEntrega,
          responsavelId: item.responsavelEmail ? await resolverEmail(item.responsavelEmail) : undefined,
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
      dataEntrega: z.string().datetime().nullable().optional(),
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
        .describe('Valor conforme o tipo do campo (data em ISO, lista_opcoes = uma das opções)'),
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
      await api.put(`/kanban/cards/${cardId}/campos/${campo.id}`, { valor });
      return ok({ cardId, campo: campo.nome, valor });
    },
  ),
);

// ─── Boot ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[betinna-kanban-mcp] conectado — 16 tools kanban_* disponíveis');
