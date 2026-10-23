/**
 * Esqueleto da vitrine — o "modo ghost" (Léo, 23/10).
 *
 * Os mesmos blocos da tela de verdade (marca, linhas, categorias, foto grande,
 * bolinhas de cor, nome, etiquetas, simulador e os dois botões), em cinza e sem
 * nenhum texto. Aparece enquanto carrega e enquanto não há internet.
 *
 * Reaproveita as classes de layout da vitrine (vt-top, vt-slide, vt-stage,
 * vt-info, vt-row): se a tela mudar de forma, o esqueleto muda junto.
 * Leitor de tela ouve "Carregando a vitrine" — nada aparece escrito na tela.
 */
export function EsqueletoVitrine() {
  return (
    <div className="vt-esq" data-testid="vt-esqueleto" role="status" aria-busy="true">
      <span className="vt-sr">Carregando a vitrine</span>
      <div className="vt-top" aria-hidden="true">
        <div className="vt-brand">
          <span className="vt-osso" style={{ width: 26, height: 26, borderRadius: '50%' }} />
          <span className="vt-osso" style={{ width: 96, height: 16 }} />
          <span className="vt-osso" style={{ width: 64, height: 24, borderRadius: 999, marginLeft: 'auto' }} />
        </div>
        <span className="vt-osso" style={{ display: 'block', height: 34, marginTop: 12, borderRadius: 10 }} />
        <div className="vt-esq-cats">
          {[44, 58, 50, 66].map((w, i) => (
            <span key={i} className="vt-osso" style={{ width: w, height: 12 }} />
          ))}
        </div>
      </div>
      <div className="vt-slide" aria-hidden="true">
        <div className="vt-stage vt-osso-stage" />
        <div className="vt-info">
          <div className="vt-row vt-row-cores">
            {[0, 1, 2].map((i) => (
              <span key={i} className="vt-osso" style={{ width: 22, height: 22, borderRadius: '50%' }} />
            ))}
          </div>
          <span className="vt-osso" style={{ width: '62%', height: 22 }} />
          <div className="vt-row" style={{ justifyContent: 'flex-start' }}>
            <span className="vt-osso" style={{ width: 70, height: 20, borderRadius: 999 }} />
            <span className="vt-osso" style={{ width: 54, height: 20, borderRadius: 999 }} />
          </div>
          <span className="vt-osso" style={{ height: 64, borderRadius: 14 }} />
          <div className="vt-row">
            <span className="vt-osso" style={{ width: 90, height: 14 }} />
            <span className="vt-osso" style={{ width: 150, height: 50, borderRadius: 14 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
