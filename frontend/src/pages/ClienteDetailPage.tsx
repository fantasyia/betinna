import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { NovoPedidoDialog } from '@/components/NovoPedidoDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { maskCNPJ, maskTelefone, normalizeUF } from '@/lib/masks';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

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
  ATIVO: colors.success,
  NOVO: '#0891b2',
  PROSPECT: '#7c3aed',
  RISCO: colors.warning,
  CRITICO: colors.danger,
  INATIVO: colors.muted,
};
const OMIE_COLOR: Record<OmieStatus, string> = {
  ATIVO: colors.success,
  BLOQUEADO: colors.danger,
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
  RASCUNHO: colors.muted,
  AGUARDANDO_APROVACAO: colors.warning,
  ENVIADO_OMIE: colors.info,
  PAGO: colors.success,
  EM_SEPARACAO: colors.primary,
  ENVIADO: colors.info,
  ENTREGUE: colors.success,
  CANCELADO: colors.danger,
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {cliente && (
            <button
              type="button"
              data-testid="cliente-page-criar-pedido"
              onClick={() => setCriarPedido(true)}
              style={btn}
            >
              + Criar pedido
            </button>
          )}
          <Link to="/clientes" style={{ ...btnSecondary, textDecoration: 'none' }}>
            ← Voltar pra lista
          </Link>
        </div>
      }
    >
      <StateView loading={loading && !cliente} error={error} onRetry={refetch}>
        {cliente && (
          <>
            <MetricasCard clienteId={cliente.id} />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <span style={badge(STATUS_COLOR[cliente.status])}>{cliente.status}</span>
              <span style={badge(OMIE_COLOR[cliente.omieStatus])}>OMIE {cliente.omieStatus}</span>
              {cliente.cnpj && (
                <span style={{ fontSize: 13, color: colors.muted }}>
                  CNPJ {cliente.cnpj}
                </span>
              )}
              {cliente.representante?.nome && (
                <span style={{ fontSize: 13, color: colors.muted }}>
                  Rep: <strong>{cliente.representante.nome}</strong>
                </span>
              )}
              {cliente.tags && cliente.tags.length > 0 && (
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {cliente.tags.map((t) => (
                    <span key={t.id} style={badge(t.cor ?? colors.muted)}>
                      {t.nome}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div
              role="tablist"
              style={{
                display: 'flex',
                gap: 0,
                borderBottom: `1px solid ${colors.border}`,
                marginBottom: '1rem',
              }}
            >
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
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
        padding: '0.625rem 1rem',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: active ? colors.primary : colors.muted,
        fontWeight: active ? 600 : 500,
        fontSize: 14,
        marginBottom: -1,
      }}
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
    <div style={card}>
      <form onSubmit={save}>
        <FormField label="Nome" required>
          <Input
            value={form.nome}
            onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
            required
            minLength={2}
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
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
            <Input
              value={form.telefone}
              onChange={(e) => setForm((s) => ({ ...s, telefone: maskTelefone(e.target.value) }))}
              placeholder="(00) 00000-0000"
              maxLength={15}
              inputMode="tel"
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
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="submit" data-testid="cliente-save" disabled={busy} style={btn}>
            {busy ? 'Salvando…' : 'Salvar alterações'}
          </button>
          {!confirmDel && (
            <button
              type="button"
              data-testid="cliente-del"
              onClick={() => setConfirmDel(true)}
              style={btnDanger}
            >
              Excluir cliente
            </button>
          )}
          {confirmDel && (
            <>
              <button type="button" onClick={() => setConfirmDel(false)} style={btnSecondary}>
                Cancelar
              </button>
              <button
                type="button"
                data-testid="cliente-del-confirm"
                disabled={busy}
                onClick={doDelete}
                style={btnDanger}
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
      <div
        style={{
          ...card,
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          opacity: 0.5,
          fontSize: 12,
          color: colors.muted,
        }}
      >
        Carregando métricas…
      </div>
    );
  }
  if (!data || data.pedidosCount === 0) {
    return (
      <div
        style={{
          ...card,
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          fontSize: 13,
          color: colors.muted,
        }}
      >
        Cliente sem pedidos ainda.
      </div>
    );
  }

  return (
    <div
      data-testid="cliente-metricas"
      style={{
        ...card,
        padding: '0.75rem 1rem',
        marginBottom: '0.75rem',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '0.75rem',
      }}
    >
      <MetricaItem label="Total vendido" value={fmtBRL(data.totalVendido)} highlight />
      <MetricaItem label="Ticket médio" value={fmtBRL(data.ticketMedio)} />
      <MetricaItem
        label="Pedidos"
        value={data.pedidosCount.toLocaleString('pt-BR')}
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
      <div
        style={{
          fontSize: 10,
          color: colors.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: highlight ? 18 : 15,
          fontWeight: 600,
          color: highlight ? colors.primary : colors.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{hint}</div>
      )}
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
    <div style={card}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Pedidos deste cliente
          {pedidos.length > 0 && (
            <span style={{ fontSize: 12, color: colors.muted, marginLeft: 8, fontWeight: 400 }}>
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
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Ver na lista geral
        </button>
      </header>

      {/* Filtros */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Select
          data-testid="cliente-pedidos-status"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
          style={{ width: 180 }}
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
          style={{ width: 160 }}
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
            style={{
              ...btnSecondary,
              padding: '0.25rem 0.625rem',
              fontSize: 11,
            }}
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
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
            marginTop: '0.25rem',
          }}
        >
          <thead>
            <tr>
              <th style={pedidoTh}>Número</th>
              <th style={pedidoTh}>Status</th>
              <th style={{ ...pedidoTh, textAlign: 'right' }}>Total</th>
              <th style={pedidoTh}>Data</th>
              <th style={pedidoTh}></th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr
                key={p.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/pedidos/${p.id}`)}
                data-testid={`cliente-pedido-row-${p.id}`}
              >
                <td style={pedidoTd}>
                  <div style={{ fontWeight: 600 }}>#{p.numero}</div>
                  {p.numeroOmie && (
                    <div style={{ fontSize: 11, color: colors.muted }}>
                      OMIE {p.numeroOmie}
                    </div>
                  )}
                </td>
                <td style={pedidoTd}>
                  <span style={badge(PEDIDO_STATUS_COLOR[p.status])}>
                    {PEDIDO_STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td style={{ ...pedidoTd, textAlign: 'right', fontWeight: 600 }}>
                  {fmtBRL(p.total)}
                </td>
                <td style={{ ...pedidoTd, color: colors.muted }}>{fmtDate(p.criadoEm)}</td>
                <td style={{ ...pedidoTd, textAlign: 'right' }}>
                  <span style={{ color: colors.primary, fontSize: 12 }}>abrir →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StateView>
    </div>
  );
}

const pedidoTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 11,
  textTransform: 'uppercase',
  color: colors.muted,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const pedidoTd: React.CSSProperties = {
  padding: '0.5rem',
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
};

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
  RASCUNHO: colors.muted,
  ENVIADA: colors.info,
  NEGOCIACAO: colors.warning,
  AGUARDANDO_ASSINATURA: colors.warning,
  ACEITA: colors.success,
  RECUSADA: colors.danger,
  EXPIRADA: colors.muted,
};

function PropostasTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<{ data: PropostaLite[] }>(
    `/propostas?clienteId=${clienteId}&limit=50&sortBy=criadoEm&sortOrder=desc`,
  );
  const propostas = data?.data ?? [];

  return (
    <div style={card}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Propostas deste cliente
          {propostas.length > 0 && (
            <span style={{ fontSize: 12, color: colors.muted, marginLeft: 8, fontWeight: 400 }}>
              ({propostas.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/propostas?clienteId=${clienteId}`)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={pedidoTh}>Número</th>
              <th style={pedidoTh}>Status</th>
              <th style={{ ...pedidoTh, textAlign: 'right' }}>Valor</th>
              <th style={{ ...pedidoTh, textAlign: 'right' }}>Prob.</th>
              <th style={pedidoTh}>Validade</th>
              <th style={pedidoTh}>Data</th>
            </tr>
          </thead>
          <tbody>
            {propostas.map((p) => (
              <tr
                key={p.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/propostas?highlight=${p.id}`)}
                data-testid={`cliente-proposta-row-${p.id}`}
              >
                <td style={pedidoTd}>
                  <strong>#{p.numero}</strong>
                </td>
                <td style={pedidoTd}>
                  <span style={badge(PROPOSTA_STATUS_COLOR[p.status])}>
                    {PROPOSTA_STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td style={{ ...pedidoTd, textAlign: 'right', fontWeight: 600 }}>
                  {fmtBRL(p.valor)}
                </td>
                <td style={{ ...pedidoTd, textAlign: 'right', color: colors.muted }}>
                  {p.probabilidade}%
                </td>
                <td style={{ ...pedidoTd, color: colors.muted }}>
                  {p.validoAte ? fmtDateShort(p.validoAte) : '—'}
                </td>
                <td style={{ ...pedidoTd, color: colors.muted }}>{fmtDate(p.criadoEm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  ENVIADA: colors.info,
  AGUARDANDO_FOLLOWUP: colors.warning,
  CONVERTIDA: colors.success,
  NAO_CONVERTEU: colors.danger,
  VENCIDA: colors.muted,
};

function AmostrasTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<{ data: AmostraLite[] }>(
    `/amostras?clienteId=${clienteId}&limit=50&sortBy=criadoEm&sortOrder=desc`,
  );
  const amostras = data?.data ?? [];

  return (
    <div style={card}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Amostras enviadas
          {amostras.length > 0 && (
            <span style={{ fontSize: 12, color: colors.muted, marginLeft: 8, fontWeight: 400 }}>
              ({amostras.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/amostras?clienteId=${clienteId}`)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={pedidoTh}>Produto</th>
              <th style={pedidoTh}>Status</th>
              <th style={{ ...pedidoTh, textAlign: 'right' }}>Valor</th>
              <th style={pedidoTh}>Enviado</th>
              <th style={pedidoTh}>Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {amostras.map((a) => (
              <tr
                key={a.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/amostras?highlight=${a.id}`)}
                data-testid={`cliente-amostra-row-${a.id}`}
              >
                <td style={pedidoTd}>
                  <strong>{a.produtoNome}</strong>
                  {a.notaFiscal && (
                    <div style={{ fontSize: 11, color: colors.muted }}>NF {a.notaFiscal}</div>
                  )}
                </td>
                <td style={pedidoTd}>
                  <span style={badge(AMOSTRA_STATUS_COLOR[a.status])}>
                    {AMOSTRA_STATUS_LABEL[a.status]}
                  </span>
                </td>
                <td style={{ ...pedidoTd, textAlign: 'right', fontWeight: 600 }}>
                  {fmtBRL(a.valor)}
                </td>
                <td style={{ ...pedidoTd, color: colors.muted }}>
                  {a.enviadoEm ? fmtDateShort(a.enviadoEm) : '—'}
                </td>
                <td style={{ ...pedidoTd, color: colors.muted }}>
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
  ABERTA: colors.warning,
  EM_ANDAMENTO: colors.info,
  RESOLVIDA: colors.success,
  CANCELADA: colors.muted,
};

const SEVERIDADE_COLOR: Record<Severidade, string> = {
  baixa: colors.muted,
  media: colors.info,
  alta: colors.warning,
  critica: colors.danger,
};

function OcorrenciasTab({ clienteId }: { clienteId: string }) {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApiQuery<{ data: OcorrenciaLite[] }>(
    `/ocorrencias?clienteId=${clienteId}&limit=50&sortBy=criadoEm&sortOrder=desc`,
  );
  const ocorrencias = data?.data ?? [];

  return (
    <div style={card}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Ocorrências
          {ocorrencias.length > 0 && (
            <span style={{ fontSize: 12, color: colors.muted, marginLeft: 8, fontWeight: 400 }}>
              ({ocorrencias.length})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/ocorrencias?clienteId=${clienteId}`)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={pedidoTh}>Número</th>
              <th style={pedidoTh}>Título</th>
              <th style={pedidoTh}>Severidade</th>
              <th style={pedidoTh}>Status</th>
              <th style={pedidoTh}>SLA</th>
              <th style={pedidoTh}>Data</th>
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
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/ocorrencias?highlight=${o.id}`)}
                  data-testid={`cliente-ocorrencia-row-${o.id}`}
                >
                  <td style={pedidoTd}>
                    <strong>#{o.numero}</strong>
                  </td>
                  <td style={pedidoTd}>{o.titulo}</td>
                  <td style={pedidoTd}>
                    <span style={badge(SEVERIDADE_COLOR[o.severidade])}>{o.severidade}</span>
                  </td>
                  <td style={pedidoTd}>
                    <span style={badge(OCORRENCIA_STATUS_COLOR[o.status])}>
                      {OCORRENCIA_STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td
                    style={{
                      ...pedidoTd,
                      color: slaVencido ? colors.danger : colors.muted,
                      fontWeight: slaVencido ? 600 : 400,
                    }}
                  >
                    {o.slaVenceEm
                      ? `${fmtDateShort(o.slaVenceEm)}${slaVencido ? ' (vencido)' : ''}`
                      : '—'}
                  </td>
                  <td style={{ ...pedidoTd, color: colors.muted }}>{fmtDate(o.criadoEm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
    <div style={card}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: 15 }}>Nova nota</h3>
      <Textarea
        data-testid="nota-input"
        placeholder="Anotação interna sobre o cliente (visível só pra equipe)"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={5000}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '0.5rem',
        }}
      >
        <span style={{ fontSize: 11, color: colors.muted }}>{texto.length}/5000</span>
        <button
          type="button"
          data-testid="nota-add"
          disabled={creating || texto.trim().length === 0}
          onClick={addNota}
          style={{ ...btn, opacity: creating || texto.trim().length === 0 ? 0.6 : 1 }}
        >
          {creating ? 'Adicionando…' : 'Adicionar nota'}
        </button>
      </div>
      {error2 && (
        <p style={{ color: colors.danger, fontSize: 13 }}>{error2}</p>
      )}

      <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: 15 }}>Notas anteriores</h3>
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && notas.length === 0}
        emptyMessage="Sem notas ainda. Adicione a primeira acima."
        onRetry={refetch}
      >
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {notas.map((n) => (
            <li
              key={n.id}
              style={{
                background: '#fafbfc',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '0.75rem',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: colors.muted,
                  marginBottom: 4,
                }}
              >
                <strong>{n.autor?.nome ?? '—'}</strong>
                <span>{fmtDate(n.criadoEm)}</span>
              </header>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{n.texto}</p>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button
                  type="button"
                  data-testid={`nota-edit-${n.id}`}
                  onClick={() => setEditing(n)}
                  style={{ ...btnSecondary, padding: '0.125rem 0.5rem', fontSize: 11 }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  data-testid={`nota-del-${n.id}`}
                  onClick={() => delNota(n.id)}
                  style={{ ...btnDanger, padding: '0.125rem 0.5rem', fontSize: 11 }}
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
    <Modal
      open
      onClose={onClose}
      title="Editar nota"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="nota-edit-form"
            data-testid="nota-save"
            disabled={busy || texto.trim().length === 0}
            style={btn}
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
        {error && (
          <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
        )}
      </form>
    </Modal>
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
    <div style={card}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: 15 }}>Enviar documento</h3>
      <p style={{ margin: '0 0 0.75rem', fontSize: 12, color: colors.muted }}>
        Máx. 10MB. Aceito: PDF, imagens, planilhas, doc, csv.
      </p>
      <input
        type="file"
        data-testid="doc-upload"
        onChange={handleFile}
        disabled={uploading}
        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.doc,.docx,.csv,.txt"
      />
      {uploading && <span style={{ marginLeft: '0.5rem', color: colors.muted, fontSize: 13 }}>Enviando…</span>}
      {uploadError && (
        <p data-testid="upload-error" style={{ color: colors.danger, fontSize: 13 }}>
          {uploadError}
        </p>
      )}

      <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: 15 }}>Documentos anexados</h3>
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && docs.length === 0}
        emptyMessage="Sem documentos. Envie o primeiro acima."
        onRetry={refetch}
      >
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {docs.map((d) => (
            <li
              key={d.id}
              style={{
                background: '#fafbfc',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span style={{ fontSize: 20 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.nome}
                </div>
                <div style={{ fontSize: 11, color: colors.muted }}>
                  {fmtSize(d.tamanho)} · {d.mimetype} · {fmtDate(d.criadoEm)}
                  {d.uploadedBy && ` · por ${d.uploadedBy.nome}`}
                </div>
              </div>
              <button
                type="button"
                data-testid={`doc-download-${d.id}`}
                onClick={() => downloadDoc(d.id)}
                style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
              >
                Baixar
              </button>
              <button
                type="button"
                data-testid={`doc-del-${d.id}`}
                onClick={() => delDoc(d.id)}
                style={{ ...btnDanger, padding: '0.25rem 0.625rem', fontSize: 12 }}
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
    <div style={card}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>Preços negociados</h3>
        <button
          type="button"
          data-testid="preco-add"
          onClick={() => setAdding(true)}
          style={btn}
        >
          + Novo preço especial
        </button>
      </header>

      <p style={{ fontSize: 12, color: colors.muted, marginTop: 0 }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: '0.5rem' }}>
          <thead>
            <tr>
              <th style={thStyle}>Produto</th>
              <th style={thStyle}>Preço tabela</th>
              <th style={thStyle}>Preço especial</th>
              <th style={thStyle}>Desconto base</th>
              <th style={thStyle}>Válido até</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {precos.map((p) => (
              <tr key={p.produtoId}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{p.produto?.nome ?? '—'}</div>
                  {p.produto?.sku && (
                    <div style={{ fontSize: 11, color: colors.muted }}>{p.produto.sku}</div>
                  )}
                </td>
                <td style={tdStyle}>{p.produto?.precoTabela !== undefined ? fmtBRL(p.produto.precoTabela) : '—'}</td>
                <td style={tdStyle}>
                  <strong>{fmtBRL(p.precoEspecial)}</strong>
                </td>
                <td style={tdStyle}>{p.descontoBase}%</td>
                <td style={tdStyle}>{p.validoAte ? fmtDate(p.validoAte) : 'sem expiração'}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    data-testid={`preco-del-${p.produtoId}`}
                    onClick={() => delPreco(p.produtoId)}
                    style={{ ...btnDanger, padding: '0.125rem 0.5rem', fontSize: 11 }}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 11,
  textTransform: 'uppercase',
  color: colors.muted,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem',
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'middle',
};

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
    <Modal
      open
      onClose={onClose}
      title="Novo preço especial"
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="preco-form"
            data-testid="preco-save"
            disabled={busy}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
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
          <div
            style={{
              fontSize: 13,
              padding: '0.5rem 0.75rem',
              background: '#fafbfc',
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              marginTop: '0.5rem',
            }}
          >
            Diferença vs. tabela:{' '}
            <strong style={{ color: Number(desconto) > 0 ? colors.success : colors.danger }}>
              {Number(desconto) > 0 ? `−${desconto}%` : `+${(-Number(desconto)).toFixed(1)}%`}
            </strong>
          </div>
        )}
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
