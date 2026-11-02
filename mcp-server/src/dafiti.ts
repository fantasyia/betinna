/**
 * Dafiti (Seller Center) — leitura com a chave do app (#01, 02/11). A
 * reposição semanal do galpão usava credencial própria fora do app e parou
 * com 401 quando a chave foi trocada: com isto, a chave é uma só, a do app.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import type { Ajudantes } from "./vitrine.js";

export function registrarDafiti(server: McpServer, { ok, seguro }: Ajudantes) {
  server.registerTool(
    "dafiti_consultar",
    {
      description:
        "Leitura no Seller Center da Dafiti com a chave cadastrada no app (Integrações → Dafiti). Caminhos: " +
        "/v2/fulfillment-products/stock-on-hand (estoque do galpão: sellerSku, sku, name, onlineStock, " +
        "replenishmentAlert) · /v2/purchase-orders (envios pro galpão, status RECEIVED etc.) · /v2/orders (pedidos: " +
        "limit/offset e os filtros section, dateStart, updateDateStart) · /v2/orders-counters (contagem por status). " +
        "todas=true junta todas as páginas (só estoque e envios). Não muda nada na Dafiti.",
      inputSchema: {
        caminho: z.enum([
          "/v2/fulfillment-products/stock-on-hand",
          "/v2/purchase-orders",
          "/v2/orders",
          "/v2/orders-counters",
        ]),
        page: z.number().int().min(0).optional(),
        size: z.number().int().min(1).max(100).optional(),
        todas: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        section: z.string().optional().describe("Ex.: status_delivered, status_pending_all"),
        dateStart: z.string().optional().describe("Criação a partir de (AAAA-MM-DD)"),
        updateDateStart: z.string().optional().describe("Item atualizado a partir de (AAAA-MM-DD)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async (a: Record<string, string | number | boolean | undefined> & { caminho: string }) => {
      const q = new URLSearchParams({ caminho: a.caminho });
      for (const [k, v] of Object.entries(a)) {
        if (k === "caminho" || v === undefined || v === false) continue;
        q.set(k, k === "todas" ? "1" : String(v));
      }
      return ok(await api.get(`/marketplace/dafiti/consultar?${q}`));
    }),
  );
}
