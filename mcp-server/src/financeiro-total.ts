/**
 * Financeiro COMPLETO pelo MCP (escopo "financeiro-total", Léo 26/10): o
 * Orquestrador dá baixa, estorna, edita e cancela título, lança A RECEBER,
 * mexe em recorrências, categorias e contas — quando o Léo pedir.
 *
 * Antes de baixar/cancelar/estornar, confira o título com financeiro_titulo_ver
 * (valor, saldo, situação, baixas). Não existe rota de transferência entre
 * contas nem de anexo: transferência = baixa numa conta + lançamento na outra,
 * ou ajuste pelo saldo inicial da conta (financeiro_conta_editar).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import { seg } from "./caminho.js";
import type { Ajudantes } from "./vitrine.js";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data AAAA-MM-DD");
const valor = z.number().positive().max(100_000_000).describe("Em reais (ex.: 104.9)");
const tipo = z.enum(["RECEBER", "PAGAR"]);
const forma = z.enum(["PIX", "CARTAO", "BOLETO", "DINHEIRO", "TRANSFERENCIA", "OUTRA"]);
const tipoConta = z.enum(["BANCO", "ASAAS", "DINHEIRO", "OUTRA"]);

export function registrarFinanceiroTotal(server: McpServer, { ok, seguro }: Ajudantes) {
  const cria = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
  const edita = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
  const mexe = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

  server.registerTool(
    "financeiro_titulo_criar",
    {
      description:
        "Lança um título A RECEBER ou A PAGAR (escopo 'financeiro-total'). parcelas>1 cria N lançamentos mensais com o valor POR parcela. " +
        "Confira antes com financeiro_titulos_listar se ele já não existe (não duplique).",
      inputSchema: {
        tipo,
        descricao: z.string().min(2).max(200),
        valor,
        vencimento: data.describe("Vencimento (AAAA-MM-DD)"),
        categoriaId: z.string().max(40).optional().describe("De financeiro_categorias_listar (do MESMO tipo)"),
        contatoNome: z.string().max(120).optional().describe("Cliente (receber) ou fornecedor (pagar)"),
        observacoes: z.string().max(1000).optional(),
        parcelas: z.number().int().min(1).max(60).optional(),
      },
      annotations: cria,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/financeiro/titulos", a))),
  );

  server.registerTool(
    "financeiro_titulo_editar",
    {
      description:
        "Edita um título aberto (descrição, valor — só sem baixa —, vencimento, categoria, contato, observações). " +
        "Mande TODOS os campos (é substituição). Escopo 'financeiro-total'.",
      inputSchema: {
        tituloId: z.string().max(40),
        descricao: z.string().min(2).max(200),
        valor,
        vencimento: data,
        categoriaId: z.string().max(40).optional(),
        contatoNome: z.string().max(120).optional(),
        observacoes: z.string().max(1000).optional(),
      },
      annotations: edita,
    },
    seguro(async ({ tituloId, ...a }: { tituloId: string } & Record<string, unknown>) =>
      ok(await api.put(`/financeiro/titulos/${seg(tituloId)}`, a)),
    ),
  );

  server.registerTool(
    "financeiro_titulo_cancelar",
    {
      description:
        "Cancela um título SEM baixa (com baixa o sistema recusa — estorne antes). Escopo 'financeiro-total'. Só com pedido do Léo.",
      inputSchema: { tituloId: z.string().max(40) },
      annotations: mexe,
    },
    seguro(async ({ tituloId }: { tituloId: string }) =>
      ok(await api.post(`/financeiro/titulos/${seg(tituloId)}/cancelar`, {})),
    ),
  );

  server.registerTool(
    "financeiro_baixa",
    {
      description:
        "Dá baixa num título — total (valor = saldo) ou PARCIAL (valor menor). Precisa da data e da conta (financeiro_contas_listar). " +
        "Juros/desconto: baixe o valor efetivamente pago e explique em 'observacao'. Escopo 'financeiro-total'.",
      inputSchema: {
        tituloId: z.string().max(40),
        valor,
        data: data.describe("Data do pagamento/recebimento (AAAA-MM-DD)"),
        contaId: z.string().max(40).describe("De financeiro_contas_listar"),
        forma: forma.optional(),
        observacao: z.string().max(300).optional(),
      },
      annotations: mexe,
    },
    seguro(async ({ tituloId, ...a }: { tituloId: string } & Record<string, unknown>) =>
      ok(await api.post(`/financeiro/titulos/${seg(tituloId)}/baixas`, a)),
    ),
  );

  server.registerTool(
    "financeiro_baixas_em_massa",
    {
      description:
        "Quita VÁRIOS títulos pelo saldo que falta, na mesma conta e data. Escopo 'financeiro-total'. Liste antes e confirme os ids com o Léo.",
      inputSchema: {
        ids: z.array(z.string().max(40)).min(1).max(500),
        data,
        contaId: z.string().max(40),
        forma: forma.optional(),
      },
      annotations: mexe,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/financeiro/baixas-em-massa", a))),
  );

  server.registerTool(
    "financeiro_baixa_estornar",
    {
      description:
        "Desfaz uma baixa (fica no histórico como estornada; o título volta a ter saldo). O id da baixa vem de financeiro_titulo_ver. Escopo 'financeiro-total'.",
      inputSchema: { baixaId: z.string().max(40) },
      annotations: mexe,
    },
    seguro(async ({ baixaId }: { baixaId: string }) =>
      ok(await api.post(`/financeiro/baixas/${seg(baixaId)}/estornar`, {})),
    ),
  );

  server.registerTool(
    "financeiro_recorrencia_criar",
    {
      description:
        "Cria uma recorrência A RECEBER ou A PAGAR (todo mês no dia X). Já gera os lançamentos deste mês e do próximo. " +
        "Confira antes com financeiro_recorrencias_listar. Escopo 'financeiro-total'.",
      inputSchema: {
        tipo,
        descricao: z.string().min(2).max(200),
        valor,
        dia: z.number().int().min(1).max(31),
        categoriaId: z.string().max(40).optional(),
        contatoNome: z.string().max(120).optional(),
      },
      annotations: cria,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/financeiro/recorrencias", a))),
  );

  server.registerTool(
    "financeiro_recorrencia_editar",
    {
      description:
        "Edita ou pausa (ativo=false) uma recorrência A RECEBER ou A PAGAR. Mande TODOS os campos (é substituição). Escopo 'financeiro-total'.",
      inputSchema: {
        recorrenciaId: z.string().max(40),
        tipo,
        descricao: z.string().min(2).max(200),
        valor,
        dia: z.number().int().min(1).max(31),
        categoriaId: z.string().max(40).optional(),
        contatoNome: z.string().max(120).optional(),
        ativo: z.boolean().optional(),
      },
      annotations: edita,
    },
    seguro(async ({ recorrenciaId, ...a }: { recorrenciaId: string } & Record<string, unknown>) =>
      ok(await api.put(`/financeiro/recorrencias/${seg(recorrenciaId)}`, a)),
    ),
  );

  server.registerTool(
    "financeiro_categoria_criar",
    {
      description:
        "Cria categoria de RECEITA ou DESPESA. Confira antes com financeiro_categorias_listar. Escopo 'financeiro-total'.",
      inputSchema: { tipo, nome: z.string().min(2).max(60) },
      annotations: cria,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/financeiro/categorias", a))),
  );

  server.registerTool(
    "financeiro_categoria_editar",
    {
      description: "Renomeia ou desativa (ativo=false) uma categoria. Escopo 'financeiro-total'.",
      inputSchema: {
        categoriaId: z.string().max(40),
        tipo,
        nome: z.string().min(2).max(60),
        ativo: z.boolean().optional(),
      },
      annotations: edita,
    },
    seguro(async ({ categoriaId, ...a }: { categoriaId: string } & Record<string, unknown>) =>
      ok(await api.put(`/financeiro/categorias/${seg(categoriaId)}`, a)),
    ),
  );

  server.registerTool(
    "financeiro_conta_criar",
    {
      description:
        "Cria uma conta de dinheiro (Banco, Asaas, Dinheiro, Outra) com saldo inicial. Escopo 'financeiro-total'.",
      inputSchema: {
        nome: z.string().min(2).max(60),
        tipo: tipoConta,
        saldoInicial: z.number().min(-100_000_000).max(100_000_000).optional(),
      },
      annotations: cria,
    },
    seguro(async (a: Record<string, unknown>) => ok(await api.post("/financeiro/contas", a))),
  );

  server.registerTool(
    "financeiro_conta_editar",
    {
      description:
        "Edita uma conta: nome, tipo, saldo inicial (é o AJUSTE de saldo) e ativo=false desativa. Mande TODOS os campos. Escopo 'financeiro-total'.",
      inputSchema: {
        contaId: z.string().max(40),
        nome: z.string().min(2).max(60),
        tipo: tipoConta,
        saldoInicial: z.number().min(-100_000_000).max(100_000_000),
        ativo: z.boolean().optional(),
      },
      annotations: mexe,
    },
    seguro(async ({ contaId, ...a }: { contaId: string } & Record<string, unknown>) =>
      ok(await api.put(`/financeiro/contas/${seg(contaId)}`, a)),
    ),
  );
}
