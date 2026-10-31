/**
 * Oferta Relâmpago da Shopee (escopo "shopee-promocoes", Léo 31/10).
 *
 * Usa o app do Betinna (o único com o módulo shop_flash_sale). Ler é livre;
 * CRIAR, PÔR/EDITAR ITEM e ATIVAR mexem na loja de verdade — só com o
 * "pode subir" do Léo pra aquela oferta. Antes de pôr item, leia o estoque
 * com shopee_anuncio_modelos (regra da loja: estoque na campanha = min(10, estoque)).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
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
}
