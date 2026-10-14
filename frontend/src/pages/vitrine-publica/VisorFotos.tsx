import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Fotos da vitrine (Léo, 14/10): o carrossel DÁ A VOLTA (da última pra 1ª e da
 * 1ª pra última), as bolinhas pulam pra foto e tocar na foto abre o VISOR em
 * tela cheia — a foto inteira, sem corte, com zoom de pinça.
 */

/** Índice depois de andar `passo` fotos, dando a volta nas pontas. PURO. */
export function fotoComVolta(idx: number, total: number, passo: number): number {
  if (total <= 0) return 0;
  return (((idx + passo) % total) + total) % total;
}

/**
 * Arrasto no carrossel que JÁ estava numa ponta: a rolagem nativa não anda, e
 * é aqui que vira a volta. Da última pra frente (dedo pra esquerda) → 1ª; da
 * 1ª pra trás (dedo pra direita) → última. Movimento curto ou mais vertical
 * que horizontal (a pessoa rolando o feed) não conta. null = nada a fazer. PURO.
 */
export function voltaDoArrasto(
  idxNoInicio: number,
  total: number,
  dx: number,
  dy: number,
): number | null {
  if (total < 2 || Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return null;
  if (dx < 0 && idxNoInicio === total - 1) return 0;
  if (dx > 0 && idxNoInicio === 0) return total - 1;
  return null;
}

/** Zoom entre 1× e 4×. PURO. */
export const limitarZoom = (z: number) => Math.min(4, Math.max(1, z));

const distancia = (t: React.TouchList) =>
  Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export function VisorFotos({
  fotos,
  nome,
  inicial,
  onFechar,
}: {
  fotos: Array<{ url: string }>;
  nome: string;
  inicial: number;
  onFechar: () => void;
}) {
  const [idx, setIdx] = useState(inicial);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const gesto = useRef<{
    tipo: 'arrasto' | 'pinca' | 'mover';
    x: number;
    y: number;
    dist: number;
    zoom: number;
    pos: { x: number; y: number };
  } | null>(null);
  const ultimoToque = useRef(0);

  const ir = (passo: number) => {
    setIdx((i) => fotoComVolta(i, fotos.length, passo));
    setZoom(1);
    setPos({ x: 0, y: 0 });
  };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      if (e.key === 'ArrowRight') ir(1);
      if (e.key === 'ArrowLeft') ir(-1);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ir` só usa setters
  }, [onFechar]);

  const inicio = (e: React.TouchEvent) => {
    const t = e.touches;
    if (t.length === 2) {
      gesto.current = { tipo: 'pinca', x: 0, y: 0, dist: distancia(t), zoom, pos };
      return;
    }
    gesto.current = {
      tipo: zoom > 1 ? 'mover' : 'arrasto',
      x: t[0].clientX,
      y: t[0].clientY,
      dist: 0,
      zoom,
      pos,
    };
  };
  const mover = (e: React.TouchEvent) => {
    const g = gesto.current;
    if (!g) return;
    const t = e.touches;
    if (g.tipo === 'pinca' && t.length === 2) {
      const z = limitarZoom((g.zoom * distancia(t)) / Math.max(1, g.dist));
      setZoom(z);
      if (z === 1) setPos({ x: 0, y: 0 });
    } else if (g.tipo === 'mover' && t.length === 1) {
      setPos({ x: g.pos.x + (t[0].clientX - g.x), y: g.pos.y + (t[0].clientY - g.y) });
    }
  };
  const fim = (e: React.TouchEvent) => {
    const g = gesto.current;
    gesto.current = null;
    if (!g || g.tipo !== 'arrasto') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      ir(dx < 0 ? 1 : -1);
      return;
    }
    // Arrastar pra baixo fecha (gesto comum de visor no celular).
    if (dy > 120 && Math.abs(dy) > Math.abs(dx)) {
      onFechar();
      return;
    }
    // Toque duplo: aproxima / afasta.
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const agora = Date.now();
      if (agora - ultimoToque.current < 300) {
        setZoom((z) => (z > 1 ? 1 : 2.5));
        setPos({ x: 0, y: 0 });
        ultimoToque.current = 0;
      } else {
        ultimoToque.current = agora;
      }
    }
  };

  const foto = fotos[idx];
  if (!foto) return null;
  return createPortal(
    <div
      className="vt-visor"
      role="dialog"
      aria-modal="true"
      aria-label={`Fotos de ${nome}`}
      data-testid="vt-visor"
    >
      <div className="vt-visor-palco" onTouchStart={inicio} onTouchMove={mover} onTouchEnd={fim}>
        <img
          key={foto.url}
          src={foto.url}
          alt={`${nome} · foto ${idx + 1}`}
          draggable={false}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})` }}
          data-testid="vt-visor-foto"
        />
      </div>
      <button type="button" className="vt-visor-fechar" onClick={onFechar} aria-label="Fechar">
        ×
      </button>
      {fotos.length > 1 && (
        <>
          <button
            type="button"
            className="vt-visor-seta vt-visor-ant"
            onClick={() => ir(-1)}
            aria-label="Foto anterior"
            data-testid="vt-visor-anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="vt-visor-seta vt-visor-prox"
            onClick={() => ir(1)}
            aria-label="Próxima foto"
            data-testid="vt-visor-proxima"
          >
            ›
          </button>
          <div className="vt-visor-cont" data-testid="vt-visor-contador">
            {idx + 1} / {fotos.length}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
