/**
 * Escopo "tudo" pelo MCP (Léo, 26/10: "quero ter acesso a absolutamente TUDO
 * sendo controlado aqui pelo chat, e lá vai ser só a interface").
 *
 * Duas ferramentas cobrem o app inteiro sem uma ferramenta por tela:
 * betinna_rotas lista o que a API tem (lido dos controllers, nunca fica velho)
 * e betinna_api chama a rota. A API recusa as portas que o Léo deixou de fora
 * (integrações, token, ativar fluxo, disparar campanha, mensagem pra cliente,
 * cobrança/estorno de verdade).
 *
 * A ferramenta existir NÃO autoriza o uso: dinheiro e envio pra fora só com
 * pedido explícito do Léo. Antes de escrever, leia (GET) e confira.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import type { Ajudantes } from "./vitrine.js";

export function registrarApiTotal(server: McpServer, { ok, seguro }: Ajudantes) {
  server.registerTool(
    "betinna_rotas",
    {
      description:
        "Lista as rotas da API do Betinna que o token alcança (método, caminho, resumo) — o mapa das telas do app. " +
        "Use 'filtro' com um trecho (ex.: 'erp/ops', 'empresas', 'kits', 'pedidos'). Escopo 'tudo'.",
      inputSchema: { filtro: z.string().max(80).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    seguro(async (a: { filtro?: string }) =>
      ok(await api.get(`/rotas-api${a.filtro ? `?filtro=${encodeURIComponent(a.filtro)}` : ""}`)),
    ),
  );

  server.registerTool(
    "betinna_api",
    {
      description:
        "Chama QUALQUER rota da API do Betinna como o dono do token, na empresa do token (escopo 'tudo'). " +
        "Ache a rota com betinna_rotas; troque :id pelo valor. Antes de PUT/PATCH/DELETE, faça o GET e confira — " +
        "PUT costuma SUBSTITUIR o registro inteiro. Dinheiro (baixa, estorno, pagamento) e envio pra fora só com pedido explícito do Léo. " +
        "Ferramentas específicas (vitrine_*, erp_*, financeiro_*, kanban_*...) continuam valendo e são mais seguras quando existem.",
      inputSchema: {
        metodo: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        caminho: z
          .string()
          .min(2)
          .max(400)
          .regex(/^\/[A-Za-z0-9\-_/.:%?=&,+~]*$/, "Caminho começando com / (sem /api/v1)")
          .describe("Ex.: /erp/ops, /empresas/config, /kits/abc?x=1"),
        corpo: z.record(z.unknown()).optional().describe("JSON do corpo (POST/PUT/PATCH)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    seguro(async (a: { metodo: string; caminho: string; corpo?: Record<string, unknown> }) =>
      ok(await api.chamar(a.metodo, a.caminho.replace(/^\/api\/v[0-9]+/, ""), a.metodo === "GET" ? undefined : a.corpo)),
    ),
  );
}
