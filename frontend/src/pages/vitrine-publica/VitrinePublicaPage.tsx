import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { formatMoeda } from '@/lib/masks';
import {
  NOME_FAIXA,
  limparCarrinho,
  lucroPorPeca,
  pecasDoModelo,
  proximaFaixa,
  resumoPedido,
  somar,
  textoKit,
  totalPecas,
  type Carrinho,
  type CorPub,
  type LinhaPub,
  type ModeloPub,
  type VitrinePub,
} from './calculo';
import { baixarKit, copiarTexto } from './kit';
import './vitrine.css';

/**
 * Vitrine pública de atacado (Fase 1, entrega 3) — o link que o cliente abre
 * no celular: feed por linha e categoria, grade por cor × tamanho, carrinho
 * salvo no aparelho e kit pra anunciar. O ENVIO do pedido é a entrega 4.
 */

const FONTES =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400;500;600;700&display=swap';

function useFontes() {
  useEffect(() => {
    if (document.querySelector('link[data-vitrine-fontes]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FONTES;
    l.dataset.vitrineFontes = '1';
    document.head.appendChild(l);
  }, []);
}

const chaveCarrinho = (slug: string) => `vitrine:carrinho:${slug}`;

function lerCarrinho(slug: string): Carrinho {
  try {
    const raw = localStorage.getItem(chaveCarrinho(slug));
    return raw ? (JSON.parse(raw) as Carrinho) : {};
  } catch {
    return {};
  }
}

export default function VitrinePublicaPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  useFontes();
  const [dados, setDados] = useState<VitrinePub | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Vitrine de atacado';
    api
      .get<VitrinePub>(`/public/vitrine/${encodeURIComponent(slug)}`, { skipAuth: true })
      .then((v) => {
        setDados(v);
        document.title = `${v.empresa.nome} · Atacado`;
      })
      .catch((e) =>
        setErro(
          e instanceof ApiError && e.status === 404
            ? 'Esta vitrine não está disponível.'
            : 'Não foi possível carregar a vitrine. Tente de novo em instantes.',
        ),
      );
  }, [slug]);

  return (
    <div className="vt-app">
      <div className="vt-tela">
        {erro ? (
          <div className="vt-centro">
            <div>
              <h2>Vitrine indisponível</h2>
              <p className="vt-muted">{erro}</p>
            </div>
          </div>
        ) : !dados ? (
          <div className="vt-centro">
            <p className="vt-muted">Carregando a vitrine…</p>
          </div>
        ) : (
          <Vitrine slug={slug} v={dados} />
        )}
      </div>
    </div>
  );
}

