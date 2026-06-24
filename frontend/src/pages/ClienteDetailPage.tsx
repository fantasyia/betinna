import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { NovoPedidoDialog } from '@/components/NovoPedidoDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { maskCNPJ, normalizeUF, formatMoeda as fmtBRL, formatNumero } from '@/lib/masks';
import { PhoneInput } from '@/components/PhoneInput';
import { cn } from '@/lib/cn';

// ─── Estilos legados traduzidos pra Tailwind ─────────────────────────

// Classes Tailwind equivalentes aos objetos do styles.ts (pixel-idênticas).
const cardCls = 'bg-surface border border-border rounded-[10px] p-6';
const btnCls =
  'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]';
const btnSecondaryCls =
  'bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]';
const btnDangerCls =
  'bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]';

// Badge com cor dinâmica — replica badge() do styles.ts via color-mix.
function badgeStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 19%, transparent)`,
  };
}
const badgeCls =
  'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]';

// ─── Tipos compartilhados ────────────────────────────────────────────

type ClienteStatus = 'ATIVO' | 'NOVO' | 'PROSPECT' | 'RISCO' | 'CRITICO' | 'INATIVO';
type OmieStatus = 'ATIVO' | 'BLOQUEADO';

interface Cliente {
  id: string;
  nome: string;
  cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  segmento?: string | null;
  status: ClienteStatus;
  omieStatus: OmieStatus;
  score: number;
  prazoPagamento?: number;
  limiteCredito?: number | null;
  representante?: { id: string; nome: string } | null;
  tags?: Array<{ id: string; nome: string; cor?: string | null }>;
  criadoEm?: string;
  atualizadoEm?: string;
}

interface NotaPrivada {
  id: string;
  texto: string;
  autor?: { id: string; nome: string };
  criadoEm: string;
  atualizadoEm: string;
}

interface Documento {
  id: string;
  nome: string;
  mimetype: string;
  tamanho: number;
  criadoEm: string;
  uploadedBy?: { id: string; nome: string };
}

interface PrecoEspecial {
  produtoId: string;
  produto?: { id: string; nome: string; sku?: string; precoTabela?: number };
  precoEspecial: number;
  descontoBase: number;
  validoAte?: string | null;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoTabela?: number;
}

const STATUS_COLOR: Record<ClienteStatus, string> = {
  ATIVO: 'var(--success)',
  NOVO: '#0891b2',
  PROSPECT: '#7c3aed',
  RISCO: 'var(--warning)',
  CRITICO: 'var(--danger)',
  INATIVO: 'var(--muted)',
};
const OMIE_COLOR: Record<OmieStatus, string> = {
  ATIVO: 'var(--success)',
  BLOQUEADO: 'var(--danger)',
};

type Tab =
  | 'dados'
  | 'pedidos'
  | 'propostas'
  | 'amostras'
  | 'ocorrencias'
  | 'notas'
  | 'documentos'
  | 'precos';

interface PedidoLite {
  id: string;
  numero: string | number;
  status:
    | 'RASCUNHO'
    | 'AGUARDANDO_APROVACAO'
    | 'ENVIADO_OMIE'
    | 'PAGO'
    | 'EM_SEPARACAO'
    | 'ENVIADO'
    | 'ENTREGUE'
    | 'CANCELADO';
  total: number;
  criadoEm: string;
  numeroOmie?: string | null;
}

const PEDIDO_STATUS_LABEL: Record<PedidoLite['status'], string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  ENVIADO_OMIE: 'Enviado OMIE',
  PAGO: 'Pago',
  EM_SEPARACAO: 'Em separação',
  ENVIADO: 'Enviado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
};

const PEDIDO_STATUS_COLOR: Record<PedidoLite['status'], string> = {
  RASCUNHO: 'var(--muted)',
  AGUARDANDO_APROVACAO: 'var(--warning)',
  ENVIADO_OMIE: 'var(--info)',
  PAGO: 'var(--success)',
  EM_SEPARACAO: 'var(--primary)',
  ENVIADO: 'var(--info)',
  ENTREGUE: 'var(--success)',
  CANCELADO: 'var(--danger)',
};

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

// ─── Página principal ────────────────────────────────────────────────

export default function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('dados');
  const [criarPedido, setCriarPedido] = useState(false);

  const { data: cliente, loading, error, refetch } = useApiQuery<Cliente>(
    id ? `/clientes/${id}` : null,
  );

  if (!id) {
    return (
      <PageLayout title="Cliente">
        <p>ID inválido</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={cliente ? cliente.nome : 'Cliente'}
      actions={
        <div className="flex gap-2">
          {cliente && (
            <button
              type="button"
              data-testid="cliente-page-criar-pedido"
              onClick={() => setCriarPedido(true)}
              className={btnCls}
            >
              + Criar pedido
            </button>
          )}
          <Link to="/clientes" className={cn(btnSecondaryCls, 'no-underline')}>
            ← Voltar pra lista
          </Link>
        </div>
      }
    >
      <StateView loading={loading && !cliente} error={error} onRetry={refetch}>
        {cliente && (
          <>
            <MetricasCard clienteId={cliente.id} />
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className={badgeCls} style={badgeStyle(STATUS_COLOR[cliente.status])}>
                {cliente.status}
              </span>
              <span className={badgeCls} style={badgeStyle(OMIE_COLOR[cliente.omieStatus])}>
                OMIE {cliente.omieStatus}
              </span>
              {cliente.cnpj && (
                <span className="text-[13px] text-muted">CNPJ {cliente.cnpj}</span>
              )}
              {cliente.representante?.nome && (
                <span className="text-[13px] text-muted">
                  Representante: <strong>{cliente.representante.nome}</strong>
                </span>
              )}
              {cliente.tags && cliente.tags.length > 0 && (
                <span className="flex gap-1 flex-wrap">
                  {cliente.tags.map((t) => (
                    <span
                      key={t.id}
                      className={badgeCls}
                      style={badgeStyle(t.cor ?? 'var(--muted)')}
                    >
                      {t.nome}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div role="tablist" className="flex gap-0 border-b border-border mb-4">
              <TabButton current={tab} value="dados" onChange={setTab}>
                Dados
              </TabButton>
              <TabButton current={tab} value="pedidos" onChange={setTab}>
                Pedidos
              </TabButton>
              <TabButton current={tab} value="propostas" onChange={setTab}>
                Propostas
              </TabButton>
              <TabButton current={tab} value="amostras" onChange={setTab}>
                Amostras
              </TabButton>
              <TabButton current={tab} value="ocorrencias" onChange={setTab}>
                Ocorrências
              </TabButton>
              <TabButton current={tab} value="notas" onChange={setTab}>
                Notas privadas
              </TabButton>
              <TabButton current={tab} value="documentos" onChange={setTab}>
                Documentos
              </TabButton>
              <TabButton current={tab} value="precos" onChange={setTab}>
                Preços especiais
              </TabButton>
            </div>

            {tab === 'dados' && (
              <DadosTab
                cliente={cliente}
                onSaved={refetch}
                onDeleted={() => navigate('/clientes')}
              />
            )}
            {tab === 'pedidos' && <PedidosTab clienteId={cliente.id} />}
            {tab === 'propostas' && <PropostasTab clienteId={cliente.id} />}
            {tab === 'amostras' && <AmostrasTab clienteId={cliente.id} />}
            {tab === 'ocorrencias' && <OcorrenciasTab clienteId={cliente.id} />}
            {tab === 'notas' && <NotasTab clienteId={cliente.id} />}
            {tab === 'documentos' && <DocumentosTab clienteId={cliente.id} />}
            {tab === 'precos' && <PrecosTab clienteId={cliente.id} />}
          </>
        )}
      </StateView>

      {cliente && (
        <NovoPedidoDialog
          open={criarPedido}
          clientePreSelecionado={{ id: cliente.id, nome: cliente.nome, cnpj: cliente.cnpj ?? null }}
          onClose={() => setCriarPedido(false)}
          onCreated={(pedidoId) => {
            setCriarPedido(false);
            navigate(`/pedidos?highlight=${pedidoId}`);
          }}
        />
      )}
    </PageLayout>
  );
}

function TabButton({
  current,
  value,
  onChange,
  children,
}: {
  current: Tab;
  value: Tab;
  onChange: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`tab-${value}`}
      onClick={() => onChange(value)}
      className={cn(
        'bg-transparent border-x-0 border-t-0 border-b-2 border-solid px-4 py-2.5 cursor-pointer font-[inherit] text-[14px] mb-[-1px]',
        active
          ? 'border-b-primary text-primary font-semibold'
          : 'border-b-transparent text-muted font-medium',
      )}
    >
      {children}
    </button>
  );
}

// ─── Tab Dados ────────────────────────────────────────────────────────

function DadosTab({
  cliente,
  onSaved,
  onDeleted,
}: {
  cliente: Cliente;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    nome: cliente.nome,
    cnpj: cliente.cnpj ?? '',
    email: cliente.email ?? '',
    telefone: cliente.telefone ?? '',
    cidade: cliente.cidade ?? '',
    uf: cliente.uf ?? '',
    segmento: cliente.segmento ?? '',
    status: cliente.status,
    omieStatus: cliente.omieStatus,
    score: cliente.score,
    prazoPagamento: cliente.prazoPagamento ?? 30,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      status: form.status,
      omieStatus: form.omieStatus,
      score: form.score,
      prazoPagamento: form.prazoPagamento,
    };
    for (const k of ['cnpj', 'email', 'telefone', 'cidade', 'uf', 'segmento'] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    try {
      await api.patch(`/clientes/${cliente.id}`, payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/clientes/${cliente.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cardCls}>
      <form onSubmit={save}>
        <FormField label="Nome" required>
          <Input
            value={form.nome}
            onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
            required
            minLength={2}
          />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="CNPJ">
            <Input
              value={form.cnpj}
              onChange={(e) => setForm((s) => ({ ...s, cnpj: maskCNPJ(e.target.value) }))}
              placeholder="00.000.000/0001-00"
              maxLength={18}
              inputMode="numeric"
            />
          </FormField>
          <FormField label="Segmento">
            <Input
              value={form.segmento}
              onChange={(e) => setForm((s) => ({ ...s, segmento: e.target.value }))}
            />
          </FormField>
          <FormField label="E-mail">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
            />
          </FormField>
          <FormField label="Telefone">
            <PhoneInput
              testId="cliente-detail-telefone"
              value={form.telefone}
              onChange={(e164) => setForm((s) => ({ ...s, telefone: e164 }))}
            />
          </FormField>
          <FormField label="Cidade">
            <Input
              value={form.cidade}
              onChange={(e) => setForm((s) => ({ ...s, cidade: e.target.value }))}
            />
          </FormField>
          <FormField label="UF">
            <Input
              maxLength={2}
              value={form.uf}
              onChange={(e) => setForm((s) => ({ ...s, uf: normalizeUF(e.target.value) }))}
            />
          </FormField>
          <FormField label="Status">
            <Select
              value={form.status}
              onChange={(e) =>
                setForm((s) => ({ ...s, status: e.target.value as ClienteStatus }))
              }
            >
              <option value="ATIVO">Ativo</option>
              <option value="NOVO">Novo</option>
              <option value="PROSPECT">Prospect</option>
              <option value="RISCO">Em risco</option>
              <option value="CRITICO">Crítico</option>
              <option value="INATIVO">Inativo</option>
            </Select>
          </FormField>
          <FormField label="OMIE">
            <Select
              value={form.omieStatus}
              onChange={(e) =>
                setForm((s) => ({ ...s, omieStatus: e.target.value as OmieStatus }))
              }
            >
              <option value="ATIVO">Ativo</option>
              <option value="BLOQUEADO">Bloqueado</option>
            </Select>
          </FormField>
          <FormField label="Score (0–100)">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(e) => setForm((s) => ({ ...s, score: Number(e.target.value) }))}
            />
          </FormField>
          <FormField label="Prazo pagamento (dias)">
            <Input
              type="number"
              min={0}
              max={180}
              value={form.prazoPagamento}
              onChange={(e) =>
                setForm((s) => ({ ...s, prazoPagamento: Number(e.target.value) }))
              }
            />
          </FormField>
        </div>

        {error && (
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button type="submit" data-testid="cliente-save" disabled={busy} className={btnCls}>
            {busy ? 'Salvando…' : 'Salvar alterações'}
          </button>
          {!confirmDel && (
            <button
              type="button"
              data-testid="cliente-del"
              onClick={() => setConfirmDel(true)}
              className={btnDangerCls}
            >
              Excluir cliente
            </button>
          )}
          {confirmDel && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className={btnSecondaryCls}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="cliente-del-confirm"
                disabled={busy}
                onClick={doDelete}
                className={btnDangerCls}
              >
                {busy ? '…' : 'Confirmar exclusão'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── Métricas card (header de venda) ─────────────────────────────────

interface Metricas {
  totalVendido: number;
  ticketMedio: number;
  pedidosCount: number;
  ultimoPedidoEm: string | null;
  vendidoNoMes: number;
  pedidosNoMes: number;
}

function MetricasCard({ clienteId }: { clienteId: string }) {
  const { data, loading } = useApiQuery<Metricas>(`/clientes/${clienteId}/metricas`);

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-[10px] py-3 px-4 mb-3 opacity-50 text-[12px] text-muted">
        Carregando métricas…
      </div>
    );
  }
  if (!data || data.pedidosCount === 0) {
    return (
      <div className="bg-surface border border-border rounded-[10px] py-3 px-4 mb-3 text-[13px] text-muted">
        Cliente sem pedidos ainda.
      </div>
    );
  }

  return (
    <div
      data-testid="cliente-metricas"
      className="bg-surface border border-border rounded-[10px] py-3 px-4 mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]"
    >
      <MetricaItem label="Total vendido" value={fmtBRL(data.totalVendido)} highlight />
      <MetricaItem label="Ticket médio" value={fmtBRL(data.ticketMedio)} />
      <MetricaItem
        label="Pedidos"
        value={formatNumero(data.pedidosCount)}
        hint={
          data.pedidosNoMes > 0 ? `${data.pedidosNoMes} no mês` : 'nenhum no mês'
        }
      />
      <MetricaItem
        label="Vendido no mês"
        value={fmtBRL(data.vendidoNoMes)}
        hint={data.vendidoNoMes > 0 ? 'mês corrente' : '—'}
      />
      <MetricaItem
        label="Último pedido"
        value={data.ultimoPedidoEm ? fmtDateShort(data.ultimoPedidoEm) : '—'}
        hint={data.ultimoPedidoEm ? fmtRelativo(data.ultimoPedidoEm) : undefined}
      />
    </div>
  );
}

function MetricaItem({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-muted uppercase tracking-[0.5px] mb-0.5">{label}</div>
      <div
        className={cn(
          'font-semibold tabular-nums',
          highlight ? 'text-[18px] text-primary' : 'text-[15px] text-text',
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted mt-px">{hint}</div>}
    </div>
  );
}

function fmtDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

function fmtRelativo(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const dias = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
    if (dias < 1) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    const meses = Math.floor(dias / 30);
    if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    const anos = Math.floor(dias / 365);
    return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  } catch {
    return '';
  }
}

// ─── Tab Pedidos ────────────────────────────────────────────────────

function PedidosTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const [statusFiltro, setStatusFiltro] = useState<string>('');
  const [periodo, setPeriodo] = useState<'todos' | '30d' | '90d' | '12m'>('todos');

  // Constrói query string com filtros
  const qs = new URLSearchParams({
    clienteId,
    limit: '50',
    sortBy: 'criadoEm',
    sortOrder: 'desc',
  });
  if (statusFiltro) qs.set('status', statusFiltro);
  if (periodo !== 'todos') {
    const dias = periodo === '30d' ? 30 : periodo === '90d' ? 90 : 365;
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - dias);
    qs.set('dataInicio', inicio.toISOString());
  }

  const { data, loading, error, refetch } = useApiQuery<{
    data: PedidoLite[];
    pagination?: { total: number };
  }>(`/pedidos?${qs.toString()}`);

  const pedidos: PedidoLite[] = data?.data ?? [];
  const filtrosAtivos = statusFiltro !== '' || periodo !== 'todos';

  return (
    <div className={cardCls}>
      <header className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="m-0 text-[15px]">
          Pedidos deste cliente
          {pedidos.length > 0 && (
            <span className="text-[12px] text-muted ml-2 font-normal">
              ({pedidos.length}
              {data?.pagination?.total && data.pagination.total > pedidos.length
                ? ` de ${data.pagination.total}`
                : ''}
              )
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/pedidos?clienteId=${clienteId}`)}
          className={cn(btnSecondaryCls, 'px-2.5 py-1 text-[12px]')}
        >
          Ver na lista geral
        </button>
      </header>

      {/* Filtros */}
      <div className="flex gap-2 mb-3 items-center flex-wrap">
        <Select
          data-testid="cliente-pedidos-status"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
          className="w-full sm:w-[180px]"
        >
          <option value="">Todos status</option>
          {(Object.keys(PEDIDO_STATUS_LABEL) as PedidoLite['status'][]).map((s) => (
            <option key={s} value={s}>
              {PEDIDO_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          data-testid="cliente-pedidos-periodo"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value as typeof periodo)}
          className="w-full sm:w-[160px]"
        >
          <option value="todos">Todos os tempos</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="90d">Últimos 90 dias</option>
          <option value="12m">Últimos 12 meses</option>
        </Select>
        {filtrosAtivos && (
          <button
            type="button"
            onClick={() => {
              setStatusFiltro('');
              setPeriodo('todos');
            }}
            className={cn(btnSecondaryCls, 'px-2.5 py-1 text-[11px]')}
          >
            Limpar
          </button>
        )}
      </div>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && pedidos.length === 0}
        emptyMessage="Sem pedidos pra este cliente ainda."
        onRetry={refetch}
      >
        <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full border-collapse text-[14px] mt-1">
          <thead>
            <tr>
              <th className={pedidoThCls}>Número</th>
              <th className={pedidoThCls}>Status</th>
              <th className={cn(pedidoThCls, 'text-right')}>Total</th>
              <th className={pedidoThCls}>Data</th>
              <th className={pedidoThCls}></th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer"
                onClick={() => navigate(`/pedidos/${p.id}`)}
                data-testid={`cliente-pedido-row-${p.id}`}
              >
                <td className={pedidoTdCls}>
                  <div className="font-semibold">#{p.numero}</div>
                  {p.numeroOmie && (
                    <div className="text-[11px] text-muted">OMIE {p.numeroOmie}</div>
                  )}
                </td>
                <td className={pedidoTdCls}>
                  <span className={badgeCls} style={badgeStyle(PEDIDO_STATUS_COLOR[p.status])}>
                    {PEDIDO_STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className={cn(pedidoTdCls, 'text-right font-semibold')}>
                  {fmtBRL(p.total)}
                </td>
                <td className={cn(pedidoTdCls, 'text-muted')}>{fmtDate(p.criadoEm)}</td>
                <td className={cn(pedidoTdCls, 'text-right')}>
                  <span className="text-primary text-[12px]">abrir →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </StateView>
    </div>
  );
}

