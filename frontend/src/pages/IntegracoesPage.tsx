import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, publicApiUrl } from '@/lib/api';
import { getStoredEmpresaId } from '@/lib/auth-store';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { LeadCaptureCard } from '@/components/LeadCaptureCard';
import { PedidoSiteChaveCard } from '@/components/PedidoSiteChaveCard';
import { EmailTransacionalCard } from '@/components/EmailTransacionalCard';
import { AssinaturaPaginaMeta, EscolherPaginaMeta } from '@/components/MetaPaginaCards';
import { EntradaAnunciosCard } from '@/components/EntradaAnunciosCard';
import { StateView } from '@/components/StateView';
import { Dialog } from '@/components/ui';
import { FormField, Input } from '@/components/FormField';
import { cn } from '@/lib/cn';
import { AlertTriangle, Lock } from 'lucide-react';

// D45 (2026-05-17): integrações que só DIRECTOR pode conectar/desconectar.
// Mantém em sync com SERVICO_METADATA.requerDirector no backend.
// Política atual: TODAS as integrações de escopo EMPRESA são DIRECTOR-only.
// As de escopo USUÁRIO (google_calendar, openai, whatsapp pessoal de cada rep)
// NÃO entram nesta lista — cada user mexe nas suas.
const SERVICOS_REQUEREM_DIRECTOR: ReadonlySet<string> = new Set([
  'tiny',
  'whatsapp',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'instagram',
  'facebook',
  'meta_app',
  'openai',
  'clicksign',
]);

// ─── Catálogo de serviços empresa ─────────────────────────────────────

type ServicoEmpresa =
  | 'tiny'
  | 'whatsapp'
  | 'mercadolivre'
  | 'shopee'
  | 'amazon'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'meta_app'
  | 'openai'
  | 'clicksign';

interface ServicoMeta {
  nome: string;
  tipo: 'erp' | 'mensageria' | 'marketplace' | 'social' | 'ia' | 'email' | 'agenda' | 'assinatura';
  obrigatorio: boolean;
  color: string;
  icon: string;
  description: string;
  /**
   * Como conectar:
   *  - 'oauth': abre popup pra fluxo OAuth (Meta/ML/Shopee/Amazon/TikTok)
   *  - 'credentials': formulário simples de chave/segredo (ex.: OpenAI)
   *  - 'qr': pareamento via QR code em página dedicada (WhatsApp da empresa)
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
  tiny: {
    nome: 'Tiny ERP (Olist)',
    tipo: 'erp',
    obrigatorio: true,
    color: '#00b386',
    icon: 'T',
    description:
      'ERP fonte da verdade: produtos, estoque, custo, pedidos, nota e rastreio. O app espelha — cadastro e edição acontecem lá.',
    connectMode: 'oauth',
    oauthStart: '/integracoes/tiny/oauth/start',
  },
  whatsapp: {
    nome: 'WhatsApp (número da empresa)',
    tipo: 'mensageria',
    obrigatorio: false,
    color: '#25d366',
    icon: '💬',
    description:
      'Número central de SAC da empresa, pareado por QR code. Não é a API oficial da Meta — ' +
      'use um número dedicado.',
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
  // App da Meta DA EMPRESA (29/09): cada cliente usa o próprio app (portfólio
  // dele). Sem isto cadastrado, Facebook/Instagram e Lead Ads não conectam.
  meta_app: {
    nome: 'App da Meta',
    tipo: 'social',
    obrigatorio: false,
    color: '#0866ff',
    icon: '∞',
    description:
      'O app que a empresa criou no painel de desenvolvedores da Meta. Cadastre ANTES de ' +
      'conectar Facebook/Instagram: o login, o token e o webhook usam este app.',
    connectMode: 'credentials',
    credentialFields: [
      { name: 'appId', label: 'ID do app' },
      { name: 'appSecret', label: 'Chave secreta do app', type: 'password' },
      { name: 'verifyToken', label: 'Token de verificação do webhook (você escolhe)' },
    ],
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
  clicksign: {
    nome: 'ClickSign (assinatura eletrônica)',
    tipo: 'assinatura',
    obrigatorio: false,
    color: '#00b8a9',
    icon: '✍️',
    description:
      'Conta da empresa pra assinar o contrato da proposta aceita. O TEXTO do contrato não vem ' +
      'daqui: ele é um Modelo dentro da ClickSign, e é a chave dele que vai no campo abaixo. ' +
      'Sem conexão, usa a conta do ambiente (Railway).',
    connectMode: 'credentials',
    credentialFields: [
      { name: 'accessToken', label: 'Token de acesso', type: 'password' },
      { name: 'templateKey', label: 'Chave do modelo de contrato' },
      { name: 'signatarioNome', label: 'Quem assina pela empresa (nome da PESSOA)' },
      { name: 'signatarioEmail', label: 'E-mail de quem assina pela empresa' },
      { name: 'signatarioDocumento', label: 'CPF de quem assina (assinatura automática)' },
      { name: 'signatarioNascimento', label: 'Nascimento de quem assina (AAAA-MM-DD)' },
    ],
  },
};

const SERVICO_ORDER: ServicoEmpresa[] = [
  'tiny',
  'whatsapp',
  'openai',
  'mercadolivre',
  'shopee',
  'amazon',
  'tiktok',
  'meta_app',
  'instagram',
  'facebook',
  'clicksign',
];

const TIPO_LABEL: Record<ServicoMeta['tipo'], string> = {
  assinatura: 'Assinatura eletrônica',
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
  /** Quando a pessoa autorizou. Nulo nas linhas anteriores ao campo. */
  conectadoEm?: string | null;
  /** Null quando a conexão vive só no provider (sem linha na tabela). */
  criadoEm: string | null;
  atualizadoEm: string | null;
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
  const papel = useRole();
  const podeEscolherPagina = papel === 'DIRECTOR' || papel === 'ADMIN';
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

