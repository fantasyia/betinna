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
  const leitura = { readOnlyHint: true, destructiveHint: false } as const;
  const mexe = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;
  const base = "/marketplace/dafiti/anuncios";
  const AVISO =
    'MEXE NA LOJA — só com o "pode subir" do Léo pro valor exato. Preço e estoque não passam por aqui. ';

  server.registerTool(
    "dafiti_anuncios_listar",
    {
      description:
        "Anúncios (product sets) da Dafiti, até 100 por página. busca = começo do nome (3+ letras). Somente leitura.",
      inputSchema: {
        pagina: z.number().int().min(1).optional(),
        porPagina: z.number().int().min(1).max(100).optional(),
        busca: z.string().min(3).max(100).optional(),
        status: z.string().min(1).max(30).optional(),
      },
      annotations: leitura,
    },
    seguro(async (a: Record<string, string | number | undefined>) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(a)) if (v !== undefined) q.set(k, String(v));
      return ok(await api.get(`${base}${q.toString() ? `?${q}` : ""}`));
    }),
  );

  server.registerTool(
    "dafiti_anuncio_ver",
    {
      description:
        "Um anúncio da Dafiti pelo id do product set: dados (nome, descrição, attributes por id), variações e fotos (id e posição). Somente leitura.",
      inputSchema: { id: z.number().int().positive() },
      annotations: leitura,
    },
    seguro(async ({ id }: { id: number }) => ok(await api.get(`${base}/${id}`))),
  );

  server.registerTool(
    "dafiti_revisao_ver",
    {
      description:
        "Situação da revisão de qualidade da Dafiti (approved, rejected, pending) para até 100 ids de product set, e motivos=true traz a lista de motivos de recusa. Somente leitura.",
      inputSchema: {
        ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        motivos: z.boolean().optional(),
      },
      annotations: leitura,
    },
    seguro(async ({ ids, motivos }: { ids?: number[]; motivos?: boolean }) =>
      ok(
        motivos
          ? await api.get(`${base}/motivos-recusa`)
          : await api.get(`${base}/revisao?ids=${(ids ?? []).join(",")}`),
      ),
    ),
  );

  server.registerTool(
    "dafiti_atributos_listar",
    {
      description:
        "Atributos aceitos num conjunto de atributos da Dafiti (attributeSet do anúncio), com ids e opções. Somente leitura.",
      inputSchema: { conjuntoId: z.number().int().positive() },
      annotations: leitura,
    },
    seguro(async ({ conjuntoId }: { conjuntoId: number }) =>
      ok(await api.get(`${base}/atributos/${conjuntoId}`)),
    ),
  );

  const escrever = (nome: string, rota: string, description: string, inputSchema: object) =>
    server.registerTool(
      nome,
      {
        description: AVISO + description,
        inputSchema: { id: z.number().int().positive(), ...inputSchema },
        annotations: mexe,
      },
      seguro(async ({ id, ...corpo }: { id: number }) =>
        ok(await api.post(`${base}/${id}/${rota}`, corpo)),
      ),
    );

  escrever("dafiti_nome_atualizar", "nome", "Troca só o nome. Devolve antes, depois e conferido.", {
    nome: z.string().min(1).max(255),
  });
  escrever(
    "dafiti_descricao_atualizar",
    "descricao",
    "Troca só a descrição. Devolve antes, depois e conferido.",
    { descricao: z.string().min(1).max(25000) },
  );
  escrever(
    "dafiti_atributos_atualizar",
    "atributos",
    "Troca só os atributos mandados; chave = id do atributo, valor = texto, id de opção, lista ou null para limpar. Devolve antes, depois e conferido.",
    {
      atributos: z.record(
        z.string().regex(/^\d+$/),
        z.union([
          z.string(),
          z.number().int(),
          z.array(z.number().int()),
          z.array(z.string()),
          z.null(),
        ]),
      ),
    },
  );
  escrever(
    "dafiti_foto_adicionar",
    "fotos",
    "Adiciona uma foto por link público; posicao 1 = principal (até 8). Devolve as fotos antes e depois.",
    { url: z.string().url(), posicao: z.number().int().min(1).max(8).optional() },
  );

  server.registerTool(
    "dafiti_foto_editar",
    {
      description:
        AVISO +
        "Troca a imagem (url) e/ou a posição de uma foto (fotoId de dafiti_anuncio_ver); remover=true tira a foto do anúncio. Devolve as fotos antes e depois.",
      inputSchema: {
        id: z.number().int().positive(),
        fotoId: z.number().int().positive(),
        url: z.string().url().optional(),
        posicao: z.number().int().min(1).max(8).optional(),
        remover: z.boolean().optional(),
      },
      annotations: mexe,
    },
    seguro(
      async ({
        id,
        fotoId,
        remover,
        ...corpo
      }: {
        id: number;
        fotoId: number;
        remover?: boolean;
        url?: string;
        posicao?: number;
      }) =>
        ok(
          await api.post(
            `${base}/${id}/fotos/${fotoId}${remover ? "/remover" : ""}`,
            remover ? {} : corpo,
          ),
        ),
    ),
  );
}
