/**
 * Testar a IA de marketplace (#04 SAC, 02/11) sem caso real: conversas escritas
 * aqui passam pelo mesmo caminho da IA (base, prompt, filtro de palavra
 * proibida e de prazo de reposição). NADA é enviado nem gravado.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import type { Ajudantes } from "./vitrine.js";

export function registrarPendenciasIa(server: McpServer, { ok, seguro }: Ajudantes) {
  server.registerTool(
    "pendencias_ia_testar",
    {
      description:
        "Testa a IA de marketplace (Shopee/ML) SEM enviar nem gravar nada. Com `casos`, roda conversas de teste " +
        "(ex.: troca, defeito, peça errada, atraso) e devolve por caso: acao (responder|humano), resposta, motivo e " +
        "barradaAntes (o 1º texto barrado pelo filtro, se houve). Sem `casos`, roda nas últimas conversas REAIS. " +
        "A última mensagem de cada caso tem que ser do cliente. Até 8 casos, rodam em paralelo.",
      inputSchema: {
        casos: z
          .array(
            z.object({
              canal: z.enum(["MARKETPLACE_SHOPEE", "MARKETPLACE_ML"]),
              titulo: z.string().max(200).optional().describe("Rótulo do caso, ex.: 'Defeito ML'"),
              mensagens: z
                .array(z.object({ de: z.enum(["cliente", "loja"]), texto: z.string().min(1).max(800) }))
                .min(1)
                .max(15),
            }),
          )
          .max(8)
          .optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async (a: { casos?: unknown[] }) =>
      ok(await api.postLongo("/pendencias/ia/simular", a.casos?.length ? { casos: a.casos } : {})),
    ),
  );
}
