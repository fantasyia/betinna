/**
 * LEITURA de PEDIDOS e FINANCEIRO (prefixos pedidos_ e financeiro_).
 *
 * SOMENTE LEITURA — o guard da API só deixa GET nesses escopos:
 *   - "pedidos"    → /pedidos (lista e detalhe; traz dados do cliente = PII)
 *   - "financeiro" → /financeiro (títulos a pagar/receber, baixas, fluxo de
 *     caixa, contas). Exige dono ADMIN/DIRECTOR e o financeiro ligado na
 *     empresa (senão a API responde 422).
 * Nada aqui cria, edita, baixa, cancela ou paga — isso é de gente, na tela.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import { seg } from "./caminho.js";
import type { Ajudantes } from "./vitrine.js";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data AAAA-MM-DD");
const STATUS_PEDIDO = [
  "RASCUNHO",
  "AGUARDANDO_APROVACAO",
  "AGUARDANDO_LIBERACAO",
  "ENVIADO_ERP",
  "PAGO",
  "EM_SEPARACAO",
  "ENVIADO",
  "ENTREGUE",
  "CANCELADO",
] as const;

/** Monta a query string só com o que veio (sem "undefined" na URL). */
function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function registrarLeituraErp(server: McpServer, { ok, seguro }: Ajudantes) {
  const leitura = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

  // ─── Pedidos ─────────────────────────────────────────────────────────────

  server.registerTool(
    "pedidos_listar",
    {
      description:
        "Lista PEDIDOS da empresa (mais recentes primeiro), com filtros. Somente leitura (escopo 'pedidos'). " +
        "Traz cliente, total, status e origem (VITRINE, REP, SITE…). Para os itens, use pedido_ver.",
      inputSchema: {
        status: z.enum(STATUS_PEDIDO).optional(),
        busca: z.string().max(100).optional().describe("Número, cliente…"),
        de: data.optional().describe("Criado a partir de (AAAA-MM-DD)"),
        ate: data.optional().describe("Criado até (AAAA-MM-DD)"),
        pagina: z.number().int().min(1).max(500).optional(),
        porPagina: z.number().int().min(1).max(100).optional(),
      },
      annotations: leitura,
    },
    seguro(async (a: { status?: string; busca?: string; de?: string; ate?: string; pagina?: number; porPagina?: number }) =>
      ok(
        await api.get(
          `/pedidos${qs({
            status: a.status,
            search: a.busca,
            dataInicio: a.de,
            dataFim: a.ate,
            page: a.pagina,
            limit: a.porPagina ?? 50,
          })}`,
        ),
      ),
    ),
  );

  server.registerTool(
    "pedido_ver",
    {
      description: "UM pedido inteiro: cliente, itens (produto, quantidade, preço), totais, status e histórico. Somente leitura.",
      inputSchema: { pedidoId: z.string().min(1) },
      annotations: leitura,
    },
    seguro(async ({ pedidoId }: { pedidoId: string }) => ok(await api.get(`/pedidos/${seg(pedidoId)}`))),
  );

  // ─── Financeiro ──────────────────────────────────────────────────────────

  server.registerTool(
    "financeiro_titulos_listar",
    {
      description:
        "Contas a RECEBER ou a PAGAR, com filtros, e os totais do topo (a receber/pagar, vencido). Somente leitura " +
        "(escopo 'financeiro'). situacao: ABERTO (inclui parcial), VENCIDO, QUITADO, CANCELADO ou TODOS. " +
        "Filtrar por pedidoId traz as parcelas a receber daquele pedido (cartão parcelado = 1 por parcela).",
      inputSchema: {
        tipo: z.enum(["RECEBER", "PAGAR"]),
        situacao: z.enum(["ABERTO", "VENCIDO", "QUITADO", "CANCELADO", "TODOS"]).optional(),
        de: data.optional().describe("Vencimento a partir de"),
        ate: data.optional().describe("Vencimento até"),
        busca: z.string().max(100).optional().describe("Descrição ou contato"),
        pedidoId: z.string().optional(),
        opId: z.string().optional().describe("Pagamentos da facção de uma OP"),
      },
      annotations: leitura,
    },
    seguro(async (a: Record<string, string | undefined>) =>
      ok(
        await api.get(
          `/financeiro/titulos${qs({
            tipo: a.tipo,
            situacao: a.situacao,
            de: a.de,
            ate: a.ate,
            busca: a.busca,
            pedidoId: a.pedidoId,
            opId: a.opId,
          })}`,
        ),
      ),
    ),
  );

  server.registerTool(
    "financeiro_titulo_ver",
    {
      description: "UM título (conta a pagar/receber) com valor, pago, saldo, vencimento, situação e as BAIXAS (data, valor, conta, forma). Somente leitura.",
      inputSchema: { tituloId: z.string().min(1) },
      annotations: leitura,
    },
    seguro(async ({ tituloId }: { tituloId: string }) => ok(await api.get(`/financeiro/titulos/${seg(tituloId)}`))),
  );

  server.registerTool(
    "financeiro_fluxo_caixa",
    {
      description: "Fluxo de caixa: realizado × previsto por dia, semana ou mês, no intervalo. Somente leitura.",
      inputSchema: {
        de: data,
        ate: data,
        agrupar: z.enum(["dia", "semana", "mes"]).optional(),
      },
      annotations: leitura,
    },
    seguro(async (a: { de: string; ate: string; agrupar?: string }) =>
      ok(await api.get(`/financeiro/fluxo${qs({ de: a.de, ate: a.ate, agrupar: a.agrupar })}`)),
    ),
  );

  server.registerTool(
    "financeiro_contas_listar",
    {
      description: "Contas (Banco, Asaas…) com o saldo atual de cada uma. Somente leitura.",
      inputSchema: {},
      annotations: leitura,
    },
    seguro(async () => ok(await api.get("/financeiro/contas"))),
  );
}
