/**
 * PRODUÇÃO do ERP (prefixo erp_) — custo do produto com o Orquestrador (Léo, 20/10).
 *
 * LEITURA (escopo "erp"): fichas técnicas por grade, insumos com custo médio,
 * facções com preço por modelo, serviços de acabamento e OPs. erp_op_simular
 * só CALCULA (não grava nada).
 *
 * ESCRITA (escopo "erp-escrita", junto com "erp"): gravar a ficha técnica de
 * uma grade e criar/editar o cadastro do insumo (preço de referência). Compra,
 * movimento de estoque, corte, envio e fechamento de OP ficam na tela.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import { seg } from "./caminho.js";
import type { Ajudantes } from "./vitrine.js";

const id = z.string().min(1).max(40);
const preco = z.number().nonnegative().max(1_000_000);

export function registrarProducaoErp(server: McpServer, { ok, seguro }: Ajudantes) {
  const leitura = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
  const escrita = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;

  // ─── Leitura ─────────────────────────────────────────────────────────────

  server.registerTool(
    "erp_fichas_listar",
    {
      description:
        "Lista as grades (modelo × linha) com o CUSTO PREVISTO por peça da ficha técnica. Escopo 'erp'. " +
        "Use erp_ficha_ver pra ver os itens de uma grade.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/erp/fichas"))),
  );

  server.registerTool(
    "erp_ficha_ver",
    {
      description:
        "Ficha técnica de UMA grade (modeloLinhaId): cada insumo com consumo por peça (e por tamanho), custo " +
        "usado e custo por peça; facção prevista; serviços de acabamento marcados; o previsto somado " +
        "(insumos + facção + acabamento) e 'semCusto' (insumos que contam 0 por falta de preço). Escopo 'erp'.",
      inputSchema: { modeloLinhaId: id },
      annotations: leitura,
    },
    seguro(async (a: { modeloLinhaId: string }) =>
      ok(await api.get(`/erp/fichas/${seg(a.modeloLinhaId)}`)),
    ),
  );

  server.registerTool(
    "erp_insumos_listar",
    {
      description:
        "Insumos (tecido e aviamento) com unidade, saldo, CUSTO MÉDIO, preço de referência e cores. Escopo 'erp'.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/erp/insumos"))),
  );

  server.registerTool(
    "erp_insumo_cores",
    {
      description: "Cores da empresa (ids) — pra dar cor ao insumo ou fixar a cor de um item da ficha. Escopo 'erp'.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/erp/insumos/cores"))),
  );

  server.registerTool(
    "erp_faccoes_listar",
    {
      description: "Facções com o PREÇO POR PEÇA de cada modelo. Escopo 'erp'.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/erp/faccoes"))),
  );

  server.registerTool(
    "erp_acabamento_ver",
    {
      description:
        "Serviços de ACABAMENTO da empresa (id, nome, preço por peça) — os ids que a ficha marca. Escopo 'erp'.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/erp/acabamento"))),
  );

  server.registerTool(
    "erp_ops_listar",
    {
      description: "Ordens de produção (mais recentes primeiro) com totais da grade. Escopo 'erp'.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/erp/ops"))),
  );

  server.registerTool(
    "erp_op_ver",
    {
      description: "Detalhe de uma OP: grade, etapas, custo previsto e CUSTO REAL lançado. Escopo 'erp'.",
      inputSchema: { opId: id },
      annotations: leitura,
    },
    seguro(async (a: { opId: string }) => ok(await api.get(`/erp/ops/${seg(a.opId)}`))),
  );

  server.registerTool(
    "erp_op_simular",
    {
      description:
        "SIMULA uma OP (não grava nada): consumo de insumos, falta de estoque e custo previsto da grade. " +
        "itens = variações (produtoId) e quantidades. Escopo 'erp'.",
      inputSchema: {
        modeloId: id,
        faccaoId: id.nullable().optional(),
        itens: z
          .array(z.object({ produtoId: id, quantidade: z.number().int().min(1).max(100_000) }))
          .min(1)
          .max(2000),
      },
      annotations: leitura,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/erp/ops/simular", a))),
  );

  // ─── Escrita (erp-escrita) ───────────────────────────────────────────────

  server.registerTool(
    "erp_acabamento_salvar",
    {
      description:
        "GRAVA os serviços de ACABAMENTO da empresa — SUBSTITUI a lista INTEIRA (é como a tela edita). " +
        "Leia antes com erp_acabamento_ver e mande TODOS: os antigos com o id deles e os novos sem id (ganham um). " +
        "Tirar da lista = desativar; antes, confira se nenhuma ficha usa o id. " +
        "custoCortePorPeca e fretePorPeca (R$ por peça): ausente = não mexe. Escopo 'erp-escrita'.",
      inputSchema: {
        servicos: z
          .array(
            z.object({
              id: z.string().min(1).max(60).optional(),
              nome: z.string().trim().min(2).max(80),
              preco: z.number().min(0).max(1000).describe("R$ por peça"),
            }),
          )
          .max(30),
        custoCortePorPeca: z.number().min(0).max(1000).optional(),
        fretePorPeca: z.number().min(0).max(1000).optional(),
      },
      annotations: escrita,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.put("/erp/acabamento", a))),
  );

  server.registerTool(
    "erp_ficha_salvar",
    {
      description:
        "GRAVA a ficha técnica de uma grade — SUBSTITUI a lista de itens INTEIRA (é como a tela edita). " +
        "Leia antes com erp_ficha_ver e mande TODOS os itens, os antigos e os novos. Escopo 'erp-escrita'. " +
        "O mesmo insumo pode vir em mais de uma linha, uma por USO (elástico no cós e na barra) — a OP soma; " +
        "só não repete insumo + cor fixa + uso iguais. " +
        "acabamento = ids de erp_acabamento_ver; custoFaccaoPrevisto = R$ por peça (null tira).",
      inputSchema: {
        modeloLinhaId: id,
        custoFaccaoPrevisto: z.number().nonnegative().max(100_000).nullable().optional(),
        observacoes: z.string().max(1000).nullable().optional(),
        acabamento: z.array(z.string().min(1).max(60)).max(30).optional(),
        acabamentoTamanhos: z
          .record(z.string().min(1).max(60), z.array(z.string().min(1).max(20)).max(40))
          .nullable()
          .optional()
          .describe(
            "Tamanhos onde cada serviço vale, ex.: {\"passar-cordao\":[\"8\",\"10\",\"12\",\"14\"]}. Serviço ausente = todos; ausente = não mexe; null = tira as restrições.",
          ),
        itens: z
          .array(
            z.object({
              insumoId: id,
              consumoPorPeca: z.number().positive().max(100_000).describe("Na unidade do insumo"),
              porTamanho: z
                .record(z.string().min(1).max(20), z.number().nonnegative().max(100_000))
                .nullable()
                .optional()
                .describe("Consumo por tamanho da grade (0 = o tamanho NÃO leva o insumo); com ele, o consumo vira a média"),
              etapa: z.enum(["FACCAO", "ACABAMENTO"]).optional(),
              observacao: z.string().max(200).nullable().optional(),
              corFixaId: id.nullable().optional().describe("Só pra insumo com cores (ex.: cordão sempre Branco)"),
              uso: z
                .string()
                .max(60)
                .nullable()
                .optional()
                .describe("Onde a linha é usada na peça (ex.: cós, barra, corpo, viés). Mande o que veio no erp_ficha_ver"),
            }),
          )
          .max(100),
      },
      annotations: escrita,
    },
    seguro(async ({ modeloLinhaId, ...a }: { modeloLinhaId: string } & Record<string, unknown>) =>
      ok(await api.put(`/erp/fichas/${seg(modeloLinhaId)}`, a)),
    ),
  );

  const insumoCampos = {
    nome: z.string().min(2).max(120),
    tipo: z.enum(["TECIDO", "AVIAMENTO"]),
    unidade: z.enum(["KG", "METRO", "UNIDADE", "PAR"]),
    cor: z.string().max(60).nullable().optional().describe("Texto livre — só pra insumo SEM cores da lista"),
    cores: z.array(id).max(40).optional().describe("Ids de erp_insumo_cores; ausente = não mexe"),
    fornecedor: z.string().max(120).nullable().optional(),
    estoqueMinimo: z.number().nonnegative().max(1_000_000).nullable().optional(),
    ativo: z.boolean().optional(),
    precoReferencia: preco
      .nullable()
      .optional()
      .describe("R$ por unidade (insumo sem cores) — vale como custo enquanto não houver compra"),
    precosCor: z.record(id, preco.nullable()).optional().describe("R$ por unidade POR COR (id da cor → preço)"),
  };

  server.registerTool(
    "erp_insumo_criar",
    {
      description:
        "Cria um INSUMO (tecido ou aviamento). Confira antes com erp_insumos_listar (não duplique). Escopo 'erp-escrita'.",
      inputSchema: insumoCampos,
      annotations: { ...escrita, idempotentHint: false },
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/erp/insumos", a))),
  );

  server.registerTool(
    "erp_insumo_editar",
    {
      description:
        "Edita o cadastro de um insumo — nome, tipo e unidade são obrigatórios; o resto, ausente = não mexe. " +
        "Use pra pôr o PREÇO DE REFERÊNCIA (precoReferencia ou precosCor). Não compra nem mexe no estoque. Escopo 'erp-escrita'.",
      inputSchema: { insumoId: id, ...insumoCampos },
      annotations: escrita,
    },
    seguro(async ({ insumoId, ...a }: { insumoId: string } & Record<string, unknown>) =>
      ok(await api.put(`/erp/insumos/${seg(insumoId)}`, a)),
    ),
  );
}
