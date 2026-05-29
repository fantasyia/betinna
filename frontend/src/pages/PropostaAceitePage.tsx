import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';

/**
 * C3 (Lote 6) — Página pública de aceite de proposta.
 *
 * Cliente acessa via link /proposta/aceite/:token (sem login). Vê os dados
 * da proposta e pode Aceitar ou Recusar. Aceite gera pedido automático no
 * backend. Token é one-time (invalidado após decisão).
 *
 * Todas as chamadas usam skipAuth (endpoints @Public no backend).
 */

interface AceiteItem {
  produtoNome: string;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  total: number;
}
interface AceitePreview {
  numero: string;
  empresaNome: string;
  clienteNome: string;
  status: string;
  validoAte: string | null;
  formaPagamento: string;
  condicaoPagamento: string | null;
  subtotal: number;
  descontoGeral: number;
  valor: number;
  observacoes: string | null;
  jaRespondida: boolean;
  itens: AceiteItem[];
}

const NAVY = '#201554';
const CYAN = '#2bcae5';

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

export default function PropostaAceitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = useState<AceitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<'ACEITA' | 'RECUSADA' | null>(null);
  const [confirmarRecusa, setConfirmarRecusa] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AceitePreview>(`/propostas/aceite/${token}`, { skipAuth: true })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function decidir(decisao: 'ACEITA' | 'RECUSADA') {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/propostas/aceite/${token}/decidir`,
        { decisao },
        { skipAuth: true },
      );
      setResultado(decisao);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${NAVY} 0%, #2d1f6e 100%)`,
        padding: '2rem 1rem',
        fontFamily: 'Cabin, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 700, margin: 0 }}>
            {data?.empresaNome ?? 'Proposta Comercial'}
          </h1>
          {data && (
            <p style={{ color: CYAN, fontSize: 14, margin: '0.25rem 0 0' }}>
              Proposta {data.numero}
            </p>
          )}
        </div>

        <div
          style={{
            background: '#fff',
            borderRadius: 10,
            padding: '1.75rem',
            boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
          }}
        >
          {loading && (
            <p style={{ textAlign: 'center', color: '#666' }}>Carregando proposta…</p>
          )}

          {!loading && error && !data && (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <div style={{ fontSize: 40 }}>⚠️</div>
              <h2 style={{ color: NAVY, fontSize: 18 }}>Link inválido ou expirado</h2>
              <p style={{ color: '#666', fontSize: 14 }}>{error}</p>
            </div>
          )}

          {/* Resultado da decisão */}
          {resultado && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ fontSize: 48 }}>{resultado === 'ACEITA' ? '✅' : '❌'}</div>
              <h2 style={{ color: NAVY, fontSize: 20, margin: '0.5rem 0' }}>
                {resultado === 'ACEITA' ? 'Proposta aceita!' : 'Proposta recusada'}
              </h2>
              <p style={{ color: '#666', fontSize: 14 }}>
                {resultado === 'ACEITA'
                  ? 'Obrigado! O responsável foi notificado e dará sequência ao seu pedido.'
                  : 'Tudo bem. O responsável foi notificado da sua decisão.'}
              </p>
            </div>
          )}

          {/* Conteúdo da proposta (quando carregada, não respondida e sem resultado ainda) */}
          {data && !resultado && (
            <>
              {data.jaRespondida && (
                <div
                  style={{
                    background: '#fff7ed',
                    border: '1px solid #fed7aa',
                    borderRadius: 8,
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    color: '#9a3412',
                    fontSize: 13,
                  }}
                >
                  Esta proposta já foi respondida ou o link expirou. Caso precise, peça um
                  novo link ao responsável.
                </div>
              )}

              <p style={{ color: '#444', fontSize: 14, marginTop: 0 }}>
                Olá, <strong>{data.clienteNome}</strong>! Segue sua proposta:
              </p>
              {data.validoAte && (
                <p style={{ color: '#888', fontSize: 12 }}>Válida até {fmtDate(data.validoAte)}</p>
              )}

              {/* Itens */}
              <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: NAVY, color: '#fff' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left' }}>Produto</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right' }}>Qtd</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right' }}>Preço</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.itens.map((it, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.5rem' }}>{it.produtoNome}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{it.quantidade}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                          {fmtBRL(it.precoUnitario)}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{fmtBRL(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totais */}
              <div style={{ textAlign: 'right', fontSize: 14, marginBottom: '1rem' }}>
                <div style={{ color: '#666' }}>Subtotal: {fmtBRL(data.subtotal)}</div>
                {data.descontoGeral > 0 && (
                  <div style={{ color: '#666' }}>Desconto: {data.descontoGeral}%</div>
                )}
                <div style={{ fontSize: 22, fontWeight: 700, color: NAVY, marginTop: 4 }}>
                  Total: {fmtBRL(data.valor)}
                </div>
              </div>

              {/* Condições */}
              <p style={{ fontSize: 12, color: '#666' }}>
                Pagamento: {data.formaPagamento}
                {data.condicaoPagamento ? ` · ${data.condicaoPagamento}` : ''}
              </p>
              {data.observacoes && (
                <p style={{ fontSize: 12, color: '#666' }}>Obs: {data.observacoes}</p>
              )}

              {error && (
                <p style={{ color: '#c43c3c', fontSize: 13, textAlign: 'center' }}>{error}</p>
              )}

              {/* Botões de decisão (só quando não respondida) */}
              {!data.jaRespondida && (
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                  {!confirmarRecusa ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmarRecusa(true)}
                        disabled={busy}
                        style={{
                          flex: 1,
                          padding: '0.875rem',
                          borderRadius: 10,
                          border: '1px solid #ddd',
                          background: '#fff',
                          color: '#666',
                          fontSize: 15,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Recusar
                      </button>
                      <button
                        type="button"
                        onClick={() => void decidir('ACEITA')}
                        disabled={busy}
                        style={{
                          flex: 2,
                          padding: '0.875rem',
                          borderRadius: 10,
                          border: 'none',
                          background: busy ? '#9ca3af' : NAVY,
                          color: '#fff',
                          fontSize: 15,
                          fontWeight: 700,
                          cursor: busy ? 'default' : 'pointer',
                        }}
                      >
                        {busy ? 'Enviando…' : 'Aceitar proposta'}
                      </button>
                    </>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, color: '#444', margin: '0 0 0.5rem' }}>
                        Tem certeza que deseja recusar esta proposta?
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => setConfirmarRecusa(false)}
                          disabled={busy}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            borderRadius: 10,
                            border: '1px solid #ddd',
                            background: '#fff',
                            color: '#666',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Voltar
                        </button>
                        <button
                          type="button"
                          onClick={() => void decidir('RECUSADA')}
                          disabled={busy}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            borderRadius: 10,
                            border: 'none',
                            background: busy ? '#9ca3af' : '#c43c3c',
                            color: '#fff',
                            fontWeight: 700,
                            cursor: busy ? 'default' : 'pointer',
                          }}
                        >
                          {busy ? 'Enviando…' : 'Confirmar recusa'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: '1.5rem' }}>
          Powered by Betinna.ai
        </p>
      </div>
    </div>
  );
}
