import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input } from '@/components/FormField';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type ServicoUsuario = 'google_calendar' | 'sendgrid' | 'openai' | 'anthropic' | 'whatsapp';

interface ServicoMeta {
  nome: string;
  tipo: 'agenda' | 'email' | 'ia' | 'mensageria';
  color: string;
  icon: string;
  description: string;
  connectMode: 'oauth' | 'credentials' | 'qr';
  oauthStart?: string;
  credentialFields?: Array<{ name: string; label: string; type?: 'text' | 'password'; placeholder?: string; hint?: string }>;
  qrRoute?: string;
}

const SERVICOS: Record<ServicoUsuario, ServicoMeta> = {
  google_calendar: {
    nome: 'Google Calendar',
    tipo: 'agenda',
    color: '#4285f4',
    icon: 'G',
    description:
      'Espelha compromissos da Agenda no seu calendário Google. Permite ver agenda Betinna no Google.',
    connectMode: 'oauth',
    oauthStart: '/integracoes/google/oauth/start',
  },
  sendgrid: {
    nome: 'SendGrid',
    tipo: 'email',
    color: '#1a82e2',
    icon: '✉',
    description: 'Envio de e-mails pelos seus templates SendGrid. Cada rep paga o próprio crédito.',
    connectMode: 'credentials',
    credentialFields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'SG.xxxxx…',
        hint: 'Gera em app.sendgrid.com → Settings → API Keys',
      },
      {
        name: 'fromEmail',
        label: 'E-mail remetente',
        type: 'text',
        placeholder: 'voce@suaempresa.com',
        hint: 'Precisa estar verificado no SendGrid (Sender Authentication)',
      },
    ],
  },
  openai: {
    nome: 'OpenAI',
    tipo: 'ia',
    color: '#10a37f',
    icon: 'AI',
    description:
      'Chave pessoal para usar o MullerBot. REPs precisam ter chave própria (rastreabilidade + custo).',
    connectMode: 'credentials',
    credentialFields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-…',
        hint: 'Gera em platform.openai.com → API Keys',
      },
    ],
  },
  anthropic: {
    nome: 'Anthropic Claude',
    tipo: 'ia',
    color: '#d97757',
    icon: 'C',
    description: 'Chave pessoal pra usar Claude (opcional — alternativa ao OpenAI).',
    connectMode: 'credentials',
    credentialFields: [
      {
        name: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-ant-…',
        hint: 'Gera em console.anthropic.com → API Keys',
      },
    ],
  },
  whatsapp: {
    nome: 'WhatsApp pessoal',
    tipo: 'mensageria',
    color: '#25d366',
    icon: '💬',
    description:
      'Conecta seu celular WhatsApp via QR. Para reps: clientes/prospects que conversarem com você aparecem na Inbox.',
    connectMode: 'qr',
    qrRoute: '/whatsapp',
  },
};

const SERVICO_ORDER: ServicoUsuario[] = ['whatsapp', 'google_calendar', 'sendgrid', 'openai', 'anthropic'];

const TIPO_LABEL: Record<ServicoMeta['tipo'], string> = {
  agenda: 'Agenda',
  email: 'E-mail',
  ia: 'IA',
  mensageria: 'Mensageria',
};

interface Conexao {
  id: string;
  servico: ServicoUsuario;
  ativo: boolean;
  externalAccountId?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

export default function MinhasIntegracoesPage() {
  const { data, loading, error, refetch } = useApiQuery<Conexao[] | { data: Conexao[] }>(
    '/usuario/integracoes',
  );
  const [connecting, setConnecting] = useState<ServicoUsuario | null>(null);
  const [disconnecting, setDisconnecting] = useState<ServicoUsuario | null>(null);

  const conexoes: Conexao[] = Array.isArray(data) ? data : data?.data ?? [];
  const byServico = new Map<ServicoUsuario, Conexao>();
  for (const c of conexoes) byServico.set(c.servico, c);

  // postMessage de popup OAuth → refetch
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      const t = (e.data as { type?: string }).type;
      if (t && t.endsWith('-oauth')) {
        refetch();
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [refetch]);

  return (
    <PageLayout title="Minhas integrações">
      <p style={{ color: colors.muted, marginTop: 0, marginBottom: '1rem', fontSize: 14 }}>
        Conexões pessoais (suas, não da empresa). Cada usuário tem as próprias credenciais
        cifradas com AES-256-GCM.
      </p>
      <StateView loading={loading} error={error} onRetry={refetch}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '0.875rem',
          }}
        >
          {SERVICO_ORDER.map((s) => (
            <ServicoCard
              key={s}
              servico={s}
              conexao={byServico.get(s)}
              onConnect={() => setConnecting(s)}
              onDisconnect={() => setDisconnecting(s)}
            />
          ))}
        </div>
      </StateView>

