import { useEffect, useRef } from 'react';

/**
 * Selo do Reclame Aqui (Léo, 06-07/11). O código oficial do painel do RA é um
 * <div id="ra-verified-seal"> + <script id="ra-embed-verified-seal" ...> que
 * preenche esse div. Os ids são fixos do RA, então só existe UM selo por vez
 * na tela. O script é recriado a cada montagem: senão, ao reabrir o resumo do
 * pedido, o div volta vazio.
 */
const SRC = 'https://s3.amazonaws.com/raichu-beta/ra-verified/bundle.js';

export function SeloReclameAqui({ dataId, modelo }: { dataId: string; modelo: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const div = caixa.current;
    if (!div) return;
    document.getElementById('ra-embed-verified-seal')?.remove();
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.id = 'ra-embed-verified-seal';
    s.src = SRC;
    s.async = true;
    s.dataset.id = dataId;
    s.dataset.target = 'ra-verified-seal';
    s.dataset.model = modelo;
    div.appendChild(s);
    return () => {
      s.remove();
      div.replaceChildren();
    };
  }, [dataId, modelo]);
  return (
    <div className="vt-selo-ra" data-testid="vt-selo-ra">
      <div id="ra-verified-seal" ref={caixa} />
    </div>
  );
}
