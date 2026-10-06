// Teste das tools vitrine_* com API FALSA local (não precisa de token nem do
// backend no ar). Uso: npm run build && node teste-vitrine.mjs
//
// Confere: lista de tools, conversão da foto (WebP 1080 px + miniatura, como o
// app), portão de arquivo (fora da pasta / oculto / caminho de rede), vídeo pela
// URL assinada, `confirmo` obrigatório pra apagar e o kanban_anexar sem regressão.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const raiz = mkdtempSync(join(tmpdir(), "vitrine-mcp-"));
const permitida = join(raiz, "produtos");
const fora = join(raiz, "fora");
mkdirSync(join(permitida, "camiseta-uv", "preto"), { recursive: true });
mkdirSync(join(permitida, ".segredo"), { recursive: true });
mkdirSync(fora, { recursive: true });
const jpg = (w, h, cor) =>
  sharp({ create: { width: w, height: h, channels: 3, background: cor } }).jpeg({ quality: 95 }).toBuffer();
writeFileSync(join(permitida, "camiseta-uv", "preto", "foto-10.jpg"), await jpg(2400, 3200, "#111"));
writeFileSync(join(permitida, "camiseta-uv", "preto", "foto-2.jpg"), await jpg(1800, 2400, "#222"));
writeFileSync(join(permitida, "camiseta-uv", "preto", "leia.txt"), "não é foto");
writeFileSync(join(permitida, ".segredo", "x.jpg"), await jpg(100, 100, "#333"));
writeFileSync(join(fora, "x.jpg"), await jpg(100, 100, "#444"));
writeFileSync(join(permitida, "video.mp4"), Buffer.alloc(4096, 1));

// ── API falsa ──
const recebidas = [];
let videoPut = null;
const api = createServer(async (req, res) => {
  const partes = [];
  for await (const c of req) partes.push(c);
  const corpo = Buffer.concat(partes);
  const url = req.url;
  const json = (data, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }));
  };
  if (req.method === "GET" && url === "/api/v1/vitrine/admin/modelos/mod-1") {
    return json({ id: "mod-1", nome: "Camiseta UV", cores: [{ id: "mc-preto", corId: "cor-preto", cor: { id: "cor-preto", nome: "Preto" }, fotos: [] }] });
  }
  if (req.method === "POST" && url === "/api/v1/vitrine/admin/cores-modelo/mc-preto/fotos") {
    // multipart: guarda o pedaço binário de cada parte pra conferir depois
    const ct = req.headers["content-type"];
    const fronteira = "--" + ct.split("boundary=")[1];
    const pedacos = corpo.toString("latin1").split(fronteira).slice(1, -1);
    const campos = {};
    for (const p of pedacos) {
      const [cab, ...resto] = p.split("\r\n\r\n");
      const nome = /name="([^"]*)"/.exec(cab)?.[1];
      campos[nome] = Buffer.from(resto.join("\r\n\r\n").replace(/\r\n$/, ""), "latin1");
    }
    recebidas.push(campos);
    return json({ id: `f-${recebidas.length}` });
  }
  if (req.method === "POST" && url === "/api/v1/vitrine/admin/modelos/mod-1/videos/preparar") {
    return json({ storagePath: "emp/mod-1/video_1.mp4", uploadUrl: `http://127.0.0.1:${porta}/upload-assinado?token=t` });
  }
  if (req.method === "PUT" && url.startsWith("/upload-assinado")) {
    videoPut = { bytes: corpo.length, temBearer: !!req.headers.authorization };
    res.writeHead(200);
    return res.end("{}");
  }
  if (req.method === "POST" && url === "/api/v1/vitrine/admin/modelos/mod-1/videos") {
    return json({ id: "v-1", ...JSON.parse(corpo.toString()) });
  }
  if (req.method === "DELETE") return json({ ok: true });
  json({ message: `rota falsa não mapeada: ${req.method} ${url}` }, 404);
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const porta = api.address().port;

