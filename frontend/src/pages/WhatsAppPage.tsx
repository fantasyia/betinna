import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { cn } from '@/lib/cn';

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
  DISCONNECTED: 'var(--muted)',
  CONNECTING: '#0891b2',
  QR_PENDING: 'var(--warning)',
  CONNECTED: 'var(--success)',
  LOGGED_OUT: 'var(--muted)',
  ERROR: 'var(--danger)',
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
      <AtendimentoTabs />
      {/* Tabs scope */}
      <div role="tablist" className="flex gap-1 mb-4">
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
          description="Cada representante tem o próprio"
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
      className={cn(
        'border border-b-0 rounded-t-md py-2 px-4 cursor-pointer font-[inherit] text-left',
        active
          ? 'bg-surface border-border text-text font-semibold'
          : 'bg-transparent border-transparent text-muted font-medium',
      )}
    >
      <div className="text-[14px]">{label}</div>
      <div className="text-[11px] text-muted">{description}</div>
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
  const [confirmLimpar, setConfirmLimpar] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const [limparMsg, setLimparMsg] = useState<string | null>(null);
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

  // Limpa TODAS as conversas+mensagens de WhatsApp da empresa (DESTRUTIVO).
  // Não desconecta o número — só zera o histórico no banco.
  async function limparWhatsapp() {
    setLimpando(true);
    setLimparMsg(null);
    try {
      const r = await api.delete<{ conversas: number; mensagens: number }>(
        '/inbox/whatsapp/limpar',
      );
      setLimparMsg(`✓ Apagado: ${r.conversas} conversa(s) e ${r.mensagens} mensagem(ns).`);
    } catch (err) {
      setLimparMsg(err instanceof ApiError ? `Falha: ${err.message}` : 'Falha ao limpar.');
    } finally {
      setLimpando(false);
      setConfirmLimpar(false);
    }
  }

  const status = info?.status ?? 'DISCONNECTED';
  // Fix QR (Fase 2.0): mostra a área de QR sempre que o status for QR_PENDING.
  // A imagem aparece quando pronta; enquanto isso, um aviso "Preparando…" —
  // nunca uma caixa vazia silenciosa.
  const showQr = status === 'QR_PENDING';
  const showConnecting = status === 'CONNECTING';
  const showConnected = status === 'CONNECTED';

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 max-w-[720px]">
      {loading && !info ? (
        <p className="text-muted">Carregando status…</p>
      ) : error && !info ? (
        <div className="py-[0.875rem] px-4 bg-[#fef2f2] border border-[#fecaca] rounded-md text-[#991b1b]">
          <strong className="block mb-1">
            Não foi possível obter status do WhatsApp.
          </strong>
          <span className="text-[13px]">
            {error}
            {error.toLowerCase().includes('not found') || error.includes('404')
              ? ' — WhatsApp ainda não conectado. Clique em "Conectar" para parear.'
              : ' — Verifique se o backend está rodando ou tente novamente.'}
          </span>
        </div>
      ) : (
        <>
          <header className="flex items-center justify-between mb-4">
            <h2 className="m-0 text-[18px]">
              {scope === 'empresa' ? 'WhatsApp da empresa' : 'Meu WhatsApp pessoal'}
            </h2>
            <span
              className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] border"
              style={{
                background: `color-mix(in srgb, ${STATUS_COLOR[status]} 12%, transparent)`,
                color: STATUS_COLOR[status],
                borderColor: `color-mix(in srgb, ${STATUS_COLOR[status]} 19%, transparent)`,
              }}
              data-testid={`wa-status-${scope}`}
            >
              {STATUS_LABEL[status]}
            </span>
          </header>

          {info?.numero && showConnected && (
            <p className="text-[14px] mb-4">
              📱 Número conectado: <strong>{info.numero}</strong>
            </p>
          )}

          {/* Estado QR_PENDING */}
          {showQr && (
            <div
              data-testid="qr-container"
              className="flex flex-col items-center p-6 bg-bg-alt rounded-lg border border-border"
            >
              <p className="mt-0 text-[14px] text-center">
                Escaneie o QR abaixo no app do WhatsApp:
                <br />
                <span className="text-muted text-[12px]">
                  WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
                </span>
              </p>
              {info?.qrDataUrl ? (
                <img
                  src={info.qrDataUrl}
                  alt="QR Code WhatsApp"
                  data-testid="qr-image"
                  className="w-[280px] h-[280px] [image-rendering:pixelated] mt-3"
                />
              ) : (
                <div
                  data-testid="qr-loading"
                  className="w-[280px] h-[280px] mt-3 flex items-center justify-center text-muted text-[13px] border border-dashed border-border rounded-lg"
                >
                  Preparando QR…
                </div>
              )}
              <p className="text-[11px] text-muted mt-3 mb-0">
                QR regenera automaticamente a cada ~20s
              </p>
            </div>
          )}

          {/* Estado CONNECTING */}
          {showConnecting && (
            <div
              data-testid="connecting-state"
              className="p-6 text-center bg-bg-alt rounded-lg border border-border"
            >
              <p className="m-0 text-muted">Conectando ao WhatsApp…</p>
            </div>
          )}

          {/* Estado CONNECTED */}
          {showConnected && (
            <div
              data-testid="connected-state"
              className="p-4 bg-success/8 border border-success rounded-lg flex items-center gap-2"
            >
              <span className="text-[20px]">✓</span>
              <div>
                <strong className="text-success">WhatsApp conectado</strong>
                <div className="text-[12px] text-muted mt-0.5">
                  Mensagens entram pela Inbox em tempo real.
                </div>
              </div>
            </div>
          )}

          {/* Estado ERROR */}
          {status === 'ERROR' && info?.erro && (
            <div
              data-testid="error-state"
              className="p-3 bg-danger/8 border border-danger rounded-lg text-danger text-[13px]"
            >
              <strong>Erro:</strong> {info.erro}
            </div>
          )}

          {/* Estados DISCONNECTED / LOGGED_OUT — convite a conectar */}
          {(status === 'DISCONNECTED' || status === 'LOGGED_OUT') && (
            <div
              data-testid="empty-state"
              className="p-6 text-center bg-bg-alt rounded-lg border border-border"
            >
              <p className="mt-0 text-muted">
                {status === 'LOGGED_OUT'
                  ? 'Sessão deslogada. Clique pra parear novamente.'
                  : 'WhatsApp ainda não está conectado.'}
              </p>
              {scope === 'empresa' && (
                <p className="text-[12px] text-warning mb-3">
                  ⚠️ Use um número <strong>dedicado</strong> da empresa (não pessoal). A Meta pode
                  banir números que parecem operar via Baileys.
                </p>
              )}
            </div>
          )}

          {/* Botões de ação */}
          {canManage && (
            <div className="flex gap-2 mt-4 flex-wrap">
              {(status === 'DISCONNECTED' || status === 'LOGGED_OUT' || status === 'ERROR') && (
                <button
                  type="button"
                  data-testid={`wa-conectar-${scope}`}
                  disabled={busy !== null}
                  onClick={() => call('conectar')}
                  className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
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
                  className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
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
                  className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
                >
                  Resetar credenciais
                </button>
              )}
              {confirmReset && (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    data-testid={`wa-resetar-confirm-${scope}`}
                    disabled={busy !== null}
                    onClick={() => call('resetar')}
                    className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
                  >
                    {busy === 'resetar' ? '…' : 'Confirmar reset (apaga credenciais)'}
                  </button>
                </>
              )}
            </div>
          )}

          {!canManage && (
            <p className="text-[12px] text-muted mt-4">
              Você não tem permissão pra gerenciar o WhatsApp da empresa (apenas ADMIN/DIRECTOR).
              Pode ver o status, mas não conectar/desconectar.
            </p>
          )}

          {actionError && (
            <div
              data-testid="action-error"
              className="mt-3 py-2 px-3 bg-danger/8 border border-danger rounded-md text-danger text-[13px]"
            >
              {actionError}
            </div>
          )}

          {/* Manutenção — limpar mensagens de WhatsApp (DESTRUTIVO, empresa toda) */}
          {scope === 'empresa' && canManage && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-[13px] font-semibold mb-1">Manutenção</div>
              <p className="text-[12px] text-muted mt-0 mb-3">
                Apaga <strong>todas</strong> as conversas e mensagens de WhatsApp da empresa (no
                banco). Útil pra zerar o histórico antes de começar os disparos.{' '}
                <strong>Não desconecta</strong> o número.
              </p>
              {!confirmLimpar ? (
                <button
                  type="button"
                  data-testid="wa-limpar"
                  disabled={limpando}
                  onClick={() => {
                    setLimparMsg(null);
                    setConfirmLimpar(true);
                  }}
                  className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
                >
                  Limpar mensagens do WhatsApp
                </button>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setConfirmLimpar(false)}
                    className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    data-testid="wa-limpar-confirm"
                    disabled={limpando}
                    onClick={() => void limparWhatsapp()}
                    className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
                  >
                    {limpando ? 'Apagando…' : 'Confirmar — apagar TUDO de WhatsApp'}
                  </button>
                </div>
              )}
              {limparMsg && (
                <div
                  className={cn(
                    'mt-3 text-[13px]',
                    limparMsg.startsWith('✓') ? 'text-success' : 'text-danger',
                  )}
                >
                  {limparMsg}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
