import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { formatMoeda, formatNumero } from '@/lib/masks';
import { restante, useAgora } from '@/lib/relogio';
import {
  NOME_FAIXA,
  disponivelDe,
  itensParaEnvio,
  mascararWhatsapp,
  limparCarrinho,
  corDaBolinha,
  fotosDaLinha,
  lucroNaProximaFaixa,
  lucroPorPeca,
  precosPorFaixa,
  progressoFaixa,
  pecasDoModelo,
  proximaFaixa,
  resumoPedido,
  somar,
  textoKit,
  totalPecas,
  type Carrinho,
  type CorPub,
  type Faixas,
  type LinhaPub,
  type ModeloPub,
  type VitrinePub,
} from './calculo';
import { useFundoDaCor } from './amostra';
import { baixarKit, copiarTexto } from './kit';
import { Pagamento, type AcessoPagamento } from './Pagamento';
import './vitrine.css';

/**
 * Vitrine pública de atacado (Fase 1) — o link que o cliente abre no celular:
 * feed por linha e categoria, grade por cor × tamanho, carrinho salvo no
 * aparelho, kit pra anunciar e o ENVIO do pedido, que entra no Betinna com
 * origem VITRINE e preço recalculado no servidor.
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
  const [enviado, setEnviado] = useState<Enviado | null>(null);
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

  const corAtual = (m: ModeloPub): CorPub =>
    m.cores.find((c) => c.id === corDe[m.id]) ?? m.cores[0];
  const linhaNoModelo = (m: ModeloPub): LinhaPub =>
    m.linhas.find((l) => l.linhaId === linhaId) ?? m.linhas[0];
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
          <Marca nome={v.empresa.nome} logoUrl={v.empresa.logoUrl} />
          {/* Pra quem tem acesso à plataforma (equipe, representante). */}
          <Link to="/login" className="vt-entrar" data-testid="vt-entrar">
            Entrar
          </Link>
        </div>
        {v.linhas.length > 1 && (
          <div className="vt-linhas" role="group" aria-label="Linha">
            {v.linhas.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={linhaId === l.id}
                onClick={() => setLinhaId(l.id)}
              >
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

      <div className="vt-feed" ref={feed} data-bag={pecas > 0 || undefined}>
        {lista.map((m, i) => {
          const cor = corAtual(m);
          const l = linhaNoModelo(m);
          return (
            <article key={m.id} className="vt-slide" data-testid={`vt-slide-${m.id}`}>
              <div className="vt-stage">
                <Carrossel
                  key={`${cor.id}:${l.linhaId}`}
                  cor={{ ...cor, fotos: fotosDaLinha(cor, l.linhaId) }}
                  nome={m.nome}
                  onAbrir={() => setPdp(m)}
                />
                <NomeDaCor cor={cor} />
                {i === 0 && lista.length > 1 && <div className="vt-hint">deslize pra cima ↑</div>}
              </div>
              <div className="vt-info">
                <div className="vt-row">
                  <span className="vt-over">
                    {[m.categoria?.nome, l.nome].filter(Boolean).join(' · ')}
                  </span>
                  <Bolinhas
                    m={m}
                    cor={cor}
                    onCor={(id) => setCorDe((s) => ({ ...s, [m.id]: id }))}
                  />
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
                <PrecoCompacto l={l} f={v.faixas} />
                <div className="vt-row">
                  <button type="button" className="vt-link" onClick={() => setKit(m)}>
                    Material de divulgação
                  </button>
                  <button
                    type="button"
                    className="vt-cta"
                    onClick={() => setGrade(m)}
                    data-testid={`vt-grade-${m.id}`}
                  >
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
          f={v.faixas}
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
          slug={slug}
          v={v}
          carrinho={carrinho}
          onVoltar={() => setVerPedido(false)}
          onEditar={(m) => setGrade(m)}
          onEsvaziar={() => {
            setCarrinho({});
            setVerPedido(false);
            avisar('Pedido limpo');
          }}
          onEnviado={(e) => {
            setEnviado(e);
            setVerPedido(false);
            setCarrinho({});
          }}
        />
      )}

      {enviado && (
        <PedidoEnviado
          slug={slug}
          e={enviado}
          empresa={v.empresa.nome}
          onFechar={() => setEnviado(null)}
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
      {/* Contador DA FOTO (desta cor, nesta linha) — antes era a posição do
          modelo no feed, e parecia contagem de fotos errada. */}
      {cor.fotos.length > 1 && (
        <div className="vt-counter" data-testid="vt-contador-fotos">
          {idx + 1} / {cor.fotos.length}
        </div>
      )}
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

/** Botão que pede confirmação no próprio lugar (2º toque confirma). */
/** Logo nominal da empresa; sem logo (ou se ela não carregar), o nome. */
function Marca({ nome, logoUrl }: { nome: string; logoUrl: string | null }) {
  const [falhou, setFalhou] = useState(false);
  if (logoUrl && !falhou) return <img src={logoUrl} alt={nome} onError={() => setFalhou(true)} />;
  return <span className="vt-nome">{nome}</span>;
}

function BotaoZerar({
  rotulo,
  pergunta,
  onConfirmar,
  testid,
}: {
  rotulo: string;
  pergunta: string;
  onConfirmar: () => void;
  testid: string;
}) {
  const [certeza, setCerteza] = useState(false);
  useEffect(() => {
    if (!certeza) return;
    const t = setTimeout(() => setCerteza(false), 4000);
    return () => clearTimeout(t);
  }, [certeza]);
  return certeza ? (
    <button
      type="button"
      className="vt-zerar vt-zerar-sim"
      onClick={onConfirmar}
      data-testid={`${testid}-sim`}
    >
      {pergunta}
    </button>
  ) : (
    <button
      type="button"
      className="vt-zerar"
      onClick={() => setCerteza(true)}
      data-testid={testid}
    >
      {rotulo}
    </button>
  );
}

/** Nome da cor escolhida, discreto sobre a foto (reaparece suave a cada troca). */
function NomeDaCor({ cor }: { cor: CorPub }) {
  return (
    <span key={cor.id} className="vt-cor-nome" aria-live="polite">
      {cor.nome}
    </span>
  );
}

function Bolinhas({ m, cor, onCor }: { m: ModeloPub; cor: CorPub; onCor: (id: string) => void }) {
  return (
    <div className="vt-dots">
      {m.cores.map((c) => (
        <Bolinha key={c.id} c={c} ativa={c.id === cor.id} onCor={onCor} />
      ))}
    </div>
  );
}

function Bolinha({ c, ativa, onCor }: { c: CorPub; ativa: boolean; onCor: (id: string) => void }) {
  return (
    <button
      type="button"
      className="vt-dot"
      style={useFundoDaCor(corDaBolinha(c))}
      aria-label={c.nome}
      aria-pressed={ativa}
      onClick={() => onCor(c.id)}
    />
  );
}

/** Bolinha pequena da linha da grade (só mostra). */
function AmostraCor({ c }: { c: CorPub }) {
  return <i style={useFundoDaCor(corDaBolinha(c))} />;
}

/** Preço das faixas de cima (Volume, Atacadão) — o card mostra a Entrada. */
function OutrasFaixas({ l, f }: { l: LinhaPub; f: Faixas }) {
  const outras = precosPorFaixa(l, f).filter((x) => x.faixa !== 'entrada');
  if (!outras.length) return null;
  return (
    <div className="vt-faixas" data-testid="vt-outras-faixas">
      {outras.map((x) => {
        const lp = lucroPorPeca(x.preco, l.precoSugerido);
        return (
          <div key={x.faixa}>
            <small>
              {NOME_FAIXA[x.faixa]} · {formatNumero(x.minimo ?? 0)}+ peças
            </small>
            <b>{formatMoeda(x.preco)}</b>
            {lp && <span className="vt-pct">lucro {formatMoeda(lp.lucro)}/peça</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Preço no FEED, enxuto: a foto é o produto, o preço acompanha. Entrada,
 * revenda e lucro numa linha; as faixas de cima numa linha fina embaixo.
 * A página do modelo mostra o bloco completo (lucro por faixa etc.).
 */
function PrecoCompacto({ l, f }: { l: LinhaPub; f: Faixas }) {
  const outras = precosPorFaixa(l, f).filter((x) => x.faixa !== 'entrada');
  const lp = lucroPorPeca(l.precoEntrada, l.precoSugerido);
  if (l.precoEntrada === null) {
    return (
      <div className="vt-preco" data-testid="vt-preco">
        <div className="vt-preco-l">
          <div>
            <small>Atacado</small>
            <span className="vt-na">preço sob consulta</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="vt-preco" data-testid="vt-preco">
      <div className="vt-preco-l">
        <div>
          <small>{outras.length ? 'Entrada' : 'Atacado'}</small>
          <b>{formatMoeda(l.precoEntrada)}</b>
        </div>
        {l.precoSugerido !== null && (
          <div>
            <small>Revenda</small>
            <b>{formatMoeda(l.precoSugerido)}</b>
          </div>
        )}
        {lp && (
          <div className="vt-win">
            <small>
              Seu lucro <span className="vt-pct">+{lp.pct}%</span>
            </small>
            <b>{formatMoeda(lp.lucro)}</b>
          </div>
        )}
      </div>
      {outras.length > 0 && (
        <div className="vt-preco-faixas">
          {outras.map((x) => (
            <span key={x.faixa}>
              <em>
                {NOME_FAIXA[x.faixa]} {formatNumero(x.minimo ?? 0)}+
              </em>
              {formatMoeda(x.preco)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BlocoLucro({ l, f }: { l: LinhaPub; f: Faixas }) {
  return (
    <>
      <BlocoLucroEntrada l={l} rotulo={precosPorFaixa(l, f).length > 1 ? 'Entrada' : 'Atacado'} />
      <OutrasFaixas l={l} f={f} />
    </>
  );
}

function BlocoLucroEntrada({ l, rotulo }: { l: LinhaPub; rotulo: string }) {
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
          <small>{rotulo} · por peça</small>
          <b>{formatMoeda(atacado)}</b>
        </div>
      </div>
    );
  }
  return (
    <div className="vt-lucro">
      <div>
        <small>{rotulo}</small>
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
  f,
  onCor,
  onFechar,
  onGrade,
  onKit,
}: {
  m: ModeloPub;
  cor: CorPub;
  l: LinhaPub;
  f: Faixas;
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
        <Carrossel
          key={`${cor.id}:${l.linhaId}`}
          cor={{ ...cor, fotos: fotosDaLinha(cor, l.linhaId) }}
          nome={m.nome}
        />
        <NomeDaCor cor={cor} />
      </div>
      <div className="vt-pdp-body">
        <div className="vt-row">
          {m.categoria && <span className="vt-over">{m.categoria.nome}</span>}
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
        <BlocoLucro l={l} f={f} />
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
          <video
            key={vd.url}
            className="vt-video"
            src={vd.url}
            controls
            preload="metadata"
            playsInline
          />
        ))}
        <button type="button" className="vt-kitlink" onClick={onKit}>
          <div>
            <b>Vai anunciar em marketplace?</b>
            <span>Baixe as fotos e a descrição prontas deste modelo</span>
          </div>
          <i>Baixar →</i>
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
  const capaFoto = m.cores[0] ? corDaBolinha(m.cores[0]).fotos[0] : undefined;
  const capa = capaFoto?.thumbUrl ?? capaFoto?.url;

  return (
    <>
      <div className="vt-scrim" onClick={onFechar} />
      <section className="vt-sheet" role="dialog" aria-label={`Montar grade · ${m.nome}`}>
        <div className="vt-grab" />
        <div className="vt-sh-head">
          {capa && <img src={capa} alt="" />}
          <div>
            {m.categoria && <span className="vt-over">{m.categoria.nome}</span>}
            <div className="vt-name">{m.nome}</div>
          </div>
        </div>
        <div className="vt-mode">
          {m.linhas.length > 1 && (
            <div className="vt-seg">
              {m.linhas.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={x.id === linha.id}
                  onClick={() => setLinha(x)}
                >
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
                <AmostraCor c={c} />
                {c.nome}
                <button
                  type="button"
                  className="vt-full"
                  onClick={() => {
                    let novo = carrinho;
                    for (const t of linha.tamanhos)
                      novo = somar(novo, m.id, c.id, t.id, delta, disponivelDe(m, c.id, t.id));
                    onMudar(novo);
                  }}
                >
                  {modo === 'por' ? '+' : '−'} grade completa
                </button>
              </div>
              <div
                className="vt-cells"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(linha.tamanhos.length, 6)}, 1fr)`,
                }}
              >
                {linha.tamanhos.map((t) => {
                  const q = carrinho[m.id]?.[c.id]?.[t.id] ?? 0;
                  const teto = disponivelDe(m, c.id, t.id);
                  // Esgotado: apagado e sem clique (a não ser pra tirar o que já estava).
                  const esgotado = teto === 0 && q === 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`vt-cell ${q ? 'vt-has' : ''} ${esgotado ? 'vt-off' : ''}`}
                      // No limite o "+" só não soma (somar já corta no teto); desabilitar
                      // apagaria a casa como se estivesse esgotada.
                      disabled={esgotado}
                      aria-label={
                        esgotado
                          ? `${c.nome}, ${t.nome}: esgotado`
                          : `${c.nome}, ${t.nome}: ${q} peças`
                      }
                      onClick={() => onMudar(somar(carrinho, m.id, c.id, t.id, delta, teto))}
                    >
                      <b>{t.nome}</b>
                      <span>{esgotado ? '—' : q}</span>
                      {teto !== null && !esgotado && teto <= 20 && <small>resta {teto}</small>}
                      {esgotado && <small>esgotado</small>}
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
          {pecasDoModelo(carrinho, m.id) > 0 && (
            <BotaoZerar
              rotulo="Limpar grade"
              pergunta="Sim, limpar"
              testid="vt-zerar-modelo"
              onConfirmar={() => {
                const c = { ...carrinho };
                delete c[m.id];
                onMudar(c);
              }}
            />
          )}
          <button type="button" className="vt-cta" onClick={onFechar}>
            Pronto
          </button>
        </div>
      </section>
    </>
  );
}

function FolhaKit({
  m,
  onFechar,
  avisar,
}: {
  m: ModeloPub;
  onFechar: () => void;
  avisar: (t: string) => void;
}) {
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
      <section className="vt-sheet" role="dialog" aria-label={`Material de divulgação · ${m.nome}`}>
        <div className="vt-grab" />
        <div className="vt-sh-head">
          <div>
            <span className="vt-over">Material de divulgação</span>
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
              onClick={async () =>
                avisar(
                  (await copiarTexto(texto)) ? 'Descrição copiada' : 'Selecione o texto e copie',
                )
              }
            >
              Copiar descrição
            </button>
            <button
              type="button"
              className="vt-cta"
              disabled={!!baixando}
              onClick={() => void baixar(false)}
            >
              {baixando ?? 'Baixar fotos (.zip)'}
            </button>
          </div>
          {m.videos.length > 0 && (
            <button
              type="button"
              className="vt-link"
              disabled={!!baixando}
              onClick={() => void baixar(true)}
            >
              Baixar fotos + vídeos (.zip, ~{Math.ceil(mbVideos)} MB de vídeo)
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function SeuPedido({
  slug,
  v,
  carrinho,
  onVoltar,
  onEditar,
  onEnviado,
  onEsvaziar,
}: {
  slug: string;
  v: VitrinePub;
  carrinho: Carrinho;
  onVoltar: () => void;
  onEditar: (m: ModeloPub) => void;
  onEnviado: (e: Enviado) => void;
  onEsvaziar: () => void;
}) {
  const [envio, setEnvio] = useState(false);
  const r = resumoPedido(carrinho, v);
  const prox = proximaFaixa(r.pecas, v.faixas);
  const itens = v.modelos.filter((m) => pecasDoModelo(carrinho, m.id) > 0);
  const barra = progressoFaixa(r.pecas, v.faixas);
  const ganho = lucroNaProximaFaixa(carrinho, v);

  return (
    <section className="vt-cart" aria-label="Seu pedido">
      <header>
        <button type="button" className="vt-back" onClick={onVoltar} aria-label="Voltar">
          ←
        </button>
        <h2>Seu pedido</h2>
        {r.pecas > 0 && (
          <BotaoZerar
            rotulo="Limpar pedido"
            pergunta="Sim, limpar tudo"
            testid="vt-esvaziar"
            onConfirmar={onEsvaziar}
          />
        )}
      </header>
      <div className="vt-list">
        {itens.length === 0 ? (
          <div className="vt-empty">
            Seu pedido está vazio. Volte à vitrine e monte a grade de um modelo.
          </div>
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
            const capa = m.cores[0] ? corDaBolinha(m.cores[0]).fotos[0] : undefined;
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
                Há modelo com preço sob consulta — o total é confirmado pela {v.empresa.nome} depois
                do pedido.
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
                {formatNumero(r.pecas)} de {formatNumero(barra.alvo)} peças
              </span>
            </div>
            <div className="vt-bar">
              <i style={{ width: `${barra.pct}%` }} />
            </div>
            <div className="vt-tiers">
              <b>{NOME_FAIXA[r.faixa]}</b>
              {prox && <span>{NOME_FAIXA[prox.faixa]}</span>}
            </div>
            <span className="vt-muted" data-testid="vt-prox-faixa">
              {ganho ? (
                <>
                  Adicione {formatNumero(ganho.faltam)} peças para seu lucro ser{' '}
                  <b className="vt-ganho">{formatMoeda(ganho.lucro)}</b> (faixa{' '}
                  {NOME_FAIXA[ganho.faixa]}).
                </>
              ) : prox ? (
                `Adicione ${formatNumero(prox.faltam)} peças pra chegar na faixa ${NOME_FAIXA[prox.faixa]}.`
              ) : (
                `Você chegou na faixa ${NOME_FAIXA.atacadao}, o melhor preço.`
              )}
            </span>
            {textoMinimo(r, v) && (
              <span className="vt-aviso" data-testid="vt-falta-minimo">
                {textoMinimo(r, v)}
              </span>
            )}
          </div>
        )}
      </div>
      <footer>
        <button
          type="button"
          className="vt-cta"
          data-testid="vt-enviar"
          disabled={itens.length === 0 || r.faltamMinimo > 0 || r.faltaValor > 0}
          onClick={() => setEnvio(true)}
        >
          Enviar pedido · {r.pecas} {r.pecas === 1 ? 'peça' : 'peças'}
        </button>
        <span className="vt-byline">
          feito com <b>Betinna.ai</b>
        </span>
      </footer>
      {envio && (
        <FolhaEnvio
          slug={slug}
          empresa={v.empresa.nome}
          carrinho={carrinho}
          resumo={r}
          onFechar={() => setEnvio(false)}
          onEnviado={onEnviado}
        />
      )}
    </section>
  );
}

/** "Faltam 30 peças ou R$ 120,00 pro pedido mínimo." — null quando já atingiu. */
function textoMinimo(r: ReturnType<typeof resumoPedido>, v: VitrinePub): string | null {
  const pecas =
    r.faltamMinimo > 0 ? `${r.faltamMinimo} ${r.faltamMinimo === 1 ? 'peça' : 'peças'}` : '';
  const valor = r.faltaValor > 0 ? formatMoeda(r.faltaValor) : '';
  if (!pecas && !valor) return null;
  if (pecas && valor)
    return `Faltam ${pecas} ${r.minimoOu ? 'ou' : 'e'} ${valor} pro pedido mínimo.`;
  if (valor)
    return `Faltam ${valor} pro pedido mínimo de ${formatMoeda(v.pedidoMinimo?.valorMin ?? 0)}.`;
  return `Pedido mínimo: faltam ${pecas}.`;
}

interface Enviado {
  numero: string;
  pecas: number;
  total: number;
  aConfirmar: boolean;
  /** Até quando as peças ficam reservadas (estoque próprio). null = sem reserva. */
  reservaExpiraEm: string | null;
  /** Pagamento online ligado: abre Pix/cartão. null = combina no WhatsApp. */
  pagamento: AcessoPagamento | null;
  /** O documento digitado no envio já vem preenchido na hora de pagar. */
  cpfCnpj: string;
}

interface Contato {
  nome: string;
  whatsapp: string;
  cidade: string;
  uf: string;
  cpfCnpj: string;
}

// Quem compra de novo não digita tudo outra vez (fica só neste aparelho).
const CHAVE_CONTATO = 'vitrine:contato';
const CONTATO_VAZIO: Contato = { nome: '', whatsapp: '', cidade: '', uf: '', cpfCnpj: '' };

function lerContato(): Contato {
  try {
    const raw = localStorage.getItem(CHAVE_CONTATO);
    return raw ? { ...CONTATO_VAZIO, ...(JSON.parse(raw) as Partial<Contato>) } : CONTATO_VAZIO;
  } catch {
    return CONTATO_VAZIO;
  }
}

function FolhaEnvio({
  slug,
  empresa,
  carrinho,
  resumo,
  onFechar,
  onEnviado,
}: {
  slug: string;
  empresa: string;
  carrinho: Carrinho;
  resumo: ReturnType<typeof resumoPedido>;
  onFechar: () => void;
  onEnviado: (e: Enviado) => void;
}) {
  const [f, setF] = useState<Contato>(lerContato);
  const [isca, setIsca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudar = (k: keyof Contato, valor: string) => setF((x) => ({ ...x, [k]: valor }));
  const pronto = f.nome.trim().length >= 2 && f.whatsapp.replace(/\D/g, '').length >= 10;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!pronto || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<{
        numero: string;
        totalPecas: number;
        total: number;
        reservaExpiraEm?: string | null;
        pagamento?: AcessoPagamento | null;
      }>(
        `/public/vitrine/${encodeURIComponent(slug)}/pedido`,
        {
          nome: f.nome.trim(),
          whatsapp: f.whatsapp,
          cidade: f.cidade.trim(),
          uf: f.uf.trim(),
          cpfCnpj: f.cpfCnpj.trim(),
          site: isca,
          itens: itensParaEnvio(carrinho),
        },
        { skipAuth: true },
      );
      try {
        localStorage.setItem(CHAVE_CONTATO, JSON.stringify(f));
      } catch {
        /* sem armazenamento: só não lembra da próxima vez */
      }
      onEnviado({
        numero: r.numero,
        pecas: r.totalPecas,
        total: r.total,
        aConfirmar: resumo.aConfirmar,
        reservaExpiraEm: r.reservaExpiraEm ?? null,
        pagamento: r.pagamento ?? null,
        cpfCnpj: f.cpfCnpj.trim(),
      });
    } catch (e) {
      setErro(
        e instanceof ApiError && e.status === 429
          ? 'Muitos envios seguidos. Espere alguns minutos e tente de novo.'
          : e instanceof ApiError && e.status >= 500
            ? 'Não foi possível enviar agora. Seu pedido continua salvo — tente de novo em instantes.'
            : apiErrorMessage(e),
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="vt-scrim" onClick={onFechar} />
      <form className="vt-sheet vt-envio" onSubmit={enviar} aria-label="Enviar pedido">
        <div className="vt-grab" />
        <div className="vt-sh-head">
          <div>
            <div className="vt-name">Enviar pedido</div>
            <span className="vt-muted">
              A {empresa} confirma tudo com você pelo WhatsApp antes de separar.
            </span>
          </div>
        </div>
        <div className="vt-form">
          <label>
            Seu nome ou da loja
            <input
              value={f.nome}
              onChange={(e) => mudar('nome', e.target.value)}
              autoComplete="name"
              maxLength={120}
              required
              data-testid="vt-f-nome"
            />
          </label>
          <label>
            WhatsApp com DDD
            <input
              value={f.whatsapp}
              onChange={(e) => mudar('whatsapp', mascararWhatsapp(e.target.value))}
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(47) 99999-1234"
              required
              data-testid="vt-f-whatsapp"
            />
          </label>
          <div className="vt-dupla">
            <label>
              Cidade
              <input
                value={f.cidade}
                onChange={(e) => mudar('cidade', e.target.value)}
                autoComplete="address-level2"
                maxLength={80}
                data-testid="vt-f-cidade"
              />
            </label>
            <label>
              UF
              <input
                value={f.uf}
                onChange={(e) =>
                  mudar(
                    'uf',
                    e.target.value
                      .replace(/[^a-z]/gi, '')
                      .slice(0, 2)
                      .toUpperCase(),
                  )
                }
                autoComplete="address-level1"
                data-testid="vt-f-uf"
              />
            </label>
          </div>
          <label>
            <span>
              CPF ou CNPJ <small>(opcional)</small>
            </span>
            <input
              value={f.cpfCnpj}
              onChange={(e) => mudar('cpfCnpj', e.target.value)}
              inputMode="numeric"
              maxLength={20}
              data-testid="vt-f-doc"
            />
          </label>
          {/* Isca pra robô: fora da tela e fora do Tab. */}
          <input
            className="vt-isca"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={isca}
            onChange={(e) => setIsca(e.target.value)}
          />
          {erro && (
            <p className="vt-aviso" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="vt-sh-foot">
          <div>
            <strong>{resumo.pecas} peças</strong>
            <small>
              {resumo.aConfirmar ? 'total confirmado depois' : formatMoeda(resumo.investe)}
            </small>
          </div>
          <button
            type="submit"
            className="vt-cta"
            disabled={!pronto || enviando}
            data-testid="vt-f-enviar"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </>
  );
}

/** Minutos que a reserva ganha quando o cliente gera a cobrança (RESERVA_PAGANDO_MIN no servidor). */
const RESERVA_PAGANDO_MIN = 60;

function PedidoEnviado({
  slug,
  e,
  empresa,
  onFechar,
}: {
  slug: string;
  e: Enviado;
  empresa: string;
  onFechar: () => void;
}) {
  const [reservaAte, setReservaAte] = useState(e.reservaExpiraEm);
  const [pago, setPago] = useState(false);
  const agora = useAgora(Boolean(reservaAte) && !pago);
  const relogio = pago ? null : restante(reservaAte, agora);
  const online = Boolean(e.pagamento) && !e.aConfirmar;
  const aoPagar = useCallback(() => setPago(true), []);
  const aoComecar = useCallback(() => {
    // Mesma conta do servidor: quem está pagando não perde a peça pelo relógio.
    setReservaAte((r) =>
      r ? new Date(Date.now() + RESERVA_PAGANDO_MIN * 60_000).toISOString() : r,
    );
  }, []);
  return (
    <section className="vt-cart vt-ok" aria-label="Pedido enviado" data-testid="vt-enviado">
      <div className="vt-ok-corpo">
        <div className="vt-ok-selo" aria-hidden="true">
          ✓
        </div>
        <h2>Pedido enviado!</h2>
        <p>
          Recebemos o pedido <b>{e.numero}</b> com {e.pecas} peças
          {e.aConfirmar ? '' : ` (${formatMoeda(e.total)})`}.
        </p>
        {relogio &&
          (relogio.vencido ? (
            <p className="vt-reserva vt-reserva-fim" data-testid="vt-reserva">
              A reserva das peças venceu. Fale com a {empresa} no WhatsApp pra reativar o pedido.
            </p>
          ) : (
            <p className="vt-reserva" data-testid="vt-reserva">
              Suas peças ficam reservadas por <b>{relogio.texto}</b>
              <small>Pague dentro desse prazo pra garantir o pedido.</small>
            </p>
          ))}
        {online && e.pagamento ? (
          <Pagamento
            slug={slug}
            acesso={e.pagamento}
            docInicial={e.cpfCnpj}
            empresa={empresa}
            onPago={aoPagar}
            onComecou={aoComecar}
          />
        ) : (
          <p className="vt-muted">
            A {empresa} vai te chamar no WhatsApp pra confirmar{e.aConfirmar ? ' os preços,' : ''} o
            frete e o pagamento.
          </p>
        )}
      </div>
      <footer>
        <button type="button" className="vt-cta" onClick={onFechar}>
          Voltar à vitrine
        </button>
        <span className="vt-byline">
          feito com <b>Betinna.ai</b>
        </span>
      </footer>
    </section>
  );
}
