/**
 * Leitura de arquivo LOCAL pra upload — o mesmo portão pra todo tool que sobe
 * arquivo (anexo de card, foto e vídeo da vitrine).
 *
 * H-1 (auditoria 13/09/2026): `readFile` de QUALQUER caminho absoluto subia
 * pro bucket do tenant — inclusive `.claude.json`, com os tokens de API. Só lê
 * dentro das pastas listadas em BETINNA_MCP_ANEXOS_DIR (separadas por `;`),
 * nunca arquivo oculto. Sem a variável, upload de arquivo fica desligado.
 */
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";

export function pastasPermitidas(): string[] {
  return (process.env.BETINNA_MCP_ANEXOS_DIR ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
}

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Aceito = dentro de uma pasta permitida E sem nenhum segmento oculto ABAIXO
 * dela (".claude\settings.json", ".ssh\…", ".env"). Só olha o trecho abaixo
 * da pasta: ela mesma pode morar sob um oculto (os repos ficam em .claude\github).
 */
function aceito(pastas: string[], alvo: string): boolean {
  return pastas.some((p) => {
    const base = resolve(p);
    const b = norm(base.endsWith(sep) ? base : base + sep);
    const a = norm(alvo);
    if (a !== norm(base) && !a.startsWith(b)) return false;
    const abaixo = alvo.slice(base.length).split(/[\\/]/).filter(Boolean);
    return !abaixo.some((s) => s.startsWith("."));
  });
}

export type Resolvido = { ok: true; real: string } | { ok: false; motivo: string };

/**
 * Caminho dentro das pastas permitidas, já resolvido (realpath). Mesma
 * mensagem em todo caso de recusa: o erro não diz se o arquivo existe.
 */
export async function resolverPermitido(caminho: string): Promise<Resolvido> {
  const pastas = pastasPermitidas();
  if (pastas.length === 0) {
    return {
      ok: false,
      motivo:
        "Upload de ARQUIVO local está desligado nesta instância (defina BETINNA_MCP_ANEXOS_DIR " +
        "com as pastas permitidas, separadas por ';').",
    };
  }
  const recusa = {
    ok: false as const,
    motivo:
      `Arquivo fora das pastas permitidas (ou oculto): "${caminho}". ` +
      `Permitidas: ${pastas.join(", ")}.`,
  };
  // Checagem LÉXICA antes de tocar o disco (auditoria 29/09/2026): o realpath
  // num caminho UNC (\\host\share) abre conexão SMB e vaza o hash NTLM do
  // Windows antes da allowlist recusar. Caminho de rede nunca é aceito, e
  // fora das pastas permitidas nem chega ao disco.
  if (/^[\\/]{2}/.test(caminho) || !aceito(pastas, resolve(caminho))) return recusa;
  let real: string;
  try {
    real = await realpath(resolve(caminho));
  } catch {
    return recusa;
  }
  // Depois do realpath: junção/symlink que aponta pra fora também é recusado.
  if (!aceito(pastas, real)) return recusa;
  return { ok: true, real };
}

export type Lido =
  | { ok: true; real: string; nome: string; buf: Buffer }
  | { ok: false; motivo: string };

/** Lê um arquivo permitido, com teto de tamanho. */
export async function lerPermitido(caminho: string, maxBytes: number): Promise<Lido> {
  const r = await resolverPermitido(caminho);
  if (!r.ok) return r;
  let buf: Buffer;
  try {
    buf = await readFile(r.real);
  } catch {
    return { ok: false, motivo: `Não consegui ler o arquivo em "${caminho}". Use caminho ABSOLUTO.` };
  }
  if (buf.length === 0) return { ok: false, motivo: `Arquivo vazio: "${caminho}".` };
  if (buf.length > maxBytes) {
    return {
      ok: false,
      motivo: `Arquivo muito grande: "${caminho}" (máx ${Math.round(maxBytes / 1024 / 1024)}MB).`,
    };
  }
  return { ok: true, real: r.real, nome: basename(caminho), buf };
}

/**
 * Arquivos (não ocultos) de uma pasta permitida com as extensões pedidas,
 * em ordem natural do nome (foto-2 antes de foto-10). Não desce subpastas.
 */
export async function listarPasta(
  pasta: string,
  extensoes: string[],
): Promise<{ ok: true; arquivos: string[] } | { ok: false; motivo: string }> {
  const r = await resolverPermitido(pasta);
  if (!r.ok) return r;
  try {
    if (!(await stat(r.real)).isDirectory()) return { ok: false, motivo: `Não é uma pasta: "${pasta}".` };
  } catch {
    return { ok: false, motivo: `Não consegui abrir a pasta "${pasta}".` };
  }
  const nomes = (await readdir(r.real, { withFileTypes: true }))
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((n) => extensoes.includes(extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
  return { ok: true, arquivos: nomes.map((n) => join(r.real, n)) };
}
