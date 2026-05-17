import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type PropostaStatus =
  | 'RASCUNHO'
  | 'ENVIADA'
  | 'NEGOCIACAO'
  | 'AGUARDANDO_ASSINATURA'
  | 'ACEITA'
  | 'RECUSADA'
  | 'EXPIRADA';

type PagamentoForma = 'BOLETO' | 'PIX' | 'TED' | 'CARTAO' | 'DINHEIRO';
type CondicaoPgto = 'avista' | '15dias' | '30dias' | '30_60' | '30_60_90';

interface Proposta {
  id: string;
  numero: string | number;
  status: PropostaStatus;
  valor: number;
  probabilidade: number;
  validoAte?: string | null;
  cliente?: { id: string; nome: string };
  representante?: { id: string; nome: string };
  criadoEm: string;
  pedidoId?: string | null;
}

interface PropostaItemDetail {
  id: string;
  produto?: { id: string; nome: string; sku?: string };
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  total: number;
}

interface PropostaDetail extends Proposta {
  subtotal?: number;
  descontoTotal?: number;
  descontoGeral?: number;
  formaPagamento?: PagamentoForma;
  condicaoPagamento?: CondicaoPgto;
  observacoes?: string | null;
  prazoEntrega?: string | null;
  itens?: PropostaItemDetail[];
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

interface ProdutoOpt {
  id: string;
  nome: string;
  sku?: string | null;
  precoTabela?: number;
}

const STATUS_COLOR: Record<PropostaStatus, string> = {
  RASCUNHO: colors.muted,
  ENVIADA: '#0891b2',
  NEGOCIACAO: colors.warning,
  AGUARDANDO_ASSINATURA: '#7c3aed',
  ACEITA: colors.success,
  RECUSADA: colors.danger,
  EXPIRADA: colors.muted,
};

const STATUS_LABEL: Record<PropostaStatus, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  NEGOCIACAO: 'Em negociação',
  AGUARDANDO_ASSINATURA: 'Aguardando assinatura',
  ACEITA: 'Aceita',
  RECUSADA: 'Recusada',
  EXPIRADA: 'Expirada',
};

const STATUS_LIST: PropostaStatus[] = [
  'RASCUNHO',
  'ENVIADA',
  'NEGOCIACAO',
  'AGUARDANDO_ASSINATURA',
  'ACEITA',
  'RECUSADA',
  'EXPIRADA',
];

const CONDICOES: { value: CondicaoPgto; label: string }[] = [
  { value: 'avista', label: 'À vista' },
  { value: '15dias', label: '15 dias' },
  { value: '30dias', label: '30 dias' },
  { value: '30_60', label: '30/60' },
  { value: '30_60_90', label: '30/60/90' },
];

const FORMAS: PagamentoForma[] = ['BOLETO', 'PIX', 'TED', 'CARTAO', 'DINHEIRO'];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

