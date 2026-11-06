/**
 * Oferta Relâmpago da Shopee (escopo "shopee-promocoes", Léo 31/10).
 *
 * Usa o app do Betinna (o único com o módulo shop_flash_sale). Ler é livre;
 * CRIAR, PÔR/EDITAR ITEM e ATIVAR mexem na loja de verdade — só com o
 * "pode subir" do Léo pra aquela oferta. Antes de pôr item, leia o estoque
 * com shopee_anuncio_modelos (regra da loja: estoque na campanha = min(10, estoque)).
 *
 * Cupons (shopee_cupom_*, 31/10): mesmo escopo, mesma regra — ler é livre;
 * criar, editar, encerrar e apagar só com o OK do Léo.
 *
 * Preço (shopee_preco_atualizar, 01/11): muda o preço do anúncio por model —
 * só com o "pode subir" do Léo pro plano exato.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import { lerPermitido } from "./arquivos.js";
import type { Ajudantes } from "./vitrine.js";

const id = z.number().int().positive();
const modelo = z.object({
  model_id: id.optional().describe("Ausente = anúncio sem variação"),
  preco: z.number().positive().optional().describe("Preço promocional FINAL em reais (ou use desconto)"),
  desconto: z.number().gt(0).lt(100).optional().describe("% sobre o preço atual do model (ou use preco)"),
  estoque: z.number().int().min(1).describe("Estoque reservado pra campanha"),
});
const item = z.object({
  item_id: id,
  purchase_limit: z.number().int().min(0).optional().describe("Limite por comprador (0 = sem limite)"),
  models: z.array(modelo).min(1).max(50),
});

export function registrarShopeePromocoes(server: McpServer, { ok, seguro }: Ajudantes) {
  const leitura = { readOnlyHint: true, destructiveHint: false } as const;
  const mexe = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

  server.registerTool(
    "shopee_flash_sale_listar",
    {
      description:
        "Ofertas relâmpago da loja Shopee. type: 0 todas · 1 próximas · 2 em andamento · 3 encerradas. Somente leitura.",
      inputSchema: {
        type: z.number().int().min(0).max(3).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: leitura,
    },
    seguro(async (a: { type?: number; offset?: number; limit?: number }) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(a)) if (v !== undefined) q.set(k, String(v));
      return ok(await api.get(`/shopee-promocoes/flash-sale?${q}`));
    }),
  );

  server.registerTool(
    "shopee_flash_sale_ver",
    {
      description: "Uma oferta relâmpago (horário, status) com os itens e models. Somente leitura.",
      inputSchema: { flashSaleId: id },
      annotations: leitura,
    },
    seguro(async ({ flashSaleId }: { flashSaleId: number }) =>
      ok(await api.get(`/shopee-promocoes/flash-sale/${flashSaleId}`)),
    ),
  );

  server.registerTool(
    "shopee_flash_sale_horarios",
    {
      description:
        "Horários (timeslot_id) disponíveis pra oferta relâmpago entre start_time e end_time (Unix, SEGUNDOS). Somente leitura.",
      inputSchema: { start_time: id, end_time: id },
      annotations: leitura,
    },
    seguro(async (a: { start_time: number; end_time: number }) =>
      ok(
        await api.get(
          `/shopee-promocoes/flash-sale/horarios?start_time=${a.start_time}&end_time=${a.end_time}`,
        ),
      ),
    ),
  );

  server.registerTool(
    "shopee_anuncio_modelos",
    {
      description:
        "Preço atual, preço original e ESTOQUE de cada model (variação) de um anúncio Shopee. Somente leitura.",
      inputSchema: { itemId: id },
      annotations: leitura,
    },
    seguro(async ({ itemId }: { itemId: number }) =>
      ok(await api.get(`/shopee-promocoes/anuncios/${itemId}/modelos`)),
    ),
  );

  server.registerTool(
    "shopee_flash_sale_criar",
    {
      description:
        "CRIA uma oferta relâmpago num timeslot (de shopee_flash_sale_horarios). Nasce sem itens. MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: { timeslot_id: id },
      annotations: mexe,
    },
    seguro(async (a: { timeslot_id: number }) =>
      ok(await api.post("/shopee-promocoes/flash-sale", a)),
    ),
  );

  server.registerTool(
    "shopee_flash_sale_adicionar_itens",
    {
      description:
        "Põe anúncios na oferta: por model, preco (final) OU desconto (%), e estoque. MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: { flashSaleId: id, itens: z.array(item).min(1).max(50) },
      annotations: mexe,
    },
    seguro(async ({ flashSaleId, itens }: { flashSaleId: number; itens: unknown[] }) =>
      ok(await api.post(`/shopee-promocoes/flash-sale/${flashSaleId}/itens`, { itens })),
    ),
  );

  server.registerTool(
    "shopee_flash_sale_editar_itens",
    {
      description:
        "Edita itens já na oferta (preço/desconto, estoque, limite; status 1 ativo · 0 desativado por model). MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: {
        flashSaleId: id,
        itens: z
          .array(
            item.extend({
              models: z
                .array(modelo.extend({ status: z.union([z.literal(0), z.literal(1)]).optional() }))
                .min(1)
                .max(50),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: mexe,
    },
    seguro(async ({ flashSaleId, itens }: { flashSaleId: number; itens: unknown[] }) =>
      ok(await api.post(`/shopee-promocoes/flash-sale/${flashSaleId}/itens/editar`, { itens })),
    ),
  );

  server.registerTool(
    "shopee_flash_sale_status",
    {
      description: "ATIVA (1) ou DESATIVA (2) a oferta relâmpago. MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: { flashSaleId: id, status: z.union([z.literal(1), z.literal(2)]) },
      annotations: mexe,
    },
    seguro(async ({ flashSaleId, status }: { flashSaleId: number; status: 1 | 2 }) =>
      ok(await api.post(`/shopee-promocoes/flash-sale/${flashSaleId}/status`, { status })),
    ),
  );

  server.registerTool(
    "shopee_preco_atualizar",
    {
      description:
        "MUDA O PREÇO de um anúncio Shopee por model (variação); anúncio sem variação = sem model_id. Responde o que a Shopee aceitou e recusou. Leia antes com shopee_anuncio_modelos. MEXE NA LOJA — só com o OK do Léo pro plano exato (preço antigo → novo).",
      inputSchema: {
        itemId: id,
        models: z
          .array(
            z.object({
              model_id: z.number().int().min(0).optional().describe("Ausente = anúncio sem variação"),
              preco: z.number().positive().describe("Preço novo em reais (original_price)"),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: mexe,
    },
    seguro(async ({ itemId, models }: { itemId: number; models: unknown[] }) =>
      ok(await api.post(`/shopee-promocoes/anuncios/${itemId}/preco`, { models })),
    ),
  );

  server.registerTool(
    "shopee_anuncio_descricao",
    {
      description:
        "Descrição atual de um anúncio Shopee: tipo (normal ou extended), texto e blocos da estendida. Somente leitura.",
      inputSchema: { itemId: id },
      annotations: leitura,
    },
    seguro(async ({ itemId }: { itemId: number }) =>
      ok(await api.get(`/shopee-promocoes/anuncios/${itemId}/descricao`)),
    ),
  );

  server.registerTool(
    "shopee_descricao_atualizar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pro texto exato. Troca SÓ a descrição; preço, estoque e título não mudam. " +
        "Leia antes com shopee_anuncio_descricao. Normal: mande descricao. Estendida sem imagem: descricao vira um bloco de texto. " +
        "Estendida com imagem: mande campos com TODOS os blocos, senão a rota recusa. Devolve antes, depois e conferido; erro da Shopee volta como erro.",
      inputSchema: {
        itemId: id,
        descricao: z.string().min(1).max(5000).optional(),
        campos: z
          .array(
            z.object({
              field_type: z.enum(["text", "image"]),
              text: z.string().min(1).max(5000).optional(),
              image_info: z.object({ image_id: z.string().min(1) }).optional(),
            }),
          )
          .min(1)
          .max(50)
          .optional(),
      },
      annotations: mexe,
    },
    seguro(async ({ itemId, ...corpo }: { itemId: number; descricao?: string; campos?: unknown[] }) =>
      ok(await api.post(`/shopee-promocoes/anuncios/${itemId}/descricao`, corpo)),
    ),
  );

  server.registerTool(
    "shopee_anuncio_ficha",
    {
      description:
        "Ficha técnica de um anúncio Shopee: categoria, atributos atuais e, em opcoes, os atributos da categoria com os value_id aceitos. Somente leitura.",
      inputSchema: { itemId: id },
      annotations: leitura,
    },
    seguro(async ({ itemId }: { itemId: number }) =>
      ok(await api.get(`/shopee-promocoes/anuncios/${itemId}/ficha`)),
    ),
  );

  server.registerTool(
    "shopee_ficha_atualizar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pro valor exato. Troca SÓ os atributos mandados; o resto da ficha é lido na hora e reenviado igual. " +
        "Preço, estoque, SKU, variação e status não vão. Valor livre: value_id 0 + original_value_name. Devolve antes, depois e conferido.",
      inputSchema: {
        itemId: id,
        atributos: z
          .array(
            z.object({
              attribute_id: id,
              attribute_value_list: z
                .array(
                  z.object({
                    value_id: z.number().int().min(0),
                    original_value_name: z.string().min(1).max(200).optional(),
                    value_unit: z.string().min(1).max(20).optional(),
                  }),
                )
                .min(1)
                .max(50),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: mexe,
    },
    seguro(async ({ itemId, atributos }: { itemId: number; atributos: unknown[] }) =>
      ok(await api.post(`/shopee-promocoes/anuncios/${itemId}/ficha`, { atributos })),
    ),
  );

  server.registerTool(
    "shopee_anuncio_titulo",
    {
      description: "Título atual de um anúncio Shopee. Somente leitura.",
      inputSchema: { itemId: id },
      annotations: leitura,
    },
    seguro(async ({ itemId }: { itemId: number }) =>
      ok(await api.get(`/shopee-promocoes/anuncios/${itemId}/titulo`)),
    ),
  );

  server.registerTool(
    "shopee_titulo_atualizar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pro título exato. Troca SÓ o título. Devolve antes, depois e conferido.",
      inputSchema: { itemId: id, titulo: z.string().min(1).max(255) },
      annotations: mexe,
    },
    seguro(async ({ itemId, titulo }: { itemId: number; titulo: string }) =>
      ok(await api.post(`/shopee-promocoes/anuncios/${itemId}/titulo`, { titulo })),
    ),
  );

  server.registerTool(
    "shopee_anuncio_marca",
    {
      description: "Marca atual de um anúncio Shopee e a categoria dele. Somente leitura.",
      inputSchema: { itemId: id },
      annotations: leitura,
    },
    seguro(async ({ itemId }: { itemId: number }) =>
      ok(await api.get(`/shopee-promocoes/anuncios/${itemId}/marca`)),
    ),
  );

  server.registerTool(
    "shopee_marcas_listar",
    {
      description:
        "Marcas aceitas numa categoria Shopee, 100 por página: use proxima como offset. status 1 normal, 2 pendente. Somente leitura.",
      inputSchema: {
        categoriaId: id,
        offset: z.number().int().min(0).optional(),
        status: z.union([z.literal(1), z.literal(2)]).optional(),
      },
      annotations: leitura,
    },
    seguro(
      async ({
        categoriaId,
        offset,
        status,
      }: {
        categoriaId: number;
        offset?: number;
        status?: 1 | 2;
      }) => {
        const q = new URLSearchParams();
        if (offset !== undefined) q.set("offset", String(offset));
        if (status !== undefined) q.set("status", String(status));
        const qs = q.toString() ? `?${q}` : "";
        return ok(await api.get(`/shopee-promocoes/categorias/${categoriaId}/marcas${qs}`));
      },
    ),
  );

  server.registerTool(
    "shopee_marca_atualizar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pra marca exata. Troca SÓ a marca; nenhum outro campo do anúncio vai. Devolve antes, depois e conferido.",
      inputSchema: {
        itemId: id,
        brand_id: z.number().int().min(0),
        original_brand_name: z.string().min(1).max(200).optional(),
      },
      annotations: mexe,
    },
    seguro(
      async ({
        itemId,
        ...marca
      }: {
        itemId: number;
        brand_id: number;
        original_brand_name?: string;
      }) => ok(await api.post(`/shopee-promocoes/anuncios/${itemId}/marca`, marca)),
    ),
  );

  server.registerTool(
    "shopee_anuncio_tabela_medidas",
    {
      description:
        "Tabela de medidas de um anúncio Shopee: URL da imagem, modelo ligado com o conteúdo (modelo_erro diz por que não abriu) e se a categoria aceita imagem ou modelo. Somente leitura.",
      inputSchema: { itemId: id },
      annotations: leitura,
    },
    seguro(async ({ itemId }: { itemId: number }) =>
      ok(await api.get(`/shopee-promocoes/anuncios/${itemId}/tabela-medidas`)),
    ),
  );

  server.registerTool(
    "shopee_tabelas_listar",
    {
      description: "Modelos de tabela de medidas da loja numa categoria. Somente leitura.",
      inputSchema: { categoriaId: id, cursor: z.string().min(1).max(100).optional() },
      annotations: leitura,
    },
    seguro(async ({ categoriaId, cursor }: { categoriaId: number; cursor?: string }) => {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return ok(await api.get(`/shopee-promocoes/categorias/${categoriaId}/tabelas-medidas${q}`));
    }),
  );

  server.registerTool(
    "shopee_imagem_subir",
    {
      description:
        "Sobe um JPG ou PNG de até 10 MB no media space da Shopee e devolve imagemId. Nenhum anúncio muda. cena desc (padrão) não mexe na imagem; normal deixa quadrada.",
      inputSchema: {
        caminho: z.string().min(1).describe("Caminho absoluto do arquivo"),
        cena: z.enum(["desc", "normal"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ caminho, cena }: { caminho: string; cena?: string }) => {
      const minusculo = caminho.toLowerCase();
      const tipo = minusculo.endsWith(".png")
        ? "image/png"
        : /\.jpe?g$/.test(minusculo)
          ? "image/jpeg"
          : null;
      if (!tipo) throw new Error("A Shopee só aceita JPG ou PNG");
      const lido = await lerPermitido(caminho, 10 * 1024 * 1024);
      if (!lido.ok) throw new Error(lido.motivo);
      const form = new FormData();
      form.append("imagem", new Blob([Uint8Array.from(lido.buf)], { type: tipo }), tipo === "image/png" ? "tabela.png" : "tabela.jpg");
      if (cena) form.append("cena", cena);
      return ok(await api.postForm("/shopee-promocoes/imagens", form));
    }),
  );

  server.registerTool(
    "shopee_tabela_medidas_atualizar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pra arte exata. Troca SÓ a tabela de medidas. Mande imagemId (de shopee_imagem_subir) OU modeloId. " +
        "A rota recusa o que a categoria não aceita. Devolve antes, depois e conferido.",
      inputSchema: {
        itemId: id,
        imagemId: z.string().min(1).max(100).optional(),
        modeloId: id.optional(),
      },
      annotations: mexe,
    },
    seguro(async ({ itemId, ...corpo }: { itemId: number; imagemId?: string; modeloId?: number }) =>
      ok(await api.post(`/shopee-promocoes/anuncios/${itemId}/tabela-medidas`, corpo)),
    ),
  );

  // ─── Cupons ───────────────────────────────────────────────────────────
  const unix = z.number().int().positive().describe("Unix, SEGUNDOS");
  const cupom = {
    nome: z.string().min(1).max(100),
    codigo: z.string().regex(/^[A-Z0-9]{1,5}$/).describe("1 a 5 letras/números; a Shopee põe o prefixo da loja"),
    inicio: unix,
    fim: unix,
    alcance: z.enum(["loja", "produtos"]),
    itemIds: z.array(id).max(200).optional().describe("Obrigatório quando alcance = produtos"),
    tipo: z.enum(["valor", "percentual"]),
    valor: z.number().positive().optional().describe("R$ de desconto (tipo valor)"),
    percentual: z.number().int().min(1).max(99).optional().describe("% de desconto (tipo percentual)"),
    teto: z.number().positive().optional().describe("Desconto máximo em R$ — OBRIGATÓRIO no tipo percentual (a Shopee recusa sem)"),
    minimoCompra: z.number().min(0).describe("Compra mínima em R$"),
    quantidade: z.number().int().min(1).describe("Quantos cupons no total"),
    vitrine: z.boolean().optional().describe("false = escondido, só por código (padrão: aparece)"),
  };

  server.registerTool(
    "shopee_cupom_listar",
    {
      description: "Cupons da loja Shopee. status: upcoming · ongoing · expired · all. Somente leitura.",
      inputSchema: {
        status: z.enum(["upcoming", "ongoing", "expired", "all"]).optional(),
        pagina: z.number().int().min(1).optional(),
        porPagina: z.number().int().min(1).max(100).optional(),
      },
      annotations: leitura,
    },
    seguro(async (a: { status?: string; pagina?: number; porPagina?: number }) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(a)) if (v !== undefined) q.set(k, String(v));
      return ok(await api.get(`/shopee-promocoes/cupons?${q}`));
    }),
  );

  server.registerTool(
    "shopee_cupom_ver",
    {
      description: "Um cupom da loja Shopee (regras, uso, datas). Somente leitura.",
      inputSchema: { voucherId: id },
      annotations: leitura,
    },
    seguro(async ({ voucherId }: { voucherId: number }) =>
      ok(await api.get(`/shopee-promocoes/cupons/${voucherId}`)),
    ),
  );

  server.registerTool(
    "shopee_cupom_criar",
    {
      description:
        "CRIA cupom na loja Shopee (valor fixo ou %, loja toda ou produtos). MEXE NA LOJA — só com o OK do Léo pro cupom exato.",
      inputSchema: cupom,
      annotations: mexe,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/shopee-promocoes/cupons", a))),
  );

  server.registerTool(
    "shopee_cupom_editar",
    {
      description:
        "Edita cupom (mande só o que muda; a Shopee recusa alguns campos depois do início). MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: {
        voucherId: id,
        ...Object.fromEntries(Object.entries(cupom).map(([k, v]) => [k, v.optional()])),
      },
      annotations: mexe,
    },
    seguro(async ({ voucherId, ...a }: { voucherId: number } & Record<string, unknown>) =>
      ok(await api.post(`/shopee-promocoes/cupons/${voucherId}/editar`, a)),
    ),
  );

  server.registerTool(
    "shopee_cupom_encerrar",
    {
      description: "ENCERRA um cupom em andamento. MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: { voucherId: id },
      annotations: mexe,
    },
    seguro(async ({ voucherId }: { voucherId: number }) =>
      ok(await api.post(`/shopee-promocoes/cupons/${voucherId}/encerrar`, {})),
    ),
  );

  server.registerTool(
    "shopee_cupom_apagar",
    {
      description: "APAGA um cupom que ainda não começou. MEXE NA LOJA — só com o OK do Léo.",
      inputSchema: { voucherId: id },
      annotations: mexe,
    },
    seguro(async ({ voucherId }: { voucherId: number }) =>
      ok(await api.post(`/shopee-promocoes/cupons/${voucherId}/apagar`, {})),
    ),
  );
}
