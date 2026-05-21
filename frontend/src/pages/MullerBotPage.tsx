import { useEffect, useRef, useState } from 'react';
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
import { PageLayout } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { Markdown } from '@/components/Markdown';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Field,
  Select,
  Textarea,
} from '@/components/ui';
import { cn } from '@/lib/cn';

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

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

const SUGGESTED = [
  'Quais produtos têm marca X?',
  'Preciso de algo na linha de molhos',
  'Recomende 3 produtos abaixo de R$ 50',
  'O que tem disponível em embalagens grandes?',
];

export default function MullerBotPage() {
  const [pergunta, setPergunta] = useState('');
  const [topK, setTopK] = useState(5);
  const [modelo, setModelo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QAItem[]>(() => loadHistory());
  // sessionId persiste em localStorage pra contexto multi-turn sobreviver
  // a reload. "Nova conversa" rotaciona via rotateSessionId.
  const [sessionId, setSessionId] = useState<string>(() => loadOrCreateSessionId());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveHistory(history);
  }, [history]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  async function enviar(e?: React.FormEvent, customQ?: string) {
    e?.preventDefault();
    const q = (customQ ?? pergunta).trim();
    if (!q) return;
    if (q.length > 2000) {
      setError('Pergunta muito longa (máx 2000 chars).');
      return;
    }
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
      title="MullerBot"
      description="Assistente comercial com RAG sobre o catálogo da empresa. Pergunte sobre produtos, preços, recomendações."
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
      <AtendimentoTabs />
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) 280px' }}
      >
        {/* Chat */}
        <Card
          padding="none"
          className="flex flex-col overflow-hidden"
          style={{ height: 'calc(100vh - 220px)', minHeight: 500 }}
        >
          <div className="flex-1 overflow-y-auto px-4 py-4 bg-bg">
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
            <div ref={endRef} />
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

        {/* Sidebar */}
        <div className="flex flex-col gap-3">
          <Card padding="md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                Configurações
              </CardTitle>
            </CardHeader>
            <div className="flex flex-col gap-3">
              <Field label="Top-K produtos" hint="Quantos produtos no contexto">
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
              <Field label="Modelo" hint="Default: gpt-4o-mini">
                <Select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                  <option value="">Default (env)</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card padding="md" variant="outline" className="bg-primary/5 border-primary/30">
            <h4 className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Info className="h-3 w-3" />
              Como funciona
            </h4>
            <ul className="text-xs text-text-subtle space-y-1.5 leading-relaxed list-disc pl-4 m-0">
              <li>RAG sobre catálogo OMIE da empresa</li>
              <li>Top-K via keyword scoring (sem alucinação)</li>
              <li>Tom e estilo configuráveis em Persona Bot</li>
              <li>REPs precisam de chave OpenAI própria</li>
              <li>Contexto multi-turn persistido server-side (Redis)</li>
              <li>"Nova conversa" reseta contexto pro bot</li>
            </ul>
          </Card>

          <Card padding="md" variant="outline" className="bg-secondary/5 border-secondary/30">
            <h4 className="text-xs font-semibold text-secondary-hover mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="h-3 w-3" />
              Dica
            </h4>
            <p className="text-xs text-text-subtle leading-relaxed m-0">
              Customize a identidade do bot (tom de voz, instruções, exemplos) na página{' '}
              <a href="/mullerbot/persona" className="text-primary font-semibold">
                Persona Bot
              </a>
              .
            </p>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}

function EmptyChat({ onSuggest }: { onSuggest: (q: string) => void }) {
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
        {SUGGESTED.map((q) => (
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
const _u = Badge;
void _u;
