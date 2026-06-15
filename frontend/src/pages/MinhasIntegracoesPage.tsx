import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { StateView } from '@/components/StateView';
import { Dialog } from '@/components/ui';
import { FormField, Input } from '@/components/FormField';

type ServicoUsuario = 'google_calendar' | 'openai' | 'whatsapp';

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
  whatsapp: {
    nome: 'WhatsApp pessoal',
    tipo: 'mensageria',
    color: '#25d366',
    icon: '💬',
    description:
      'Conecta seu celular WhatsApp via QR. Para representantes: clientes/prospects que conversarem com você aparecem na Inbox.',
    connectMode: 'qr',
    qrRoute: '/whatsapp',
  },
};

const SERVICO_ORDER: ServicoUsuario[] = ['whatsapp', 'google_calendar', 'openai'];

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
      <SistemaTabs />
      <p className="text-muted mt-0 mb-4 text-[14px]">
        Conexões pessoais (suas, não da empresa). Cada usuário tem as próprias credenciais
        cifradas com AES-256-GCM.
      </p>
      <StateView loading={loading} error={error} onRetry={refetch}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
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
  const statusColor = conectado ? 'var(--success)' : 'var(--muted)';

  return (
    <div
      data-testid={`user-servico-card-${servico}`}
      className="bg-surface border border-border rounded-[10px] p-6 flex flex-col gap-2"
      style={{ borderLeft: `4px solid ${meta.color}` }}
    >
      <header className="flex items-center gap-2">
        <span
          className="text-white rounded-md w-9 h-9 flex items-center justify-center font-bold text-[14px] flex-shrink-0"
          style={{ background: meta.color }}
        >
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="m-0 text-[15px]">{meta.nome}</h3>
          <div className="text-[11px] text-muted">{TIPO_LABEL[meta.tipo]}</div>
        </div>
        <span
          className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]"
          style={{
            background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
            color: statusColor,
            border: `1px solid color-mix(in srgb, ${statusColor} 19%, transparent)`,
          }}
          data-testid={`user-status-${servico}`}
        >
          {conectado ? '● conectado' : '○ não conectado'}
        </span>
      </header>

      <p className="m-0 text-[12px] text-muted leading-[1.4]">
        {meta.description}
      </p>

      {conexao && (
        <dl className="m-0 text-[11px] text-muted">
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

      <div className="flex gap-[0.375rem] mt-auto flex-wrap">
        {!conectado && (
          <button
            type="button"
            data-testid={`user-conectar-${servico}`}
            onClick={onConnect}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
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
              className="bg-surface text-text border border-border-strong rounded-md px-3 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
            >
              Reconectar
            </button>
            <button
              type="button"
              data-testid={`user-desconectar-${servico}`}
              onClick={onDisconnect}
              className="bg-danger text-white rounded-md px-3 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
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
      <Dialog open onClose={onClose} title={`Conectar ${meta.nome}`}>
        <p className="mt-0 text-[14px]">
          O pareamento é feito por QR code numa página dedicada.
        </p>
        <a
          href={meta.qrRoute}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px] inline-block no-underline mt-2"
        >
          Abrir pareamento →
        </a>
      </Dialog>
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
    <Dialog
      open
      onClose={onClose}
      title={`Conectar ${meta.nome}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid={`user-oauth-start-${servico}`}
            onClick={startOAuth}
            disabled={busy}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            style={{ opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Aguardando popup…' : existing ? 'Reautorizar' : 'Autorizar via OAuth'}
          </button>
        </>
      }
    >
      <p className="mt-0 text-[14px]">{meta.description}</p>
      <div className="bg-bg-alt border border-border rounded-md p-3 text-[13px] text-muted leading-[1.5] mt-3">
        Abrimos uma janela popup do <strong>{meta.nome}</strong> pra você autorizar.
        Quando aprovar, a janela fecha e a integração fica ativa.
      </div>
      {error && (
        <p data-testid="form-error" className="text-danger text-[13px] mt-2">
          {error}
        </p>
      )}
    </Dialog>
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const faltando = fields.find((f) => form[f.name].trim().length === 0);
    if (faltando) {
      setError(`Preencha o campo "${faltando.label ?? faltando.name}".`);
      return;
    }
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
    <Dialog
      open
      onClose={onClose}
      title={`Conectar ${meta.nome}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="user-creds-form"
            data-testid={`user-creds-save-${servico}`}
            disabled={busy}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="user-creds-form" onSubmit={submit}>
        <p className="mt-0 text-[14px]">{meta.description}</p>
        <p className="text-[12px] text-muted mb-4">
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
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
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
    <Dialog
      open
      onClose={onClose}
      title={`Desconectar ${meta.nome}`}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid={`user-desconectar-confirm-${servico}`}
            onClick={doDelete}
            disabled={busy}
            className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            {busy ? 'Desconectando…' : 'Confirmar'}
          </button>
        </>
      }
    >
      <p className="mt-0 text-[14px]">
        Tem certeza que quer desconectar <strong>{meta.nome}</strong>?
      </p>
      <p className="text-[13px] text-muted">
        Credenciais cifradas serão apagadas. Você pode reconectar a qualquer momento.
      </p>
      {error && (
        <p data-testid="form-error" className="text-danger text-[13px]">
          {error}
        </p>
      )}
    </Dialog>
  );
}
