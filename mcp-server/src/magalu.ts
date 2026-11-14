/**
 * Magalu (Open API, 14/11): `magalu_api` — passthrough com o token OAuth da
 * empresa (Integrações → Magalu). Ler é livre; escrever só SKU e preço, com as
 * travas no servidor (estoque nunca, Full nunca, SKU novo nasce desativado).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import type { Ajudantes } from "./vitrine.js";

export function registrarMagalu(server: McpServer, { ok, seguro }: Ajudantes) {
  server.registerTool(
    "magalu_api",
    {
      description:
        "Chama a Open API do Magalu (developers.magalu.com) com o token da loja; devolve a resposta crua. metodo GET lê " +
        "QUALQUER rota de /seller/v1, /seller/v0, /v0/questions e /v0/conversations. POST/PUT/PATCH MEXEM NA LOJA — só " +
        "com o \"pode subir\" do Léo pro plano exato. Travas no servidor: escrita só em SKU (POST /seller/v1/portfolios/skus " +
        "cria — nasce active=false; PUT|PATCH /seller/v1/portfolios/skus/{sku} altera) e preço (POST|PATCH " +
        "/seller/v1/portfolios/prices/{sku} {price, list_price, normalizer, currency:'BRL', channel:{id}}); estoque " +
        "(stocks/warehouses, chave stock/quantity no corpo) é recusado — vem do Magis5; fulfillment:true (Full) recusado; " +
        "DELETE, pedido, nota, SAC, pergunta e chat não escrevem. Mapa de leitura: SKUs GET /seller/v1/portfolios/skus " +
        "(_offset, _limit, status PUBLISHED|UNPUBLISHED|...) e /seller/v1/portfolios/skus/{sku}; preço " +
        "/seller/v1/portfolios/prices/{sku}; estoque /seller/v1/portfolios/stocks/{sku}; loja /seller/v1/portfolios/me; " +
        "pedidos GET /seller/v1/orders (status, purchased_at__gte, updated_at__gte, code, _offset, _limit) e " +
        "/seller/v1/orders/{code}; entregas /seller/v1/deliveries; SAC GET /seller/v0/tickets (status, type, " +
        "updated_at_gte, order__code) e /seller/v0/tickets/{id}/messages; perguntas GET /v0/questions (status, " +
        "_offset, _limit); chat GET /v0/conversations. Valores em inteiro + normalizer (1000/100 = R$ 10,00). " +
        "Resposta da escrita: { resposta, ajustes }.",
      inputSchema: {
        metodo: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        caminho: z
          .string()
          .regex(/^\/(seller\/v[01]|v0\/(questions|conversations))(\/[A-Za-z0-9\-_.]+)*$/),
        query: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
          )
          .optional()
          .describe("Só GET: parâmetros da URL (lista vira parâmetro repetido)"),
        corpo: z
          .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
          .optional()
          .describe("Só escrita: JSON do Magalu"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    seguro(
      async ({
        metodo,
        caminho,
        query,
        corpo,
      }: {
        metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        caminho: string;
        query?: Record<string, unknown>;
        corpo?: unknown;
      }) =>
        ok(
          metodo === "GET"
            ? await api.post("/marketplace/magalu/api/ler", { caminho, query })
            : await api.post("/marketplace/magalu/api/escrever", { metodo, caminho, corpo }),
        ),
    ),
  );
}
