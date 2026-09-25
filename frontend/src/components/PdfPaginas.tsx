import { useEffect, useRef, useState } from 'react';

/**
 * Mostra TODAS as páginas de um PDF, na largura do container — como folhas de
 * papel, uma embaixo da outra.
 *
 * Existe pela página de aceite (Léo, 25/09): o levantamento e o contrato
 * aparecem no mesmo formato, e o que o cliente vê é página por página o
 * arquivo que ele assina. Visualizador nativo de PDF em <iframe> não serve: no
 * celular ele não abre, só oferece baixar.
 *
 * pdf.js é carregado sob demanda — ele é pesado e só esta tela usa.
 */
export function PdfPaginas({ url, testid }: { url: string; testid?: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');

  useEffect(() => {
    let cancelado = false;
    setEstado('carregando');
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const doc = await pdfjs.getDocument({ url }).promise;
        const el = caixa.current;
        if (!el || cancelado) return;
        el.innerHTML = '';
        const largura = el.clientWidth || 800;
        // Nitidez em tela de alta densidade, sem estourar memória no celular.
        const densidade = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages; n++) {
          const pagina = await doc.getPage(n);
          const escala = (largura / pagina.getViewport({ scale: 1 }).width) * densidade;
          const vista = pagina.getViewport({ scale: escala });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vista.width);
          canvas.height = Math.floor(vista.height);
          canvas.className = 'pdf-pagina';
          canvas.setAttribute('aria-label', `Página ${n} de ${doc.numPages}`);
          el.appendChild(canvas);
          await pagina.render({ canvas, viewport: vista }).promise;
          if (cancelado) return;
        }
        setEstado('ok');
      } catch {
        if (!cancelado) setEstado('erro');
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [url]);

  return (
    <div data-testid={testid}>
      {estado === 'carregando' && <p className="pdf-aviso">Carregando o documento…</p>}
      {estado === 'erro' && (
        <p className="pdf-aviso">
          Não foi possível mostrar o documento aqui. Use o botão de baixar acima.
        </p>
      )}
      <div ref={caixa} className="pdf-paginas" />
    </div>
  );
}
