/**
 * Estoque de peça pronta (ERP próprio) pelo MCP (Léo, 02/11): a #01 Produto
 * lança as listas que o Léo manda ("Blusão Chumbo P- 19"). Resolve modelo ×
 * linha × cor × tamanho pelos NOMES do app — o que não bater volta em
 * `naoEncontrados` e não é lançado (nunca chuta). Grava como inventário: o
 * saldo vira o número final, com motivo, no histórico de movimentos.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import type { Ajudantes } from "./vitrine.js";

interface Saldo {
  produtoId: string;
  ativo: boolean;
  modelo: { id: string; nome: string };
  cor: { nome: string };
  linha: { nome: string };
  tamanho: { nome: string };
  fisico: number;
  reservado: number;
  /** Pedido de marketplace sem nota (Magis5). Só entra em `reservado`/`disponivel` com a chave ligada. */
  reservadoMarketplace?: number;
  disponivel: number;
}

/** minúsculas, sem acento, hífen/espaço iguais. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const item = z.object({
  modelo: z.string().min(1).describe("Nome do modelo no app (ex.: 'Moletom Canguru com Capuz') ou o id"),
  linha: z.string().min(1).describe("Regular, Plus Size ou Infantil"),
  cor: z.string().min(1).describe("Nome da cor NO APP (ex.: Cinza-Escuro, não 'Chumbo')"),
  tamanho: z.string().min(1),
  quantidade: z.number().int().min(0).max(1_000_000),
});

export function registrarEstoque(server: McpServer, { ok, seguro }: Ajudantes) {
  server.registerTool(
    "erp_estoque_ver",
    {
      description:
        "Estoque de peça pronta por variação (físico, reservado, disponível) de UM modelo, por nome ou id. " +
        "reservadoMarketplace = peças de pedido de marketplace (Magis5) ainda sem nota; só desconta do " +
        "disponível quando a reserva até a NF está ligada (GET /magis5/estoque mostra a chave). Somente leitura.",
      inputSchema: { modelo: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async (a: { modelo: string }) => {
      const saldos = await api.get<Saldo[]>("/erp/estoque/saldos");
      const alvo = norm(a.modelo);
      const xs = saldos.filter((s) => s.modelo.id === a.modelo || norm(s.modelo.nome) === alvo);
      return ok(
        xs.map((s) => ({
          linha: s.linha.nome,
          cor: s.cor.nome,
          tamanho: s.tamanho.nome,
          fisico: s.fisico,
          reservado: s.reservado,
          reservadoMarketplace: s.reservadoMarketplace ?? 0,
          disponivel: s.disponivel,
          ativo: s.ativo,
        })),
      );
    }),
  );

  server.registerTool(
    "erp_estoque_lancar",
    {
      description:
        "MEXE NO ESTOQUE do app (com motivo no histórico). Lança uma lista de peças por modelo × linha × cor × " +
        "tamanho, pelos NOMES do app. modo 'somar' = soma ao físico atual (peças que chegaram); 'contagem' = o " +
        "número vira o físico (inventário). Use os nomes do app: Chumbo = Cinza-Escuro, Mescla = Cinza-Claro, " +
        "Rosa = Rosa-Claro, Militar = Verde-Militar, Marinho = Azul-Marinho; Blusão = Moletom Canguru com Capuz, " +
        "Calça = Calça de Moletom, Camiseta UV = Camiseta UV Manga Longa. O que não bater volta em " +
        "naoEncontrados e NÃO é lançado. simular=true mostra o plano sem gravar — rode antes.",
      inputSchema: {
        itens: z.array(item).min(1).max(500),
        modo: z.enum(["somar", "contagem"]),
        motivo: z.string().min(3).max(300).describe("Ex.: 'Estoque recebido (Léo, 05/11)'"),
        simular: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    seguro(
      async (a: {
        itens: Array<z.infer<typeof item>>;
        modo: "somar" | "contagem";
        motivo: string;
        simular?: boolean;
      }) => {
        const saldos = await api.get<Saldo[]>("/erp/estoque/saldos");
        // A mesma variação repetida na lista soma (duas listas do Léo).
        const porProduto = new Map<string, { s: Saldo; q: number }>();
        const naoEncontrados: string[] = [];
        for (const i of a.itens) {
          const m = norm(i.modelo);
          const achados = saldos.filter(
            (s) =>
              s.ativo &&
              (s.modelo.id === i.modelo || norm(s.modelo.nome) === m) &&
              norm(s.linha.nome) === norm(i.linha) &&
              norm(s.cor.nome) === norm(i.cor) &&
              norm(s.tamanho.nome) === norm(i.tamanho),
          );
          const rotulo = `${i.modelo} · ${i.linha} · ${i.cor} · ${i.tamanho}`;
          if (achados.length !== 1) {
            naoEncontrados.push(`${rotulo} (${achados.length ? "mais de uma" : "não existe no app"})`);
            continue;
          }
          const atual = porProduto.get(achados[0].produtoId);
          porProduto.set(achados[0].produtoId, { s: achados[0], q: (atual?.q ?? 0) + i.quantidade });
        }
        const plano = [...porProduto.values()].map(({ s, q }) => ({
          produtoId: s.produtoId,
          variacao: `${s.modelo.nome} · ${s.linha.nome} · ${s.cor.nome} · ${s.tamanho.nome}`,
          antes: s.fisico,
          depois: a.modo === "somar" ? s.fisico + q : q,
        }));
        const resumo = {
          variacoes: plano.length,
          pecasDepois: plano.reduce((t, p) => t + p.depois, 0),
          naoEncontrados,
          plano: plano.map(({ variacao, antes, depois }) => ({ variacao, antes, depois })),
        };
        if (a.simular || plano.length === 0) return ok({ simulado: true, ...resumo });
        const r = await api.post("/erp/estoque/inventario", {
          contagens: plano.map((p) => ({ produtoId: p.produtoId, contado: p.depois })),
          motivo: a.motivo,
        });
        return ok({ gravado: r, ...resumo });
      },
    ),
  );
}
