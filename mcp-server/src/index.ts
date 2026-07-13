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
      'Cria um card no fim de uma lista. Aceita descrição, prazo (ISO) e IDs de etiquetas do quadro.',
    inputSchema: {
      listaId: z.string().describe('ID da lista (use kanban_ver_board)'),
      titulo: z.string().min(1).max(200),
      descricao: z.string().max(10000).optional(),
      dataEntrega: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe('Prazo ISO, ex: 2026-07-20T12:00:00Z ou 2026-07-20T12:00:00-03:00'),
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
      // O card JÁ foi criado. Se aplicar uma etiqueta falhar (id inválido),
      // NÃO retornamos isError — senão o Claude recria o card e duplica.
      // Reportamos sucesso com um aviso sobre as etiquetas que falharam.
      const avisoEtiquetas: string[] = [];
      for (const etiquetaId of etiquetas ?? []) {
        try {
          await api.post(`/kanban/cards/${card.id}/etiquetas/${etiquetaId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          avisoEtiquetas.push(`Etiqueta "${etiquetaId}" não aplicada: ${msg}`);
        }
      }
      return ok({
        id: card.id,
        titulo: card.titulo,
        ...(avisoEtiquetas.length > 0 ? { avisoEtiquetas } : {}),
      });
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
      dataEntrega: z.string().datetime({ offset: true }).nullable().optional(),
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
      // Prioriza id exato; senão nome (case-insensitive); senão cor.
      let alvo = board.etiquetas.find((e) => e.id === etiqueta);
      if (!alvo) {
        const porNome = board.etiquetas.filter(
          (e) => (e.nome ?? '').toLowerCase() === etiqueta.toLowerCase(),
        );
        if (porNome.length > 1) {
          return erro(
            `Há ${porNome.length} etiquetas chamadas "${etiqueta}". Use o id: ${porNome
              .map((e) => `${e.id} (${e.cor})`)
              .join(', ')}`,
          );
        }
        alvo = porNome[0] ?? board.etiquetas.find((e) => e.cor.toLowerCase() === etiqueta.toLowerCase());
      }
      if (!alvo) {
        const disponiveis = board.etiquetas.map((e) => e.nome ?? e.cor).join(', ') || '(nenhuma)';
        return erro(
          `Etiqueta "${etiqueta}" não existe no quadro. Disponíveis: ${disponiveis}. ` +
            'Crie com kanban_criar_etiqueta.',
        );
      }
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
  'PAUSAR_IA',
]);
const FLUXO_TRIGGER_TIPO = z.enum([
  'LEAD_CRIADO',
  'LEAD_ETAPA_MUDOU',
  'PEDIDO_APROVADO',
  'PEDIDO_ENTREGUE',
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
  id: z.string().min(1).max(120).describe('Chave estável (ex: "trigger", "ia1") usada nas arestas'),
  tipo: FLUXO_NO_TIPO,
  acaoTipo: FLUXO_ACAO_TIPO.nullable().optional().describe('Obrigatório quando tipo=ACAO'),
  titulo: z.string().min(1).max(100),
  config: z.record(z.unknown()).optional().describe('Config do nó (varia por tipo/ação)'),
  posX: z.number().optional(),
  posY: z.number().optional(),
});
const fluxoArestaInput = z.object({
  sourceNoId: z.string().min(1).describe('id (chave) do nó de origem'),
  targetNoId: z.string().min(1).describe('id (chave) do nó de destino'),
  label: z.string().max(40).nullable().optional().describe('Ex: "true"/"false" após CONDICAO'),
});

interface FluxoResumo {
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
      'Lista os fluxos de automação da empresa (id, nome, status, trigger). Filtros opcionais.',
    inputSchema: {
      status: z
        .enum(['RASCUNHO', 'ATIVO', 'PAUSADO', 'ARQUIVADO'])
        .optional()
        .describe('Filtra por status'),
      search: z.string().optional().describe('Busca por nome'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ status, search }: { status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (search) qs.set('search', search);
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
      })),
    );
  }),
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
    description: 'Histórico de execuções de um fluxo (mais recentes primeiro).',
    inputSchema: {
      fluxoId: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ fluxoId, limit }: { fluxoId: string; limit: number }) => {
    const resp = await api.get<unknown>(`/fluxos/${fluxoId}/execucoes?limit=${limit}`);
    return ok(resp);
  }),
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
      'Atualiza um fluxo em rascunho: nome/descrição/trigger e/ou FULL-REPLACE de nós e arestas ' +
      '(quando fornecidos, substituem TODOS os existentes). Não ativa.',
    inputSchema: {
      fluxoId: z.string(),
      nome: z.string().min(1).max(150).optional(),
      descricao: z.string().max(500).optional(),
      triggerTipo: FLUXO_TRIGGER_TIPO.optional(),
      triggerConfig: z.record(z.unknown()).optional(),
      nos: z.array(fluxoNoInput).optional().describe('Se enviado, substitui TODOS os nós'),
      arestas: z.array(fluxoArestaInput).optional().describe('Se enviado, substitui TODAS as arestas'),
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
  'fluxos_testar',
  {
    description:
      'Dispara uma execução de TESTE manual do fluxo (não é ativação — não liga o gatilho real). ' +
      'Use fluxos_execucoes pra ler o resultado.',
    inputSchema: {
      fluxoId: z.string(),
      contexto: z
        .record(z.unknown())
        .optional()
        .describe('Contexto inicial da execução (ex: { leadId, tag })'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  seguro(async ({ fluxoId, contexto }: { fluxoId: string; contexto?: Record<string, unknown> }) => {
    const r = await api.post<unknown>('/fluxos/testar', { fluxoId, contexto: contexto ?? {} });
    return ok(r);
  }),
);

// ─── Funis (SOMENTE LEITURA — escopo "funis") ───────────────────────────
// Base pro email-marketing: o orquestrador precisa enxergar os funis e etapas
// pra decidir a quem/quando escrever. NUNCA escreve (o token nem consegue: o
// guard barra métodos != GET em /funis).

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
    description: 'Detalhe de um funil: dados + etapas ordenadas. Somente leitura.',
    inputSchema: { funilId: z.string().describe('ID do funil (use funis_listar)') },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  seguro(async ({ funilId }: { funilId: string }) => {
    const f = await api.get<Record<string, unknown>>(`/funis/${funilId}`);
    return ok(f);
  }),
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
      'etapaNome, dataEntrada}] e representante. DADOS PESSOAIS — só o necessário. Somente leitura.',
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
      if (resp === null) return ok({ encontrado: false });
      return ok(resp);
    },
  ),
);

// ─── Boot ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  '[betinna-kanban-mcp] conectado — 26 tools kanban_* + 9 tools fluxos_* + 4 tools funis_/contatos_ disponíveis',
);
