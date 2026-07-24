/**
 * Export de gráfico SVG → PNG sem dependência externa (M8 do dashboard).
 *
 * Os gráficos pintam com `var(--chart-*)` — num PNG standalone o CSS do app
 * não existe, então na serialização a gente resolve cada var() pro valor
 * COMPUTADO do tema atual (light/dark) e pinta o fundo com --surface.
 */
export async function svgParaPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));

  const cs = getComputedStyle(document.documentElement);
  const serializado = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\((--[\w-]+)\)/g, (_, nome: string) => cs.getPropertyValue(nome).trim() || '#000');

  const canvas = document.createElement('canvas');
  const escala = 2; // 2x pra não sair borrado em tela retina/zoom
  canvas.width = w * escala;
  canvas.height = h * escala;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador');
  ctx.fillStyle = cs.getPropertyValue('--surface').trim() || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const url = URL.createObjectURL(new Blob([serializado], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Falha ao rasterizar o SVG'));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  const a = document.createElement('a');
  a.download = filename;
  a.href = canvas.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}
