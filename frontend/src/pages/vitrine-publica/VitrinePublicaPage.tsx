import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  abrirPeloRodizio,
  corInicial,
  coresPorEstoque,
  fotosDaLinha,
  gradeDoCarrinho,
  avisoDaGrade,
  paresDe,
  preencherConjunto,
  sugestoesAntesDePagar,
  lucroNaProximaFaixa,
  progressoFaixa,
  quantidadesDoSimulador,
  simularPedido,
  pecasDoModelo,
  proximaFaixa,
  resumoPedido,
  somar,
  temLinha,
  textoKit,
  totalPecas,
  type Carrinho,
  type CorPub,
  type Faixas,
  type LinhaPub,
  type ModeloPub,
  type VitrinePub,
} from './calculo';
import { baixarKit, copiarTexto } from './kit';
import {
  Entrega,
  freteParaEnvio,
  freteResolvido,
  type Endereco,
  type EscolhaFrete,
  type FretePub,
} from './Entrega';
import { Pagamento, type AcessoPagamento } from './Pagamento';
import { atribuicaoParaEnvio, capturarAtribuicao, evento, iniciarPixel } from './pixel';
import './vitrine.css';

/**
 * Vitrine pública de atacado (Fase 1) — o link que o cliente abre no celular:
 * feed por linha e categoria, grade por cor × tamanho, carrinho salvo no
 * aparelho, material de divulgação e o ENVIO do pedido, que entra no Betinna com
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

/**
 * Código deste aparelho, pro rodízio da foto de abertura: cada cliente vê uma
 * foto diferente primeiro, e a mesma quando volta. Sem armazenamento (modo
 * privado), vale só nesta visita.
 */
const CHAVE_VISITANTE = 'vitrine:visitante';
function codigoDoVisitante(): string {
  const novo = () => Math.random().toString(36).slice(2, 12);
  try {
    const salvo = localStorage.getItem(CHAVE_VISITANTE);
    if (salvo) return salvo;
    const c = novo();
    localStorage.setItem(CHAVE_VISITANTE, c);
    return c;
  } catch {
    return novo();
  }
}

