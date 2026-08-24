import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Send,
  Trash2,
  Settings,
  Sparkles,
  AlertCircle,
  Package,
  Info,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { AssistenteTabs } from '@/components/AssistenteTabs';
import { Markdown } from '@/components/Markdown';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoeda as fmtBRL } from '@/lib/masks';

/**
 * MullerBotPage v2 — chat com paleta Betinna (roxo+ciano).
 *
 * Layout:
 *  - Esquerda: chat (perguntas direita, respostas esquerda com Avatar Bot)
 *  - Direita: settings + dicas
 */

interface MullerProduto {
  id: string;
  nome: string;
  sku?: string;
  marca?: string;
  precoTabela?: number;
}

interface PerguntarResponse {
  resposta: string;
  produtosUsados: MullerProduto[];
  produtosTruncados?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  modelo?: string;
}

interface QAItem {
  id: string;
  pergunta: string;
  resposta: string;
  produtos: MullerProduto[];
  truncados: boolean;
  tokensIn?: number;
  tokensOut?: number;
  modelo?: string;
  ts: number;
}

const HISTORY_KEY = 'mullerbot_history_v2';
const SESSION_KEY = 'mullerbot_session_v2';

function loadHistory(): QAItem[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QAItem[];
  } catch {
    return [];
  }
}
function saveHistory(items: QAItem[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-20)));
  } catch {
    // ignora se storage cheio
  }
}

/**
 * sessionId persiste em localStorage (não sessionStorage) pra contexto
 * sobreviver a reload de página. Backend usa esse id pra carregar histórico
 * via MullerBotCacheService.getHistorico — assim o bot lembra o que foi
 * dito em turnos anteriores e responde com contexto.
 */
function loadOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const novo = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `mb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_KEY, novo);
    return novo;
  } catch {
    // localStorage indisponível — usa id efêmero
    return `mb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function rotateSessionId(): string {
  const novo = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `mb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(SESSION_KEY, novo);
  } catch {
    // ignora
  }
  return novo;
}

/**
 * Sugestões NEUTRAS — usadas quando o catálogo ainda não tem marca/linha/
 * categoria cadastrada.
 *
 * De propósito não citam produto, faixa de preço nem segmento: as antigas
 * ("linha de molhos", "abaixo de R$ 50", "embalagens grandes") vieram do
 * primeiro cliente e apareciam iguais em qualquer empresa — numa de proteção
 * elétrica, sugeriam perguntar por molho de tomate.
 */
const SUGESTOES_NEUTRAS = [
  'Quais produtos vocês têm no catálogo?',
  'Me indique 3 produtos e explique quando usar cada um',
  'Qual a diferença entre os modelos?',
  'Preciso de ajuda pra escolher o produto certo',
];

/**
 * Monta sugestões a partir do catálogo REAL do tenant (marca, linha, categoria).
 *
 * Vem dos dados, e não de config, porque config precisaria ser preenchida por
 * alguém em cada empresa — e o dado já existe. Catálogo vazio (ou sem esses
 * campos) cai nas neutras, que servem pra qualquer negócio.
 */
export function montarSugestoes(facets?: {
  marcas?: string[];
  linhas?: string[];
  categorias?: string[];
}): string[] {
  const marca = facets?.marcas?.[0];
  const linha = facets?.linhas?.[0];
  const categoria = facets?.categorias?.[0];
  const doCatalogo = [
    marca ? `Quais produtos são da marca ${marca}?` : null,
    linha ? `Preciso de algo na linha ${linha}` : null,
    categoria ? `O que vocês têm em ${categoria}?` : null,
  ].filter((q): q is string => q !== null);
  // Completa até 4 com as neutras, sem repetir o que já entrou.
  return [...doCatalogo, ...SUGESTOES_NEUTRAS].slice(0, 4);
}

export default function MullerBotPage() {
  const [pergunta, setPergunta] = useState('');
  const [topK, setTopK] = useState(5);
  const [modelo, setModelo] = useState<string>('');
  const role = useRole();
  const isRep = role === 'REP';
  // Modelos da conta OpenAI de quem está usando — mesma fonte da tela de
  // configuração. A lista aqui era fixa no código (gpt-4o-mini/4o/4-turbo) e
  // já estava velha: oferecia modelo que a conta não tem e escondia os novos.
  const { data: modelosResp } = useApiQuery<{ modelos: string[]; fonte: string }>(
    '/mullerbot/bot/modelos',
  );
  const modelosLive = modelosResp?.modelos ?? [];
  // Nome do bot definido pela empresa (ex.: "SomaBOT") — cabeçalho da página.
  const [nomeBot, setNomeBot] = useState<string>('');
  useEffect(() => {
    api
      .get<{ nome?: string }>('/mullerbot/persona')
      .then((r) => setNomeBot(r.nome?.trim() ?? ''))
      .catch(() => setNomeBot(''));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QAItem[]>(() => loadHistory());
  // sessionId persiste em localStorage pra contexto multi-turn sobreviver
  // a reload. "Nova conversa" rotaciona via rotateSessionId.
  const [sessionId, setSessionId] = useState<string>(() => loadOrCreateSessionId());
  // Ref na LISTA, não num marcador no fim dela: a rolagem tem que acontecer
  // DENTRO do painel de mensagens. Ver o efeito abaixo.
  const listaRef = useRef<HTMLDivElement | null>(null);
  // CAÇADA-BUG #8: guard síncrono anti-duplo-envio (Ctrl+Enter rápido = 2 chamadas OpenAI/custo).
  const busyRef = useRef(false);

  useEffect(() => {
    saveHistory(history);
  }, [history]);
  // Desce o painel de mensagens até o fim.
  //
  // Era um scrollIntoView num marcador no fim da lista, e isso comia o
  // cabeçalho: o scrollIntoView não rola só o container com overflow — rola
  // TODOS os ancestrais necessários pra trazer o elemento à vista, inclusive a
  // página. Como o efeito também roda na montagem (o histórico vem do
  // localStorage), abrir o Assistente já entrava com o título "SomaBOT" e a
  // descrição fora da tela.
  //
  // Mexer no scrollTop do próprio painel faz o que se queria desde o início e
  // não tem como tocar no scroll da página.
  useEffect(() => {
    const lista = listaRef.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }, [history]);

  async function enviar(e?: React.FormEvent, customQ?: string) {
    e?.preventDefault();
    if (busyRef.current) return; // já há uma pergunta em voo (anti-duplo Ctrl+Enter)
    const q = (customQ ?? pergunta).trim();
    if (!q) return;
    if (q.length > 2000) {
      setError('Pergunta muito longa (máx 2000 chars).');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // sessionId garante contexto multi-turn — backend usa pra carregar
      // histórico via MullerBotCacheService.getHistorico e injetar como
      // mensagens prévias na chamada do OpenAI.
      const payload: {
        pergunta: string;
        topK: number;
        modelo?: string;
        sessionId: string;
      } = { pergunta: q, topK, sessionId };
      if (modelo.trim()) payload.modelo = modelo.trim();
      const r = await api.post<PerguntarResponse>('/mullerbot/perguntar', payload);
      const item: QAItem = {
        id: Math.random().toString(36).slice(2),
        pergunta: q,
        resposta: r.resposta,
        produtos: r.produtosUsados ?? [],
        truncados: r.produtosTruncados ?? false,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        modelo: r.modelo,
        ts: Date.now(),
      };
      setHistory((h) => [...h, item]);
      setPergunta('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function clearHistory() {
    setHistory([]);
  }

  /**
   * "Nova conversa" — rotaciona sessionId no localStorage E pede ao backend
   * pra limpar o histórico Redis associado (best-effort). Limpa também UI.
   */
  async function novaConversa() {
    const oldSessionId = sessionId;
    setSessionId(rotateSessionId());
    setHistory([]);
    setError(null);
    // Best-effort: backend tem endpoint DELETE /mullerbot/historico/:sessionId.
    // Falha silenciosa pra não bloquear UX — Redis tem TTL natural mesmo
    // se a request falhar, o histórico expira sozinho.
    try {
      await api.delete(`/mullerbot/historico/${encodeURIComponent(oldSessionId)}`);
    } catch {
      // Sem problema — Redis TTL cuida disso
    }
  }

  return (
    <PageLayout
      title={nomeBot || 'Assistente IA'}
      description="Assistente interno da empresa. Pergunte sobre produtos, preços, regras, condições e FAQ — ele busca no catálogo e na base de conhecimento. O nome dele você define em Persona Bot."
      actions={
        history.length > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              data-testid="muller-clear"
              onClick={clearHistory}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Limpar UI
            </Button>
            <Button
              variant="secondary"
              data-testid="muller-nova-conversa"
              onClick={() => void novaConversa()}
              leftIcon={<Sparkles className="h-3.5 w-3.5" />}
            >
              Nova conversa
            </Button>
          </div>
        ) : undefined
      }
    >
      <AssistenteTabs />
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* Chat */}
        <Card
          padding="none"
          className="flex flex-col overflow-hidden"
          style={{ height: 'calc(100vh - 220px)', minHeight: 500 }}
        >
          <div ref={listaRef} className="flex-1 overflow-y-auto px-4 py-4 bg-bg">
            {history.length === 0 ? (
              <EmptyChat onSuggest={(q) => void enviar(undefined, q)} />
            ) : (
              <ul className="list-none p-0 m-0 flex flex-col gap-4">
                {history.map((qa) => (
                  <li key={qa.id} className="flex flex-col gap-2">
                    {/* Pergunta (direita) */}
                    <div className="flex justify-end">
                      <div className="max-w-[78%] px-3 py-2 rounded-2xl rounded-br-sm bg-gradient-brand text-white text-sm shadow-sm">
                        <p className="m-0 whitespace-pre-wrap">{qa.pergunta}</p>
                      </div>
                    </div>
                    {/* Resposta (esquerda) com Avatar */}
                    <div className="flex justify-start items-start gap-2">
                      <div
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-1',
                          'bg-gradient-brand text-white',
                        )}
                      >
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="max-w-[85%] px-3.5 py-3 rounded-2xl rounded-tl-sm bg-surface border border-border text-sm shadow-sm">
                        <Markdown content={qa.resposta} />
                        {qa.produtos.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-border">
                            <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1">
                              <Package className="h-3 w-3" />
                              Produtos consultados ({qa.produtos.length})
                            </div>
                            <ul className="m-0 p-0 list-none flex flex-col gap-1">
                              {qa.produtos.map((p) => (
                                <li key={p.id} className="text-xs text-text-subtle">
                                  <span className="text-primary mr-1">·</span>
                                  <strong className="text-text">{p.nome}</strong>
                                  {p.marca && (
                                    <span className="text-muted"> ({p.marca})</span>
                                  )}
                                  {p.precoTabela !== undefined && (
                                    <span className="text-muted tabular ml-1">
                                      — {fmtBRL(p.precoTabela)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                            {qa.truncados && (
                              <p className="text-[11px] text-warning mt-1.5 flex items-start gap-1 m-0">
                                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                Catálogo grande — descrições truncadas pra caber no contexto.
                              </p>
                            )}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-light mt-2 text-right tabular">
                          {qa.modelo ? `${qa.modelo} · ` : ''}
                          {qa.tokensIn !== undefined && `${qa.tokensIn}↓`}
                          {qa.tokensOut !== undefined && ` ${qa.tokensOut}↑`}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Compose */}
          <form
            onSubmit={enviar}
            className="px-3 py-3 border-t border-border bg-bg-alt"
          >
            <div className="flex items-end gap-2">
              <Textarea
                data-testid="muller-input"
                placeholder="Pergunte sobre o catálogo…"
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                maxLength={2000}
                rows={1}
                className="min-h-[44px] max-h-32 resize-none"
              />
              <Button
                type="submit"
                data-testid="muller-send"
                disabled={busy || pergunta.trim().length === 0}
                loading={busy}
                leftIcon={!busy ? <Send className="h-3.5 w-3.5" /> : undefined}
              >
                {busy ? 'Pensando' : 'Perguntar'}
              </Button>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span
                className={cn('text-[11px]', error ? 'text-danger' : 'text-muted-light')}
              >
                {error ? error : '⌘/Ctrl + Enter pra enviar'}
              </span>
              <span className="text-[11px] text-muted-light tabular">
                {pergunta.length}/2000
              </span>
            </div>
          </form>
        </Card>

        {/* Sidebar — um card de "o que ele consulta" + os ajustes, em vez de
            três cartões repetindo a mesma informação com jargão ("Top-K",
            "Default (env)") e um link solto pra mesma página. */}
        <div className="flex flex-col gap-3">
          <Card padding="md" variant="outline" className="bg-primary/5 border-primary/30">
            <h4 className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Info className="h-3 w-3" />
              O que ele consulta
            </h4>
            <ul className="text-xs text-text-subtle space-y-1.5 leading-relaxed list-disc pl-4 m-0">
              <li>O catálogo de produtos da empresa e a base de conhecimento (FAQ e regras)</li>
              <li>Só o que está lá — se não achar, ele diz, em vez de inventar preço ou prazo</li>
              <li>Lembra do que já foi dito nesta conversa; "Nova conversa" começa do zero</li>
              <li>
                A conta da OpenAI é a da empresa — você não precisa conectar chave nenhuma pra
                usar este chat
              </li>
            </ul>
          </Card>

          <Card padding="md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                Ajustes desta conversa
              </CardTitle>
              <CardDescription>
                Valem só aqui no chat — não mudam o bot que atende no WhatsApp.
              </CardDescription>
            </CardHeader>
            <div className="flex flex-col gap-3">
              <Field
                label="Produtos por resposta"
                hint="Quantos itens do catálogo ele lê antes de responder. Mais = respostas mais completas e mais lentas."
              >
                <Select
                  data-testid="muller-topk"
                  value={String(topK)}
                  onChange={(e) => setTopK(Number(e.target.value))}
                >
                  {[3, 5, 8, 10, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* Trocar o modelo é escolher o CUSTO da pergunta, e quem paga é
                  a chave da empresa — então é da gestão, não do rep. Pra ele o
                  modelo é o que o admin configurou; a consulta aqui é de base
                  de dados (catálogo + conhecimento) e o configurado dá conta.
                  O backend ignora o override vindo de REP de qualquer forma —
                  isto aqui só evita oferecer o que não vai valer. */}
              {!isRep && (
                <Field
                  label="Modelo da IA"
                  hint="Em branco usa o modelo configurado. Mais inteligente = mais caro por pergunta."
                >
                  <Select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                    <option value="">Modelo configurado</option>
                    {modelosLive.map((m: string) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          <Card padding="md" variant="outline" className="bg-secondary/5 border-secondary/30">
            <h4 className="text-xs font-semibold text-secondary-hover mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="h-3 w-3" />
              Dica
            </h4>
            <p className="text-xs text-text-subtle leading-relaxed m-0">
              {isRep ? (
                <>
                  O jeito de responder (nome, tom, instruções) sai do bot da empresa. Em{' '}
                  <Link to="/mullerbot/persona" className="text-primary font-semibold">
                    Meu bot
                  </Link>{' '}
                  você configura o SEU, o que responde no seu WhatsApp.
                </>
              ) : (
                <>
                  Nome, tom de voz, instruções e exemplos ficam em{' '}
                  <Link to="/mullerbot/persona" className="text-primary font-semibold">
                    Configuração
                  </Link>
                  .
                </>
              )}
            </p>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}

function EmptyChat({ onSuggest }: { onSuggest: (q: string) => void }) {
  // Facets do catálogo da empresa (marca/linha/categoria dos produtos ativos).
  const { data: facets } = useApiQuery<{
    marcas: string[];
    linhas: string[];
    categorias: string[];
  }>('/produtos/facets');
  const sugestoes = montarSugestoes(facets ?? undefined);
  return (
    <div className="text-center py-12 px-4 max-w-xl mx-auto">
      <div
        className={cn(
          'inline-flex h-16 w-16 items-center justify-center rounded-2xl mb-4',
          'bg-gradient-brand text-white shadow-lg',
        )}
      >
        <Bot className="h-8 w-8" />
      </div>
      <h2
        className="text-xl font-bold tracking-tight text-text mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Pergunte sobre o catálogo
      </h2>
      <p className="text-sm text-text-subtle leading-relaxed mb-6">
        Busco os produtos mais relevantes no catálogo da empresa e respondo com base
        neles. Sem invenção. Sem alucinação.
      </p>
      <div className="flex flex-col gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-light text-left">
          Sugestões
        </div>
        {sugestoes.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSuggest(q)}
            className={cn(
              'text-left px-3 py-2.5 rounded-md',
              'bg-surface border border-border text-sm text-text',
              'hover:border-primary/40 hover:bg-primary/5 transition-colors',
            )}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// Unused Badge import — manter pra futuro uso
