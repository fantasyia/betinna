/**
 * Anúncios da Shein (#05, Léo 01/11). Hierarquia: SPU (modelo) → SKC (cor) →
 * SKU (tamanho). Ler é livre; MUDAR PREÇO e EDITAR mexem na loja de verdade —
 * só com o "pode subir" do Léo pro plano exato. Estoque fica fora (Léo).
 * Rotas em /marketplace/anuncios/shein (a api chama a Shein pelo IP liberado).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "./api.js";
import { seg } from "./caminho.js";
import type { Ajudantes } from "./vitrine.js";

export function registrarSheinAnuncios(server: McpServer, { ok, seguro }: Ajudantes) {
  const leitura = { readOnlyHint: true, destructiveHint: false } as const;
  const mexe = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

  server.registerTool(
    "shein_anuncios_listar",
    {
      description:
        "Anúncios APROVADOS da loja Shein: spuName → skcName (cor) → skuCode (tamanho), só os códigos. " +
        "Detalhe (cor, tamanho, SKU do vendedor, preço, no ar) com shein_anuncio_ver. A Shein não diz o " +
        "total: use todas=true pra trazer TODAS as páginas (com totalCores e totalAnuncios). Somente leitura.",
      inputSchema: {
        pagina: z.number().int().min(1).optional(),
        porPagina: z.number().int().min(1).max(100).optional(),
        horas: z.number().int().min(1).optional().describe("Só os atualizados nas últimas N horas"),
        todas: z.boolean().optional().describe("Todas as páginas de uma vez, com o total"),
      },
      annotations: leitura,
    },
    seguro(async (a: { pagina?: number; porPagina?: number; horas?: number; todas?: boolean }) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(a)) if (v !== undefined && v !== false) q.set(k, String(v));
      return ok(await api.get(`/marketplace/anuncios/shein?${q}`));
    }),
  );

  server.registerTool(
    "shein_anuncio_ver",
    {
      description:
        "Um anúncio da Shein (spuName): nome, e por cor (skcName) as variações com skuCode, SKU do vendedor, " +
        "tamanho, à venda, preço e promocional por site, e se está no ar. cru=true devolve a resposta inteira " +
        "da Shein (IDs de atributo, imagens) — use antes de editar. Somente leitura.",
      inputSchema: { spuName: z.string().min(1), cru: z.boolean().optional() },
      annotations: leitura,
    },
    seguro(async (a: { spuName: string; cru?: boolean }) =>
      ok(await api.get(`/marketplace/anuncios/shein/${seg(a.spuName)}${a.cru ? "?cru=1" : ""}`)),
    ),
  );

  server.registerTool(
    "shein_preco_atualizar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pro plano exato. Muda o preço por SKU (skuCode), até 100 " +
        "por chamada; vários tamanhos da MESMA cor vão juntos na mesma chamada. Na Shein BR só existe UM preço " +
        "(o de venda): mande SÓ o preco. Se mandar precoPromocional, ELE vira o preço de venda e o cheio é " +
        "descartado (testado em 02/11) — não há \"de/por\" pelo price/save. " +
        "Site padrão shein-br, moeda BRL. Aumento de preço pede motivoAumento (1 custo · 2 logística · 3 fim de " +
        "campanha · 4 outros · 5 regra logística) e pode ser barrado por campanha. Devolve aceitos, emRevisao " +
        "(a Shein aprova depois; não mande outro preço pro mesmo SKC até sair) e recusados com o motivo.",
      inputSchema: {
        itens: z
          .array(
            z.object({
              skuCode: z.string().min(1),
              preco: z.number().positive().describe("Preço cheio em reais"),
              precoPromocional: z
                .number()
                .positive()
                .nullable()
                .optional()
                .describe("Normalmente NÃO mande (Shein BR: ele vira o preço de venda)"),
              site: z.string().optional(),
              moeda: z.string().length(3).optional(),
              motivoAumento: z.number().int().min(1).max(5).optional(),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: mexe,
    },
    seguro(async (a: { itens: unknown[] }) => ok(await api.post("/marketplace/anuncios/shein/preco", a))),
  );

  server.registerTool(
    "shein_anuncio_ficha",
    {
      description:
        "Ficha de um anúncio da Shein (spuName) no formato das rotas de edição: título, descrição, atributos do " +
        "produto (sem cor e tamanho), tabela de medidas, fotos do anúncio e fotos por cor (skcName). Somente leitura.",
      inputSchema: { spuName: z.string().min(1) },
      annotations: leitura,
    },
    seguro(async (a: { spuName: string }) =>
      ok(await api.get(`/marketplace/anuncios/shein/${seg(a.spuName)}/ficha`)),
    ),
  );

  server.registerTool(
    "shein_revisao_ver",
    {
      description:
        "Situação da revisão da Shein de um anúncio (documentState: 1 pendente, 2 aprovado, 3 recusado, " +
        "-1 aceitação falhou, 4 retirado, 5 apelação) com failedReason. versao = a devolvida pela edição. Somente leitura.",
      inputSchema: { spuName: z.string().min(1), versao: z.string().min(1).max(60).optional() },
      annotations: leitura,
    },
    seguro(async (a: { spuName: string; versao?: string }) =>
      ok(
        await api.get(
          `/marketplace/anuncios/shein/${seg(a.spuName)}/revisao${a.versao ? `?versao=${encodeURIComponent(a.versao)}` : ""}`,
        ),
      ),
    ),
  );

  const editar = (nome: string, rota: string, description: string, inputSchema: object) =>
    server.registerTool(
      nome,
      {
        description:
          `MEXE NA LOJA — só com o "pode subir" do Léo pro valor exato. ${description} Estoque e preço são recusados. ` +
          "A Shein revisa: devolve antes, depois, conferido, enviado, versao e bloqueios; o depois só muda depois da " +
          "aprovação — acompanhe com shein_revisao_ver.",
        inputSchema: { spuName: z.string().min(1), ...inputSchema },
        annotations: mexe,
      },
      seguro(async ({ spuName, ...corpo }: { spuName: string }) =>
        ok(await api.post(`/marketplace/anuncios/shein/${seg(spuName)}/${rota}`, corpo)),
      ),
    );

  server.registerTool(
    "shein_video_converter",
    {
      description:
        "Passo 1 do vídeo na Shein: manda um MP4 (link público que termina em .mp4, até 100 MB, sem marca d'água) " +
        "pra Shein converter. NÃO mexe no anúncio. Devolve a tarefa; se o mesmo link já foi convertido na semana, já vem a url.",
      inputSchema: { url: z.string().url().max(1000) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    seguro(async (a: { url: string }) =>
      ok(await api.post("/marketplace/anuncios/shein/video/converter", { url: a.url })),
    ),
  );

  server.registerTool(
    "shein_video_situacao",
    {
      description:
        "Passo 2 do vídeo na Shein: situação da conversão (pendente, pronto com a url convertida, ou falhou com o motivo). Somente leitura.",
      inputSchema: { tarefa: z.string().min(6).max(80) },
      annotations: leitura,
    },
    seguro(async (a: { tarefa: string }) =>
      ok(await api.get(`/marketplace/anuncios/shein/video/tarefa/${seg(a.tarefa)}`)),
    ),
  );

  editar(
    "shein_video_atualizar",
    "video",
    "Passo 3 do vídeo: grava no anúncio a url JÁ CONVERTIDA (shein_video_situacao → url). Um vídeo por site (padrão shein-br).",
    {
      url: z.string().url().max(1000),
      sites: z.array(z.string().min(1).max(30)).min(1).max(10).optional(),
    },
  );

  editar(
    "shein_plano_atualizar",
    "plano",
    "Título, descrição, atributos ({trocar, remover}) e tabela numa EDIÇÃO SÓ: a Shein trava o anúncio enquanto uma revisão está aberta, então mande tudo junto. Mande só o que muda. Recusa se o anúncio já estiver em revisão.",
    {
      titulo: z.string().min(1).max(1000).optional(),
      descricao: z.string().min(1).max(5000).optional(),
      atributos: z
        .object({
          trocar: z
            .array(
              z.object({
                attribute_id: z.number().int().positive(),
                attribute_value_id: z.number().int().positive().optional(),
                attribute_extra_value: z.string().min(1).max(200).optional(),
              }),
            )
            .max(100)
            .optional(),
          remover: z.array(z.number().int().positive()).max(100).optional(),
        })
        .optional(),
      tabela: z.array(z.record(z.string(), z.unknown())).min(1).max(2000).optional(),
    },
  );
  editar("shein_titulo_atualizar", "titulo", "Troca só o título (pt-br).", {
    titulo: z.string().min(1).max(1000),
  });
  editar("shein_descricao_atualizar", "descricao", "Troca só a descrição (pt-br, sem emoji).", {
    descricao: z.string().min(1).max(5000),
  });
  editar(
    "shein_atributos_atualizar",
    "atributos",
    "Troca valores de atributos do produto e remove atributos; o resto da ficha vai igual. Atributo trocado " +
      "entra só com os valores mandados (multisseleção: um item por valor). IDs em shein_anuncio_ficha e " +
      "shein_consultar query-attribute-template.",
    {
      trocar: z
        .array(
          z.object({
            attribute_id: z.number().int().positive(),
            attribute_value_id: z.number().int().positive().optional(),
            attribute_extra_value: z.string().min(1).max(200).optional(),
          }),
        )
        .max(100)
        .optional(),
      remover: z.array(z.number().int().positive()).max(100).optional(),
    },
  );
  editar(
    "shein_tabela_atualizar",
    "tabela",
    "Troca a tabela de medidas INTEIRA: tabela = size_attribute_list da Shein (attribute_id, attribute_extra_value, " +
      "relate_sale_attribute_id, relate_sale_attribute_value_id).",
    { tabela: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) },
  );
  editar(
    "shein_fotos_atualizar",
    "fotos",
    "Troca as fotos do anúncio ou, com cor = skcName, as de uma cor; a lista vai inteira. Link de fora é " +
      "convertido pela Shein antes (transform-pic). tipo: 1 principal, 2 detalhe, 5 quadrada, 6 bloco de cor, 7 página.",
    {
      cor: z.string().min(1).max(60).optional(),
      imagens: z
        .array(
          z.object({
            url: z.string().url(),
            tipo: z.union([z.literal(1), z.literal(2), z.literal(5), z.literal(6), z.literal(7)]),
            ordem: z.number().int().min(1).max(50),
          }),
        )
        .min(1)
        .max(50),
    },
  );

  server.registerTool(
    "shein_anuncio_editar",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pro plano exato. Edição PARCIAL de um anúncio aprovado " +
        "(/goods/product/partialEdit), corpo no formato da Shein (snake_case): spu_name obrigatório + só o que " +
        "muda. Casos: (1) mudar SKU do vendedor: skc_list[{skc_name, sku_list[{sku_code, supplier_sku}]}]; " +
        "(2) NOVA COR: skc_list[{sale_attribute{attribute_id, attribute_value_id}, image_info, sku_list completa " +
        "com sale_attribute_list, price_info_list{base_price, currency:'BRL', sub_site:'shein-br'}, " +
        "stock_info_list, supplier_sku, peso/medidas}]; (3) NOVO TAMANHO: skc_list[{skc_name, sku_list[novo]}] " +
        "+ size_attribute_list completa se o anúncio tiver tabela de medidas. Lista (object[]) editada vai " +
        "INTEIRA. Foto precisa ser link da Shein: converta com shein_consultar /open-api/goods/transform-pic. " +
        "IDs de atributo: shein_anuncio_ver cru=true e shein_consultar query-attribute-template. A Shein REVISA " +
        "a edição (acompanhe com query-document-state); a resposta traz pre_valid_result quando barra.",
      inputSchema: {
        corpo: z
          .object({ spu_name: z.string().min(1) })
          .passthrough()
          .describe("Corpo do partialEdit, no formato da documentação da Shein"),
      },
      annotations: mexe,
    },
    seguro(async (a: { corpo: Record<string, unknown> }) =>
      ok(await api.post("/marketplace/anuncios/shein/editar", a.corpo)),
    ),
  );

  server.registerTool(
    "shein_escrever",
    {
      description:
        "MEXE NA LOJA — só com o \"pode subir\" do Léo pro plano exato. Escritas de campanha e preço sugerido, " +
        "corpo no formato da documentação da Shein: /open-api/campaigns/register-campaign (inscrever: activityId + " +
        "goodsInfoList com skc, estoque e preço/desconto por SKU e site — leia antes registrable-product-list) · " +
        "/open-api/campaigns/cancel-registration · /open-api/goods-recommend-retail-price/batch-save (preço de " +
        "varejo sugerido, até 10 SKC; SOBRESCREVE tudo do SKC — mande todos os SKUs; leia antes a regra e o atual; " +
        "passa por revisão: acompanhe em goods-recommend-retail-price-audit/search). Devolve a resposta da Shein " +
        "(ex.: success_list / failed_list com o motivo).",
      inputSchema: {
        caminho: z.enum([
          "/open-api/campaigns/register-campaign",
          "/open-api/campaigns/cancel-registration",
          "/open-api/goods-recommend-retail-price/batch-save",
        ]),
        corpo: z.record(z.unknown()),
      },
      annotations: mexe,
    },
    seguro(async (a: { caminho: string; corpo: Record<string, unknown> }) =>
      ok(await api.post("/marketplace/anuncios/shein/escrever", { caminho: a.caminho, corpo: a.corpo })),
    ),
  );

  server.registerTool(
    "shein_consultar",
    {
      description:
        "Consulta de LEITURA na Open API da Shein (não muda a loja), só nos caminhos liberados: " +
        "/open-api/goods/query-attribute-template (atributos da categoria, IDs de cor/tamanho) · " +
        "query-publish-fill-in-standard (regras de publicação) · query-site-list · query-category-tree · " +
        "searchProduct (inclui trava de preço por campanha) · query-document-state (revisão da edição) · " +
        "product/check-supplierSku-repeated · product/check-edit-permission · " +
        "get-custom-attribute-permission-config · get-associated-attribute-rules · transform-pic (converte " +
        "link de foto pro formato da Shein) · /open-api/goods-specs/check-modify-permission e " +
        "/open-api/goods-specs/modify-logs/search. CAMPANHAS: /open-api/campaigns/campaign-list (abertas) · " +
        "campaign-detail · registrable-product-list (elegíveis) · registration-records (inscrições). PREÇO DE " +
        "VAREJO SUGERIDO (o \"de R$\" riscado): /open-api/goods-recommend-retail-price/search (atual por SKU) · " +
        "/open-api/goods/query-recommend-retail-price-rule (regras) · " +
        "/open-api/goods-recommend-retail-price-audit/search (revisão). Corpo no formato da documentação da Shein " +
        "(open.sheincorp.com → API Documentation → Marketing Campaign Registration / Price).",
      inputSchema: {
        caminho: z.string().min(1).describe("Ex.: /open-api/goods/query-attribute-template"),
        corpo: z.record(z.unknown()).optional(),
      },
      annotations: leitura,
    },
    seguro(async (a: { caminho: string; corpo?: Record<string, unknown> }) =>
      ok(await api.post("/marketplace/anuncios/shein/consultar", { caminho: a.caminho, corpo: a.corpo ?? {} })),
    ),
  );
}