/** Fotos da cor × linha na ordem que ESTE cliente vê (rodízio da abertura). */
function fotosDoCliente(cor: CorPub, linhaId: string, visitante: string) {
  return abrirPeloRodizio(fotosDaLinha(cor, linhaId), `${cor.id}:${linhaId}`, visitante);
}

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
        // De onde o cliente veio (utm/fbclid) — guardado no aparelho pro pedido.
        capturarAtribuicao(window.location.href, document.referrer);
        if (v.pixel) iniciarPixel(v.pixel);
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
  // Modelo que estava na tela quando o lojista trocou pra uma linha que ele não
  // tem: fica no topo com o aviso, em vez de sumir (Léo, 07/10).
  const [fixado, setFixado] = useState<string | null>(null);
  const [visitante] = useState(codigoDoVisitante);
  const feed = useRef<HTMLDivElement>(null);
  // Peças do modelo quando a grade abriu — o que passar disso é AddToCart.
  const pecasAoAbrirGrade = useRef(0);

  /** Toque no logo: fecha o que estiver aberto e volta pro primeiro produto. */
  function irProInicio() {
    setPdp(null);
    setGrade(null);
    setKit(null);
    setVerPedido(false);
    setFixado(null);
    setCat('todos');
    setLinhaId(v.linhas[0]?.id ?? '');
    feed.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * "Monte o conjunto" (Léo, 09/10): abre a grade do par JÁ com a mesma grade
   * do modelo de origem (mesma cor, linha e tamanhos). Sem desconto.
   */
  function montarConjunto(origem: ModeloPub, par: ModeloPub) {
    // A grade da origem fecha aqui sem passar pelo "Pronto": registra o que entrou.
    if (grade?.id === origem.id) {
      const n = pecasDoModelo(carrinho, origem.id);
      if (n > pecasAoAbrirGrade.current) {
        evento('AddToCart', {
          content_ids: [origem.id],
          content_name: origem.nome,
          content_type: 'product_group',
          num_items: n - pecasAoAbrirGrade.current,
        });
      }
    }
    const r = preencherConjunto(origem, par, carrinho);
    if (r.pecas > 0) setCarrinho(r.carrinho);
    setPdp(null);
    setGrade(par);
    avisar(
      r.pecas > 0
        ? `${r.pecas} peças de ${par.nome} com a mesma grade — confira`
        : `Monte a grade de ${par.nome}`,
    );
  }

  // Pixel: produto visto (ficha técnica ou grade aberta).
  useEffect(() => {
    const m = pdp ?? grade;
    if (m) {
      evento('ViewContent', {
        content_ids: [m.id],
        content_name: m.nome,
        content_type: 'product_group',
      });
    }
  }, [pdp, grade]);
  useEffect(() => {
    if (grade) pecasAoAbrirGrade.current = pecasDoModelo(carrinho, grade.id);
    // Só na abertura: o carrinho muda a cada toque na grade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade]);

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

  /** O modelo que está ocupando o meio do feed agora. */
  const modeloNaTela = (): string | null => {
    const el = feed.current;
    if (!el) return null;
    const caixa = el.getBoundingClientRect();
    const meio = caixa.top + caixa.height / 2;
    for (const a of el.querySelectorAll<HTMLElement>('[data-modelo]')) {
      const r = a.getBoundingClientRect();
      if (r.top <= meio && r.bottom > meio) return a.dataset.modelo ?? null;
    }
    return null;
  };

  const trocarLinha = (id: string) => {
    const atual = modeloNaTela();
    const m = atual ? v.modelos.find((x) => x.id === atual) : undefined;
    setFixado(m && !temLinha(m, id) ? m.id : null);
    setLinhaId(id);
  };
  const modeloFixado =
    fixado && cat === 'todos'
      ? v.modelos.find((m) => m.id === fixado && !temLinha(m, linhaId))
      : undefined;
  const slides = modeloFixado ? [modeloFixado, ...lista] : lista;
  useEffect(() => {
    feed.current?.scrollTo({ top: 0 });
  }, [linhaId, cat]);

  const linhaNoModelo = (m: ModeloPub): LinhaPub =>
    m.linhas.find((l) => l.linhaId === linhaId) ?? m.linhas[0];
  // Cor que abre: a escolhida, ou a 1ª com estoque nesta linha (esgotada nunca abre).
  const corAtual = (m: ModeloPub): CorPub =>
    m.cores.find((c) => c.id === corDe[m.id]) ?? corInicial(m, linhaNoModelo(m));
  const pecas = totalPecas(carrinho);
  // Selo da linha (Léo, 07/10: "Plus Size de verdade · veste até 150 kg…").
  const seloDa = (id: string) => v.linhas.find((x) => x.id === id)?.selo ?? null;

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
          {/* Logo = "início": volta pro começo dos produtos (Léo, 09/10). */}
          <button
            type="button"
            className="vt-inicio"
            onClick={irProInicio}
            aria-label={`${v.empresa.nome} — início da vitrine`}
            data-testid="vt-inicio"
          >
            {v.empresa.simboloUrl && (
              <img className="vt-simbolo" src={v.empresa.simboloUrl} alt="" aria-hidden="true" />
            )}
            <Marca nome={v.empresa.nome} logoUrl={v.empresa.logoUrl} />
          </button>
          {/* Carrinho no topo (Léo, 10/10): no lugar da barra fixa de baixo. */}
          {pecas > 0 && (
            <button
              type="button"
              className="vt-carrinho"
              onClick={() => {
                setToast(null);
                setVerPedido(true);
              }}
              aria-label={`Ver pedido: ${pecas} ${pecas === 1 ? 'peça' : 'peças'}`}
              data-testid="vt-carrinho"
            >
              <svg
                viewBox="0 0 24 24"
                width="19"
                height="19"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9.5" cy="19.5" r="1.4" />
                <circle cx="17.5" cy="19.5" r="1.4" />
                <path d="M2.5 3.5h2.6l2.3 10.7a1.6 1.6 0 0 0 1.6 1.3h8.2a1.6 1.6 0 0 0 1.6-1.2L20.5 7H6" />
              </svg>
              {/* key: o número "pula" quando muda. */}
              <span key={pecas} className="vt-carrinho-n">
                {pecas > 999 ? '999+' : pecas}
              </span>
            </button>
          )}
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
                onClick={() => trocarLinha(l.id)}
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

      <div className="vt-feed" ref={feed}>
        {slides.map((m, i) => {
          const cor = corAtual(m);
          const l = linhaNoModelo(m);
          const semALinha = m === modeloFixado;
          return (
            <article
              key={m.id}
              className="vt-slide"
              data-modelo={m.id}
              data-testid={`vt-slide-${m.id}`}
            >
              <div className="vt-stage">
                {semALinha && (
                  <div className="vt-semlinha" role="status" data-testid="vt-sem-linha">
                    <span>
                      Este modelo não tem{' '}
                      <b>{v.linhas.find((x) => x.id === linhaId)?.nome ?? 'esta linha'}</b>.
                    </span>
                    <div>
                      {m.linhas.map((x) => (
                        <button
                          key={x.id}
                          type="button"
                          onClick={() => {
                            setFixado(null);
                            setLinhaId(x.linhaId);
                          }}
                        >
                          Ver em {x.nome}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Carrossel
                  key={`${cor.id}:${l.linhaId}`}
                  cor={{ ...cor, fotos: fotosDoCliente(cor, l.linhaId, visitante) }}
                  nome={m.nome}
                />
                <NomeDaCor cor={cor} />
                {i === 0 && slides.length > 1 && <div className="vt-hint">deslize pra cima ↑</div>}
              </div>
              <div className="vt-info">
                <div className="vt-row">
                  <span className="vt-over">
                    {[m.categoria?.nome, l.nome].filter(Boolean).join(' · ')}
                  </span>
                  <Bolinhas
                    m={m}
                    cor={cor}
                    linha={l}
                    onCor={(id) => setCorDe((s) => ({ ...s, [m.id]: id }))}
                  />
                </div>
                <NomeDoModelo nome={m.nome} base={22} />
                {!semALinha && <Selo texto={seloDa(l.linhaId)} />}
                {m.etiquetas.length > 0 && (
                  <div className="vt-tags">
                    {m.etiquetas.map((t) => (
                      <span key={t} className="vt-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <SimuladorPedido l={l} f={v.faixas} minimo={v.pedidoMinimo} />
                <div className="vt-row">
                  {/* A página do produto abre só por aqui — a foto só desliza (Léo, 07/10).
                      O Material de divulgação está lá dentro. */}
                  <button
                    type="button"
                    className="vt-link"
                    onClick={() => setPdp(m)}
                    data-testid={`vt-ficha-${m.id}`}
                  >
                    Ficha técnica
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
        {slides.length === 0 && (
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
          minimo={v.pedidoMinimo}
          selo={seloDa(linhaNoModelo(pdp).linhaId)}
          visitante={visitante}
          onCor={(id) => setCorDe((s) => ({ ...s, [pdp.id]: id }))}
          onFechar={() => setPdp(null)}
          onGrade={() => {
            setGrade(pdp);
            setPdp(null);
          }}
          onKit={() => setKit(pdp)}
          pares={paresDe(pdp, v)}
          temPecas={pecasDoModelo(carrinho, pdp.id) > 0}
          onConjunto={(par) => montarConjunto(pdp, par)}
        />
      )}

      {grade && (
        <FolhaGrade
          m={grade}
          linhaInicial={linhaNoModelo(grade)}
          carrinho={carrinho}
          onMudar={setCarrinho}
          pares={paresDe(grade, v)}
          onConjunto={(par) => montarConjunto(grade, par)}
          onFechar={() => {
            const n = pecasDoModelo(carrinho, grade.id);
            if (n > pecasAoAbrirGrade.current) {
              evento('AddToCart', {
                content_ids: [grade.id],
                content_name: grade.nome,
                content_type: 'product_group',
                num_items: n - pecasAoAbrirGrade.current,
              });
            }
            setGrade(null);
            // Confirma O QUE mudou neste modelo (Léo, 10/10): "+12 peças · Bermuda…".
            // Nada mudou = sem aviso (o número do carrinho no topo já está certo).
            if (!verPedido) {
              const msg = avisoDaGrade(grade.nome, n - pecasAoAbrirGrade.current);
              if (msg) avisar(msg);
            }
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
          privacidade={Boolean(v.privacidade)}
          onFechar={() => setEnviado(null)}
        />
      )}

      {toast && <div className="vt-toast">{toast}</div>}
    </>
  );
}

const capaDe = (m: ModeloPub): string | undefined => {
  const f = m.cores[0] ? corDaBolinha(m.cores[0]).fotos[0] : undefined;
  return f?.thumbUrl ?? f?.url;
};

/** "Monte o conjunto": o par do modelo, com a mesma grade quando já tem peça. */
function MonteConjunto({
  pares,
  temPecas,
  onEscolher,
}: {
  pares: ModeloPub[];
  temPecas: boolean;
  onEscolher: (par: ModeloPub) => void;
}) {
  if (pares.length === 0) return null;
  return (
    <div className="vt-conjunto" data-testid="vt-conjunto">
      <div className="vt-conjunto-titulo">Monte o conjunto</div>
      {pares.slice(0, 2).map((p) => {
        const capa = capaDe(p);
        return (
          <button
            key={p.id}
            type="button"
            className="vt-conjunto-item"
            onClick={() => onEscolher(p)}
            data-testid={`vt-conjunto-${p.id}`}
          >
            {capa ? <img src={capa} alt="" /> : <span />}
            <span>
              <b>{p.nome}</b>
              <small>{temPecas ? 'mesma cor, linha e grade' : 'na mesma cor e linha'}</small>
            </span>
            <i>{temPecas ? 'Montar igual →' : 'Montar grade →'}</i>
          </button>
        );
      })}
    </div>
  );
}

/** Antes de pagar: o que combina com o pedido e o resto da vitrine. Nunca trava a compra. */
function FolhaSugestoes({
  modelos,
  pagamentoOnline,
  onEscolher,
  onSeguir,
}: {
  modelos: ModeloPub[];
  pagamentoOnline: boolean;
  onEscolher: (m: ModeloPub) => void;
  onSeguir: () => void;
}) {
  return (
    <>
      <div className="vt-scrim" onClick={onSeguir} />
      <section className="vt-sheet" role="dialog" aria-label="Sugestões" data-testid="vt-sugestoes">
        <div className="vt-grab" />
        <div className="vt-sh-head">
          <div>
            <div className="vt-name">Vale levar também?</div>
            <span className="vt-muted">Peças que combinam com o seu pedido.</span>
          </div>
        </div>
        <div className="vt-sug-lista">
          {modelos.map((m) => {
            const capa = capaDe(m);
            const preco = m.linhas.map((l) => l.precoEntrada).find((x) => x !== null) ?? null;
            return (
              <button
                key={m.id}
                type="button"
                className="vt-conjunto-item"
                onClick={() => onEscolher(m)}
                data-testid={`vt-sugestao-${m.id}`}
              >
                {capa ? <img src={capa} alt="" /> : <span />}
                <span>
                  <b>{m.nome}</b>
                  {preco !== null && <small>a partir de {formatMoeda(preco)}/peça</small>}
                </span>
                <i>Montar grade →</i>
              </button>
            );
          })}
        </div>
        <div className="vt-sh-foot">
          <button
            type="button"
            className="vt-cta vt-cta-sec"
            onClick={onSeguir}
            data-testid="vt-sugestoes-seguir"
          >
            {pagamentoOnline ? 'Não, obrigado, ir pro pagamento' : 'Não, obrigado, enviar o pedido'}
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * Link da Política de Privacidade. Página PRONTA do servidor (o robô do Meta
 * lê sem rodar o app) — por isso `<a>` e não rota do app; outra aba pra não
 * perder o que a pessoa digitou no pedido.
 */
function LinkPrivacidade({ slug }: { slug: string }) {
  return (
    <a
      className="vt-priv"
      href={`/v/${encodeURIComponent(slug)}/privacidade`}
      target="_blank"
      rel="noopener"
      data-testid="vt-privacidade"
    >
      Política de privacidade
    </a>
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
            // A 2ª já vem carregada: o 1º deslize não mostra foto em branco.
            loading={i <= 1 ? 'eager' : 'lazy'}
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

function Bolinhas({
  m,
  cor,
  linha,
  onCor,
}: {
  m: ModeloPub;
  cor: CorPub;
  linha: LinhaPub;
  onCor: (id: string) => void;
}) {
  // Esgotada nesta linha vai pro fim — nunca é a 1ª opção (Léo, 07/10).
  return (
    <div className="vt-dots">
      {coresPorEstoque(m, linha).map((c) => (
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
      // Cor lisa, do hex cadastrado (Léo, 07/10: recorte da foto não ficou bom).
      style={{ background: c.hex }}
      aria-label={c.nome}
      aria-pressed={ativa}
      onClick={() => onCor(c.id)}
    />
  );
}

/** Bolinha pequena da linha da grade (só mostra). */
function AmostraCor({ c }: { c: CorPub }) {
  return <i style={{ background: c.hex }} />;
}

/** Preço das faixas de cima (Volume, Atacadão) — o card mostra a Entrada. */

/**
 * Preço no FEED, enxuto: a foto é o produto, o preço acompanha. Entrada,
 * revenda e lucro numa linha; as faixas de cima numa linha fina embaixo.
 * A página do modelo mostra o bloco completo (lucro por faixa etc.).
 */
/**
 * Simulador do pedido (Léo, 07/10 — no lugar de Entrada / Revenda / Seu lucro):
 * "Se você levar" 50 · 100 · 200 · 1.000 → quanto investe, por quanto vende e
 * o LUCRO NO PEDIDO. O preço da peça acompanha a faixa da quantidade.
 */
function SimuladorPedido({
  l,
  f,
  minimo,
}: {
  l: LinhaPub;
  f: Faixas;
  minimo?: VitrinePub['pedidoMinimo'];
}) {
  const qtds = quantidadesDoSimulador(f, minimo);
  const [qtd, setQtd] = useState(qtds[0]);
  const s = simularPedido(l, f, qtds.includes(qtd) ? qtd : qtds[0]);
  if (s.preco === null) {
    return (
      <div className="vt-sim" data-testid="vt-preco">
        <span className="vt-na">Preço sob consulta</span>
      </div>
    );
  }
  const lucroPeca = s.revenda !== null ? Math.round((s.revenda - s.preco) * 100) / 100 : null;
  // Preço DA PEÇA em destaque (Léo, 07/10: "precisa ter o preço unitário em mais
  // destaque"); muda com a faixa da quantidade escolhida. O resto é apoio.
  return (
    <div className="vt-sim" data-testid="vt-preco">
      <div className="vt-sim-topo">
        <div className="vt-sim-unit">
          <b data-testid="vt-sim-unitario">{formatMoeda(s.preco)}</b>
          <span>/peça</span>
        </div>
        {s.revenda !== null && (
          <div className="vt-sim-rev">
            <span>revenda {formatMoeda(s.revenda)}</span>
            {lucroPeca !== null && lucroPeca > 0 && <em>lucro {formatMoeda(lucroPeca)}/peça</em>}
          </div>
        )}
      </div>
      <div className="vt-sim-q">
        <small>Se você levar</small>
        <div className="vt-sim-btns" role="group" aria-label="Quantidade">
          {qtds.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={n === s.qtd}
              onClick={() => setQtd(n)}
              data-testid={`vt-sim-${n}`}
            >
              {formatNumero(n)}
            </button>
          ))}
        </div>
      </div>
      <div className={s.lucro === null ? 'vt-sim-r vt-sim-so' : 'vt-sim-r'}>
        <div>
          <small>Investe</small>
          <b>{formatMoeda(s.investe ?? 0)}</b>
        </div>
        {s.lucro !== null && (
          <div className="vt-win">
            <small>Lucro no pedido</small>
            <b data-testid="vt-sim-lucro">{formatMoeda(s.lucro)}</b>
          </div>
        )}
      </div>
    </div>
  );
}

function PaginaModelo({
  m,
  cor,
  l,
  f,
  minimo,
  selo,
  visitante,
  onCor,
  onFechar,
  onGrade,
  onKit,
  pares,
  temPecas,
  onConjunto,
}: {
  m: ModeloPub;
  cor: CorPub;
  l: LinhaPub;
  f: Faixas;
  minimo: VitrinePub['pedidoMinimo'];
  selo: string | null;
  visitante: string;
  onCor: (id: string) => void;
  onFechar: () => void;
  onGrade: () => void;
  onKit: () => void;
  /** Modelos que combinam (conjunto). */
  pares: ModeloPub[];
  /** Já tem peça deste modelo no pedido (o par vem com a mesma grade). */
  temPecas: boolean;
  onConjunto: (par: ModeloPub) => void;
}) {
  const [guia, setGuia] = useState(false);
  return (
    <section className="vt-pdp" aria-label={m.nome}>
      <button type="button" className="vt-close" onClick={onFechar} aria-label="Fechar">
        ✕
      </button>
      <div className="vt-stage" style={{ position: 'relative' }}>
        <Carrossel
          key={`${cor.id}:${l.linhaId}`}
          cor={{ ...cor, fotos: fotosDoCliente(cor, l.linhaId, visitante) }}
          nome={m.nome}
        />
        <NomeDaCor cor={cor} />
      </div>
      <div className="vt-pdp-body">
        <div className="vt-row">
          {m.categoria && <span className="vt-over">{m.categoria.nome}</span>}
          <Bolinhas m={m} cor={cor} linha={l} onCor={onCor} />
        </div>
        <NomeDoModelo nome={m.nome} base={28} />
        <Selo texto={selo} />
        {m.etiquetas.length > 0 && (
          <div className="vt-tags">
            {m.etiquetas.map((t) => (
              <span key={t} className="vt-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <SimuladorPedido l={l} f={f} minimo={minimo} />
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
        {temGuia(m) && (
          <button
            type="button"
            className="vt-link"
            style={{ justifySelf: 'start' }}
            onClick={() => setGuia(true)}
            data-testid="vt-guia-abrir"
          >
            Guia de tamanhos
          </button>
        )}
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
            <b>Material de divulgação</b>
            <span>Fotos, vídeos e descrição deste modelo pra divulgar pros seus clientes</span>
          </div>
          <i>Baixar →</i>
        </button>
        <MonteConjunto pares={pares} temPecas={temPecas} onEscolher={onConjunto} />
        <button type="button" className="vt-cta" onClick={onGrade}>
          Montar grade
        </button>
      </div>
      {guia && <GuiaTamanhos m={m} linhaInicial={l} onFechar={() => setGuia(false)} />}
    </section>
  );
}

/**
 * Nome do modelo numa linha só (Léo, 07/10: "o título caindo pra linha de
 * baixo"): a fonte desce até caber; só no mínimo é que corta com "…".
 */
function NomeDoModelo({ nome, base }: { nome: string; base: number }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const caber = () => {
      let tam = base;
      el.style.fontSize = `${tam}px`;
      while (el.scrollWidth > el.clientWidth && tam > 15) {
        tam -= 1;
        el.style.fontSize = `${tam}px`;
      }
    };
    caber();
    // A fonte do título chega depois (Google Fonts) e muda a largura do texto:
    // refaz quando ela termina de carregar (o `ready` pode já ter resolvido).
    const fontes = document.fonts;
    void fontes?.ready.then(caber);
    fontes?.addEventListener?.('loadingdone', caber);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(caber);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      fontes?.removeEventListener?.('loadingdone', caber);
    };
  }, [nome, base]);
  return (
    <h2 ref={ref} className="vt-name vt-name-1l" title={nome}>
      {nome}
    </h2>
  );
}

/** Selo da linha escolhida (ex.: Plus Size de verdade). Sem texto, nada. */
function Selo({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p className="vt-selo" data-testid="vt-selo">
      <i aria-hidden="true">✓</i>
      {texto}
    </p>
  );
}

const temGuia = (m: ModeloPub) => m.linhas.some((l) => (l.tabelaMedidas?.linhas.length ?? 0) > 0);

/**
 * Guia de tamanhos (Léo, 07/10): a tabela de medidas da linha — inclusive a
 * coluna "Veste bem até (média)" do Plus. Troca de linha dentro da folha.
 */
function GuiaTamanhos({
  m,
  linhaInicial,
  onFechar,
}: {
  m: ModeloPub;
  linhaInicial: LinhaPub;
  onFechar: () => void;
}) {
  const comTabela = m.linhas.filter((l) => (l.tabelaMedidas?.linhas.length ?? 0) > 0);
  const [linha, setLinha] = useState(
    comTabela.find((l) => l.id === linhaInicial.id) ?? comTabela[0],
  );
  const t = linha?.tabelaMedidas;
  return (
    <>
      <div className="vt-scrim vt-guia-scrim" onClick={onFechar} />
      <section
        className="vt-sheet vt-guia"
        role="dialog"
        aria-label={`Guia de tamanhos · ${m.nome}`}
        data-testid="vt-guia"
      >
        <div className="vt-grab" />
        <div className="vt-sh-head">
          <div>
            <span className="vt-over">Guia de tamanhos</span>
            <div className="vt-name">{m.nome}</div>
          </div>
        </div>
        {comTabela.length > 1 && (
          <div className="vt-mode">
            <div className="vt-seg">
              {comTabela.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={x.id === linha?.id}
                  onClick={() => setLinha(x)}
                >
                  {x.nome}
                </button>
              ))}
            </div>
          </div>
        )}
        {t && (
          <div className="vt-guia-tab">
            <table>
              <thead>
                <tr>
                  <th>Tamanho</th>
                  {t.colunas.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.linhas.map((r) => (
                  <tr key={r.tamanho}>
                    <th>{r.tamanho}</th>
                    {r.valores.map((v, i) => (
                      <td key={i}>{v || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="vt-muted">Medidas em média — podem variar um pouco de peça pra peça.</p>
          </div>
        )}
        <div className="vt-sh-foot">
          <span />
          <button type="button" className="vt-cta" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </section>
    </>
  );
}

function FolhaGrade({
  m,
  linhaInicial,
  carrinho,
  onMudar,
  onFechar,
  pares = [],
  onConjunto,
}: {
  m: ModeloPub;
  linhaInicial: LinhaPub;
  carrinho: Carrinho;
  onMudar: (c: Carrinho) => void;
  onFechar: () => void;
  /** Modelos que combinam: "Monte o conjunto" embaixo da grade. */
  pares?: ModeloPub[];
  onConjunto?: (par: ModeloPub) => void;
}) {
  const [linha, setLinha] = useState<LinhaPub>(linhaInicial);
  const [guia, setGuia] = useState(false);
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
            {(linha.tabelaMedidas?.linhas.length ?? 0) > 0 && (
              <button
                type="button"
                className="vt-link"
                onClick={() => setGuia(true)}
                data-testid="vt-guia-grade"
              >
                Guia de tamanhos
              </button>
            )}
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
          {coresPorEstoque(m, linha).map((c) => (
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
                // Todos os tamanhos numa linha só (Léo, 07/10); muitos tamanhos = célula compacta.
                className={linha.tamanhos.length > 6 ? 'vt-cells vt-cells-muitos' : 'vt-cells'}
                style={{
                  gridTemplateColumns: `repeat(${linha.tamanhos.length}, minmax(0, 1fr))`,
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
          {onConjunto && (
            <MonteConjunto
              pares={pares}
              temPecas={pecasDoModelo(carrinho, m.id) > 0}
              onEscolher={onConjunto}
            />
          )}
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
      {guia && <GuiaTamanhos m={m} linhaInicial={linha} onFechar={() => setGuia(false)} />}
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
  const [sugerindo, setSugerindo] = useState(false);
  const sugestoes = sugestoesAntesDePagar(v, carrinho);
  const r = resumoPedido(carrinho, v);
  /** Antes de pagar, uma vez por visita: 2–3 sugestões, e "Não, obrigado" segue direto. */
  function irParaEnvio() {
    const chave = `vitrine:sugeriu:${slug}`;
    let ja = false;
    try {
      ja = sessionStorage.getItem(chave) === '1';
      sessionStorage.setItem(chave, '1');
    } catch {
      /* sem armazenamento: sugere de novo, sem problema */
    }
    if (sugestoes.length > 0 && !ja) setSugerindo(true);
    else setEnvio(true);
  }
  const prox = proximaFaixa(r.pecas, v.faixas);
  const itens = v.modelos.filter((m) => pecasDoModelo(carrinho, m.id) > 0);
  const barra = progressoFaixa(r.pecas, v.faixas);
  const ganho = lucroNaProximaFaixa(carrinho, v);

  // Pixel: abriu o "Enviar pedido" = começou o checkout.
  useEffect(() => {
    if (envio) {
      evento('InitiateCheckout', {
        currency: 'BRL',
        value: r.aConfirmar ? undefined : r.investe,
        num_items: r.pecas,
      });
    }
    // Só quando abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envio]);

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
            const capa = m.cores[0] ? corDaBolinha(m.cores[0]).fotos[0] : undefined;
            return (
              <div key={m.id} className="vt-line" data-testid={`vt-linha-${m.id}`}>
                <div className="vt-line-head">
                  {capa ? <img src={capa.thumbUrl ?? capa.url} alt="" /> : <span />}
                  <div>
                    <div className="vt-name">{m.nome}</div>
                    <small>{formatNumero(pecasDoModelo(carrinho, m.id))} peças</small>
                  </div>
                  <button type="button" className="vt-line-edit" onClick={() => onEditar(m)}>
                    editar
                  </button>
                </div>
                {/* Uma tabelinha por linha: cor × tamanho, só o que tem peça. */}
                {gradeDoCarrinho(m, carrinho).map((g) => (
                  <div key={g.linha.id} className="vt-tab">
                    <div className="vt-tab-titulo">
                      <span>{g.linha.nome}</span>
                      <span>{formatNumero(g.total)} pç</span>
                    </div>
                    <div
                      className="vt-tab-grade"
                      style={{
                        gridTemplateColumns: `minmax(112px, max-content) repeat(${g.tamanhos.length}, minmax(22px, 1fr))`,
                      }}
                    >
                      <span className="vt-tab-h" />
                      {g.tamanhos.map((t) => (
                        <span key={t.id} className="vt-tab-tam vt-tab-h">
                          {t.nome}
                        </span>
                      ))}
                      {g.cores.map((x) => (
                        <Fragment key={x.cor.id}>
                          <span className="vt-tab-cor">
                            <i style={{ background: x.cor.hex }} />
                            {x.cor.nome}
                          </span>
                          {x.qtds.map((q, i) => (
                            <span key={i} className={q ? 'vt-tab-q' : 'vt-tab-q vt-tab-zero'}>
                              {q || '·'}
                            </span>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                ))}
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
          onClick={irParaEnvio}
        >
          Enviar pedido · {r.pecas} {r.pecas === 1 ? 'peça' : 'peças'}
        </button>
        <span className="vt-byline">
          {v.privacidade && (
            <>
              <LinkPrivacidade slug={slug} />
              {' · '}
            </>
          )}
          feito com <b>Betinna.ai</b>
        </span>
      </footer>
      {sugerindo && (
        <FolhaSugestoes
          modelos={sugestoes}
          pagamentoOnline={Boolean(v.pagamentoOnline)}
          onEscolher={(m) => {
            setSugerindo(false);
            onEditar(m);
          }}
          onSeguir={() => {
            setSugerindo(false);
            setEnvio(true);
          }}
        />
      )}
      {envio && (
        <FolhaEnvio
          slug={slug}
          empresa={v.empresa.nome}
          carrinho={carrinho}
          resumo={r}
          frete={v.frete ?? null}
          privacidade={Boolean(v.privacidade)}
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

interface Contato extends Endereco {
  nome: string;
  whatsapp: string;
  cpfCnpj: string;
}

// Quem compra de novo não digita tudo outra vez (fica só neste aparelho).
const CHAVE_CONTATO = 'vitrine:contato';
const CONTATO_VAZIO: Contato = {
  nome: '',
  whatsapp: '',
  cidade: '',
  uf: '',
  cpfCnpj: '',
  // Endereço de entrega (frete): lembrado neste aparelho pra próxima compra.
  cep: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
};

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
  frete,
  privacidade,
  onFechar,
  onEnviado,
}: {
  slug: string;
  empresa: string;
  carrinho: Carrinho;
  resumo: ReturnType<typeof resumoPedido>;
  /** Empresa cobra frete: pede o endereço e cota. null = combina no WhatsApp. */
  frete: FretePub | null;
  /** Política de Privacidade publicada: link junto do formulário. */
  privacidade: boolean;
  onFechar: () => void;
  onEnviado: (e: Enviado) => void;
}) {
  const [f, setF] = useState<Contato>(lerContato);
  const [isca, setIsca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<EscolhaFrete>(null);
  const mudar = (k: keyof Contato, valor: string) => setF((x) => ({ ...x, [k]: valor }));
  const mudarEndereco = useCallback(
    (patch: Partial<Endereco>) => setF((x) => ({ ...x, ...patch })),
    [],
  );
  const itens = useMemo(() => itensParaEnvio(carrinho), [carrinho]);
  const pronto =
    f.nome.trim().length >= 2 &&
    f.whatsapp.replace(/\D/g, '').length >= 10 &&
    (!frete || freteResolvido(f, escolha));
  const valorFrete = escolha?.tipo === 'servico' ? escolha.preco : 0;

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
          itens,
          atribuicao: atribuicaoParaEnvio(window.location.href),
          ...(frete ? freteParaEnvio(f, escolha) : {}),
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
            {privacidade && (
              <span className="vt-muted vt-priv-linha">
                Seus dados servem só pra atender este pedido. <LinkPrivacidade slug={slug} />
              </span>
            )}
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
          {/* Com frete, cidade e UF vêm no endereço de entrega (o CEP preenche). */}
          {!frete && (
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
          )}
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
          {frete && (
            <Entrega
              slug={slug}
              empresa={empresa}
              frete={frete}
              pecas={resumo.pecas}
              itens={itens}
              endereco={f}
              onEndereco={mudarEndereco}
              escolha={escolha}
              onEscolha={setEscolha}
            />
          )}
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
            <small data-testid="vt-f-total">
              {resumo.aConfirmar
                ? escolha?.tipo === 'servico'
                  ? `frete ${formatMoeda(valorFrete)} · total confirmado depois`
                  : 'total confirmado depois'
                : escolha?.tipo === 'servico'
                  ? `${formatMoeda(resumo.investe + valorFrete)} com frete`
                  : escolha?.tipo === 'retirada'
                    ? `${formatMoeda(resumo.investe)} · retirada`
                    : frete
                      ? `${formatMoeda(resumo.investe)} + frete`
                      : formatMoeda(resumo.investe)}
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
  privacidade,
  onFechar,
}: {
  slug: string;
  e: Enviado;
  empresa: string;
  privacidade: boolean;
  onFechar: () => void;
}) {
  const [reservaAte, setReservaAte] = useState(e.reservaExpiraEm);
  const [pago, setPago] = useState(false);
  const agora = useAgora(Boolean(reservaAte) && !pago);
  const relogio = pago ? null : restante(reservaAte, agora);
  const online = Boolean(e.pagamento) && !e.aConfirmar;
  const aoPagar = useCallback(() => {
    setPago(true);
    // Mesmo eventID da API de Conversões: o Meta conta UMA compra.
    if (e.pagamento) {
      evento(
        'Purchase',
        { value: e.total, currency: 'BRL', num_items: e.pecas },
        `pedido-${e.pagamento.pedidoId}`,
      );
    }
  }, [e]);
  const aoComecar = useCallback(() => {
    evento('AddPaymentInfo', { value: e.total, currency: 'BRL' });
    // Mesma conta do servidor: quem está pagando não perde a peça pelo relógio.
    setReservaAte((r) =>
      r ? new Date(Date.now() + RESERVA_PAGANDO_MIN * 60_000).toISOString() : r,
    );
  }, [e.total]);
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
          {privacidade && (
            <>
              <LinkPrivacidade slug={slug} />
              {' · '}
            </>
          )}
          feito com <b>Betinna.ai</b>
        </span>
      </footer>
    </section>
  );
}