export default function PropostasPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (status) qs.set('status', status);
    return `/propostas?${qs.toString()}`;
  }, [page, search, status]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Proposta>>(listPath);

  const columns: Column<Proposta>[] = [
    {
      key: 'numero',
      header: 'Proposta',
      render: (p) => <strong>#{p.numero}</strong>,
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (p) => p.cliente?.nome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'rep',
      header: 'Rep',
      render: (p) => p.representante?.nome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (p) => <strong>{fmtBRL(p.valor)}</strong>,
    },
    {
      key: 'prob',
      header: 'Prob.',
      render: (p) => `${p.probabilidade}%`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <span style={badge(STATUS_COLOR[p.status])}>{STATUS_LABEL[p.status]}</span>,
    },
    {
      key: 'validade',
      header: 'Validade',
      render: (p) => fmtDate(p.validoAte),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <button
          type="button"
          data-testid={`proposta-open-${p.id}`}
          onClick={() => setSelected(p.id)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Propostas"
      actions={
        <button
          type="button"
          data-testid="proposta-new-btn"
          onClick={() => setCreating(true)}
          style={btn}
        >
          + Nova proposta
        </button>
      }
    >
      <div style={card}>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Cliente, número…"
          />
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            {STATUS_LIST.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma proposta encontrada."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(p) => p.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <PropostaDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
      {creating && (
        <PropostaFormModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Detalhe ──────────────────────────────────────────────────────────

const TRANSITIONS: Partial<Record<PropostaStatus, PropostaStatus[]>> = {
  RASCUNHO: ['ENVIADA', 'EXPIRADA'],
  ENVIADA: ['NEGOCIACAO', 'AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA'],
  NEGOCIACAO: ['AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA'],
  AGUARDANDO_ASSINATURA: ['ACEITA', 'RECUSADA', 'EXPIRADA'],
};

function PropostaDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<PropostaDetail>(`/propostas/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transition, setTransition] = useState<PropostaStatus | null>(null);
  const [motivo, setMotivo] = useState('');

  async function doTransition() {
    if (!transition) return;
    setBusy(true);
    setActionError(null);
    try {
      const payload: Record<string, unknown> = { status: transition };
      if (motivo.trim()) payload.motivo = motivo.trim();
      await api.put(`/propostas/${id}/status`, payload);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao mudar status');
      refetch();
    } finally {
      setBusy(false);
    }
  }

  async function doConverter() {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/propostas/${id}/converter-em-pedido`);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao converter');
      refetch();
    } finally {
      setBusy(false);
    }
  }

  const allowed = data ? TRANSITIONS[data.status] ?? [] : [];
  const exigeMotivo = transition === 'RECUSADA';

  return (
    <Modal
      open
      onClose={onClose}
      width={680}
      title={data ? `Proposta #${data.numero}` : 'Proposta'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {data?.status === 'ACEITA' && !data.pedidoId && (
            <button
              type="button"
              data-testid="proposta-converter"
              disabled={busy}
              onClick={doConverter}
              style={btn}
            >
              {busy ? 'Convertendo…' : 'Converter em pedido'}
            </button>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
              <span style={{ color: colors.muted, fontSize: 13 }}>
                Criada em {fmtDate(data.criadoEm)}
              </span>
              {data.pedidoId && (
                <span style={{ ...badge(colors.success), marginLeft: 'auto' }}>
                  Pedido gerado
                </span>
              )}
            </div>

            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem',
                fontSize: 14,
              }}
            >
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="Representante">{data.representante?.nome ?? '—'}</Info>
              <Info label="Subtotal">
                {data.subtotal !== undefined ? fmtBRL(data.subtotal) : '—'}
              </Info>
              <Info label="Desconto total">
                {data.descontoTotal !== undefined ? fmtBRL(data.descontoTotal) : '—'}
              </Info>
              <Info label="Valor">
                <strong>{fmtBRL(data.valor)}</strong>
              </Info>
              <Info label="Probabilidade">{data.probabilidade}%</Info>
              <Info label="Validade">{fmtDate(data.validoAte)}</Info>
              <Info label="Pagamento">
                {data.formaPagamento} · {data.condicaoPagamento}
              </Info>
            </dl>

            {data.itens && data.itens.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3 style={{ fontSize: 14, marginBottom: '0.5rem' }}>Itens</h3>
                <Table
                  data={data.itens}
                  rowKey={(i) => i.id}
                  columns={[
                    {
                      key: 'produto',
                      header: 'Produto',
                      render: (i) => i.produto?.nome ?? '—',
                    },
                    { key: 'qt', header: 'Qt', render: (i) => i.quantidade },
                    {
                      key: 'unit',
                      header: 'Unit',
                      render: (i) => fmtBRL(i.precoUnitario),
                    },
                    {
                      key: 'desc',
                      header: 'Desc%',
                      render: (i) => `${i.desconto}%`,
                    },
                    {
                      key: 'tot',
                      header: 'Total',
                      render: (i) => <strong>{fmtBRL(i.total)}</strong>,
                    },
                  ]}
                />
              </div>
            )}

            {data.observacoes && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  Observações
                </h3>
                <p style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{data.observacoes}</p>
              </div>
            )}

            {allowed.length > 0 && (
              <div
                style={{
                  marginTop: '1.25rem',
                  paddingTop: '1rem',
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: 14 }}>Mudar status</h3>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {allowed.map((s) => (
                    <button
                      key={s}
                      type="button"
                      data-testid={`proposta-status-${s}`}
                      onClick={() => setTransition(s)}
                      style={{
                        ...btnSecondary,
                        padding: '0.25rem 0.625rem',
                        fontSize: 12,
                        borderColor: transition === s ? STATUS_COLOR[s] : undefined,
                      }}
                    >
                      → {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                {transition && (
                  <div style={{ marginTop: '0.75rem' }}>
                    {exigeMotivo && (
                      <FormField
                        label="Motivo"
                        htmlFor="prop-motivo"
                        required
                        hint="Obrigatório ao recusar"
                      >
                        <Textarea
                          id="prop-motivo"
                          data-testid="proposta-motivo-input"
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                        />
                      </FormField>
                    )}
                    <button
                      type="button"
                      data-testid="proposta-status-confirm"
                      disabled={busy || (exigeMotivo && motivo.trim().length === 0)}
                      onClick={doTransition}
                      style={{ ...btn, opacity: busy ? 0.7 : 1 }}
                    >
                      {busy ? 'Aplicando…' : 'Confirmar mudança'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {actionError && (
              <div
                data-testid="action-error"
                style={{
                  ...card,
                  borderColor: colors.danger,
                  color: colors.danger,
                  padding: '0.5rem 0.75rem',
                  marginTop: '0.75rem',
                }}
              >
                {actionError}
              </div>
            )}
          </div>
        )}
      </StateView>
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          color: colors.muted,
          marginBottom: 2,
          letterSpacing: 0.3,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─── Create form ─────────────────────────────────────────────────────

interface FormItem {
  /** UI-local id pra remover linha (não vai pro backend) */
  uiKey: string;
  produto: ProdutoOpt | null;
  quantidade: number;
  desconto: number;
  precoUnitarioOverride: string; // string pra deixar input vazio
}

function newFormItem(): FormItem {
  return {
    uiKey: Math.random().toString(36).slice(2),
    produto: null,
    quantidade: 1,
    desconto: 0,
    precoUnitarioOverride: '',
  };
}

function PropostaFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [itens, setItens] = useState<FormItem[]>([newFormItem()]);
  const [formaPagamento, setFormaPagamento] = useState<PagamentoForma>('BOLETO');
  const [condicaoPagamento, setCondicaoPagamento] = useState<CondicaoPgto>('30dias');
  const [descontoGeral, setDescontoGeral] = useState(0);
  const [probabilidade, setProbabilidade] = useState(50);
  const [validoAte, setValidoAte] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setItem(idx: number, patch: Partial<FormItem>) {
    setItens((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItens((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));
  }
  function addItem() {
    setItens((arr) => [...arr, newFormItem()]);
  }

  // Total estimado (preview client-side; backend recalcula)
  const subtotal = itens.reduce((acc, it) => {
    if (!it.produto) return acc;
    const unit =
      it.precoUnitarioOverride.trim()
        ? Number(it.precoUnitarioOverride) || 0
        : it.produto.precoTabela ?? 0;
    const bruto = unit * it.quantidade;
    return acc + bruto * (1 - it.desconto / 100);
  }, 0);
  const totalComDescGeral = subtotal * (1 - descontoGeral / 100);

  const valid =
    cliente !== null &&
    itens.length > 0 &&
    itens.every((it) => it.produto !== null && it.quantidade >= 1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente || !valid) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      clienteId: cliente.id,
      itens: itens.map((it) => {
        const obj: Record<string, unknown> = {
          produtoId: it.produto!.id,
          quantidade: it.quantidade,
          desconto: it.desconto,
        };
        if (it.precoUnitarioOverride.trim()) {
          obj.precoUnitarioOverride = Number(it.precoUnitarioOverride);
        }
        return obj;
      }),
      formaPagamento,
      condicaoPagamento,
      descontoGeral,
      probabilidade,
    };
    if (validoAte) payload.validoAte = validoAte;
    if (observacoes.trim()) payload.observacoes = observacoes.trim();

    try {
      await api.post('/propostas', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar proposta');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title="Nova proposta"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="proposta-form"
            data-testid="proposta-save-btn"
            disabled={busy || !valid}
            style={{ ...btn, opacity: busy || !valid ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Criar como rascunho'}
          </button>
        </>
      }
    >
      <form id="proposta-form" onSubmit={submit}>
        <FormField label="Cliente" required>
          <AsyncCombobox<ClienteOpt>
            testId="cliente-picker"
            endpoint="/clientes"
            placeholder="Buscar cliente por nome ou CNPJ…"
            getLabel={(c) => c.nome}
            getSubLabel={(c) => c.cnpj ?? null}
            getId={(c) => c.id}
            value={cliente}
            onChange={setCliente}
          />
        </FormField>

        <h3 style={{ fontSize: 14, margin: '0.75rem 0 0.5rem' }}>Itens</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {itens.map((it, idx) => (
            <ItemRow
              key={it.uiKey}
              item={it}
              onChange={(patch) => setItem(idx, patch)}
              onRemove={itens.length > 1 ? () => removeItem(idx) : null}
              testId={`item-${idx}`}
            />
          ))}
        </div>
        <button
          type="button"
          data-testid="proposta-add-item"
          onClick={addItem}
          style={{ ...btnSecondary, marginTop: '0.5rem', fontSize: 13 }}
        >
          + Adicionar item
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginTop: '1rem' }}>
          <FormField label="Forma de pagamento" htmlFor="prop-forma">
            <Select
              id="prop-forma"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value as PagamentoForma)}
            >
              {FORMAS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Condição" htmlFor="prop-cond">
            <Select
              id="prop-cond"
              value={condicaoPagamento}
              onChange={(e) => setCondicaoPagamento(e.target.value as CondicaoPgto)}
            >
              {CONDICOES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Validade" htmlFor="prop-validade">
            <Input
              id="prop-validade"
              type="date"
              value={validoAte}
              onChange={(e) => setValidoAte(e.target.value)}
            />
          </FormField>
          <FormField label="Desconto geral (%)" htmlFor="prop-dg">
            <Input
              id="prop-dg"
              type="number"
              min={0}
              max={50}
              step="0.1"
              value={descontoGeral}
              onChange={(e) => setDescontoGeral(Number(e.target.value))}
            />
          </FormField>
          <FormField label="Probabilidade (%)" htmlFor="prop-prob">
            <Input
              id="prop-prob"
              type="number"
              min={0}
              max={100}
              value={probabilidade}
              onChange={(e) => setProbabilidade(Number(e.target.value))}
            />
          </FormField>
        </div>
        <FormField label="Observações" htmlFor="prop-obs">
          <Textarea
            id="prop-obs"
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Notas internas, prazos especiais…"
          />
        </FormField>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem',
            background: '#fafbfc',
            borderRadius: 6,
            marginTop: '0.5rem',
            border: `1px solid ${colors.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: colors.muted }}>Total estimado</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtBRL(totalComDescGeral)}</div>
          </div>
          <div style={{ fontSize: 12, color: colors.muted, textAlign: 'right' }}>
            Subtotal: {fmtBRL(subtotal)}
            <br />
            Backend recalcula no save.
          </div>
        </div>

        {error && (
          <p
            data-testid="form-error"
            style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function ItemRow({
  item,
  onChange,
  onRemove,
  testId,
}: {
  item: FormItem;
  onChange: (patch: Partial<FormItem>) => void;
  onRemove: (() => void) | null;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 70px 70px 90px 32px',
        gap: '0.5rem',
        alignItems: 'start',
        padding: '0.5rem',
        background: '#fafbfc',
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
      }}
    >
      <AsyncCombobox<ProdutoOpt>
        testId={`${testId}-produto`}
        endpoint="/produtos"
        placeholder="Buscar produto…"
        getLabel={(p) => p.nome}
        getSubLabel={(p) =>
          [p.sku, p.precoTabela !== undefined ? fmtBRL(p.precoTabela) : null]
            .filter(Boolean)
            .join(' · ')
        }
        getId={(p) => p.id}
        value={item.produto}
        onChange={(p) => onChange({ produto: p })}
      />
      <Input
        type="number"
        min={1}
        value={item.quantidade}
        onChange={(e) => onChange({ quantidade: Math.max(1, Number(e.target.value)) })}
        data-testid={`${testId}-qt`}
        aria-label="Quantidade"
      />
      <Input
        type="number"
        min={0}
        max={80}
        step="0.1"
        value={item.desconto}
        onChange={(e) => onChange({ desconto: Number(e.target.value) })}
        data-testid={`${testId}-desc`}
        aria-label="Desconto %"
        placeholder="% desc"
      />
      <Input
        type="number"
        min={0}
        step="0.01"
        value={item.precoUnitarioOverride}
        onChange={(e) => {
          // Aceita só dígitos, ponto/vírgula e vazio. Normaliza vírgula→ponto.
          const v = e.target.value.replace(',', '.');
          if (v === '' || /^\d*\.?\d*$/.test(v)) {
            onChange({ precoUnitarioOverride: v });
          }
        }}
        onBlur={(e) => {
          // Clamp negativo a 0; ignora NaN/vazio.
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n < 0) {
            onChange({ precoUnitarioOverride: '0' });
          }
        }}
        data-testid={`${testId}-override`}
        aria-label="Preço override"
        placeholder="preço"
      />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          data-testid={`${testId}-remove`}
          style={{ ...btnDanger, padding: '0.5rem', fontSize: 16, lineHeight: 1 }}
          aria-label="Remover item"
        >
          ×
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
