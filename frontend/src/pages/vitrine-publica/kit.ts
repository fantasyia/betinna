import { zipSync, strToU8, type Zippable } from 'fflate';
import { nomeArquivo, textoKit, type ModeloPub } from './calculo';

/**
 * Monta o .zip do "kit pra anunciar" NO NAVEGADOR: as fotos já são públicas,
 * então o servidor não precisa juntar nada (nem gastar memória com isso).
 * Fotos saem em JPG — é o formato que todo marketplace aceita no cadastro.
 */

async function webpParaJpg(url: string): Promise<Uint8Array> {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`Foto indisponível (${resp.status})`);
  const bitmap = await createImageBitmap(await resp.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Navegador sem suporte a canvas');
    // Fundo branco: JPG não tem transparência.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Não foi possível converter a foto');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export async function baixarKit(
  m: ModeloPub,
  opts: { incluirVideos: boolean; onProgresso?: (feito: number, total: number) => void },
): Promise<void> {
  const raiz = nomeArquivo(m.nome);
  const arquivos: Zippable = {};
  const fotos = m.cores.flatMap((c) => c.fotos.map((f, i) => ({ cor: c.nome, i, url: f.url })));
  const videos = opts.incluirVideos ? m.videos : [];
  const total = fotos.length + videos.length;
  let feito = 0;

  for (const f of fotos) {
    const nome = `${raiz}/${nomeArquivo(f.cor)}/${String(f.i + 1).padStart(2, '0')}.jpg`;
    // Nível 0: JPG já é comprimido; recomprimir só gasta tempo do celular.
    arquivos[nome] = [await webpParaJpg(f.url), { level: 0 }];
    opts.onProgresso?.(++feito, total);
  }
  for (const [i, v] of videos.entries()) {
    const resp = await fetch(v.url, { mode: 'cors' });
    if (!resp.ok) throw new Error(`Vídeo indisponível (${resp.status})`);
    const base = v.nomeArquivo ? nomeArquivo(v.nomeArquivo.replace(/\.mp4$/i, '')) : `video-${i + 1}`;
    arquivos[`${raiz}/videos/${base}.mp4`] = [new Uint8Array(await resp.arrayBuffer()), { level: 0 }];
    opts.onProgresso?.(++feito, total);
  }
  arquivos[`${raiz}/descricao.txt`] = strToU8(textoKit(m));

  const zip = zipSync(arquivos);
  salvarArquivo(new Blob([zip], { type: 'application/zip' }), `${raiz}.zip`);
}

export function salvarArquivo(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copia o texto; sem Clipboard API (http, navegador antigo) devolve false. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