function Vitrine({ slug, v }: { slug: string; v: VitrinePub }) {
  const [linhaId, setLinhaId] = useState(v.linhas[0]?.id ?? '');
  const [cat, setCat] = useState<string>('todos');
  const [corDe, setCorDe] = useState<Record<string, string>>({});
  const [carrinho, setCarrinho] = useState<Carrinho>(() => limparCarrinho(lerCarrinho(slug), v));
  const [pdp, setPdp] = useState<ModeloPub | null>(null);
  const [grade, setGrade] = useState<ModeloPub | null>(null);
  const [kit, setKit] = useState<ModeloPub | null>(null);
  const [verPedido, setVerPedido] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  // Carrinho salvo no aparelho: sair e voltar mantém o pedido montado.
  useEffect(() => {
    try {
      localStorage.setItem(chaveCarrinho(slug), JSON.stringify(carrinho));
    } catch {
      /* modo privado / armazenamento cheio: segue só em memória */
    }
  }, [carrinho, slug]);

  const avisar = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 1600);
  }, []);

  const daLinha = useMemo(
    () => v.modelos.filter((m) => m.linhas.some((l) => l.linhaId === linhaId)),
    [v.modelos, linhaId],
  );
  const categorias = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of daLinha) if (m.categoria) map.set(m.categoria.id, m.categoria.nome);
    return [...map.entries()];
  }, [daLinha]);
  const lista = cat === 'todos' ? daLinha : daLinha.filter((m) => m.categoria?.id === cat);

  useEffect(() => {
    if (cat !== 'todos' && !categorias.some(([id]) => id === cat)) setCat('todos');
  }, [categorias, cat]);
  useEffect(() => {
    feed.current?.scrollTo({ top: 0 });
  }, [linhaId, cat]);

  const corAtual = (m: ModeloPub): CorPub => m.cores.find((c) => c.id === corDe[m.id]) ?? m.cores[0];
  const linhaNoModelo = (m: ModeloPub): LinhaPub => m.linhas.find((l) => l.linhaId === linhaId) ?? m.linhas[0];
  const pecas = totalPecas(carrinho);
  const modelosNoPedido = Object.keys(carrinho).length;

  if (v.modelos.length === 0) {
    return (
      <div className="vt-centro">
        <div>
          <h2>{v.empresa.nome}</h2>
          <p className="vt-muted">A vitrine está sendo montada. Volte em breve.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="vt-top">
        <div className="vt-brand">
          {v.empresa.logoUrl ? (
            <img src={v.empresa.logoUrl} alt={v.empresa.nome} />
          ) : (
            <span className="vt-nome">{v.empresa.nome}</span>
          )}
          <span className="vt-atac">Atacado</span>
        </div>
        {v.linhas.length > 1 && (
          <div className="vt-linhas" role="group" aria-label="Linha">
            {v.linhas.map((l) => (
              <button key={l.id} type="button" aria-pressed={linhaId === l.id} onClick={() => setLinhaId(l.id)}>
                {l.nome}
              </button>
            ))}
          </div>
        )}
        {categorias.length > 1 && (
          <div className="vt-cats" role="group" aria-label="Categoria">
            <button type="button" aria-pressed={cat === 'todos'} onClick={() => setCat('todos')}>
              Todos
            </button>
            {categorias.map(([id, nome]) => (
              <button key={id} type="button" aria-pressed={cat === id} onClick={() => setCat(id)}>
                {nome}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="vt-feed" ref={feed}>
        {lista.map((m, i) => {
          const cor = corAtual(m);
          const l = linhaNoModelo(m);
          return (
            <article key={m.id} className="vt-slide" data-testid={`vt-slide-${m.id}`}>
              <div className="vt-stage">
                <Carrossel key={cor.id} cor={cor} nome={m.nome} onAbrir={() => setPdp(m)} />
                <div className="vt-counter">
                  {String(i + 1).padStart(2, '0')} / {String(lista.length).padStart(2, '0')}
                  {m.categoria ? ` · ${m.categoria.nome}` : ''}
                </div>
                {i === 0 && lista.length > 1 && <div className="vt-hint">deslize pra cima ↑</div>}
              </div>
              <div className="vt-info">
                <div className="vt-row">
                  <span className="vt-over">
                    {m.categoria?.nome ?? 'Atacado'} · {l.nome}
                  </span>
                  <Bolinhas m={m} cor={cor} onCor={(id) => setCorDe((s) => ({ ...s, [m.id]: id }))} />
                </div>
                <h2 className="vt-name">{m.nome}</h2>
                {m.etiquetas.length > 0 && (
                  <div className="vt-tags">
                    {m.etiquetas.map((t) => (
                      <span key={t} className="vt-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <BlocoLucro l={l} />
                <div className="vt-row">
                  <button type="button" className="vt-link" onClick={() => setKit(m)}>
                    Kit pra anunciar
                  </button>
                  <button type="button" className="vt-cta" onClick={() => setGrade(m)} data-testid={`vt-grade-${m.id}`}>
                    Montar grade
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {lista.length === 0 && (
          <div className="vt-centro">
            <p className="vt-muted">Nenhum modelo nesta categoria.</p>
          </div>
        )}
      </div>

      {pdp && (
        <PaginaModelo
          m={pdp}
          cor={corAtual(pdp)}
          l={linhaNoModelo(pdp)}
          onCor={(id) => setCorDe((s) => ({ ...s, [pdp.id]: id }))}
          onFechar={() => setPdp(null)}
          onGrade={() => {
            setGrade(pdp);
            setPdp(null);
          }}
          onKit={() => setKit(pdp)}
        />
      )}

      {pecas > 0 && !verPedido && (
        <div className="vt-bag" data-testid="vt-bag">
          <div>
            <div className="vt-q">
              {pecas} {pecas === 1 ? 'peça' : 'peças'}
            </div>
            <div className="vt-s">
              {modelosNoPedido} {modelosNoPedido === 1 ? 'modelo' : 'modelos'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setToast(null);
              setVerPedido(true);
            }}
          >
            Ver pedido →
          </button>
        </div>
      )}

      {grade && (
        <FolhaGrade
          m={grade}
          linhaInicial={linhaNoModelo(grade)}
          carrinho={carrinho}
          onMudar={setCarrinho}
          onFechar={() => {
            const n = pecasDoModelo(carrinho, grade.id);
            setGrade(null);
            if (!verPedido && n) avisar(`${totalPecas(carrinho)} peças no pedido`);
          }}
        />
      )}

      {kit && <FolhaKit m={kit} onFechar={() => setKit(null)} avisar={avisar} />}

      {verPedido && (
        <SeuPedido
          v={v}
          carrinho={carrinho}
          onVoltar={() => setVerPedido(false)}
          onEditar={(m) => setGrade(m)}
        />
      )}

      {toast && <div className="vt-toast">{toast}</div>}
    </>
  );
}

/** Fotos da cor, uma por tela; deslizar pro lado troca de foto. */
function Carrossel({ cor, nome, onAbrir }: { cor: CorPub; nome: string; onAbrir?: () => void }) {
  const [idx, setIdx] = useState(0);
  return (
    <>
      <div
        className="vt-fotos"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {cor.fotos.map((f, i) => (
          <img
            key={f.url}
            src={f.url}
            alt={`${nome} · ${cor.nome} · foto ${i + 1}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            onClick={onAbrir}
          />
        ))}
      </div>
      {cor.fotos.length > 1 && (
        <div className="vt-pontos" aria-hidden>
          {cor.fotos.map((f, i) => (
            <i key={f.url} data-on={i === idx} />
          ))}
        </div>
      )}
    </>
  );
}

function Bolinhas({ m, cor, onCor }: { m: ModeloPub; cor: CorPub; onCor: (id: string) => void }) {
  return (
    <div className="vt-dots">
      {m.cores.map((c) => (
        <button
          key={c.id}
          type="button"
          className="vt-dot"
          style={{ background: c.hex }}
          aria-label={c.nome}
          aria-pressed={c.id === cor.id}
          onClick={() => onCor(c.id)}
        />
      ))}
    </div>
  );
}

function BlocoLucro({ l }: { l: LinhaPub }) {
  const atacado = l.precoEntrada;
  const lp = lucroPorPeca(atacado, l.precoSugerido);
  if (atacado === null) {
    return (
      <div className="vt-lucro vt-so-atacado">
        <div>
          <small>Atacado</small>
          <span className="vt-na">preço sob consulta</span>
        </div>
      </div>
    );
  }
  if (!lp) {
    return (
      <div className="vt-lucro vt-so-atacado">
        <div>
          <small>Atacado · por peça</small>
          <b>{formatMoeda(atacado)}</b>
        </div>
      </div>
    );
  }
  return (
    <div className="vt-lucro">
      <div>
        <small>Atacado</small>
        <b>{formatMoeda(atacado)}</b>
      </div>
      <div>
        <small>Revenda sugerida</small>
        <b>{formatMoeda(l.precoSugerido as number)}</b>
      </div>
      <div className="vt-win">
        <small>Seu lucro / peça</small>
        <b>{formatMoeda(lp.lucro)}</b>
        <span className="vt-pct">+{lp.pct}% sobre o custo</span>
      </div>
    </div>
  );
}

function PaginaModelo({
  m,
  cor,
  l,
  onCor,
  onFechar,
  onGrade,
  onKit,
}: {
  m: ModeloPub;
  cor: CorPub;
  l: LinhaPub;
  onCor: (id: string) => void;
  onFechar: () => void;
  onGrade: () => void;
  onKit: () => void;
}) {
  return (
    <section className="vt-pdp" aria-label={m.nome}>
      <button type="button" className="vt-close" onClick={onFechar} aria-label="Fechar">
        ✕
      </button>
      <div className="vt-stage" style={{ position: 'relative' }}>
        <Carrossel key={cor.id} cor={cor} nome={m.nome} />
      </div>
      <div className="vt-pdp-body">
        <div className="vt-row">
          <span className="vt-over">{m.categoria?.nome ?? 'Atacado'}</span>
          <Bolinhas m={m} cor={cor} onCor={onCor} />
        </div>
        <h2 className="vt-name" style={{ fontSize: 28 }}>
          {m.nome}
        </h2>
        {m.etiquetas.length > 0 && (
          <div className="vt-tags">
            {m.etiquetas.map((t) => (
              <span key={t} className="vt-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <BlocoLucro l={l} />
        <div className="vt-gl">
          {m.linhas.map((x) => (
            <div key={x.id}>
              <span>{x.nome}</span>
              <span>{x.tamanhos.map((t) => t.nome).join(' · ')}</span>
            </div>
          ))}
          {m.composicao && (
            <div>
              <span>Composição</span>
              <span>{m.composicao}</span>
            </div>
          )}
        </div>
        {m.descricao && <p>{m.descricao}</p>}
        {m.videos.map((vd) => (
          <video key={vd.url} className="vt-video" src={vd.url} controls preload="metadata" playsInline />
        ))}
        <button type="button" className="vt-kitlink" onClick={onKit}>
          <div>
            <b>Vai anunciar em marketplace?</b>
            <span>Baixe as fotos e a descrição prontas deste modelo</span>
          </div>
          <i>Kit →</i>
        </button>
        <button type="button" className="vt-cta" onClick={onGrade}>
          Montar grade
        </button>
      </div>
    </section>
  );
}

function FolhaGrade({
  m,
  linhaInicial,
  carrinho,
  onMudar,
  onFechar,
}: {
  m: ModeloPub;
  linhaInicial: LinhaPub;
  carrinho: Carrinho;
  onMudar: (c: Carrinho) => void;
  onFechar: () => void;
}) {
  const [linha, setLinha] = useState<LinhaPub>(linhaInicial);
  const [passo, setPasso] = useState(1);
  const [modo, setModo] = useState<'por' | 'tirar'>('por');
  const delta = modo === 'por' ? passo : -passo;
  const capa = m.cores[0]?.fotos[0]?.thumbUrl ?? m.cores[0]?.fotos[0]?.url;

  return (
    <>
      <div className="vt-scrim" onClick={onFechar} />
      <section className="vt-sheet" role="dialog" aria-label={`Montar grade · ${m.nome}`}>
        <div className="vt-grab" />
        <div className="vt-sh-head">
          {capa && <img src={capa} alt="" />}
          <div>
            <span className="vt-over">{m.categoria?.nome ?? 'Atacado'}</span>
            <div className="vt-name">{m.nome}</div>
          </div>
        </div>
        <div className="vt-mode">
          {m.linhas.length > 1 && (
            <div className="vt-seg">
              {m.linhas.map((x) => (
                <button key={x.id} type="button" aria-pressed={x.id === linha.id} onClick={() => setLinha(x)}>
                  {x.nome}
                </button>
              ))}
            </div>
          )}
          <div className="vt-seg">
            {[1, 6, 12].map((n) => (
              <button key={n} type="button" aria-pressed={passo === n} onClick={() => setPasso(n)}>
                +{n}
              </button>
            ))}
          </div>
          <div className="vt-seg">
            <button type="button" aria-pressed={modo === 'por'} onClick={() => setModo('por')}>
              Pôr
            </button>
            <button type="button" aria-pressed={modo === 'tirar'} onClick={() => setModo('tirar')}>
              Tirar
            </button>
          </div>
        </div>
        <div className="vt-matrix">
          {m.cores.map((c) => (
            <div key={c.id} className="vt-mrow">
              <div className="vt-rh">
                <i style={{ background: c.hex }} />
                {c.nome}
                <button
                  type="button"
                  className="vt-full"
                  onClick={() => {
                    let novo = carrinho;
                    for (const t of linha.tamanhos) novo = somar(novo, m.id, c.id, t.id, delta);
                    onMudar(novo);
                  }}
                >
                  {modo === 'por' ? '+' : '−'} grade completa
                </button>
              </div>
              <div className="vt-cells" style={{ gridTemplateColumns: `repeat(${Math.min(linha.tamanhos.length, 6)}, 1fr)` }}>
                {linha.tamanhos.map((t) => {
                  const q = carrinho[m.id]?.[c.id]?.[t.id] ?? 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`vt-cell ${q ? 'vt-has' : ''}`}
                      aria-label={`${c.nome}, ${t.nome}: ${q} peças`}
                      onClick={() => onMudar(somar(carrinho, m.id, c.id, t.id, delta))}
                    >
                      <b>{t.nome}</b>
                      <span>{q}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="vt-sh-foot">
          <div>
            <strong>{pecasDoModelo(carrinho, m.id)} peças</strong>
            <small>neste modelo</small>
          </div>
          <button type="button" className="vt-cta" onClick={onFechar}>
            Pronto
          </button>
        </div>
      </section>
    </>
  );
}

function FolhaKit({ m, onFechar, avisar }: { m: ModeloPub; onFechar: () => void; avisar: (t: string) => void }) {
  const [baixando, setBaixando] = useState<string | null>(null);
  const texto = textoKit(m);
  const totalFotos = m.cores.reduce((s, c) => s + c.fotos.length, 0);
  const mbVideos = m.videos.reduce((s, x) => s + (x.tamanhoBytes ?? 0), 0) / 1024 / 1024;

  async function baixar(incluirVideos: boolean) {
    setBaixando('Preparando…');
    try {
      await baixarKit(m, {
        incluirVideos,
        onProgresso: (f, t) => setBaixando(`Preparando ${f} de ${t}…`),
      });
      avisar('Kit baixado');
    } catch {
      avisar('Não foi possível baixar agora');
    } finally {
      setBaixando(null);
    }
  }

  return (
    <>
      <div className="vt-scrim" onClick={onFechar} />
      <section className="vt-sheet" role="dialog" aria-label={`Kit pra anunciar · ${m.nome}`}>
        <div className="vt-grab" />
        <div className="vt-sh-head">
          <div>
            <span className="vt-over">Kit pra anunciar</span>
            <div className="vt-name">{m.nome}</div>
          </div>
        </div>
        <div className="vt-kit">
          <ul>
            <li>
              Fotos separadas por cor
              <span>
                {totalFotos} fotos · {m.cores.map((c) => c.nome).join(', ')}
              </span>
            </li>
            <li>
              Título e descrição prontos<span>texto pra colar no anúncio</span>
            </li>
            {m.videos.map((vd, i) => (
              <li key={vd.url}>
                {vd.nomeArquivo ?? `Vídeo ${i + 1}`}
                <a className="vt-link" href={vd.url} download target="_blank" rel="noreferrer">
                  baixar vídeo
                </a>
              </li>
            ))}
          </ul>
          <div className="vt-desc">{texto}</div>
          <div className="vt-kitbtns">
            <button
              type="button"
              className="vt-ghost"
              onClick={async () => avisar((await copiarTexto(texto)) ? 'Descrição copiada' : 'Selecione o texto e copie')}
            >
              Copiar descrição
            </button>
            <button type="button" className="vt-cta" disabled={!!baixando} onClick={() => void baixar(false)}>
              {baixando ?? 'Baixar fotos (.zip)'}
            </button>
          </div>
          {m.videos.length > 0 && (
            <button type="button" className="vt-link" disabled={!!baixando} onClick={() => void baixar(true)}>
              Baixar fotos + vídeos (.zip, ~{Math.ceil(mbVideos)} MB de vídeo)
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function SeuPedido({
  v,
  carrinho,
  onVoltar,
  onEditar,
}: {
  v: VitrinePub;
  carrinho: Carrinho;
  onVoltar: () => void;
  onEditar: (m: ModeloPub) => void;
}) {
  const r = resumoPedido(carrinho, v);
  const prox = proximaFaixa(r.pecas, v.faixas);
  const itens = v.modelos.filter((m) => pecasDoModelo(carrinho, m.id) > 0);
  const alvo = v.faixas.minimoAtacadao ?? 500;

  return (
    <section className="vt-cart" aria-label="Seu pedido">
      <header>
        <button type="button" className="vt-back" onClick={onVoltar} aria-label="Voltar">
          ←
        </button>
        <h2>Seu pedido</h2>
      </header>
      <div className="vt-list">
        {itens.length === 0 ? (
          <div className="vt-empty">Seu pedido está vazio. Volte à vitrine e monte a grade de um modelo.</div>
        ) : (
          itens.map((m) => {
            const linhas: string[] = [];
            for (const c of m.cores) {
              for (const l of m.linhas) {
                const partes = l.tamanhos
                  .map((t) => ({ t, q: carrinho[m.id]?.[c.id]?.[t.id] ?? 0 }))
                  .filter((x) => x.q > 0)
                  .map((x) => `${x.t.nome} ${x.q}`);
                if (partes.length) linhas.push(`${c.nome} · ${l.nome}: ${partes.join('  ')}`);
              }
            }
            const capa = m.cores[0]?.fotos[0];
            return (
              <div key={m.id} className="vt-line">
                {capa ? <img src={capa.thumbUrl ?? capa.url} alt="" /> : <span />}
                <div>
                  <div className="vt-name">{m.nome}</div>
                  <div className="vt-g">
                    {linhas.map((x) => (
                      <div key={x}>{x}</div>
                    ))}
                  </div>
                  <div className="vt-foot">
                    <b>{pecasDoModelo(carrinho, m.id)} peças</b>
                    <button type="button" onClick={() => onEditar(m)}>
                      editar
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {itens.length > 0 && (
          <div className="vt-box">
            <h3>Quanto você lucra</h3>
            {r.aConfirmar ? (
              <p className="vt-muted">
                Há modelo com preço sob consulta — o total é confirmado pela {v.empresa.nome} depois do pedido.
              </p>
            ) : (
              <div className="vt-kv">
                <span>Você investe (faixa {NOME_FAIXA[r.faixa]})</span>
                <b>{formatMoeda(r.investe)}</b>
              </div>
            )}
            {r.lucro !== null && (
              <>
                <div className="vt-kv">
                  <span>Revendendo pelo sugerido</span>
                  <b>{formatMoeda(r.revende)}</b>
                </div>
                <div className="vt-kv vt-big">
                  <span>Lucro estimado</span>
                  <b>{formatMoeda(r.lucro)}</b>
                </div>
              </>
            )}
          </div>
        )}

        {itens.length > 0 && (
          <div className="vt-box">
            <div className="vt-kv">
              <span>Faixa de preço</span>
              <span className="vt-muted">
                {r.pecas} de {alvo} peças
              </span>
            </div>
            <div className="vt-bar">
              <i style={{ width: `${Math.min(100, (r.pecas / alvo) * 100)}%` }} />
            </div>
            <div className="vt-tiers">
              {(['entrada', 'volume', 'atacadao'] as const).map((fx) => (
                <span key={fx}>{r.faixa === fx ? <b>{NOME_FAIXA[fx]}</b> : NOME_FAIXA[fx]}</span>
              ))}
            </div>
            <span className="vt-muted">
              {prox
                ? `Faltam ${prox.faltam} peças pra faixa ${NOME_FAIXA[prox.faixa]}.`
                : 'Você chegou na faixa 500+, o melhor preço.'}
            </span>
            {r.faltamMinimo > 0 && (
              <span className="vt-aviso">Pedido mínimo: faltam {r.faltamMinimo} peças.</span>
            )}
          </div>
        )}
      </div>
      <footer>
        {/* Entrega 4: envio do pedido (nome, WhatsApp, cidade/UF, CPF/CNPJ opcional). */}
        <button type="button" className="vt-cta" disabled>
          Enviar pedido · em breve
        </button>
        <span className="vt-byline">
          feito com <b>Betinna.ai</b>
        </span>
      </footer>
    </section>
  );
}
