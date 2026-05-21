import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { alpha, badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type Status =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_PENDING'
  | 'CONNECTED'
  | 'LOGGED_OUT'
  | 'ERROR';

interface SessionInfo {
  ownerType: 'EMPRESA' | 'USUARIO';
  ownerId: string;
  empresaId: string;
  status: Status;
  qrDataUrl?: string;
  qrRaw?: string;
  numero?: string;
  erro?: string;
  desde?: string;
}

const STATUS_COLOR: Record<Status, string> = {
  DISCONNECTED: colors.muted,
  CONNECTING: '#0891b2',
  QR_PENDING: colors.warning,
  CONNECTED: colors.success,
  LOGGED_OUT: colors.muted,
  ERROR: colors.danger,
};
const STATUS_LABEL: Record<Status, string> = {
  DISCONNECTED: 'Desconectado',
  CONNECTING: 'Conectando…',
  QR_PENDING: 'Aguardando QR',
  CONNECTED: 'Conectado',
  LOGGED_OUT: 'Deslogado',
  ERROR: 'Erro',
};

type Scope = 'empresa' | 'pessoal';

const ENDPOINTS: Record<Scope, { status: string; conectar: string; desconectar: string; resetar: string }> = {
  empresa: {
    status: '/integracoes/whatsapp/status',
    conectar: '/integracoes/whatsapp/conectar',
    desconectar: '/integracoes/whatsapp/desconectar',
    resetar: '/integracoes/whatsapp/resetar',
  },
  pessoal: {
    status: '/usuario/integracoes/whatsapp/status',
    conectar: '/usuario/integracoes/whatsapp/conectar',
    desconectar: '/usuario/integracoes/whatsapp/desconectar',
    resetar: '/usuario/integracoes/whatsapp/resetar',
  },
};

export default function WhatsAppPage() {
  const role = useRole();
  const canAccessEmpresa = role === 'ADMIN' || role === 'DIRECTOR' || role === 'SAC';
  const canManageEmpresa = role === 'ADMIN' || role === 'DIRECTOR';

  const [scope, setScope] = useState<Scope>(canAccessEmpresa ? 'empresa' : 'pessoal');

  return (
    <PageLayout title="WhatsApp">
      {/* Tabs scope */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: '0.25rem',
          marginBottom: '1rem',
        }}
      >
        {canAccessEmpresa && (
          <ScopeTab
            label="Número da empresa"
            description="Central SAC compartilhada"
            active={scope === 'empresa'}
            onClick={() => setScope('empresa')}
            testId="tab-empresa"
          />
        )}
        <ScopeTab
          label="Meu WhatsApp pessoal"
          description="Cada rep tem o próprio"
          active={scope === 'pessoal'}
          onClick={() => setScope('pessoal')}
          testId="tab-pessoal"
        />
      </div>

      <SessionPanel
        key={scope}
        scope={scope}
        canManage={scope === 'pessoal' ? true : canManageEmpresa}
      />
    </PageLayout>
  );
}

function ScopeTab({
  label,
  description,
  active,
  onClick,
  testId,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      style={{
        background: active ? colors.surface : 'transparent',
        border: `1px solid ${active ? colors.border : 'transparent'}`,
        borderBottom: 'none',
        borderRadius: '6px 6px 0 0',
        padding: '0.5rem 1rem',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: active ? colors.text : colors.muted,
        fontWeight: active ? 600 : 500,
        textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 14 }}>{label}</div>
      <div style={{ fontSize: 11, color: colors.muted }}>{description}</div>
    </button>
  );
}

// ─── Painel de sessão (compartilhado entre empresa e pessoal) ────────

