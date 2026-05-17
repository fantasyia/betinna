import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from '@/components/PageLayout';
import { FormField, Select, Textarea } from '@/components/FormField';
import { Markdown } from '@/components/Markdown';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

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

const HISTORY_KEY = 'mullerbot_history_v1';

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
    /* sessionStorage cheio — ignora */
  }
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

export default function MullerBotPage() {
  const [pergunta, setPergunta] = useState('');
  const [topK, setTopK] = useState(5);
  const [modelo, setModelo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QAItem[]>(() => loadHistory());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveHistory(history);
  }, [history]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault();
    const q = pergunta.trim();
    // Validação client-side (backend valida com Zod). Aqui só os checks
    // óbvios pra evitar request inútil.
    if (!q) return;
    if (q.length > 2000) {
      setError('Pergunta muito longa (máx 2000 chars). Encurte e tente de novo.');
      return;
    }
    if (topK < 1 || topK > 20) {
      setError('topK deve estar entre 1 e 20.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Payload tipado em vez de `Record<string, unknown>` — mais seguro contra
      // typos e fica fácil de evoluir junto com o backend DTO.
      const payload: { pergunta: string; topK: number; modelo?: string } = {
        pergunta: q,
        topK,
      };
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
    if (!confirm('Limpar histórico desta sessão?')) return;
    setHistory([]);
  }

  return (
    <PageLayout
      title="MullerBot"
      actions={
        history.length > 0 ? (
          <button
            type="button"
            data-testid="muller-clear"
            onClick={clearHistory}
            style={btnSecondary}
          >
            Limpar histórico
          </button>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1rem', alignItems: 'start' }}>
        {/* Chat principal */}
        <div
          style={{
            ...card,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 200px)',
            minHeight: 500,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '1rem',
              background: '#fafbfc',
            }}
          >
            {history.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3rem 1rem',
                  color: colors.muted,
                }}
              >
                <div style={{ fontSize: 32, marginBottom: '0.5rem' }}>🤖</div>
                <p style={{ marginTop: 0, fontSize: 14, maxWidth: 480, margin: '0 auto' }}>
                  Pergunte qualquer coisa sobre o catálogo da empresa. O MullerBot busca os
                  produtos mais relevantes e responde com base apenas neles (não inventa).
                </p>
                <p style={{ fontSize: 13, color: colors.muted, marginTop: '1rem' }}>
                  Exemplos:
                  <br />
                  &ldquo;Quais produtos têm marca X?&rdquo;
                  <br />
                  &ldquo;Preciso de algo na linha de molhos&rdquo;
                  <br />
                  &ldquo;Recomende 3 produtos abaixo de R$ 50&rdquo;
                </p>
              </div>
            )}

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {history.map((qa) => (
                <li key={qa.id}>
                  {/* Pergunta (direita) */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
                    <div
                      style={{
                        maxWidth: '75%',
                        padding: '0.5rem 0.75rem',
                        background: colors.primary,
                        color: '#fff',
                        borderRadius: 12,
                        fontSize: 14,
                      }}
                    >
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{qa.pergunta}</p>
                    </div>
                  </div>
                  {/* Resposta (esquerda) */}
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div
                      style={{
                        maxWidth: '85%',
                        padding: '0.75rem 0.875rem',
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 12,
                        fontSize: 14,
                      }}
                    >
                      <Markdown
                        content={qa.resposta}
                        style={{ fontSize: 14, lineHeight: 1.5 }}
                      />
                      {qa.produtos.length > 0 && (
                        <div style={{ marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.5rem' }}>
                          <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>
                            Produtos consultados
                          </div>
                          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {qa.produtos.map((p) => (
                              <li key={p.id} style={{ fontSize: 12, color: colors.muted }}>
                                · <strong>{p.nome}</strong>
                                {p.marca && ` (${p.marca})`}
                                {p.precoTabela !== undefined && ` — ${fmtBRL(p.precoTabela)}`}
                              </li>
                            ))}
                          </ul>
                          {qa.truncados && (
                            <p style={{ fontSize: 11, color: colors.warning, marginTop: 4 }}>
                              ⚠ Catálogo grande — produtos descritivos foram truncados pra caber no contexto.
                            </p>
                          )}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 10,
                          color: colors.muted,
                          marginTop: 6,
                          textAlign: 'right',
                        }}
                      >
                        {qa.modelo ? `${qa.modelo} · ` : ''}
                        {qa.tokensIn !== undefined && `${qa.tokensIn}↓`}
                        {qa.tokensOut !== undefined && ` ${qa.tokensOut}↑`}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div ref={endRef} />
          </div>

          {/* Compose */}
          <form
            onSubmit={enviar}
            style={{ padding: '0.75rem 1rem', borderTop: `1px solid ${colors.border}` }}
          >
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
              style={{ minHeight: 60 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <span style={{ fontSize: 11, color: error ? colors.danger : colors.muted }}>
                {error ? error : `⌘/Ctrl + Enter pra enviar · ${pergunta.length}/2000`}
              </span>
              <button
                type="submit"
                data-testid="muller-send"
                disabled={busy || pergunta.trim().length === 0}
                style={{ ...btn, opacity: busy || pergunta.trim().length === 0 ? 0.6 : 1 }}
              >
                {busy ? 'Pensando…' : 'Perguntar'}
              </button>
            </div>
          </form>
        </div>

        {/* Sidebar config */}
        <div style={card}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Configurações</h3>
          <FormField label="Top-K produtos" htmlFor="topk" hint="Quantos produtos relevantes carregar no contexto">
            <Select
              id="topk"
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
          </FormField>
          <FormField label="Modelo (opcional)" htmlFor="modelo" hint="Default: gpt-4o-mini">
            <Select
              id="modelo"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
            >
              <option value="">Default (env)</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
            </Select>
          </FormField>

          <div
            style={{
              background: '#fafbfc',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '0.75rem',
              fontSize: 12,
              color: colors.muted,
              marginTop: '0.75rem',
              lineHeight: 1.5,
            }}
          >
            <strong>Como funciona:</strong>
            <ul style={{ paddingLeft: 16, margin: '4px 0 0' }}>
              <li>RAG sobre catálogo OMIE</li>
              <li>Top-K via keyword scoring</li>
              <li>Sem alucinação (system prompt limita)</li>
              <li>REPs precisam ter chave OpenAI própria em <span style={badge(colors.primary)}>Minhas integrações</span></li>
              <li>Histórico só nesta sessão (não persistido)</li>
            </ul>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
