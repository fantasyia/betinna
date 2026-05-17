import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input } from '@/components/FormField';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

// D45 (2026-05-17): integrações que só DIRECTOR pode conectar/desconectar.
// Mantém em sync com SERVICO_METADATA.requerDirector no backend.
// Política atual: TODAS as integrações de escopo EMPRESA são DIRECTOR-only.
// As de escopo USUÁRIO (google_calendar, sendgrid, openai, anthropic, whatsapp
// pessoal de cada rep) NÃO entram nesta lista — cada user mexe nas suas.
const SERVICOS_REQUEREM_DIRECTOR: ReadonlySet<string> = new Set([
  'omie',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
]);

// ─── Catálogo de serviços empresa ─────────────────────────────────────

type ServicoEmpresa =
  | 'omie'
  | 'whatsapp'
  | 'mercadolivre'
  | 'shopee'
  | 'amazon'
  | 'tiktok'
  | 'instagram'
  | 'facebook';

interface ServicoMeta {
  nome: string;
  tipo: 'erp' | 'mensageria' | 'marketplace' | 'social' | 'ia' | 'email' | 'agenda';
  obrigatorio: boolean;
  color: string;
  icon: string;
  description: string;
  /**
   * Como conectar:
   *  - 'oauth': abre popup pra fluxo OAuth (Meta/ML/Shopee/Amazon/TikTok)
   *  - 'credentials': formulário simples com appKey/secret (OMIE)
   *  - 'qr': pareamento via QR code em página dedicada (WhatsApp Baileys)
   */
  connectMode: 'oauth' | 'credentials' | 'qr';
  /** OAuth: path do start endpoint */
  oauthStart?: string;
  /** Credentials: campos do formulário */
  credentialFields?: Array<{ name: string; label: string; type?: 'text' | 'password' }>;
  /** QR: rota interna do app pra fluxo de pareamento */
  qrRoute?: string;
}

const SERVICOS: Record<ServicoEmpresa, ServicoMeta> = {
  omie: {
    nome: 'OMIE ERP',
    tipo: 'erp',
    obrigatorio: true,
    color: '#00b386',
    icon: 'O',
    description:
      'ERP fonte da verdade pra clientes, produtos e pedidos. Sync incremental diária 04:00 UTC.',
    connectMode: 'credentials',
    credentialFields: [
      { name: 'appKey', label: 'App Key', type: 'text' },
      { name: 'appSecret', label: 'App Secret', type: 'password' },
    ],
  },
  whatsapp: {
    nome: 'WhatsApp (Baileys)',
    tipo: 'mensageria',
    obrigatorio: false,
    color: '#25d366',
    icon: '💬',
    description:
      'Número central de SAC da empresa via WhatsApp não-oficial (Baileys). Use número dedicado.',
    connectMode: 'qr',
    qrRoute: '/whatsapp',
  },
  mercadolivre: {
    nome: 'Mercado Livre',
    tipo: 'marketplace',
    obrigatorio: false,
    color: '#facc15',
    icon: 'ML',
    description: 'SAC + pedidos + perguntas pré-venda + reclamações ML.',
    connectMode: 'oauth',
    oauthStart: '/integracoes/mercadolivre/oauth/start',
  },
  shopee: {
    nome: 'Shopee',
    tipo: 'marketplace',
    obrigatorio: false,
    color: '#ee4d2d',
    icon: 'SP',
    description: 'SAC + pedidos + chat + returns Shopee.',
    connectMode: 'oauth',
    oauthStart: '/integracoes/shopee/oauth/start',
  },
  amazon: {
    nome: 'Amazon SP-API',
    tipo: 'marketplace',
    obrigatorio: false,
    color: '#ff9900',
    icon: 'AZ',
    description: 'Pedidos + mensagens estruturadas (Permitted Actions).',
    connectMode: 'oauth',
    oauthStart: '/integracoes/amazon/oauth/start',
  },
  tiktok: {
    nome: 'TikTok Shop',
    tipo: 'marketplace',
    obrigatorio: false,
    color: '#000000',
    icon: 'TT',
    description: 'Pedidos + returns TikTok Shop (sem chat livre por limitação API).',
    connectMode: 'oauth',
    oauthStart: '/integracoes/tiktok/oauth/start',
  },
  instagram: {
    nome: 'Instagram Direct',
    tipo: 'social',
    obrigatorio: false,
    color: '#e1306c',
    icon: '📷',
    description: 'DMs via Graph API. Vinculado à Page Facebook da empresa.',
    connectMode: 'oauth',
    oauthStart: '/integracoes/meta/oauth/start',
  },
  facebook: {
    nome: 'Facebook Messenger',
    tipo: 'social',
    obrigatorio: false,
    color: '#1877f2',
    icon: 'f',
    description: 'Mensagens Page → cliente via Graph API.',
    connectMode: 'oauth',
    oauthStart: '/integracoes/meta/oauth/start',
  },
};

const SERVICO_ORDER: ServicoEmpresa[] = [
  'omie',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
];

