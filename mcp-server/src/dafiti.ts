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
        "replenishmentAlert) · /v2/purchase-orders (envios pro galpão, status RECEIVED etc.). todas=true junta todas as páginas (devolve total + a lista). Não muda nada na Dafiti.",
      inputSchema: {
        caminho: z.enum([
          "/v2/fulfillment-products/stock-on-hand",
          "/v2/purchase-orders",
        ]),
        page: z.number().int().min(0).optional(),
        size: z.number().int().min(1).max(100).optional(),
        todas: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async (a: { caminho: string; page?: number; size?: number; todas?: boolean }) => {
      const q = new URLSearchParams({ caminho: a.caminho });
      if (a.page !== undefined) q.set("page", String(a.page));
      if (a.size !== undefined) q.set("size", String(a.size));
      if (a.todas) q.set("todas", "1");
      return ok(await api.get(`/marketplace/dafiti/consultar?${q}`));
    }),
  );
}
