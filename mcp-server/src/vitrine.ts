/**
 * VITRINE DE ATACADO + PRECIFICAÇÃO (prefixos vitrine_ e precificacao_).
 *
 * Exige escopo "vitrine" no PAT e dono ADMIN/DIRECTOR; a vitrine precisa
 * estar ligada na empresa (senão a API responde 422). Serve pra o agente
 * cadastrar o produto INTEIRO: cores, categorias, linhas e tamanhos, modelo
 * (preços, medidas, material de divulgação), fotos e vídeos de uma pasta local
 * (BETINNA_MCP_ANEXOS_DIR), SKU/estoque e a calculadora de preço.
 *
 * Fotos: o app converte no NAVEGADOR (WebP 1080 px q0.82 + miniatura 360 px
 * q0.75) e o servidor só aceita WebP. Aqui o `sharp` faz a mesma conversão,
 * então a foto que sobe pelo MCP é igual à que sobe pela tela.
 *
 * Apagar qualquer coisa pede `confirmo: true`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extname } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { api } from "./api.js";
import { lerPermitido, listarPasta } from "./arquivos.js";
import { seg } from "./caminho.js";

type Resultado = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export interface Ajudantes {
  ok: (payload: unknown) => Resultado;
  erro: (msg: string) => Resultado;
  seguro: <A>(fn: (args: A) => Promise<Resultado>) => (args: A) => Promise<Resultado>;
}

// Mesmas medidas do app (frontend/src/pages/vitrine/imagem.ts) e tetos do servidor.
const LARGURA_FOTO = 1080;
const LARGURA_THUMB = 360;
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const EXT_FOTO = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif"];

const confirmo = z
  .literal(true)
  .describe("Obrigatório: confirma que é pra APAGAR (não tem desfazer).");
const preco = z.number().min(0).max(1_000_000).nullable().optional();
const pct = z.number().min(0).max(100).nullable().optional();
const tabelaMedidas = z
  .object({
    colunas: z.array(z.string()).min(1).max(10).describe('Ex.: ["Cintura", "Comprimento"]'),
    linhas: z
      .array(z.object({ tamanho: z.string(), valores: z.array(z.string()) }))
      .max(40)
      .describe("Uma por tamanho, com UM valor por coluna (em cm)."),
  })
  .nullable()
  .optional();
const modeloLinha = z.object({
  linhaId: z.string().describe("ID da linha da empresa (vitrine_linhas_listar)"),
  tamanhoIds: z.array(z.string()).min(1).describe("Tamanhos DAQUELA linha que o modelo tem"),
  precoEntrada: preco,
  precoVolume: preco,
  precoAtacadao: preco,
  precoSugerido: preco.describe("Revenda sugerida (o lucro do lojista sai dela)"),
  tabelaMedidas,
});
const camposModelo = {
  categoriaId: z.string().nullable().optional().describe("vitrine_categorias_listar"),
  descricao: z.string().max(4000).nullable().optional(),
  etiquetas: z.array(z.string().max(40)).max(12).optional().describe('Ex.: ["Proteção UV 50+"]'),
  ordem: z.number().int().min(0).optional(),
  ativo: z.boolean().optional().describe("Publicado na vitrine (false = escondido)"),
  tituloMarketplace: z.string().max(60).nullable().optional().describe("Material de divulgação (marketplace)"),
  descricaoMarketplace: z.string().max(8000).nullable().optional().describe("Material de divulgação (marketplace)"),
  composicao: z.string().max(200).nullable().optional().describe('Ex.: "100% poliamida"'),
  corIds: z
    .array(z.string())
    .max(40)
    .optional()
    .describe("Cores do modelo, na ordem da vitrine (vitrine_cores_listar). Substitui a lista."),
  linhas: z
    .array(modeloLinha)
    .max(10)
    .optional()
    .describe("Linhas com tamanhos, preços e medidas. Substitui a lista."),
};

interface ModeloCorApi {
  id: string;
  corId: string;
  cor: { id: string; nome: string };
  fotos: Array<{ id: string }>;
}

/** Converte a foto como o app faz no navegador: WebP 1080 px + miniatura 360 px. */
async function prepararFoto(buf: Buffer) {
  const base = sharp(buf, { failOn: "none" }).rotate(); // respeita a orientação EXIF
  let qualidade = 82;
  let foto = await base.clone().resize({ width: LARGURA_FOTO, withoutEnlargement: true }).webp({ quality: qualidade }).toBuffer({ resolveWithObject: true });
  while (foto.data.length > MAX_FOTO_BYTES && qualidade > 50) {
    qualidade -= 10;
    foto = await base.clone().resize({ width: LARGURA_FOTO, withoutEnlargement: true }).webp({ quality: qualidade }).toBuffer({ resolveWithObject: true });
  }
  const thumb = await base.clone().resize({ width: LARGURA_THUMB, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  return {
    foto: foto.data,
    thumb: thumb.length <= MAX_THUMB_BYTES ? thumb : null,
    largura: foto.info.width,
    altura: foto.info.height,
  };
}

export function registrarVitrine(server: McpServer, { ok, erro, seguro }: Ajudantes): void {
  /** modeloCorId direto, ou modeloId + cor (nome ou id da cor). */
  async function acharModeloCor(a: { modeloCorId?: string; modeloId?: string; cor?: string }) {
    if (a.modeloCorId) return a.modeloCorId;
    if (!a.modeloId || !a.cor) {
      throw new Error("Informe modeloCorId, ou modeloId + cor (nome ou id da cor).");
    }
    const m = await api.get<{ cores: ModeloCorApi[] }>(`/vitrine/admin/modelos/${seg(a.modeloId)}`);
    const alvo = a.cor.trim().toLowerCase();
    const mc = m.cores.find(
      (c) => c.id === a.cor || c.corId === a.cor || c.cor.nome.trim().toLowerCase() === alvo,
    );
    if (!mc) {
      throw new Error(
        `O modelo não tem a cor "${a.cor}". Cores dele: ${m.cores.map((c) => c.cor.nome).join(", ") || "(nenhuma)"}. ` +
          "Marque a cor no modelo (vitrine_modelo_atualizar com corIds) antes de subir foto.",
      );
    }
    return mc.id;
  }
  const alvoCor = {
    modeloCorId: z.string().optional().describe("ID da cor DO MODELO (vitrine_modelo_ver → cores[].id)"),
    modeloId: z.string().optional().describe("Alternativa: modelo + cor"),
    cor: z.string().optional().describe("Alternativa: nome (ou id) da cor, junto com modeloId"),
  };
  const alvoLinha = {
    linha: z
      .string()
      .optional()
      .describe(
        "Linha (biotipo) das fotos: nome (Regular, Plus Size, Infantil — exige modeloId) ou linhaId. " +
          "Ausente = fotos GERAIS da cor, que valem pra toda linha sem foto própria.",
      ),
  };

  /** Linha das fotos: null = gerais. Nome exige modeloId; id passa direto. */
  async function acharLinha(a: { modeloId?: string; linha?: string }): Promise<string | null> {
    const alvo = a.linha?.trim();
    if (!alvo) return null;
    if (!a.modeloId) return alvo; // sem o modelo, só dá pra aceitar o id
    const m = await api.get<{ linhas: Array<{ linhaId: string; linha: { nome: string } }> }>(
      `/vitrine/admin/modelos/${seg(a.modeloId)}`,
    );
    const l = m.linhas.find(
      (x) => x.linhaId === alvo || x.linha.nome.trim().toLowerCase() === alvo.toLowerCase(),
    );
    if (!l) {
      throw new Error(
        `O modelo não tem a linha "${alvo}". Linhas dele: ${m.linhas.map((x) => x.linha.nome).join(", ") || "(nenhuma)"}.`,
      );
    }
    return l.linhaId;
  }

  // ─── Config e conferência ───────────────────────────────────────────────

  server.registerTool(
    "vitrine_config_ver",
    {
      description:
        "Config da vitrine de atacado: slug (link público), se está ativa, mínimos de peças por faixa " +
        "(Entrada/Volume/Atacadão) e se respeita estoque. null = vitrine desligada na empresa.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async () => ok(await api.get("/vitrine/admin/config"))),
  );

  server.registerTool(
    "vitrine_config_atualizar",
    {
      description:
        "Salva a config da vitrine. ATENÇÃO: mudar o slug muda o link público que os lojistas já têm.",
      inputSchema: {
        slug: z.string().describe("3–40 letras minúsculas, números e hífen"),
        ativa: z.boolean().optional(),
        minimoEntrada: z.number().int().min(1).nullable().optional(),
        minimoVolume: z.number().int().min(1).nullable().optional(),
        minimoAtacadao: z.number().int().min(1).nullable().optional(),
        respeitaEstoque: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async (dto: Record<string, unknown>) => ok(await api.put("/vitrine/admin/config", dto))),
  );

  server.registerTool(
    "vitrine_publica_ver",
    {
      description:
        "O que o LOJISTA vê na vitrine pública (mesma resposta da página). Use pra conferir o cadastro " +
        "depois de salvar: só aparece modelo ativo, com linha e com ao menos uma foto por cor. " +
        "Sem slug, usa o da config.",
      inputSchema: { slug: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async ({ slug }: { slug?: string }) => {
      let s = slug;
      if (!s) {
        const cfg = await api.get<{ slug: string } | null>("/vitrine/admin/config");
        if (!cfg) return erro("A vitrine não está ligada nesta empresa.");
        s = cfg.slug;
      }
      return ok(await api.get(`/public/vitrine/${seg(s)}`));
    }),
  );

  // ─── Listas da empresa: cores, categorias, linhas e tamanhos ────────────

  const lista = (nome: string, rota: string, oque: string) =>
    server.registerTool(
      nome,
      {
        description: `Lista ${oque} da empresa (com id, ordem e ativo).`,
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      seguro(async () => ok(await api.get(`/vitrine/admin/${rota}`))),
    );
  lista("vitrine_cores_listar", "cores", "as CORES");
  lista("vitrine_categorias_listar", "categorias", "as CATEGORIAS");
  lista("vitrine_linhas_listar", "linhas", "as LINHAS de grade (Regular, Plus Size…) com os TAMANHOS de cada uma");

  const basico = {
    ordem: z.number().int().min(0).optional(),
    ativo: z.boolean().optional(),
  };
  const crud = (
    sing: string,
    rota: string,
    campos: Record<string, z.ZodTypeAny>,
    obs: string,
  ) => {
    server.registerTool(
      `vitrine_${sing}_criar`,
      {
        description: `Cria ${obs}.`,
        inputSchema: { ...campos, ...basico },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      seguro(async (dto: Record<string, unknown>) => ok(await api.post(`/vitrine/admin/${rota}`, dto))),
    );
    server.registerTool(
      `vitrine_${sing}_atualizar`,
      {
        description: `Atualiza ${obs} (manda o nome sempre; ordem/ativo opcionais).`,
        inputSchema: { id: z.string(), ...campos, ...basico },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      seguro(async ({ id, ...dto }: Record<string, unknown> & { id: string }) =>
        ok(await api.put(`/vitrine/admin/${rota}/${seg(id)}`, dto)),
      ),
    );
    server.registerTool(
      `vitrine_${sing}_excluir`,
      {
        description: `APAGA ${obs}. O servidor recusa se algum modelo ainda usa.`,
        inputSchema: { id: z.string(), confirmo },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      seguro(async ({ id }: { id: string; confirmo: true }) => {
        await api.delete(`/vitrine/admin/${rota}/${seg(id)}`);
        return ok({ id, excluido: true });
      }),
    );
  };
  crud(
    "cor",
    "cores",
    {
      nome: z.string().min(1).max(60),
      hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("Cor da bolinha, #RRGGBB"),
    },
    "uma COR da empresa",
  );
  crud("categoria", "categorias", { nome: z.string().min(1).max(60) }, "uma CATEGORIA");
  crud(
    "linha",
    "linhas",
    {
      nome: z.string().min(1).max(40),
      selo: z
        .string()
        .max(160)
        .nullable()
        .optional()
        .describe(
          "Selo que a vitrine mostra nesta linha (ex.: \"Plus Size de verdade · veste até 150 kg ou mais\"). " +
            "Vazio/null = sem selo. Ausente = não mexe.",
        ),
    },
    "uma LINHA de grade (Regular, Plus Size…)",
  );

  server.registerTool(
    "vitrine_tamanho_criar",
    {
      description: "Cria um TAMANHO dentro de uma linha (P, M, G… ou 2, 4, 6…). A ordem define a sequência.",
      inputSchema: { linhaId: z.string(), nome: z.string().min(1).max(20), ...basico },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ linhaId, ...dto }: Record<string, unknown> & { linhaId: string }) =>
      ok(await api.post(`/vitrine/admin/linhas/${seg(linhaId)}/tamanhos`, dto)),
    ),
  );
  server.registerTool(
    "vitrine_tamanho_atualizar",
    {
      description: "Atualiza um TAMANHO (nome sempre; ordem/ativo opcionais).",
      inputSchema: { id: z.string(), nome: z.string().min(1).max(20), ...basico },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ id, ...dto }: Record<string, unknown> & { id: string }) =>
      ok(await api.put(`/vitrine/admin/tamanhos/${seg(id)}`, dto)),
    ),
  );
  server.registerTool(
    "vitrine_tamanho_excluir",
    {
      description: "APAGA um TAMANHO. O servidor recusa se algum modelo ainda usa.",
      inputSchema: { id: z.string(), confirmo },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    seguro(async ({ id }: { id: string; confirmo: true }) => {
      await api.delete(`/vitrine/admin/tamanhos/${seg(id)}`);
      return ok({ id, excluido: true });
    }),
  );

  // ─── Modelos ─────────────────────────────────────────────────────────────

  server.registerTool(
    "vitrine_modelos_listar",
    {
      description: "Lista os MODELOS (produtos) da vitrine, na ordem da vitrine.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async () => ok(await api.get("/vitrine/admin/modelos"))),
  );
  server.registerTool(
    "vitrine_modelo_ver",
    {
      description:
        "Modelo completo: dados, material de divulgação, cores (cores[].id = modeloCorId, com as fotos), " +
        "linhas com tamanhos/preços/medidas, vídeos e variações (SKU/estoque por cor × tamanho).",
      inputSchema: { modeloId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async ({ modeloId }: { modeloId: string }) =>
      ok(await api.get(`/vitrine/admin/modelos/${seg(modeloId)}`)),
    ),
  );
  server.registerTool(
    "vitrine_modelo_criar",
    {
      description:
        "Cria um MODELO. Pode já mandar cores (corIds) e linhas com tamanhos, preços e medidas. " +
        "Depois: fotos por cor (vitrine_fotos_subir) e conferir em vitrine_publica_ver.",
      inputSchema: { nome: z.string().min(1).max(120), ...camposModelo },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async (dto: Record<string, unknown>) => ok(await api.post("/vitrine/admin/modelos", dto))),
  );
  server.registerTool(
    "vitrine_modelo_atualizar",
    {
      description:
        "Atualiza um MODELO. Campo AUSENTE = fica como está. corIds e linhas, se mandados, SUBSTITUEM " +
        "a lista inteira (tirar uma cor do modelo apaga as fotos dela). Sem nome, mantém o atual.",
      inputSchema: { modeloId: z.string(), nome: z.string().min(1).max(120).optional(), ...camposModelo },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ modeloId, ...dto }: Record<string, unknown> & { modeloId: string }) => {
      const corpo = { ...dto };
      // A API exige o nome no PUT; sem ele, mantém o atual.
      if (!corpo.nome) {
        const atual = await api.get<{ nome: string }>(`/vitrine/admin/modelos/${seg(modeloId)}`);
        corpo.nome = atual.nome;
      }
      return ok(await api.put(`/vitrine/admin/modelos/${seg(modeloId)}`, corpo));
    }),
  );
  server.registerTool(
    "vitrine_modelos_reordenar",
    {
      description: "Ordem dos modelos na vitrine. Mande TODOS os ids de modelo da empresa, na ordem nova.",
      inputSchema: { ids: z.array(z.string()).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ ids }: { ids: string[] }) => ok(await api.put("/vitrine/admin/modelos/ordem", { ids }))),
  );
  server.registerTool(
    "vitrine_modelo_excluir",
    {
      description:
        "APAGA um MODELO: some da vitrine, os produtos dele são desativados e as fotos/vídeos saem do armazenamento.",
      inputSchema: { modeloId: z.string(), confirmo },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    seguro(async ({ modeloId }: { modeloId: string; confirmo: true }) => {
      await api.delete(`/vitrine/admin/modelos/${seg(modeloId)}`);
      return ok({ modeloId, excluido: true });
    }),
  );

  // ─── Variações (SKU / estoque) ────────────────────────────────────────

  const variacao = z.object({
    id: z.string().describe("ID da variação (vitrine_modelo_ver → variacoes[].id)"),
    sku: z.string().max(60).nullable().optional(),
    estoque: z.number().int().min(0).nullable().optional(),
  });
  server.registerTool(
    "vitrine_variacoes_atualizar",
    {
      description:
        "SKU e/ou estoque de variações (cor × tamanho), uma ou várias. Responde o resultado de cada uma; " +
        "uma que falha não para as outras.",
      inputSchema: { variacoes: z.array(variacao).min(1).max(500) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ variacoes }: { variacoes: Array<z.infer<typeof variacao>> }) => {
      const resultado: Array<{ id: string; ok: boolean; erro?: string }> = [];
      for (const { id, ...dto } of variacoes) {
        try {
          await api.patch(`/vitrine/admin/variacoes/${seg(id)}`, dto);
          resultado.push({ id, ok: true });
        } catch (e) {
          resultado.push({ id, ok: false, erro: e instanceof Error ? e.message : String(e) });
        }
      }
      return ok({ total: resultado.length, falhas: resultado.filter((r) => !r.ok).length, resultado });
    }),
  );

  // ─── Fotos por cor ────────────────────────────────────────────────────

  server.registerTool(
    "vitrine_fotos_listar",
    {
      description:
        "Fotos de UMA cor do modelo, na ordem. Cada foto traz linhaId (null = geral). Com `linha`, " +
        "devolve só as daquela linha (ou só as gerais com linha vazia). A 1ª de cada grupo é a capa.",
      inputSchema: { ...alvoCor, ...alvoLinha },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async (a: { modeloCorId?: string; modeloId?: string; cor?: string; linha?: string }) => {
      const id = await acharModeloCor(a);
      const fotos = await api.get<Array<{ linhaId: string | null }>>(`/vitrine/admin/cores-modelo/${seg(id)}/fotos`);
      if (a.linha === undefined) return ok(fotos);
      const linhaId = await acharLinha(a);
      return ok(fotos.filter((f) => (f.linhaId ?? null) === linhaId));
    }),
  );

  server.registerTool(
    "vitrine_fotos_subir",
    {
      description:
        "Sobe fotos de UMA cor do modelo a partir de arquivos locais (caminhos) OU de uma pasta inteira " +
        "(em ordem natural do nome: foto-2 antes de foto-10). Converte como o app: WebP 1080 px + " +
        "miniatura. Só lê dentro de BETINNA_MCP_ANEXOS_DIR. Com `linha` (Regular/Plus Size/Infantil), " +
        "as fotos são DAQUELA linha — o biotipo certo; sem, são gerais da cor. Máx 12 por cor × linha; " +
        "a 1ª de cada grupo é a capa (vitrine_fotos_ordenar troca). Responde o resultado de cada arquivo.",
      inputSchema: {
        ...alvoCor,
        ...alvoLinha,
        caminhos: z.array(z.string()).max(12).optional().describe("Caminhos ABSOLUTOS dos arquivos"),
        pasta: z.string().optional().describe("Alternativa: pasta com as fotos (não desce subpastas)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(
      async (a: {
        modeloCorId?: string;
        modeloId?: string;
        cor?: string;
        linha?: string;
        caminhos?: string[];
        pasta?: string;
      }) => {
        if (!!a.caminhos?.length === !!a.pasta) return erro("Informe caminhos OU pasta (um dos dois).");
        let arquivos = a.caminhos ?? [];
        if (a.pasta) {
          const l = await listarPasta(a.pasta, EXT_FOTO);
          if (!l.ok) return erro(l.motivo);
          if (!l.arquivos.length) return erro(`Nenhuma foto (${EXT_FOTO.join(" ")}) em "${a.pasta}".`);
          if (l.arquivos.length > 12) {
            return erro(`A pasta tem ${l.arquivos.length} fotos; o máximo por cor × linha é 12.`);
          }
          arquivos = l.arquivos;
        }
        const id = await acharModeloCor(a);
        const linhaId = await acharLinha(a);
        const resultado: Array<{ arquivo: string; ok: boolean; fotoId?: string; kb?: number; erro?: string }> = [];
        for (const caminho of arquivos) {
          try {
            if (!EXT_FOTO.includes(extname(caminho).toLowerCase())) {
              throw new Error(`extensão não aceita (use ${EXT_FOTO.join(" ")})`);
            }
            const lido = await lerPermitido(caminho, MAX_ORIGINAL_BYTES);
            if (!lido.ok) throw new Error(lido.motivo);
            const p = await prepararFoto(lido.buf);
            if (p.foto.length > MAX_FOTO_BYTES) throw new Error("mesmo convertida, a foto passou de 2MB");
            const form = new FormData();
            form.append("foto", new Blob([Uint8Array.from(p.foto)], { type: "image/webp" }), "foto.webp");
            if (p.thumb) form.append("thumb", new Blob([Uint8Array.from(p.thumb)], { type: "image/webp" }), "thumb.webp");
            form.append("largura", String(p.largura));
            form.append("altura", String(p.altura));
            if (linhaId) form.append("linhaId", linhaId);
            const f = await api.postForm<{ id: string }>(`/vitrine/admin/cores-modelo/${seg(id)}/fotos`, form);
            resultado.push({ arquivo: lido.nome, ok: true, fotoId: f.id, kb: Math.round(p.foto.length / 1024) });
          } catch (e) {
            resultado.push({ arquivo: caminho, ok: false, erro: e instanceof Error ? e.message : String(e) });
          }
        }
        return ok({
          modeloCorId: id,
          linhaId,
          enviadas: resultado.filter((r) => r.ok).length,
          falhas: resultado.filter((r) => !r.ok).length,
          resultado,
        });
      },
    ),
  );

  server.registerTool(
    "vitrine_fotos_ordenar",
    {
      description:
        "Nova ordem das fotos de UM grupo cor × linha (TODAS as fotos do grupo; a 1ª vira a capa). " +
        "Sem `linha`, ordena as fotos gerais da cor.",
      inputSchema: { ...alvoCor, ...alvoLinha, fotoIds: z.array(z.string()).min(1).max(12) },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async (a: { modeloCorId?: string; modeloId?: string; cor?: string; linha?: string; fotoIds: string[] }) => {
      const id = await acharModeloCor(a);
      const linhaId = await acharLinha(a);
      return ok(
        await api.put(`/vitrine/admin/cores-modelo/${seg(id)}/fotos/ordem`, { fotoIds: a.fotoIds, linhaId }),
      );
    }),
  );

  server.registerTool(
    "vitrine_bolinha_definir",
    {
      description:
        "Pedaço da CAPA que vira a bolinha da cor na vitrine: x e y de 0 a 1 (fração da largura/altura " +
        "da foto, a partir do canto de cima à esquerda). null = automático. É a capa GERAL da cor; " +
        "trocar essa capa zera o ponto.",
      inputSchema: {
        ...alvoCor,
        ponto: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(
      async (a: { modeloCorId?: string; modeloId?: string; cor?: string; ponto: { x: number; y: number } | null }) => {
        const id = await acharModeloCor(a);
        return ok(await api.put(`/vitrine/admin/cores-modelo/${seg(id)}/amostra`, { ponto: a.ponto }));
      },
    ),
  );

  server.registerTool(
    "vitrine_foto_excluir",
    {
      description: "APAGA uma foto (do banco e do armazenamento). Apagar a capa zera o ponto da bolinha.",
      inputSchema: { fotoId: z.string(), confirmo },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    seguro(async ({ fotoId }: { fotoId: string; confirmo: true }) => {
      await api.delete(`/vitrine/admin/fotos/${seg(fotoId)}`);
      return ok({ fotoId, excluida: true });
    }),
  );

  server.registerTool(
    "vitrine_foto_rodizio",
    {
      description:
        "Marca/desmarca a foto pro RODÍZIO da abertura: entre as fotos marcadas de uma cor × linha, cada " +
        "cliente vê UMA primeiro (sempre a mesma pra ele). Nenhuma marcada = abre na 1ª da ordem. " +
        "Use nas fotos de corpo inteiro (as focadas no produto ficam pra depois).",
      inputSchema: { fotoId: z.string(), rodizio: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    seguro(async ({ fotoId, rodizio }: { fotoId: string; rodizio: boolean }) =>
      ok(await api.put(`/vitrine/admin/fotos/${seg(fotoId)}/rodizio`, { rodizio })),
    ),
  );

  // ─── Vídeos do modelo ─────────────────────────────────────────────────

  server.registerTool(
    "vitrine_video_subir",
    {
      description:
        "Sobe um vídeo MP4 local (máx 50MB) pro modelo — vai no material de divulgação. Só lê dentro de " +
        "BETINNA_MCP_ANEXOS_DIR. O arquivo vai direto pro armazenamento por uma URL assinada.",
      inputSchema: { modeloId: z.string(), caminho: z.string().describe("Caminho ABSOLUTO do .mp4") },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ modeloId, caminho }: { modeloId: string; caminho: string }) => {
      if (extname(caminho).toLowerCase() !== ".mp4") return erro("O vídeo precisa ser MP4.");
      const lido = await lerPermitido(caminho, MAX_VIDEO_BYTES);
      if (!lido.ok) return erro(lido.motivo);
      const prep = await api.post<{ storagePath: string; uploadUrl: string }>(
        `/vitrine/admin/modelos/${seg(modeloId)}/videos/preparar`,
        { tamanhoBytes: lido.buf.length },
      );
      // Mesmo formato do app (e do supabase-js no uploadToSignedUrl). Sem o
      // Bearer do Betinna: a URL assinada já carrega a autorização.
      const form = new FormData();
      form.append("cacheControl", "31536000");
      form.append("", new Blob([Uint8Array.from(lido.buf)], { type: "video/mp4" }), lido.nome);
      const res = await fetch(prep.uploadUrl, {
        method: "PUT",
        body: form,
        headers: { "x-upsert": "false" },
        signal: AbortSignal.timeout(300_000),
        redirect: "error",
      });
      if (!res.ok) return erro(`O armazenamento recusou o vídeo (${res.status}).`);
      const v = await api.post(`/vitrine/admin/modelos/${seg(modeloId)}/videos`, {
        storagePath: prep.storagePath,
        nomeArquivo: lido.nome.slice(0, 120),
        tamanhoBytes: lido.buf.length,
      });
      return ok(v);
    }),
  );

  server.registerTool(
    "vitrine_video_excluir",
    {
      description: "APAGA um vídeo do modelo (do banco e do armazenamento).",
      inputSchema: { videoId: z.string().describe("vitrine_modelo_ver → videos[].id"), confirmo },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    seguro(async ({ videoId }: { videoId: string; confirmo: true }) => {
      await api.delete(`/vitrine/admin/videos/${seg(videoId)}`);
      return ok({ videoId, excluido: true });
    }),
  );

  // ─── Precificação ─────────────────────────────────────────────────────

  server.registerTool(
    "precificacao_ver",
    {
      description:
        "Calculadora de preço: taxas da empresa (imposto, Pix, cartão, anúncio, embalagem), faixas, " +
        "pedido mínimo e, por linha de cada modelo, custo e preços (Entrada/Volume/Atacadão/revenda).",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    seguro(async () => ok(await api.get("/precificacao"))),
  );
  server.registerTool(
    "precificacao_taxas_atualizar",
    {
      description: "Taxas da empresa usadas na calculadora (% de 0 a 100; valores em R$).",
      inputSchema: {
        impostoPct: pct,
        pixPct: pct,
        pixFixoPorPedido: preco,
        cartaoPct: pct,
        anuncioPorPedido: preco,
        embalagemPorPedido: preco,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async (dto: Record<string, unknown>) => ok(await api.put("/precificacao/taxas", dto))),
  );
  server.registerTool(
    "precificacao_linha_atualizar",
    {
      description:
        "Custo por peça e preços de UMA linha de um modelo (Entrada/Volume/Atacadão e revenda sugerida). " +
        "O id é o da linha DO MODELO (precificacao_ver ou vitrine_modelo_ver → linhas[].id).",
      inputSchema: {
        modeloLinhaId: z.string(),
        custoPorPeca: preco,
        precoEntrada: preco,
        precoVolume: preco,
        precoAtacadao: preco,
        precoSugerido: preco,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    seguro(async ({ modeloLinhaId, ...dto }: Record<string, unknown> & { modeloLinhaId: string }) =>
      ok(await api.put(`/precificacao/linhas/${seg(modeloLinhaId)}`, dto)),
    ),
  );
}
