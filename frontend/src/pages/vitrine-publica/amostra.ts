/**
 * Bolinha da cor = pedaço do TECIDO na foto daquela cor.
 *
 * O enquadramento muda de foto pra foto (mão, camiseta, fundo), então um
 * recorte fixo no meio erra. Aqui a foto é lida num canvas pequeno, dividida
 * em células, e vence a célula mais parecida com o hex cadastrado da cor e
 * com textura uniforme. Sem foto, sem CORS ou com erro: cai no miolo/hex.
 */
import { useEffect, useState, type CSSProperties } from 'react';

export interface Ponto {
  /** Centro escolhido, em fração da foto (0–1). */
  fx: number;
  fy: number;
  /** largura ÷ altura da foto. */
  aspecto: number;
}

const MIOLO: Ponto = { fx: 0.5, fy: 0.55, aspecto: 0.75 };
/** Quantas vezes a foto é maior que a bolinha (na largura). */
export const ZOOM = 6;

function hexParaRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Célula mais parecida com o hex: distância de cor + um pouco do desvio
 * (célula com borda de duas cores perde pra tecido liso) + a distância média
 * das VIZINHAS — a bolinha mostra mais que uma célula, então vence o miolo
 * da peça, não a borda encostada no fundo. PURO.
 */
export function melhorPonto(
  px: Uint8ClampedArray,
  largura: number,
  altura: number,
  hex: string,
  celula = 4,
): { fx: number; fy: number } | null {
  const alvo = hexParaRgb(hex);
  if (!alvo || largura < celula || altura < celula) return null;
  const cols = Math.floor(largura / celula);
  const lins = Math.floor(altura / celula);
  const dist: number[] = [];
  const desv: number[] = [];
  const n = celula * celula;
  for (let cy = 0; cy < lins; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let q = 0;
      for (let y = cy * celula; y < (cy + 1) * celula; y++) {
        for (let x = cx * celula; x < (cx + 1) * celula; x++) {
          const i = (y * largura + x) * 4;
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
          q += px[i] * px[i] + px[i + 1] * px[i + 1] + px[i + 2] * px[i + 2];
        }
      }
      r /= n;
      g /= n;
      b /= n;
      dist.push(Math.hypot(r - alvo[0], g - alvo[1], b - alvo[2]));
      desv.push(Math.sqrt(Math.max(0, q / n - (r * r + g * g + b * b)) / 3));
    }
  }
  let melhor: { fx: number; fy: number; nota: number } | null = null;
  for (let cy = 0; cy < lins; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let viz = 0;
      let nv = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const x = cx + dx;
          const y = cy + dy;
          // fora da foto conta como "não é o tecido"
          viz += x < 0 || y < 0 || x >= cols || y >= lins ? 255 : dist[y * cols + x];
          nv++;
        }
      }
      const k = cy * cols + cx;
      const nota = dist[k] + desv[k] * 0.6 + (viz / nv) * 0.8;
      if (!melhor || nota < melhor.nota) {
        melhor = { fx: (cx + 0.5) / cols, fy: (cy + 0.5) / lins, nota };
      }
    }
  }
  return melhor && { fx: melhor.fx, fy: melhor.fy };
}

/** background-position (%) que põe o ponto (fx, fy) no centro da bolinha. PURO. */
export function posicaoDoFundo(p: Ponto, zoom = ZOOM): { x: number; y: number } {
  const sx = zoom;
  const sy = zoom / p.aspecto; // bolinha quadrada: a foto em pé fica mais alta
  const pos = (f: number, s: number) => Math.min(100, Math.max(0, ((f * s - 0.5) / (s - 1)) * 100));
  return { x: Math.round(pos(p.fx, sx) * 10) / 10, y: Math.round(pos(p.fy, sy) * 10) / 10 };
}

const cache = new Map<string, Promise<Ponto>>();

function amostrar(src: string, hex: string): Promise<Ponto> {
  const chave = `${src}|${hex}`;
  const pronto = cache.get(chave);
  if (pronto) return pronto;
  const p = new Promise<Ponto>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const aspecto = img.naturalWidth / Math.max(1, img.naturalHeight) || MIOLO.aspecto;
        const w = 48;
        const h = Math.max(6, Math.round(w / aspecto));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve({ ...MIOLO, aspecto });
        ctx.drawImage(img, 0, 0, w, h);
        const achado = melhorPonto(ctx.getImageData(0, 0, w, h).data, w, h, hex);
        resolve(achado ? { ...achado, aspecto } : { ...MIOLO, aspecto });
      } catch {
        resolve(MIOLO); // canvas "sujo" (sem CORS): fica no miolo
      }
    };
    img.onerror = () => resolve(MIOLO);
    img.src = src;
  });
  cache.set(chave, p);
  return p;
}

/** Estilo da bolinha: foto ampliada no ponto do tecido; hex enquanto carrega. */
export function useFundoDaCor(cor: {
  hex: string;
  fotos: Array<{ url: string; thumbUrl: string | null }>;
}): CSSProperties {
  const src = cor.fotos[0]?.thumbUrl ?? cor.fotos[0]?.url ?? null;
  const [ponto, setPonto] = useState<Ponto | null>(null);
  useEffect(() => {
    if (!src) return;
    let vivo = true;
    void amostrar(src, cor.hex).then((p) => vivo && setPonto(p));
    return () => {
      vivo = false;
    };
  }, [src, cor.hex]);
  if (!src || !ponto) return { background: cor.hex };
  const { x, y } = posicaoDoFundo(ponto);
  return {
    backgroundColor: cor.hex,
    backgroundImage: `url(${JSON.stringify(src)})`,
    backgroundSize: `${ZOOM * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: 'no-repeat',
  };
}
