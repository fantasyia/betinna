/**
 * Otimização da foto NO NAVEGADOR, antes do upload: WebP com ~1080 px de
 * largura (o que o celular precisa) + miniatura de 360 px. Assim o servidor
 * não precisa de biblioteca nativa de imagem, e foto de 8 MB da câmera vira
 * ~150 KB antes de sair do computador.
 */

export const LARGURA_FOTO = 1080;
export const LARGURA_THUMB = 360;

/** Dimensões finais mantendo a proporção; nunca AMPLIA uma foto pequena. */
export function dimensoesAlvo(
  largura: number,
  altura: number,
  maxLargura: number,
): { largura: number; altura: number } {
  if (largura <= 0 || altura <= 0) return { largura: 0, altura: 0 };
  if (largura <= maxLargura) return { largura, altura };
  const fator = maxLargura / largura;
  return { largura: maxLargura, altura: Math.round(altura * fator) };
}

async function redimensionar(
  bitmap: ImageBitmap,
  maxLargura: number,
  qualidade: number,
): Promise<{ blob: Blob; largura: number; altura: number }> {
  const alvo = dimensoesAlvo(bitmap.width, bitmap.height, maxLargura);
  const canvas = document.createElement('canvas');
  canvas.width = alvo.largura;
  canvas.height = alvo.altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Navegador sem suporte a canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, alvo.largura, alvo.altura);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', qualidade),
  );
  // Safari antigo devolve PNG quando não sabe gerar WebP — o servidor recusaria.
  if (!blob || blob.type !== 'image/webp') {
    throw new Error('Este navegador não gera WebP — use Chrome, Edge ou Firefox atualizado');
  }
  return { blob, ...alvo };
}

export async function prepararFoto(arquivo: File): Promise<{
  foto: Blob;
  thumb: Blob;
  largura: number;
  altura: number;
}> {
  if (!arquivo.type.startsWith('image/')) throw new Error(`"${arquivo.name}" não é uma imagem`);
  const bitmap = await createImageBitmap(arquivo);
  try {
    const foto = await redimensionar(bitmap, LARGURA_FOTO, 0.82);
    const thumb = await redimensionar(bitmap, LARGURA_THUMB, 0.75);
    return { foto: foto.blob, thumb: thumb.blob, largura: foto.largura, altura: foto.altura };
  } finally {
    bitmap.close();
  }
}
