import { parseOffice } from 'officeparser';

/**
 * Extração de texto de documentos pra base de conhecimento (RAG).
 *
 * PDF/DOCX/XLSX/PPTX/ODT/ODP/ODS → officeparser (puro JS, sem binário externo).
 * TXT/MD/CSV → decodifica o buffer direto (officeparser não trata texto plano).
 *
 * LIMITAÇÃO MVP: só texto digital. PDF escaneado/imagem (sem camada de texto) sai
 * vazio — o chamador marca `erroExtracao` e o doc ainda pode ser ENVIADO (podeEnviar),
 * só não vira fonte de busca. OCR fica fora de escopo.
 */

/** Mimetypes/extensões tratados como texto plano (não passam pelo officeparser). */
const TEXTO_PLANO_MIMES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);
const TEXTO_PLANO_EXTS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'log']);

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return m ? m[1].toLowerCase() : '';
}

export function ehTextoPlano(mimetype: string, fileName: string): boolean {
  return TEXTO_PLANO_MIMES.has(mimetype.toLowerCase()) || TEXTO_PLANO_EXTS.has(extOf(fileName));
}

/**
 * Extrai o texto bruto do documento. Lança se o formato não é suportado; devolve
 * string vazia (após trim) quando o arquivo não tem texto extraível (PDF escaneado).
 */
export async function extrairTexto(
  buffer: Buffer,
  mimetype: string,
  fileName: string,
): Promise<string> {
  if (ehTextoPlano(mimetype, fileName)) {
    return buffer.toString('utf-8');
  }
  // officeparser detecta o tipo pelo conteúdo do buffer (PDF/OOXML/ODF).
  const resultado: unknown = await parseOffice(buffer);
  return resultadoParaTexto(resultado);
}

/**
 * officeparser v7 devolve uma AST ({ content, toText() }), não string. `.toText()`
 * é o caminho oficial pro texto plano; mantém fallbacks defensivos pra outras formas
 * (string crua de versões antigas / agregação manual do content[]).
 */
function resultadoParaTexto(resultado: unknown): string {
  if (typeof resultado === 'string') return resultado;
  if (resultado && typeof resultado === 'object') {
    const r = resultado as { toText?: () => string; content?: Array<{ text?: string }> };
    if (typeof r.toText === 'function') return r.toText();
    if (Array.isArray(r.content)) {
      return r.content
        .map((node) => node?.text ?? '')
        .filter(Boolean)
        .join('\n\n');
    }
  }
  return '';
}

/**
 * Normaliza whitespace: colapsa espaços/tabs, preserva quebras de parágrafo
 * (linha em branco) pra o chunker ter onde cortar.
 */
export function normalizarTexto(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Divide o texto em trechos de ~maxChars, cortando em fronteira de parágrafo
 * (e, no pior caso, de frase) pra não rachar uma ideia no meio. Um parágrafo
 * maior que maxChars é quebrado por frase/força bruta.
 */
export function dividirEmChunks(texto: string, maxChars = 1800): string[] {
  const limpo = normalizarTexto(texto);
  if (!limpo) return [];
  if (limpo.length <= maxChars) return [limpo];

  const paragrafos = limpo.split(/\n{2,}/).flatMap((p) => quebrarSeGrande(p, maxChars));
  const chunks: string[] = [];
  let atual = '';
  for (const p of paragrafos) {
    if (!atual) {
      atual = p;
    } else if (atual.length + 2 + p.length <= maxChars) {
      atual += `\n\n${p}`;
    } else {
      chunks.push(atual);
      atual = p;
    }
  }
  if (atual) chunks.push(atual);
  return chunks;
}

/** Parágrafo > maxChars: quebra por frase; se ainda estourar, fatia bruto. */
function quebrarSeGrande(paragrafo: string, maxChars: number): string[] {
  const p = paragrafo.trim();
  if (p.length <= maxChars) return p ? [p] : [];

  const frases = p.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let buf = '';
  for (const f of frases) {
    const frase = f.length > maxChars ? '' : f;
    if (!frase) {
      // Frase única gigante (sem pontuação): fatia bruto.
      if (buf) {
        out.push(buf);
        buf = '';
      }
      for (let i = 0; i < f.length; i += maxChars) out.push(f.slice(i, i + maxChars));
      continue;
    }
    if (!buf) buf = frase;
    else if (buf.length + 1 + frase.length <= maxChars) buf += ` ${frase}`;
    else {
      out.push(buf);
      buf = frase;
    }
  }
  if (buf) out.push(buf);
  return out;
}