const TIPO_LABEL: Record<ServicoMeta['tipo'], string> = {
  erp: 'ERP',
  mensageria: 'Mensageria',
  marketplace: 'Marketplace',
  social: 'Rede social',
  ia: 'IA',
  email: 'E-mail',
  agenda: 'Agenda',
};

// ─── Tipos do backend ────────────────────────────────────────────────

interface Conexao {
  id: string;
  servico: ServicoEmpresa;
  ativo: boolean;
  externalAccountId?: string | null;
  ultimoSync?: string | null;
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

// ─── Página ──────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const { data, loading, error, refetch } = useApiQuery<Conexao[] | { data: Conexao[] }>('/integracoes');
  const [connecting, setConnecting] = useState<ServicoEmpresa | null>(null);
  const [disconnecting, setDisconnecting] = useState<ServicoEmpresa | null>(null);

  // Normaliza shape — backend pode retornar array direto ou { data }
  const conexoes: Conexao[] = Array.isArray(data) ? data : data?.data ?? [];
  const byServico = new Map<ServicoEmpresa, Conexao>();
  for (const c of conexoes) byServico.set(c.servico, c);

  // Escuta postMessage de popup OAuth pra refetch automático
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
    <PageLayout title="Integrações da empresa">
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
              onRefetch={refetch}
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

// ─── Card por serviço ────────────────────────────────────────────────

function ServicoCard({
  servico,
  conexao,
  onConnect,
  onDisconnect,
  onRefetch,
}: {
  servico: ServicoEmpresa;
  conexao?: Conexao;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefetch: () => void;
}) {
  const meta = SERVICOS[servico];
  const conectado = conexao?.ativo;
  const role = useRole();
  // D45: serviços com requerDirector só aceitam role DIRECTOR (nem ADMIN bypassa).
  const requerDirector = SERVICOS_REQUEREM_DIRECTOR.has(servico);
  const podeOperar = !requerDirector || role === 'DIRECTOR';

  return (
    <div
      data-testid={`servico-card-${servico}`}
      style={{
        ...card,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        borderLeft: `4px solid ${meta.color}`,
        opacity: conectado ? 1 : 0.95,
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
          <div style={{ fontSize: 11, color: colors.muted }}>
            {TIPO_LABEL[meta.tipo]}
            {meta.obrigatorio && (
              <span
                style={{
                  marginLeft: 6,
                  ...badge(colors.warning),
                  fontSize: 9,
                  padding: '1px 5px',
                }}
              >
                obrigatório
              </span>
            )}
            {requerDirector && (
              <span
                style={{
                  marginLeft: 6,
                  ...badge(colors.danger),
                  fontSize: 9,
                  padding: '1px 5px',
                }}
                title="Apenas o DIRETOR pode conectar este serviço (D45)"
              >
                diretor-only
              </span>
            )}
          </div>
        </div>
        <span
          style={badge(conectado ? colors.success : colors.muted)}
          data-testid={`status-${servico}`}
        >
          {conectado ? '● conectado' : '○ não conectado'}
        </span>
      </header>

      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: colors.muted,
          lineHeight: 1.4,
        }}
      >
        {meta.description}
      </p>

      {conexao && (
        <dl style={{ margin: 0, fontSize: 11, color: colors.muted }}>
          {conexao.externalAccountId && (
            <div>
              <strong>ID:</strong> {conexao.externalAccountId}
            </div>
          )}
          {conexao.ultimoSync && (
            <div>
              <strong>Último sync:</strong> {fmtDate(conexao.ultimoSync)}
            </div>
          )}
          <div>
            <strong>Conectado em:</strong> {fmtDate(conexao.criadoEm)}
          </div>
        </dl>
      )}

      {/* Botões inferiores */}
      <div style={{ display: 'flex', gap: '0.375rem', marginTop: 'auto', flexWrap: 'wrap' }}>
        {!podeOperar && (
          <span
            style={{
              fontSize: 11,
              color: colors.muted,
              fontStyle: 'italic',
            }}
            data-testid={`bloqueado-${servico}`}
          >
            Apenas o DIRETOR pode conectar este serviço.
          </span>
        )}
        {podeOperar && !conectado && (
          <button
            type="button"
            data-testid={`conectar-${servico}`}
            onClick={onConnect}
            style={btn}
          >
            Conectar
          </button>
        )}
        {podeOperar && conectado && servico === 'omie' && (
          <TestOmieButton onDone={onRefetch} />
        )}
        {podeOperar && conectado && (
          <>
            <button
              type="button"
              data-testid={`reconectar-${servico}`}
              onClick={onConnect}
              style={{ ...btnSecondary, padding: '0.5rem 0.75rem' }}
            >
              Reconectar
            </button>
            <button
              type="button"
              data-testid={`desconectar-${servico}`}
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

function TestOmieButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/integracoes/omie/sync/forcar');
      setMsg('Sync OMIE disparado.');
      setTimeout(() => setMsg(null), 4000);
      onDone();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Falha');
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        data-testid="omie-sync"
        onClick={run}
        disabled={busy}
        style={btn}
      >
        {busy ? 'Sincronizando…' : 'Sync agora'}
      </button>
      {msg && (
        <span
          style={{
            fontSize: 11,
            color: msg.includes('Falha') ? colors.danger : colors.success,
            alignSelf: 'center',
          }}
        >
          {msg}
        </span>
      )}
    </>
  );
}

// ─── Connect modal — escolhe fluxo conforme connectMode ──────────────

function ConnectModal({
  servico,
  existing,
  onClose,
  onSaved,
}: {
  servico: ServicoEmpresa;
  existing?: Conexao;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = SERVICOS[servico];

  if (meta.connectMode === 'qr') {
    return (
      <Modal open onClose={onClose} title={`Conectar ${meta.nome}`}>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          O pareamento do WhatsApp é feito por QR code numa página dedicada.
        </p>
        <a
          href={meta.qrRoute}
          style={{
            ...btn,
            display: 'inline-block',
            textDecoration: 'none',
            marginTop: '0.5rem',
          }}
        >
          Abrir pareamento WhatsApp →
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
  servico: ServicoEmpresa;
  meta: ServicoMeta;
  existing?: Conexao;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escuta postMessage do popup
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (!e.data || typeof e.data !== 'object') return;
      const t = (e.data as { type?: string }).type;
      const ok = (e.data as { ok?: boolean }).ok;
      // Aceita ml-oauth, meta-oauth, shopee-oauth, etc.
      if (t && t.endsWith('-oauth')) {
        if (ok) {
          onSaved();
        } else {
          setError('Autorização falhou. Verifique credenciais no popup.');
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
      if (!r.url) {
        throw new Error('Backend não retornou URL OAuth');
      }
      // Abre popup centralizado
      const w = 600;
      const h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        r.url,
        `${servico}-oauth`,
        `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!popup) {
        throw new Error('Não foi possível abrir popup — desbloqueie em seu navegador');
      }
      // Detecta fechamento manual do popup
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
            data-testid={`oauth-start-${servico}`}
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
          marginTop: '0.75rem',
          fontSize: 13,
          color: colors.muted,
          lineHeight: 1.5,
        }}
      >
        Ao clicar em <strong>Autorizar</strong>, abrimos uma janela popup do{' '}
        <strong>{meta.nome}</strong> pra você fazer login e dar permissão à Betinna.
        Quando aprovar, a janela fecha sozinha e a integração fica ativa aqui.
      </div>
      {existing && (
        <p style={{ fontSize: 12, color: colors.warning, marginTop: '0.5rem' }}>
          Já existe uma conexão. Reautorizar substitui as credenciais atuais.
        </p>
      )}
      {error && (
        <div
          data-testid="oauth-error"
          style={{
            ...card,
            borderColor: colors.danger,
            color: colors.danger,
            padding: '0.5rem 0.75rem',
            marginTop: '0.5rem',
          }}
        >
          {error}
        </div>
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
  servico: ServicoEmpresa;
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
      await api.post('/integracoes/conectar', {
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
            form="creds-form"
            data-testid={`creds-save-${servico}`}
            disabled={busy || !valid}
            style={{ ...btn, opacity: busy || !valid ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Salvar credenciais'}
          </button>
        </>
      }
    >
      <form id="creds-form" onSubmit={submit}>
        <p style={{ marginTop: 0, fontSize: 14 }}>{meta.description}</p>
        <p style={{ fontSize: 12, color: colors.muted, marginBottom: '1rem' }}>
          Credenciais são <strong>cifradas em AES-256-GCM</strong> antes de salvar.
          Nem o time da Betinna consegue ler.
        </p>
        {fields.map((f) => (
          <FormField key={f.name} label={f.label} htmlFor={`creds-${f.name}`} required>
            <Input
              id={`creds-${f.name}`}
              data-testid={`creds-${f.name}`}
              type={f.type ?? 'text'}
              value={form[f.name]}
              onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
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

// ─── Disconnect ──────────────────────────────────────────────────────

function DisconnectModal({
  servico,
  onClose,
  onDone,
}: {
  servico: ServicoEmpresa;
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
      await api.delete(`/integracoes/${servico}`);
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
            data-testid={`desconectar-confirm-${servico}`}
            onClick={doDelete}
            disabled={busy}
            style={btnDanger}
          >
            {busy ? 'Desconectando…' : 'Confirmar desconexão'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 14 }}>
        Tem certeza que quer desconectar <strong>{meta.nome}</strong>?
      </p>
      <ul style={{ fontSize: 13, color: colors.muted, paddingLeft: '1.25rem' }}>
        <li>Credenciais cifradas serão apagadas</li>
        <li>Webhooks/cron desse serviço pararão</li>
        {meta.obrigatorio && (
          <li style={{ color: colors.danger }}>
            <strong>Atenção:</strong> esse serviço é marcado como obrigatório — desconectar pode
            quebrar funcionalidades essenciais (sync ERP, cálculos, etc.).
          </li>
        )}
      </ul>
      {error && (
        <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