const pedidoThCls =
  'text-left p-2 border-b border-border text-[11px] uppercase text-muted font-semibold tracking-[0.3px]';

const pedidoTdCls = 'p-2 border-b border-border align-middle';

// ─── Tab Propostas ─────────────────────────────────────────────────

type PropostaStatus =
  | 'RASCUNHO'
  | 'ENVIADA'
  | 'NEGOCIACAO'
  | 'AGUARDANDO_ASSINATURA'
  | 'ACEITA'
  | 'RECUSADA'
  | 'EXPIRADA';

interface PropostaLite {
  id: string;
  numero: string | number;
  status: PropostaStatus;
  valor: number;
  probabilidade: number;
  validoAte?: string | null;
  criadoEm: string;
}

const PROPOSTA_STATUS_LABEL: Record<PropostaStatus, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  NEGOCIACAO: 'Negociação',
  AGUARDANDO_ASSINATURA: 'Aguardando assinatura',
  ACEITA: 'Aceita',
  RECUSADA: 'Recusada',
  EXPIRADA: 'Expirada',
};

const PROPOSTA_STATUS_COLOR: Record<PropostaStatus, string> = {
  RASCUNHO: 'var(--muted)',
  ENVIADA: 'var(--info)',
  NEGOCIACAO: 'var(--warning)',
  AGUARDANDO_ASSINATURA: 'var(--warning)',
  ACEITA: 'var(--success)',
  RECUSADA: 'var(--danger)',
  EXPIRADA: 'var(--muted)',
};

function PropostasTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<{ data: PropostaLite[] }>(
    `/propostas?clienteId=${clienteId}&limit=50&sortBy=criadoEm&sortOrder=desc`,
  );
  const propostas = data?.data ?? [];

  return (
    <div className={cardCls}>
      <header className="flex items-center justify-between mb-3">
        <h3 className="m-0 text-[15px]">
          Propostas deste cliente
          {propostas.length > 0 && (
            <span className="text-[12px] text-muted ml-2 font-normal">
              ({propostas.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/propostas?clienteId=${clienteId}`)}
          className={cn(btnSecondaryCls, 'px-2.5 py-1 text-[12px]')}
        >
          Ver na lista geral
        </button>
      </header>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && propostas.length === 0}
        emptyMessage="Sem propostas pra este cliente."
        onRetry={refetch}
      >
        <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={pedidoThCls}>Número</th>
              <th className={pedidoThCls}>Status</th>
              <th className={cn(pedidoThCls, 'text-right')}>Valor</th>
              <th className={cn(pedidoThCls, 'text-right')}>Prob.</th>
              <th className={pedidoThCls}>Validade</th>
              <th className={pedidoThCls}>Data</th>
            </tr>
          </thead>
          <tbody>
            {propostas.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer"
                onClick={() => navigate(`/propostas?highlight=${p.id}`)}
                data-testid={`cliente-proposta-row-${p.id}`}
              >
                <td className={pedidoTdCls}>
                  <strong>#{p.numero}</strong>
                </td>
                <td className={pedidoTdCls}>
                  <span className={badgeCls} style={badgeStyle(PROPOSTA_STATUS_COLOR[p.status])}>
                    {PROPOSTA_STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className={cn(pedidoTdCls, 'text-right font-semibold')}>
                  {fmtBRL(p.valor)}
                </td>
                <td className={cn(pedidoTdCls, 'text-right text-muted')}>
                  {p.probabilidade}%
                </td>
                <td className={cn(pedidoTdCls, 'text-muted')}>
                  {p.validoAte ? fmtDateShort(p.validoAte) : '—'}
                </td>
                <td className={cn(pedidoTdCls, 'text-muted')}>{fmtDate(p.criadoEm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </StateView>
    </div>
  );
}

// ─── Tab Amostras ──────────────────────────────────────────────────

type AmostraStatus =
  | 'ENVIADA'
  | 'AGUARDANDO_FOLLOWUP'
  | 'CONVERTIDA'
  | 'NAO_CONVERTEU'
  | 'VENCIDA';

interface AmostraLite {
  id: string;
  produtoNome: string;
  valor: number;
  notaFiscal?: string | null;
  enviadoEm?: string | null;
  followUpEm?: string | null;
  status: AmostraStatus;
}

const AMOSTRA_STATUS_LABEL: Record<AmostraStatus, string> = {
  ENVIADA: 'Enviada',
  AGUARDANDO_FOLLOWUP: 'Aguardando follow-up',
  CONVERTIDA: 'Convertida',
  NAO_CONVERTEU: 'Não converteu',
  VENCIDA: 'Vencida',
};

const AMOSTRA_STATUS_COLOR: Record<AmostraStatus, string> = {
  ENVIADA: 'var(--info)',
  AGUARDANDO_FOLLOWUP: 'var(--warning)',
  CONVERTIDA: 'var(--success)',
  NAO_CONVERTEU: 'var(--danger)',
  VENCIDA: 'var(--muted)',
};

function AmostrasTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<{ data: AmostraLite[] }>(
    `/amostras?clienteId=${clienteId}&limit=50&sortBy=criadoEm&sortOrder=desc`,
  );
  const amostras = data?.data ?? [];

  return (
    <div className={cardCls}>
      <header className="flex items-center justify-between mb-3">
        <h3 className="m-0 text-[15px]">
          Amostras enviadas
          {amostras.length > 0 && (
            <span className="text-[12px] text-muted ml-2 font-normal">
              ({amostras.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/amostras?clienteId=${clienteId}`)}
          className={cn(btnSecondaryCls, 'px-2.5 py-1 text-[12px]')}
        >
          Ver na lista geral
        </button>
      </header>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && amostras.length === 0}
        emptyMessage="Nenhuma amostra enviada pra este cliente."
        onRetry={refetch}
      >
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={pedidoThCls}>Produto</th>
              <th className={pedidoThCls}>Status</th>
              <th className={cn(pedidoThCls, 'text-right')}>Valor</th>
              <th className={pedidoThCls}>Enviado</th>
              <th className={pedidoThCls}>Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {amostras.map((a) => (
              <tr
                key={a.id}
                className="cursor-pointer"
                onClick={() => navigate(`/amostras?highlight=${a.id}`)}
                data-testid={`cliente-amostra-row-${a.id}`}
              >
                <td className={pedidoTdCls}>
                  <strong>{a.produtoNome}</strong>
                  {a.notaFiscal && (
                    <div className="text-[11px] text-muted">NF {a.notaFiscal}</div>
                  )}
                </td>
                <td className={pedidoTdCls}>
                  <span className={badgeCls} style={badgeStyle(AMOSTRA_STATUS_COLOR[a.status])}>
                    {AMOSTRA_STATUS_LABEL[a.status]}
                  </span>
                </td>
                <td className={cn(pedidoTdCls, 'text-right font-semibold')}>
                  {fmtBRL(a.valor)}
                </td>
                <td className={cn(pedidoTdCls, 'text-muted')}>
                  {a.enviadoEm ? fmtDateShort(a.enviadoEm) : '—'}
                </td>
                <td className={cn(pedidoTdCls, 'text-muted')}>
                  {a.followUpEm ? fmtDateShort(a.followUpEm) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateView>
    </div>
  );
}

// ─── Tab Ocorrências ───────────────────────────────────────────────

type OcorrenciaStatus = 'ABERTA' | 'EM_ANDAMENTO' | 'RESOLVIDA' | 'CANCELADA';
type Severidade = 'baixa' | 'media' | 'alta' | 'critica';

interface OcorrenciaLite {
  id: string;
  numero: string | number;
  titulo: string;
  status: OcorrenciaStatus;
  severidade: Severidade;
  slaVenceEm?: string | null;
  criadoEm: string;
}

const OCORRENCIA_STATUS_LABEL: Record<OcorrenciaStatus, string> = {
  ABERTA: 'Aberta',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDA: 'Resolvida',
  CANCELADA: 'Cancelada',
};

const OCORRENCIA_STATUS_COLOR: Record<OcorrenciaStatus, string> = {
  ABERTA: 'var(--warning)',
  EM_ANDAMENTO: 'var(--info)',
  RESOLVIDA: 'var(--success)',
  CANCELADA: 'var(--muted)',
};

const SEVERIDADE_COLOR: Record<Severidade, string> = {
  baixa: 'var(--muted)',
  media: 'var(--info)',
  alta: 'var(--warning)',
  critica: 'var(--danger)',
};

function OcorrenciasTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<{ data: OcorrenciaLite[] }>(
    `/ocorrencias?clienteId=${clienteId}&limit=50&sortBy=criadoEm&sortOrder=desc`,
  );
  const ocorrencias = data?.data ?? [];

  return (
    <div className={cardCls}>
      <header className="flex items-center justify-between mb-3">
        <h3 className="m-0 text-[15px]">
          Ocorrências
          {ocorrencias.length > 0 && (
            <span className="text-[12px] text-muted ml-2 font-normal">
              ({ocorrencias.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/ocorrencias?clienteId=${clienteId}`)}
          className={cn(btnSecondaryCls, 'px-2.5 py-1 text-[12px]')}
        >
          Ver na lista geral
        </button>
      </header>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && ocorrencias.length === 0}
        emptyMessage="Nenhuma ocorrência aberta pra este cliente."
        onRetry={refetch}
      >
        <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className={pedidoThCls}>Número</th>
              <th className={pedidoThCls}>Título</th>
              <th className={pedidoThCls}>Severidade</th>
              <th className={pedidoThCls}>Status</th>
              <th className={pedidoThCls}>SLA</th>
              <th className={pedidoThCls}>Data</th>
            </tr>
          </thead>
          <tbody>
            {ocorrencias.map((o) => {
              const slaVencido =
                o.slaVenceEm &&
                ['ABERTA', 'EM_ANDAMENTO'].includes(o.status) &&
                new Date(o.slaVenceEm).getTime() < Date.now();
              return (
                <tr
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/ocorrencias?highlight=${o.id}`)}
                  data-testid={`cliente-ocorrencia-row-${o.id}`}
                >
                  <td className={pedidoTdCls}>
                    <strong>#{o.numero}</strong>
                  </td>
                  <td className={pedidoTdCls}>{o.titulo}</td>
                  <td className={pedidoTdCls}>
                    <span className={badgeCls} style={badgeStyle(SEVERIDADE_COLOR[o.severidade])}>
                      {o.severidade}
                    </span>
                  </td>
                  <td className={pedidoTdCls}>
                    <span
                      className={badgeCls}
                      style={badgeStyle(OCORRENCIA_STATUS_COLOR[o.status])}
                    >
                      {OCORRENCIA_STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td
                    className={cn(
                      pedidoTdCls,
                      slaVencido ? 'text-danger font-semibold' : 'text-muted font-normal',
                    )}
                  >
                    {o.slaVenceEm
                      ? `${fmtDateShort(o.slaVenceEm)}${slaVencido ? ' (vencido)' : ''}`
                      : '—'}
                  </td>
                  <td className={cn(pedidoTdCls, 'text-muted')}>{fmtDate(o.criadoEm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </StateView>
    </div>
  );
}

// ─── Tab Notas privadas ──────────────────────────────────────────────

function NotasTab({ clienteId }: { clienteId: string }) {
  const toast = useToast();
  // api.get já desempacota o envelope `{success, data, meta}` retornando T direto.
  const { data, loading, error, refetch } = useApiQuery<NotaPrivada[]>(
    `/clientes/${clienteId}/notas`,
  );
  const notas: NotaPrivada[] = data ?? [];

  const [texto, setTexto] = useState('');
  const [creating, setCreating] = useState(false);
  const [error2, setError2] = useState<string | null>(null);
  const [editing, setEditing] = useState<NotaPrivada | null>(null);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function addNota() {
    if (!texto.trim()) return;
    setCreating(true);
    setError2(null);
    try {
      await api.post(`/clientes/${clienteId}/notas`, { texto: texto.trim() });
      setTexto('');
      refetch();
    } catch (err) {
      setError2(err instanceof ApiError ? err.message : 'Falha');
    } finally {
      setCreating(false);
    }
  }

  async function delNota(id: string) {
    const ok = await confirmAsync({
      title: 'Excluir esta nota?',
      message: 'Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/clientes/${clienteId}/notas/${id}`);
      toast.success('Nota excluída');
      refetch();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className={cardCls}>
      <h3 className="mt-0 mb-2 mx-0 text-[15px]">Nova nota</h3>
      <Textarea
        data-testid="nota-input"
        placeholder="Anotação interna sobre o cliente (visível só pra equipe)"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={5000}
      />
      <div className="flex justify-between items-center mt-2">
        <span className="text-[11px] text-muted">{texto.length}/5000</span>
        <button
          type="button"
          data-testid="nota-add"
          disabled={creating || texto.trim().length === 0}
          onClick={addNota}
          className={cn(btnCls, (creating || texto.trim().length === 0) && 'opacity-60')}
        >
          {creating ? 'Adicionando…' : 'Adicionar nota'}
        </button>
      </div>
      {error2 && <p className="text-danger text-[13px]">{error2}</p>}

      <h3 className="mt-6 mb-2 mx-0 text-[15px]">Notas anteriores</h3>
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && notas.length === 0}
        emptyMessage="Sem notas ainda. Adicione a primeira acima."
        onRetry={refetch}
      >
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {notas.map((n) => (
            <li
              key={n.id}
              className="bg-bg-alt border border-border rounded-md p-3"
            >
              <header className="flex justify-between text-[12px] text-muted mb-1">
                <strong>{n.autor?.nome ?? '—'}</strong>
                <span>{fmtDate(n.criadoEm)}</span>
              </header>
              <p className="m-0 whitespace-pre-wrap text-[14px]">{n.texto}</p>
              <div className="flex gap-1 mt-1.5">
                <button
                  type="button"
                  data-testid={`nota-edit-${n.id}`}
                  onClick={() => setEditing(n)}
                  className={cn(btnSecondaryCls, 'px-2 py-0.5 text-[11px]')}
                >
                  Editar
                </button>
                <button
                  type="button"
                  data-testid={`nota-del-${n.id}`}
                  onClick={() => delNota(n.id)}
                  className={cn(btnDangerCls, 'px-2 py-0.5 text-[11px]')}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      </StateView>

      {editing && (
        <EditNotaModal
          clienteId={clienteId}
          nota={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
}

function EditNotaModal({
  clienteId,
  nota,
  onClose,
  onSaved,
}: {
  clienteId: string;
  nota: NotaPrivada;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [texto, setTexto] = useState(nota.texto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/clientes/${clienteId}/notas/${nota.id}`, { texto: texto.trim() });
      onSaved();
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
      title="Editar nota"
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondaryCls}>
            Cancelar
          </button>
          <button
            type="submit"
            form="nota-edit-form"
            data-testid="nota-save"
            disabled={busy || texto.trim().length === 0}
            className={btnCls}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="nota-edit-form" onSubmit={save}>
        <Textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={5000}
          style={{ minHeight: 120 }}
        />
        {error && <p className="text-danger text-[13px]">{error}</p>}
      </form>
    </Dialog>
  );
}

// ─── Tab Documentos ──────────────────────────────────────────────────

function DocumentosTab({ clienteId }: { clienteId: string }) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<Documento[]>(
    `/clientes/${clienteId}/documentos`,
  );
  const docs: Documento[] = data ?? [];
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  // Tipos aceitos pelo Storage do backend (Supabase signed URLs).
  // Mantém em sync com `documentos.controller` se mudar.
  const ALLOWED_MIME = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'text/csv',
    'text/plain',
  ]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Arquivo maior que 10MB — não suportado');
      e.target.value = '';
      return;
    }
    // Valida mimetype antes de gastar upload — backend rejeita igual mas
    // economiza tempo de rede + dá feedback imediato.
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      setUploadError(
        `Tipo "${file.type}" não suportado. Aceitos: PDF, imagens (PNG/JPG/WebP), planilhas (XLSX/XLS/CSV), documentos (DOC/DOCX), TXT.`,
      );
      e.target.value = '';
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Direct fetch porque api client é JSON-only
      const sess = await import('@/lib/auth-store').then((m) => m.getSession());
      const baseUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/v1/clientes/${clienteId}/documentos`, {
        method: 'POST',
        body: fd,
        headers: {
          ...(sess?.accessToken ? { Authorization: `Bearer ${sess.accessToken}` } : {}),
          ...(sess?.user.empresaIdAtiva ? { 'X-Empresa-Id': sess.user.empresaIdAtiva } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
        );
      }
      refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setUploading(false);
      e.target.value = ''; // reset input
    }
  }

  async function downloadDoc(docId: string) {
    try {
      const r = await api.get<{ url: string }>(`/clientes/${clienteId}/documentos/${docId}/download`);
      window.open(r.url, '_blank', 'noopener');
    } catch (err) {
      toast.error('Falha ao gerar link', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function delDoc(docId: string) {
    const ok = await confirmAsync({
      title: 'Excluir este documento?',
      message: 'Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/clientes/${clienteId}/documentos/${docId}`);
      toast.success('Documento excluído');
      refetch();
    } catch (err) {
      toast.error('Falha ao excluir', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className={cardCls}>
      <h3 className="mt-0 mb-2 mx-0 text-[15px]">Enviar documento</h3>
      <p className="mt-0 mb-3 mx-0 text-[12px] text-muted">
        Máx. 10MB. Aceito: PDF, imagens, planilhas, doc, csv.
      </p>
      <input
        type="file"
        data-testid="doc-upload"
        onChange={handleFile}
        disabled={uploading}
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.doc,.docx,.csv,.txt"
      />
      {uploading && <span className="ml-2 text-muted text-[13px]">Enviando…</span>}
      {uploadError && (
        <p data-testid="upload-error" className="text-danger text-[13px]">
          {uploadError}
        </p>
      )}

      <h3 className="mt-6 mb-2 mx-0 text-[15px]">Documentos anexados</h3>
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && docs.length === 0}
        emptyMessage="Sem documentos. Envie o primeiro acima."
        onRetry={refetch}
      >
        <ul className="list-none p-0 m-0 flex flex-col gap-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="bg-bg-alt border border-border rounded-md py-2 px-3 flex items-center gap-2"
            >
              <span className="text-[20px]">📄</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[14px] overflow-hidden text-ellipsis whitespace-nowrap">
                  {d.nome}
                </div>
                <div className="text-[11px] text-muted">
                  {fmtSize(d.tamanho)} · {d.mimetype} · {fmtDate(d.criadoEm)}
                  {d.uploadedBy && ` · por ${d.uploadedBy.nome}`}
                </div>
              </div>
              <button
                type="button"
                data-testid={`doc-download-${d.id}`}
                onClick={() => downloadDoc(d.id)}
                className={cn(btnSecondaryCls, 'px-2.5 py-1 text-[12px]')}
              >
                Baixar
              </button>
              <button
                type="button"
                data-testid={`doc-del-${d.id}`}
                onClick={() => delDoc(d.id)}
                className={cn(btnDangerCls, 'px-2.5 py-1 text-[12px]')}
              >
                Excluir
              </button>
            </li>
          ))}
        </ul>
      </StateView>
      {ConfirmDialog}
    </div>
  );
}

// ─── Tab Preços especiais ────────────────────────────────────────────

function PrecosTab({ clienteId }: { clienteId: string }) {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<PrecoEspecial[]>(
    `/clientes/${clienteId}/precos-especiais`,
  );
  const precos: PrecoEspecial[] = data ?? [];
  const [adding, setAdding] = useState(false);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function delPreco(produtoId: string) {
    const ok = await confirmAsync({
      title: 'Remover este preço especial?',
      message: 'O cliente voltará a pagar o preço padrão pra este produto.',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/clientes/${clienteId}/precos-especiais/${produtoId}`);
      toast.success('Preço especial removido');
      refetch();
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className={cardCls}>
      <header className="flex justify-between items-center mb-3">
        <h3 className="m-0 text-[15px]">Preços negociados</h3>
        <button
          type="button"
          data-testid="preco-add"
          onClick={() => setAdding(true)}
          className={btnCls}
        >
          + Novo preço especial
        </button>
      </header>

      <p className="text-[12px] text-muted mt-0">
        Preço acordado pra este cliente, sobrepõe a tabela. Sync OMIE pode atualizar
        automaticamente.
      </p>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && precos.length === 0}
        emptyMessage="Sem preços especiais ainda. Adicione o primeiro."
        onRetry={refetch}
      >
        <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full border-collapse text-[14px] mt-2">
          <thead>
            <tr>
              <th className={thStyleCls}>Produto</th>
              <th className={thStyleCls}>Preço tabela</th>
              <th className={thStyleCls}>Preço especial</th>
              <th className={thStyleCls}>Desconto base</th>
              <th className={thStyleCls}>Válido até</th>
              <th className={thStyleCls}></th>
            </tr>
          </thead>
          <tbody>
            {precos.map((p) => (
              <tr key={p.produtoId}>
                <td className={tdStyleCls}>
                  <div className="font-semibold">{p.produto?.nome ?? '—'}</div>
                  {p.produto?.sku && (
                    <div className="text-[11px] text-muted">{p.produto.sku}</div>
                  )}
                </td>
                <td className={tdStyleCls}>{p.produto?.precoTabela !== undefined ? fmtBRL(p.produto.precoTabela) : '—'}</td>
                <td className={tdStyleCls}>
                  <strong>{fmtBRL(p.precoEspecial)}</strong>
                </td>
                <td className={tdStyleCls}>{p.descontoBase}%</td>
                <td className={tdStyleCls}>{p.validoAte ? fmtDate(p.validoAte) : 'sem expiração'}</td>
                <td className={tdStyleCls}>
                  <button
                    type="button"
                    data-testid={`preco-del-${p.produtoId}`}
                    onClick={() => delPreco(p.produtoId)}
                    className={cn(btnDangerCls, 'px-2 py-0.5 text-[11px]')}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </StateView>

      {adding && (
        <PrecoFormModal
          clienteId={clienteId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refetch();
          }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
}

const thStyleCls =
  'text-left p-2 border-b border-border text-[11px] uppercase text-muted font-semibold tracking-[0.3px]';

const tdStyleCls = 'p-2 border-b border-border align-middle';

function PrecoFormModal({
  clienteId,
  onClose,
  onSaved,
}: {
  clienteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [produto, setProduto] = useState<ProdutoOpt | null>(null);
  const [precoEspecial, setPrecoEspecial] = useState('');
  const [descontoBase, setDescontoBase] = useState(0);
  const [validoAte, setValidoAte] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desconto = useMemo(() => {
    if (!produto?.precoTabela || !precoEspecial) return null;
    const pe = Number(precoEspecial);
    if (!pe) return null;
    return ((1 - pe / produto.precoTabela) * 100).toFixed(1);
  }, [produto, precoEspecial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!produto) {
      setError('Selecione um produto.');
      return;
    }
    const pe = Number(precoEspecial);
    if (!precoEspecial.trim() || Number.isNaN(pe) || pe <= 0) {
      setError('Informe um preço especial maior que zero.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      produtoId: produto.id,
      precoEspecial: Number(precoEspecial),
      descontoBase,
    };
    if (validoAte) payload.validoAte = validoAte;
    try {
      await api.put(`/clientes/${clienteId}/precos-especiais`, payload);
      onSaved();
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
      title="Novo preço especial"
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondaryCls}>
            Cancelar
          </button>
          <button
            type="submit"
            form="preco-form"
            data-testid="preco-save"
            disabled={busy}
            className={cn(btnCls, busy && 'opacity-60')}
          >
            {busy ? 'Salvando…' : 'Salvar preço'}
          </button>
        </>
      }
    >
      <form id="preco-form" onSubmit={submit}>
        <FormField label="Produto" required>
          <AsyncCombobox<ProdutoOpt>
            testId="preco-produto-picker"
            endpoint="/produtos"
            placeholder="Buscar produto…"
            getLabel={(p) => p.nome}
            getSubLabel={(p) =>
              [p.sku, p.precoTabela !== undefined ? `tabela ${fmtBRL(p.precoTabela)}` : null]
                .filter(Boolean)
                .join(' · ')
            }
            getId={(p) => p.id}
            value={produto}
            onChange={setProduto}
          />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Preço especial (R$)" htmlFor="pe-val" required>
            <Input
              id="pe-val"
              data-testid="preco-valor-input"
              type="number"
              min={0.01}
              step="0.01"
              value={precoEspecial}
              onChange={(e) => setPrecoEspecial(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Desconto base (%)" htmlFor="pe-db" hint="Para promo extras">
            <Input
              id="pe-db"
              type="number"
              min={0}
              max={80}
              step="0.1"
              value={descontoBase}
              onChange={(e) => setDescontoBase(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Válido até" htmlFor="pe-validade">
            <Input
              id="pe-validade"
              type="date"
              value={validoAte}
              onChange={(e) => setValidoAte(e.target.value)}
            />
          </FormField>
        </div>
        {desconto !== null && (
          <div className="text-[13px] py-2 px-3 bg-bg-alt border border-border rounded-md mt-2">
            Diferença vs. tabela:{' '}
            <strong className={Number(desconto) > 0 ? 'text-success' : 'text-danger'}>
              {Number(desconto) > 0 ? `−${desconto}%` : `+${(-Number(desconto)).toFixed(1)}%`}
            </strong>
          </div>
        )}
        {error && <p className="text-danger text-[13px]">{error}</p>}
      </form>
    </Dialog>
  );
}