      {connecting && (
        <ConnectModal
          servico={connecting}
          existing={byServico.get(connecting)}
          onClose={() => setConnecting(null)}
          onSaved={() => {
            setConnecting(null);
            refetch();
          }}
        />
      )}
      {disconnecting && (
        <DisconnectModal
          servico={disconnecting}
          onClose={() => setDisconnecting(null)}
          onDone={() => {
            setDisconnecting(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────

function ServicoCard({
  servico,
  conexao,
  onConnect,
  onDisconnect,
}: {
  servico: ServicoUsuario;
  conexao?: Conexao;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const meta = SERVICOS[servico];
  const conectado = conexao?.ativo;

  return (
    <div
      data-testid={`user-servico-card-${servico}`}
      style={{
        ...card,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        borderLeft: `4px solid ${meta.color}`,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          style={{
            background: meta.color,
            color: '#fff',
            borderRadius: 6,
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {meta.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{meta.nome}</h3>
          <div style={{ fontSize: 11, color: colors.muted }}>{TIPO_LABEL[meta.tipo]}</div>
        </div>
        <span
          style={badge(conectado ? colors.success : colors.muted)}
          data-testid={`user-status-${servico}`}
        >
          {conectado ? '● conectado' : '○ não conectado'}
        </span>
      </header>

      <p style={{ margin: 0, fontSize: 12, color: colors.muted, lineHeight: 1.4 }}>
        {meta.description}
      </p>

      {conexao && (
        <dl style={{ margin: 0, fontSize: 11, color: colors.muted }}>
          {conexao.externalAccountId && (
            <div>
              <strong>Conta:</strong> {conexao.externalAccountId}
            </div>
          )}
          <div>
            <strong>Conectado em:</strong> {fmtDate(conexao.criadoEm)}
          </div>
        </dl>
      )}

      <div style={{ display: 'flex', gap: '0.375rem', marginTop: 'auto', flexWrap: 'wrap' }}>
        {!conectado && (
          <button
            type="button"
            data-testid={`user-conectar-${servico}`}
            onClick={onConnect}
            style={btn}
          >
            Conectar
          </button>
        )}
        {conectado && (
          <>
            <button
              type="button"
              data-testid={`user-reconectar-${servico}`}
              onClick={onConnect}
              style={{ ...btnSecondary, padding: '0.5rem 0.75rem' }}
            >
              Reconectar
            </button>
            <button
              type="button"
              data-testid={`user-desconectar-${servico}`}
              onClick={onDisconnect}
              style={{ ...btnDanger, padding: '0.5rem 0.75rem' }}
            >
              Desconectar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Connect modal ───────────────────────────────────────────────────

function ConnectModal({
  servico,
  existing,
  onClose,
  onSaved,
}: {
  servico: ServicoUsuario;
  existing?: Conexao;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = SERVICOS[servico];

  if (meta.connectMode === 'qr' && meta.qrRoute) {
    return (
      <Modal open onClose={onClose} title={`Conectar ${meta.nome}`}>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          O pareamento é feito por QR code numa página dedicada.
        </p>
        <a
          href={meta.qrRoute}
          style={{ ...btn, display: 'inline-block', textDecoration: 'none', marginTop: '0.5rem' }}
        >
          Abrir pareamento →
        </a>
      </Modal>
    );
  }

  if (meta.connectMode === 'oauth') {
    return (
      <OAuthConnectModal
        servico={servico}
        meta={meta}
        existing={existing}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  return (
    <CredentialsConnectModal
      servico={servico}
      meta={meta}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function OAuthConnectModal({
  servico,
  meta,
  existing,
  onClose,
  onSaved,
}: {
  servico: ServicoUsuario;
  meta: ServicoMeta;
  existing?: Conexao;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      const t = (e.data as { type?: string }).type;
      const ok = (e.data as { ok?: boolean }).ok;
      if (t && t.endsWith('-oauth')) {
        if (ok) onSaved();
        else {
          setError('Autorização falhou.');
          setBusy(false);
        }
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onSaved]);

  const startOAuth = useCallback(async () => {
    if (!meta.oauthStart) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<{ url: string }>(meta.oauthStart);
      if (!r.url) throw new Error('Backend não retornou URL OAuth');
      const w = 600;
      const h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        r.url,
        `${servico}-oauth`,
        `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!popup) throw new Error('Popup bloqueado — habilite no navegador');
      const t = setInterval(() => {
        if (popup.closed) {
          clearInterval(t);
          setBusy(false);
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Falha');
      setBusy(false);
    }
  }, [meta.oauthStart, servico]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Conectar ${meta.nome}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid={`user-oauth-start-${servico}`}
            onClick={startOAuth}
            disabled={busy}
            style={{ ...btn, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Aguardando popup…' : existing ? 'Reautorizar' : 'Autorizar via OAuth'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14 }}>{meta.description}</p>
      <div
        style={{
          background: '#fafbfc',
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: '0.75rem',
          fontSize: 13,
          color: colors.muted,
          lineHeight: 1.5,
          marginTop: '0.75rem',
        }}
      >
        Abrimos uma janela popup do <strong>{meta.nome}</strong> pra você autorizar.
        Quando aprovar, a janela fecha e a integração fica ativa.
      </div>
      {error && (
        <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}

function CredentialsConnectModal({
  servico,
  meta,
  onClose,
  onSaved,
}: {
  servico: ServicoUsuario;
  meta: ServicoMeta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields = meta.credentialFields ?? [];
  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = fields.every((f) => form[f.name].trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/usuario/integracoes/conectar', {
        servico,
        credenciais: form,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Conectar ${meta.nome}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="user-creds-form"
            data-testid={`user-creds-save-${servico}`}
            disabled={busy || !valid}
            style={{ ...btn, opacity: busy || !valid ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="user-creds-form" onSubmit={submit}>
        <p style={{ marginTop: 0, fontSize: 14 }}>{meta.description}</p>
        <p style={{ fontSize: 12, color: colors.muted, marginBottom: '1rem' }}>
          Credenciais cifradas <strong>AES-256-GCM</strong>. Só seu usuário acessa.
        </p>
        {fields.map((f) => (
          <FormField
            key={f.name}
            label={f.label}
            htmlFor={`user-creds-${f.name}`}
            hint={f.hint}
            required
          >
            <Input
              id={`user-creds-${f.name}`}
              data-testid={`user-creds-${f.name}`}
              type={f.type ?? 'text'}
              value={form[f.name]}
              onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
              placeholder={f.placeholder}
              required
              autoComplete="off"
            />
          </FormField>
        ))}
        {error && (
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function DisconnectModal({
  servico,
  onClose,
  onDone,
}: {
  servico: ServicoUsuario;
  onClose: () => void;
  onDone: () => void;
}) {
  const meta = SERVICOS[servico];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/usuario/integracoes/${servico}`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Desconectar ${meta.nome}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid={`user-desconectar-confirm-${servico}`}
            onClick={doDelete}
            disabled={busy}
            style={btnDanger}
          >
            {busy ? 'Desconectando…' : 'Confirmar'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14 }}>
        Tem certeza que quer desconectar <strong>{meta.nome}</strong>?
      </p>
      <p style={{ fontSize: 13, color: colors.muted }}>
        Credenciais cifradas serão apagadas. Você pode reconectar a qualquer momento.
      </p>
      {error && (
        <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
