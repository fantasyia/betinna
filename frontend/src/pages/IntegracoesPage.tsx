import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { StateView } from '@/components/StateView';
import { Dialog } from '@/components/ui';
import { FormField, Input } from '@/components/FormField';
import { cn } from '@/lib/cn';

// D45 (2026-05-17): integrações que só DIRECTOR pode conectar/desconectar.
// Mantém em sync com SERVICO_METADATA.requerDirector no backend.
// Política atual: TODAS as integrações de escopo EMPRESA são DIRECTOR-only.
// As de escopo USUÁRIO (google_calendar, openai, whatsapp pessoal de cada rep)
// NÃO entram nesta lista — cada user mexe nas suas.
const SERVICOS_REQUEREM_DIRECTOR: ReadonlySet<string> = new Set([
  'omie',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
  'openai',
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
  | 'facebook'
  | 'openai';

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
  openai: {
    nome: 'OpenAI',
    tipo: 'ia',
    obrigatorio: false,
    color: '#10a37f',
    icon: '🤖',
    description:
      'Chave da empresa pra IA (bot do WhatsApp + nó "Conversar com IA" dos fluxos). Lida pela API e pelo Worker. Sem ela, usa a chave do ambiente (Railway).',
    connectMode: 'credentials',
    credentialFields: [{ name: 'apiKey', label: 'Chave da API (sk-...)', type: 'password' }],
  },
};

const SERVICO_ORDER: ServicoEmpresa[] = [
  'omie',
  'whatsapp',
  'openai',
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

type StatusValor = 'ATIVA' | 'DEGRADADA' | 'CAIDA' | 'DESCONECTADA';
interface IntegracaoStatusRow {
  servico: string;
  status: StatusValor;
  ultimoErro?: string | null;
  ultimoErroEm?: string | null;
  ultimaVerificacaoEm?: string | null;
}

/** Semáforo: rótulo + cor por status de saúde. */
const STATUS_SAUDE: Record<StatusValor, { label: string; color: string }> = {
  ATIVA: { label: '● ativa', color: 'var(--success)' },
  DEGRADADA: { label: '● instável', color: 'var(--warning)' },
  CAIDA: { label: '⚠ Reconectar', color: 'var(--danger)' },
  DESCONECTADA: { label: '⚠ Reconectar', color: 'var(--danger)' },
};

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
  const { data: statusData, refetch: refetchStatus } = useApiQuery<
    IntegracaoStatusRow[] | { data: IntegracaoStatusRow[] }
  >('/integracoes/status');
  const [connecting, setConnecting] = useState<ServicoEmpresa | null>(null);
  const [disconnecting, setDisconnecting] = useState<ServicoEmpresa | null>(null);

  // Normaliza shape — backend pode retornar array direto ou { data }
  const conexoes: Conexao[] = Array.isArray(data) ? data : data?.data ?? [];
  const byServico = new Map<ServicoEmpresa, Conexao>();
  for (const c of conexoes) byServico.set(c.servico, c);

  const statusRows: IntegracaoStatusRow[] = Array.isArray(statusData)
    ? statusData
    : statusData?.data ?? [];
  const statusByServico = new Map<string, IntegracaoStatusRow>();
  for (const s of statusRows) statusByServico.set(s.servico, s);

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
      <SistemaTabs />
      <StateView loading={loading} error={error} onRetry={refetch}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
          {SERVICO_ORDER.map((s) => (
            <ServicoCard
              key={s}
              servico={s}
              conexao={byServico.get(s)}
              status={statusByServico.get(s)}
              onConnect={() => setConnecting(s)}
              onDisconnect={() => setDisconnecting(s)}
              onRefetch={() => {
                refetch();
                refetchStatus();
              }}
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
  status,
  onConnect,
  onDisconnect,
  onRefetch,
}: {
  servico: ServicoEmpresa;
  conexao?: Conexao;
  status?: IntegracaoStatusRow;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefetch: () => void;
}) {
  const meta = SERVICOS[servico];
  const conectado = conexao?.ativo;
  const role = useRole();
  // D48: serviços com requerDirector aceitam DIRECTOR (mandatário do tenant)
  // OU ADMIN (master da plataforma, opera cross-tenant). Outros papéis veem
  // a página mas não conseguem operar.
  const requerDirector = SERVICOS_REQUEREM_DIRECTOR.has(servico);
  const podeOperar = !requerDirector || role === 'DIRECTOR' || role === 'ADMIN';

  return (
    <div
      data-testid={`servico-card-${servico}`}
      className="bg-surface border border-border rounded-[10px] p-6 flex flex-col gap-2"
      style={{
        borderLeft: `4px solid ${meta.color}`,
        opacity: conectado ? 1 : 0.95,
      }}
    >
      <header className="flex items-center gap-2">
        <span
          className="text-white rounded-md w-9 h-9 flex items-center justify-center font-bold text-[14px] shrink-0"
          style={{ background: meta.color }}
        >
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="m-0 text-[15px]">{meta.nome}</h3>
          <div className="text-[11px] text-muted">
            {TIPO_LABEL[meta.tipo]}
            {meta.obrigatorio && (
              <span
                className="ml-1.5 inline-flex items-center rounded-full px-[5px] py-px text-[9px] font-semibold leading-[1.6] tracking-[0.2px] text-warning border"
                style={{
                  background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--warning) 19%, transparent)',
                }}
              >
                obrigatório
              </span>
            )}
            {requerDirector && (
              <span
                className="ml-1.5 inline-flex items-center rounded-full px-[5px] py-px text-[9px] font-semibold leading-[1.6] tracking-[0.2px] text-danger border"
                style={{
                  background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--danger) 19%, transparent)',
                }}
                title="Apenas DIRETOR ou ADMIN pode conectar este serviço (D45/D48)"
              >
                diretor/admin
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-[3px]">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] border',
              conectado ? 'text-success' : 'text-muted',
            )}
            style={{
              background: conectado
                ? 'color-mix(in srgb, var(--success) 12%, transparent)'
                : 'color-mix(in srgb, var(--muted) 12%, transparent)',
              borderColor: conectado
                ? 'color-mix(in srgb, var(--success) 19%, transparent)'
                : 'color-mix(in srgb, var(--muted) 19%, transparent)',
            }}
            data-testid={`status-${servico}`}
          >
            {conectado ? '● conectado' : '○ não conectado'}
          </span>
          {status && (
            <span
              className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[10px] font-semibold leading-[1.6] tracking-[0.2px] border"
              style={{
                background: `color-mix(in srgb, ${STATUS_SAUDE[status.status].color} 12%, transparent)`,
                color: STATUS_SAUDE[status.status].color,
                borderColor: `color-mix(in srgb, ${STATUS_SAUDE[status.status].color} 19%, transparent)`,
              }}
              data-testid={`saude-${servico}`}
              title={
                `Saúde: ${status.status}` +
                (status.ultimoErro ? `\nÚltimo erro: ${status.ultimoErro}` : '') +
                (status.ultimaVerificacaoEm
                  ? `\nVerificado: ${fmtDate(status.ultimaVerificacaoEm)}`
                  : '')
              }
            >
              {STATUS_SAUDE[status.status].label}
            </span>
          )}
        </div>
      </header>

      <p className="m-0 text-[12px] text-muted leading-[1.4]">{meta.description}</p>

      {conexao && (
        <dl className="m-0 text-[11px] text-muted">
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
      <div className="flex gap-1.5 mt-auto flex-wrap">
        {!podeOperar && (
          <span className="text-[11px] text-muted italic" data-testid={`bloqueado-${servico}`}>
            Apenas DIRETOR ou ADMIN pode conectar este serviço.
          </span>
        )}
        {podeOperar && !conectado && (
          <button
            type="button"
            data-testid={`conectar-${servico}`}
            onClick={onConnect}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
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
              className="bg-surface text-text border border-border-strong rounded-md px-3 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
            >
              Reconectar
            </button>
            <button
              type="button"
              data-testid={`desconectar-${servico}`}
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
        className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
      >
        {busy ? 'Sincronizando…' : 'Sync agora'}
      </button>
      {msg && (
        <span
          className={cn(
            'text-[11px] self-center',
            msg.includes('Falha') ? 'text-danger' : 'text-success',
          )}
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
      <Dialog open onClose={onClose} title={`Conectar ${meta.nome}`}>
        <p className="mt-0 text-[14px]">
          O pareamento do WhatsApp é feito por QR code numa página dedicada.
        </p>
        <a
          href={meta.qrRoute}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px] inline-block no-underline mt-2"
        >
          Abrir pareamento WhatsApp →
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
            data-testid={`oauth-start-${servico}`}
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
      <div className="bg-bg-alt border border-border rounded-md p-3 mt-3 text-[13px] text-muted leading-[1.5]">
        Ao clicar em <strong>Autorizar</strong>, abrimos uma janela popup do{' '}
        <strong>{meta.nome}</strong> pra você fazer login e dar permissão à Betinna.
        Quando aprovar, a janela fecha sozinha e a integração fica ativa aqui.
      </div>
      {existing && (
        <p className="text-[12px] text-warning mt-2">
          Já existe uma conexão. Reautorizar substitui as credenciais atuais.
        </p>
      )}
      {error && (
        <div
          data-testid="oauth-error"
          className="bg-surface border border-danger rounded-[10px] text-danger px-3 py-2 mt-2"
        >
          {error}
        </div>
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
            form="creds-form"
            data-testid={`creds-save-${servico}`}
            disabled={busy}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Salvar credenciais'}
          </button>
        </>
      }
    >
      <form id="creds-form" onSubmit={submit}>
        <p className="mt-0 text-[14px]">{meta.description}</p>
        <p className="text-[12px] text-muted mb-4">
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
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
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
            data-testid={`desconectar-confirm-${servico}`}
            onClick={doDelete}
            disabled={busy}
            className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            {busy ? 'Desconectando…' : 'Confirmar desconexão'}
          </button>
        </>
      }
    >
      <p className="mt-0 text-[14px]">
        Tem certeza que quer desconectar <strong>{meta.nome}</strong>?
      </p>
      <ul className="text-[13px] text-muted pl-5">
        <li>Credenciais cifradas serão apagadas</li>
        <li>Webhooks/cron desse serviço pararão</li>
        {meta.obrigatorio && (
          <li className="text-danger">
            <strong>Atenção:</strong> esse serviço é marcado como obrigatório — desconectar pode
            quebrar funcionalidades essenciais (sync ERP, cálculos, etc.).
          </li>
        )}
      </ul>
      {error && (
        <p data-testid="form-error" className="text-danger text-[13px]">
          {error}
        </p>
      )}
    </Dialog>
  );
}