// ── cliente MCP (stdio) ──
const mcp = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, BETINNA_API_URL: `http://127.0.0.1:${porta}`, BETINNA_API_TOKEN: "bkt_teste", BETINNA_MCP_ANEXOS_DIR: permitida },
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = "";
const pend = new Map();
mcp.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const linha = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!linha.trim()) continue;
    const m = JSON.parse(linha);
    pend.get(m.id)?.(m);
  }
});
let seq = 0;
const rpc = (method, params) =>
  new Promise((r) => {
    const id = ++seq;
    pend.set(id, r);
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const chamar = async (name, args) => {
  const m = await rpc("tools/call", { name, arguments: args });
  if (m.error) return { erroProtocolo: m.error.message };
  const t = m.result.content[0].text;
  return { isError: !!m.result.isError, texto: t, json: m.result.isError ? null : JSON.parse(t) };
};

let falhas = 0;
const conferir = (cond, msg) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) falhas++;
};

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } });
const tools = (await rpc("tools/list", {})).result.tools.map((t) => t.name);
const vit = tools.filter((t) => t.startsWith("vitrine_") || t.startsWith("precificacao_"));
conferir(vit.length >= 30, `${vit.length} tools vitrine_/precificacao_ registradas`);
conferir(tools.includes("kanban_anexar"), "kanban_anexar segue registrado");

// Fotos por pasta, achando a cor pelo NOME
const r1 = await chamar("vitrine_fotos_subir", { modeloId: "mod-1", cor: "preto", pasta: join(permitida, "camiseta-uv", "preto") });
conferir(r1.json?.enviadas === 2 && r1.json?.falhas === 0, `pasta: 2 fotos enviadas (o .txt ignorado) — ${r1.texto.slice(0, 120)}`);
conferir(r1.json?.resultado[0].arquivo === "foto-2.jpg", "ordem natural: foto-2 antes de foto-10");
for (const [i, c] of recebidas.entries()) {
  const m = await sharp(c.foto).metadata();
  const t = await sharp(c.thumb).metadata();
  conferir(m.format === "webp" && m.width === 1080 && c.foto.length <= 2 * 1024 * 1024, `foto ${i + 1}: WebP 1080 px, ${Math.round(c.foto.length / 1024)} KB`);
  conferir(t.format === "webp" && t.width === 360, `miniatura ${i + 1}: WebP 360 px`);
  conferir(c.largura.toString() === "1080" && Number(c.altura.toString()) === m.height, `largura/altura enviadas batem (${c.largura}×${c.altura})`);
}

// Portão de arquivo
const r2 = await chamar("vitrine_fotos_subir", { modeloCorId: "mc-preto", caminhos: [join(fora, "x.jpg"), join(permitida, ".segredo", "x.jpg"), "\\\\servidor\\share\\x.jpg"] });
conferir(r2.json?.enviadas === 0 && r2.json?.falhas === 3 && r2.json.resultado.every((x) => /fora das pastas permitidas/.test(x.erro)), "fora da pasta, oculto e caminho de rede: recusados");
const r3 = await chamar("vitrine_fotos_subir", { modeloId: "mod-1", cor: "Azul", pasta: join(permitida, "camiseta-uv", "preto") });
conferir(r3.isError && /não tem a cor "Azul"/.test(r3.texto), "cor que o modelo não tem: erro claro");

// Vídeo pela URL assinada (sem o Bearer do Betinna)
const r4 = await chamar("vitrine_video_subir", { modeloId: "mod-1", caminho: join(permitida, "video.mp4") });
conferir(!r4.isError && r4.json?.storagePath === "emp/mod-1/video_1.mp4", "vídeo: preparar → upload → confirmar");
conferir(videoPut && videoPut.bytes > 4096 && !videoPut.temBearer, "upload do vídeo vai pra URL assinada SEM o token do Betinna");

// Apagar exige confirmo
const r5 = await chamar("vitrine_modelo_excluir", { modeloId: "mod-1" });
conferir(r5.erroProtocolo || r5.isError, "excluir sem confirmo: recusado");
const r6 = await chamar("vitrine_modelo_excluir", { modeloId: "mod-1", confirmo: true });
conferir(!r6.isError && r6.json?.excluido === true, "excluir com confirmo: passa");

// kanban_anexar: mesma recusa de antes (portão agora compartilhado)
const r7 = await chamar("kanban_anexar", { cardId: "c-1", caminhoArquivo: join(fora, "x.jpg") });
conferir(r7.isError && /fora das pastas permitidas/.test(r7.texto), "kanban_anexar segue recusando arquivo fora da pasta");

mcp.kill();
api.close();
rmSync(raiz, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