function SessionPanel({ scope, canManage }: { scope: Scope; canManage: boolean }) {
  const endpoints = ENDPOINTS[scope];
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'conectar' | 'desconectar' | 'resetar' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    async function load() {
      try {
        const s = await api.get<SessionInfo>(endpoints.status);
        if (!cancelledRef.current) {
          setInfo(s);
          setError(null);
        }
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof ApiError ? err.message : 'Erro');
        }
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    }
    void load();
    // Poll 3s — Baileys regenera QR cada ~20s e mudança de status é frequente
    interval = setInterval(load, 3000);
    return () => {
      cancelledRef.current = true;
      if (interval) clearInterval(interval);
    };
  }, [endpoints.status]);

  async function call(action: 'conectar' | 'desconectar' | 'resetar') {
    setBusy(action);
    setActionError(null);
    try {
      if (action === 'conectar') {
        await api.post(endpoints.conectar);
      } else {
        await api.delete(action === 'desconectar' ? endpoints.desconectar : endpoints.resetar);
      }
      // Refresh status imediato (poll vai pegar depois também)
      const s = await api.get<SessionInfo>(endpoints.status);
      setInfo(s);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  }

  const status = info?.status ?? 'DISCONNECTED';
  const showQr = status === 'QR_PENDING' && info?.qrDataUrl;
  const showConnecting = status === 'CONNECTING';
  const showConnected = status === 'CONNECTED';

  return (
    <div style={{ ...card, maxWidth: 720 }}>
      {loading && !info ? (
        <p style={{ color: colors.muted }}>Carregando status…</p>
      ) : error && !info ? (
        <div
          style={{
            padding: '0.875rem 1rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            color: '#991b1b',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>
            Não foi possível obter status do WhatsApp.
          </strong>
          <span style={{ fontSize: 13 }}>
            {error}
            {error.toLowerCase().includes('not found') || error.includes('404')
              ? ' — WhatsApp ainda não conectado. Clique em "Conectar" para parear.'
              : ' — Verifique se o backend está rodando ou tente novamente.'}
          </span>
        </div>
      ) : (
        <>
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {scope === 'empresa' ? 'WhatsApp da empresa' : 'Meu WhatsApp pessoal'}
            </h2>
            <span style={badge(STATUS_COLOR[status])} data-testid={`wa-status-${scope}`}>
              {STATUS_LABEL[status]}
            </span>
          </header>

          {info?.numero && showConnected && (
            <p style={{ fontSize: 14, marginBottom: '1rem' }}>
              📱 Número conectado: <strong>{info.numero}</strong>
            </p>
          )}

          {/* Estado QR_PENDING */}
          {showQr && info?.qrDataUrl && (
            <div
              data-testid="qr-container"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '1.5rem',
                background: '#fafbfc',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
              }}
            >
              <p style={{ marginTop: 0, fontSize: 14, textAlign: 'center' }}>
                Escaneie o QR abaixo no app do WhatsApp:
                <br />
                <span style={{ color: colors.muted, fontSize: 12 }}>
                  WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
                </span>
              </p>
              <img
                src={info.qrDataUrl}
                alt="QR Code WhatsApp"
                data-testid="qr-image"
                style={{
                  width: 280,
                  height: 280,
                  imageRendering: 'pixelated',
                  marginTop: '0.75rem',
                }}
              />
              <p style={{ fontSize: 11, color: colors.muted, marginTop: '0.75rem', marginBottom: 0 }}>
                QR regenera automaticamente a cada ~20s
              </p>
            </div>
          )}

          {/* Estado CONNECTING */}
          {showConnecting && (
            <div
              data-testid="connecting-state"
              style={{
                padding: '1.5rem',
                textAlign: 'center',
                background: '#fafbfc',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
              }}
            >
              <p style={{ margin: 0, color: colors.muted }}>Conectando ao WhatsApp…</p>
            </div>
          )}

          {/* Estado CONNECTED */}
          {showConnected && (
            <div
              data-testid="connected-state"
              style={{
                padding: '1rem',
                background: alpha(colors.success, 8),
                border: `1px solid ${colors.success}`,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span style={{ fontSize: 20 }}>✓</span>
              <div>
                <strong style={{ color: colors.success }}>WhatsApp conectado</strong>
                <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  Mensagens entram pela Inbox em tempo real.
                </div>
              </div>
            </div>
          )}

          {/* Estado ERROR */}
          {status === 'ERROR' && info?.erro && (
            <div
              data-testid="error-state"
              style={{
                padding: '0.75rem',
                background: alpha(colors.danger, 8),
                border: `1px solid ${colors.danger}`,
                borderRadius: 8,
                color: colors.danger,
                fontSize: 13,
              }}
            >
              <strong>Erro:</strong> {info.erro}
            </div>
          )}

          {/* Estados DISCONNECTED / LOGGED_OUT — convite a conectar */}
          {(status === 'DISCONNECTED' || status === 'LOGGED_OUT') && (
            <div
              data-testid="empty-state"
              style={{
                padding: '1.5rem',
                textAlign: 'center',
                background: '#fafbfc',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
              }}
            >
              <p style={{ marginTop: 0, color: colors.muted }}>
                {status === 'LOGGED_OUT'
                  ? 'Sessão deslogada. Clique pra parear novamente.'
                  : 'WhatsApp ainda não está conectado.'}
              </p>
              {scope === 'empresa' && (
                <p style={{ fontSize: 12, color: colors.warning, marginBottom: '0.75rem' }}>
                  ⚠️ Use um número <strong>dedicado</strong> da empresa (não pessoal). A Meta pode
                  banir números que parecem operar via Baileys.
                </p>
              )}
            </div>
          )}

          {/* Botões de ação */}
          {canManage && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              {(status === 'DISCONNECTED' || status === 'LOGGED_OUT' || status === 'ERROR') && (
                <button
                  type="button"
                  data-testid={`wa-conectar-${scope}`}
                  disabled={busy !== null}
                  onClick={() => call('conectar')}
                  style={btn}
                >
                  {busy === 'conectar' ? 'Iniciando…' : 'Conectar'}
                </button>
              )}
              {(status === 'CONNECTED' || status === 'QR_PENDING' || status === 'CONNECTING') && (
                <button
                  type="button"
                  data-testid={`wa-desconectar-${scope}`}
                  disabled={busy !== null}
                  onClick={() => call('desconectar')}
                  style={btnSecondary}
                >
                  {busy === 'desconectar' ? 'Desconectando…' : 'Desconectar'}
                </button>
              )}
              {status !== 'DISCONNECTED' && !confirmReset && (
                <button
                  type="button"
                  data-testid={`wa-resetar-${scope}`}
                  disabled={busy !== null}
                  onClick={() => setConfirmReset(true)}
                  style={btnDanger}
                >
                  Resetar credenciais
                </button>
              )}
              {confirmReset && (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    style={btnSecondary}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    data-testid={`wa-resetar-confirm-${scope}`}
                    disabled={busy !== null}
                    onClick={() => call('resetar')}
                    style={btnDanger}
                  >
                    {busy === 'resetar' ? '…' : 'Confirmar reset (apaga credenciais)'}
                  </button>
                </>
              )}
            </div>
          )}

          {!canManage && (
            <p style={{ fontSize: 12, color: colors.muted, marginTop: '1rem' }}>
              Você não tem permissão pra gerenciar o WhatsApp da empresa (apenas ADMIN/DIRECTOR).
              Pode ver o status, mas não conectar/desconectar.
            </p>
          )}

          {actionError && (
            <div
              data-testid="action-error"
              style={{
                marginTop: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: alpha(colors.danger, 8),
                border: `1px solid ${colors.danger}`,
                borderRadius: 6,
                color: colors.danger,
                fontSize: 13,
              }}
            >
              {actionError}
            </div>
          )}
        </>
      )}
    </div>
  );
}