  // Conectadas viram cards em cima; o resto, a lista "Disponíveis" agrupada.
  const emUso = SERVICO_ORDER.filter((s) => byServico.get(s)?.ativo);
  const disponiveis = SERVICO_ORDER.filter((s) => !byServico.get(s)?.ativo);

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
        <div className="flex flex-col gap-7">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <p className="m-0 flex items-center gap-2 text-[14px] text-muted">
              <Lock className="h-4 w-4" aria-hidden="true" />
              Só diretor ou admin conecta integrações da empresa.
            </p>
            <div className="flex gap-2 text-[13px]">
              <span
                className="rounded-full px-3 py-1.5 text-success"
                style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)' }}
              >
                {emUso.length} {emUso.length === 1 ? 'conectada' : 'conectadas'}
              </span>
              <span className="rounded-full px-3 py-1.5 bg-bg-alt text-muted">
                {disponiveis.length} {disponiveis.length === 1 ? 'disponível' : 'disponíveis'}
              </span>
            </div>
          </div>

          {/* O ERP é o único obrigatório: desconectado, ele é o aviso da página. */}
          {!byServico.get('tiny')?.ativo && podeEscolherPagina && (
            <div
              data-testid="aviso-tiny"
              className="flex items-center gap-3 px-[18px] py-3.5 rounded-[10px] border"
              style={{
                background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
              }}
            >
              <AlertTriangle className="h-[18px] w-[18px] text-warning shrink-0" aria-hidden="true" />
              <p className="m-0 flex-grow text-[14px]">
                <strong className="text-warning">Tiny ERP não conectado.</strong> Ele é a fonte da
                verdade de produtos, estoque, pedidos e nota.
              </p>
              <button
                type="button"
                data-testid="aviso-tiny-conectar"
                onClick={() => setConnecting('tiny')}
                className="bg-primary text-primary-contrast rounded-[10px] px-4 h-9 text-[14px] font-semibold cursor-pointer shrink-0"
              >
                Conectar Tiny
              </button>
            </div>
          )}

          {emUso.length > 0 && (
            <section className="flex flex-col gap-3.5" aria-labelledby="integracoes-em-uso">
              <h2 id="integracoes-em-uso" className="m-0 text-[18px] font-medium flex items-baseline gap-2.5">
                Em uso <span className="text-[14px] text-muted font-normal">{emUso.length}</span>
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {emUso.map((s) => (
                  <ServicoCard
                    key={s}
                    servico={s}
                    conexao={byServico.get(s) as Conexao}
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
            </section>
          )}

          {disponiveis.length > 0 && (
            <section className="flex flex-col gap-3.5" aria-labelledby="integracoes-disponiveis">
              <h2 id="integracoes-disponiveis" className="m-0 text-[18px] font-medium flex items-baseline gap-2.5">
                Disponíveis{' '}
                <span className="text-[14px] text-muted font-normal">{disponiveis.length}</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {GRUPOS_DISPONIVEIS.map(({ tipo, rotulo }) => {
                  const doGrupo = disponiveis.filter((s) => SERVICOS[s].tipo === tipo);
                  if (doGrupo.length === 0) return null;
                  return (
                    <div
                      key={tipo}
                      className="bg-surface border border-border rounded-[10px] overflow-hidden"
                    >
                      <div className="px-[18px] py-2.5 text-[12px] font-semibold tracking-[0.3px] text-muted bg-bg-alt">
                        {rotulo}
                      </div>
                      {doGrupo.map((s) => (
                        <ServicoLinha key={s} servico={s} onConnect={() => setConnecting(s)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Conta com várias Páginas: o admin escolhe (item 3a) */}
        {podeEscolherPagina && (
          <EscolherPaginaMeta
            onConectada={() => {
              refetch();
              refetchStatus();
            }}
          />
        )}

        {/* Onde o lead de anúncio (CTWA / Lead Ads) entra no funil — itens 6 e 10 */}
        {podeEscolherPagina && (
          <div className="mt-4">
            <EntradaAnunciosCard />
          </div>
        )}

        {/* E-mail transacional (Resend) — status + teste de envio */}
        <div className="mt-4">
          <EmailTransacionalCard />
        </div>

        {/* Captura de leads do site (chave de API pública por tenant) */}
        <div className="mt-4">
          <LeadCaptureCard />
        </div>

        {/* Pedidos do checkout do site — chave própria, separada da de leads */}
        <div className="mt-4">
          <PedidoSiteChaveCard />
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

/**
 * URL do webhook DESTA empresa — é ela que vai no painel do app da Meta
 * (Webhooks → URL de retorno), junto com o token de verificação cadastrado.
 */
function UrlWebhookMeta() {
  const empresaId = getStoredEmpresaId();
  if (!empresaId) return null;
  const url = publicApiUrl(`/webhooks/meta/${empresaId}`);
  return (
    <div className="text-[11px] text-muted" data-testid="meta-webhook-url">
      <strong>URL do webhook:</strong>{' '}
      <code className="break-all select-all">{url}</code>
    </div>
  );
}

// ─── Serviço: card (em uso) e linha (disponível) ─────────────────────

/**
 * Grupos da lista "Disponíveis", na ordem em que aparecem. O rótulo é o do
 * grupo (plural), não o do serviço — "Marketplaces", não "Marketplace".
 */
const GRUPOS_DISPONIVEIS: Array<{ tipo: ServicoMeta['tipo']; rotulo: string }> = [
  { tipo: 'erp', rotulo: 'ERP' },
  { tipo: 'mensageria', rotulo: 'Mensageria' },
  { tipo: 'ia', rotulo: 'IA' },
  { tipo: 'marketplace', rotulo: 'Marketplaces' },
  { tipo: 'social', rotulo: 'Redes sociais' },
  { tipo: 'assinatura', rotulo: 'Assinatura' },
];

/**
 * Pode conectar/desconectar? D48: serviços com `requerDirector` aceitam
 * DIRECTOR (mandatário do tenant) OU ADMIN (master da plataforma).
 */
function usePodeOperar(servico: ServicoEmpresa) {
  const role = useRole();
  return (
    !SERVICOS_REQUEREM_DIRECTOR.has(servico) || role === 'DIRECTOR' || role === 'ADMIN'
  );
}

function IconeServico({ meta, tamanho }: { meta: ServicoMeta; tamanho: 'md' | 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'text-white flex items-center justify-center font-semibold shrink-0',
        tamanho === 'md' ? 'w-[38px] h-[38px] rounded-[10px] text-[14px]' : 'w-8 h-8 rounded-lg text-[12px]',
      )}
      style={{ background: meta.color }}
    >
      {meta.icon}
    </span>
  );
}

const BOTAO_CONTORNO =
  'bg-transparent text-text border border-border-strong rounded-[10px] px-4 h-9 text-[13px] font-medium cursor-pointer hover:bg-surface-hover';

/**
 * Serviço CONECTADO: card com status, dado útil da conexão e as ações.
 *
 * "Desconectar" é texto vermelho, não bloco vermelho: é a ação que menos se
 * quer apertar por engano, e antes era a mais chamativa do card.
 */
function ServicoCard({
  servico,
  conexao,
  status,
  onConnect,
  onDisconnect,
  onRefetch,
}: {
  servico: ServicoEmpresa;
  conexao: Conexao;
  status?: IntegracaoStatusRow;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefetch: () => void;
}) {
  const meta = SERVICOS[servico];
  const podeOperar = usePodeOperar(servico);
  // Saúde só aparece quando NÃO está boa: "conectado" + "ativa" diziam a mesma
  // coisa duas vezes. Instável/caída é o que precisa chamar atenção.
  const saudeRuim = status && status.status !== 'ATIVA' ? STATUS_SAUDE[status.status] : null;
  const conectadoEm = conexao.conectadoEm ?? conexao.criadoEm;

  return (
    <div
      data-testid={`servico-card-${servico}`}
      className="bg-surface border border-border rounded-[10px] p-[18px] flex flex-col gap-3.5"
    >
      <header className="flex items-center gap-3">
        <IconeServico meta={meta} tamanho="md" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <h3 className="m-0 text-[15px] font-semibold">{meta.nome}</h3>
          <span className="text-[12px] text-muted">{TIPO_LABEL[meta.tipo]}</span>
        </div>
      </header>

      <div className="flex items-center gap-3 flex-wrap text-[13px]">
        <span
          className="inline-flex items-center gap-2 text-success"
          data-testid={`status-${servico}`}
        >
          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-success" />
          Conectado
        </span>
        {saudeRuim && status && (
          <span
            className="inline-flex items-center gap-1.5 font-semibold"
            style={{ color: saudeRuim.color }}
            data-testid={`saude-${servico}`}
            title={
              `Saúde: ${status.status}` +
              (status.ultimoErro ? `\nÚltimo erro: ${status.ultimoErro}` : '') +
              (status.ultimaVerificacaoEm
                ? `\nVerificado: ${fmtDate(status.ultimaVerificacaoEm)}`
                : '')
            }
          >
            {saudeRuim.label}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 text-[13px] leading-[1.5] text-muted flex-grow">
        <p className="m-0">{meta.description}</p>
        {servico === 'meta_app' && <UrlWebhookMeta />}
        {servico === 'facebook' && podeOperar && <AssinaturaPaginaMeta />}
        {(conexao.externalAccountId || conexao.ultimoSync || conectadoEm) && (
          <p className="m-0 text-[12px]">
            {[
              conexao.ultimoSync && `Último sync ${fmtDate(conexao.ultimoSync)}`,
              conexao.externalAccountId && `ID ${conexao.externalAccountId}`,
              // Conexão que vive só no provider (WhatsApp/Evolution) não tem
              // linha na tabela — e portanto não tem "conectado em". Mostrar a
              // data de agora seria dizer que pareou neste instante.
              conectadoEm && `Desde ${fmtDate(conectadoEm)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        {!podeOperar ? (
          <span className="text-[12px] text-muted italic" data-testid={`bloqueado-${servico}`}>
            Só diretor ou admin mexe nesta conexão.
          </span>
        ) : (
          <>
            {servico === 'tiny' && <SyncTinyButton onDone={onRefetch} />}
            <button
              type="button"
              data-testid={`reconectar-${servico}`}
              onClick={onConnect}
              className={BOTAO_CONTORNO}
            >
              Reconectar
            </button>
            {/* Pareamento por QR (WhatsApp): desconectar é no provider, não na
                tabela de credenciais. O DELETE daqui apagaria a linha e deixaria
                o número conectado — botão que parece funcionar e não funciona. */}
            {meta.connectMode === 'qr' ? (
              <a
                href={meta.qrRoute}
                data-testid={`desconectar-${servico}`}
                className="bg-transparent text-danger rounded-[10px] px-2.5 h-9 inline-flex items-center text-[13px] font-medium no-underline hover:underline"
              >
                Desconectar
              </a>
            ) : (
              <button
                type="button"
                data-testid={`desconectar-${servico}`}
                onClick={onDisconnect}
                className="bg-transparent border-0 text-danger rounded-[10px] px-2.5 h-9 text-[13px] font-medium cursor-pointer hover:underline"
              >
                Desconectar
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Serviço DISPONÍVEL (não conectado): uma linha enxuta da lista agrupada. */
function ServicoLinha({
  servico,
  onConnect,
}: {
  servico: ServicoEmpresa;
  onConnect: () => void;
}) {
  const meta = SERVICOS[servico];
  const podeOperar = usePodeOperar(servico);

  return (
    <div
      data-testid={`servico-card-${servico}`}
      className="flex items-center gap-3.5 px-[18px] py-3.5 border-t border-border"
    >
      <IconeServico meta={meta} tamanho="sm" />
      <div className="flex flex-col gap-0.5 flex-grow min-w-0">
        <span className="text-[14px] font-semibold">
          {meta.nome}
          {meta.obrigatorio && (
            <span
              className="ml-2 inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold text-warning"
              style={{ background: 'color-mix(in srgb, var(--warning) 15%, transparent)' }}
            >
              obrigatório
            </span>
          )}
        </span>
        <span className="text-[13px] text-muted">{meta.description}</span>
      </div>
      <span className="text-[12px] text-muted whitespace-nowrap" data-testid={`status-${servico}`}>
        não conectado
      </span>
      {podeOperar ? (
        <button
          type="button"
          data-testid={`conectar-${servico}`}
          onClick={onConnect}
          className={BOTAO_CONTORNO}
        >
          Conectar
        </button>
      ) : (
        <span className="text-[12px] text-muted italic" data-testid={`bloqueado-${servico}`}>
          só diretor ou admin
        </span>
      )}
    </div>
  );
}

function SyncTinyButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/integracoes/tiny/sync/produtos?modo=completo');
      setMsg('Sync do ERP disparado.');
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
        data-testid="tiny-sync"
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
