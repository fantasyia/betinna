/**
 * PRODUÇÃO do ERP (prefixo erp_) — custo do produto com o Orquestrador (Léo, 20/10).
 *
 * LEITURA (escopo "erp"): fichas técnicas por grade, insumos com custo médio,
 * facções com preço por modelo, serviços de acabamento e OPs. erp_op_simular
 * só CALCULA (não grava nada).
 *
 * ESCRITA (escopo "erp-escrita", junto com "erp"): gravar a ficha técnica e a
 * de costura (01/11) de uma grade e criar/editar o cadastro do insumo (preço de
 * referência). Compra,
 * movimento de estoque, corte, envio e fechamento de OP ficam na tela.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extname } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { api } from "./api.js";
import { lerPermitido } from "./arquivos.js";
import { seg } from "./caminho.js";
import type { Ajudantes } from "./vitrine.js";

const id = z.string().min(1).max(40);
const preco = z.number().nonnegative().max(1_000_000);

// Ficha de costura (#03, 01/11): desenho técnico pede mais resolução que foto.
const LARGURA_COSTURA = 1800;
const MAX_IMAGEM_COSTURA = 2 * 1024 * 1024;
const EXT_IMAGEM = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif"];

/** WebP até 1800 px de largura, baixando a qualidade até caber em 2 MB. */
async function prepararImagemCostura(buf: Buffer): Promise<Buffer> {
  const base = sharp(buf, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
  for (let q = 88; q >= 48; q -= 10) {
    const out = await base.clone().resize({ width: LARGURA_COSTURA, withoutEnlargement: true }).webp({ quality: q }).toBuffer();
    if (out.length <= MAX_IMAGEM_COSTURA) return out;
  }
  throw new Error("mesmo convertida, a imagem passou de 2MB");
}

export function registrarProducaoErp(server: McpServer, { ok, erro, seguro }: Ajudantes) {
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

  server.registerTool(
    "erp_ficha_opcional_previa",
    {
      description:
        "Ficha de OPCIONAL (ex.: a versão 'com Emborrachado'): compara a ficha dele com a do produto BASE na mesma " +
        "linha e mostra o que ele tem A MAIS (extras: itens + serviços de acabamento) e o que a base tem e ele NÃO " +
        "(divergencias). Não grava. Use antes de erp_ficha_opcional_extras.",
      inputSchema: { modeloLinhaId: id.describe("Linha do modelo OPCIONAL") },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async ({ modeloLinhaId }: { modeloLinhaId: string }) =>
      ok(await api.get(`/erp/fichas/${seg(modeloLinhaId)}/opcional/previa`)),
    ),
  );

  server.registerTool(
    "erp_ficha_opcional_extras",
    {
      description:
        "LIGA a ficha de um OPCIONAL à do produto BASE: ela passa a ser base + estes extras e é REMONTADA sozinha " +
        "toda vez que a ficha da base muda (a ficha do opcional deixa de aceitar erp_ficha_salvar). extras = " +
        "{itens (mesmo formato do erp_ficha_salvar), acabamento: [ids de serviço a mais]}; null SOLTA (a ficha " +
        "fica como está, comum). Escopo 'erp-escrita'. Rode erp_ficha_opcional_previa antes e mostre ao Léo.",
      inputSchema: {
        modeloLinhaId: id.describe("Linha do modelo OPCIONAL"),
        extras: z
          .object({
            itens: z
              .array(
                z.object({
                  insumoId: id,
                  consumoPorPeca: z.number().positive().max(100_000),
                  porTamanho: z.record(z.string().min(1).max(20), z.number().nonnegative().max(100_000)).nullable().optional(),
                  etapa: z.enum(["FACCAO", "ACABAMENTO"]).optional(),
                  observacao: z.string().max(200).nullable().optional(),
                  corFixaId: id.nullable().optional(),
                  uso: z.string().max(60).nullable().optional(),
                }),
              )
              .max(100),
            acabamento: z.array(z.string().min(1).max(60)).max(30).optional(),
          })
          .nullable(),
      },
      annotations: escrita,
    },
    seguro(async ({ modeloLinhaId, extras }: { modeloLinhaId: string; extras: unknown }) =>
      ok(await api.put(`/erp/fichas/${seg(modeloLinhaId)}/opcional-extras`, { extras })),
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

  // ─── Ficha de costura (#03 Modelista, 01/11) ─────────────────────────────

  server.registerTool(
    "erp_costura_ver",
    {
      description:
        "Ficha de COSTURA de uma grade (modeloLinhaId): imagens (id, url, legenda), peças do corte, sequência " +
        "(ordem · operação · máquina), etiquetas, pontos de atenção e medidas por tamanho; e os tamanhos da grade. " +
        "costura null = ainda não tem. Sai na via da facção da OP, uma página por modelo × linha, junto com os " +
        "aviamentos da facção e o acabamento da ficha técnica (esses NÃO se digitam aqui). Escopo 'erp'.",
      inputSchema: { modeloLinhaId: id },
      annotations: leitura,
    },
    seguro(async (a: { modeloLinhaId: string }) =>
      ok(await api.get(`/erp/fichas/${seg(a.modeloLinhaId)}/costura`)),
    ),
  );

  const opcional = (max: number) => z.string().max(max).nullable().optional();

  server.registerTool(
    "erp_costura_salvar",
    {
      description:
        "GRAVA a ficha de costura de uma grade — SUBSTITUI a ficha INTEIRA (leia antes com erp_costura_ver e mande " +
        "tudo). As imagens sobem com erp_costura_imagem_subir; aqui vai só a ORDEM e a legenda delas pelo id — id " +
        "que ficar de fora é APAGADO. Medidas: valor por tamanho da grade, número (cm) ou texto (\"relaxada 74 / " +
        "esticada 101\"). Escopo 'erp-escrita'.",
      inputSchema: {
        modeloLinhaId: id,
        imagens: z
          .array(z.object({ id: z.string().min(1).max(40), legenda: opcional(120) }))
          .max(8)
          .describe("Ordem e legenda das imagens JÁ subidas (ids do erp_costura_ver)"),
        pecasCorte: z
          .array(z.object({ peca: z.string().min(1).max(80), quantidade: z.number().int().min(1).max(50), tecido: opcional(80), observacao: opcional(200) }))
          .max(40),
        sequencia: z
          .array(z.object({ ordem: z.number().int().min(1).max(200), operacao: z.string().min(1).max(200), maquina: z.string().min(1).max(60), observacao: opcional(200) }))
          .max(80),
        etiquetas: z.array(z.object({ tipo: z.string().min(1).max(60), posicao: z.string().min(1).max(200) })).max(10),
        atencao: z.array(z.string().min(1).max(300)).max(20),
        medidas: z
          .array(
            z.object({
              ponto: z.string().min(1).max(80),
              tolerancia: opcional(40),
              valores: z.record(z.string().min(1).max(20), z.union([z.number().nonnegative().max(1000), z.string().min(1).max(60)])),
            }),
          )
          .max(30),
      },
      annotations: escrita,
    },
    seguro(async ({ modeloLinhaId, ...a }: { modeloLinhaId: string } & Record<string, unknown>) =>
      ok(await api.put(`/erp/fichas/${seg(modeloLinhaId)}/costura`, a)),
    ),
  );

  server.registerTool(
    "erp_costura_imagem_subir",
    {
      description:
        "Acrescenta UMA imagem (desenho técnico ou foto com marcações) à ficha de costura, a partir de um arquivo " +
        "local (caminho ABSOLUTO, dentro de BETINNA_MCP_ANEXOS_DIR). Converte pra WebP até 1800 px. Máx 8 por " +
        "ficha. Cria a ficha de costura se a grade ainda não tem. Escopo 'erp-escrita'.",
      inputSchema: { modeloLinhaId: id, caminho: z.string().min(1), legenda: z.string().max(120).optional() },
      annotations: { ...escrita, idempotentHint: false },
    },
    seguro(async (a: { modeloLinhaId: string; caminho: string; legenda?: string }) => {
      if (!EXT_IMAGEM.includes(extname(a.caminho).toLowerCase())) {
        return erro(`Extensão não aceita (use ${EXT_IMAGEM.join(" ")}). PDF: exporte a página como PNG antes.`);
      }
      const lido = await lerPermitido(a.caminho, 40 * 1024 * 1024);
      if (!lido.ok) return erro(lido.motivo);
      const webp = await prepararImagemCostura(lido.buf);
      const form = new FormData();
      form.append("imagem", new Blob([Uint8Array.from(webp)], { type: "image/webp" }), "imagem.webp");
      if (a.legenda) form.append("legenda", a.legenda);
      return ok(await api.postForm(`/erp/fichas/${seg(a.modeloLinhaId)}/costura/imagens`, form));
    }),
  );

  server.registerTool(
    "erp_costura_imagem_excluir",
    {
      description: "Apaga uma imagem da ficha de costura (id do erp_costura_ver). Escopo 'erp-escrita'.",
      inputSchema: { modeloLinhaId: id, imagemId: z.string().min(1).max(40) },
      annotations: { ...escrita, destructiveHint: true },
    },
    seguro(async (a: { modeloLinhaId: string; imagemId: string }) =>
      ok(await api.delete(`/erp/fichas/${seg(a.modeloLinhaId)}/costura/imagens/${seg(a.imagemId)}`)),
    ),
  );
}
