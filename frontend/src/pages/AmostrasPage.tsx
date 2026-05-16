import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { badge, btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

type AmostraStatus =
  | 'ENVIADA'
  | 'AGUARDANDO_FOLLOWUP'
  | 'CONVERTIDA'
  | 'NAO_CONVERTEU'
  | 'VENCIDA';

interface Amostra {
  id: string;
  produtoNome: string;
  valor: number;
  notaFiscal?: string | null;
  enviadoEm?: string | null;
  followUpEm?: string | null;
  status: AmostraStatus;
  representanteNome?: string | null;
  cliente?: { id: string; nome: string };
}

interface ClienteOpt {
  id: string;
  nome: string;
  cnpj?: string | null;
}

const STATUS_COLOR: Record<AmostraStatus, string> = {
  ENVIADA: '#0891b2',
  AGUARDANDO_FOLLOWUP: colors.warning,
  CONVERTIDA: colors.success,
  NAO_CONVERTEU: colors.danger,
  VENCIDA: colors.muted,
};
const STATUS_LABEL: Record<AmostraStatus, string> = {
  ENVIADA: 'Enviada',
  AGUARDANDO_FOLLOWUP: 'Aguardando follow-up',
  CONVERTIDA: 'Convertida',
  NAO_CONVERTEU: 'Não converteu',
  VENCIDA: 'Vencida',
};
const STATUS_LIST: AmostraStatus[] = [
  'ENVIADA',
  'AGUARDANDO_FOLLOWUP',
  'CONVERTIDA',
  'NAO_CONVERTEU',
  'VENCIDA',
];

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
function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86400000);
}

export default function AmostrasPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [vencidas, setVencidas] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) qs.set('status', status);
    if (vencidas) qs.set('vencidas', vencidas);
    return `/amostras?${qs.toString()}`;
  }, [page, status, vencidas]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Amostra>>(listPath);

  const columns: Column<Amostra>[] = [
    {
      key: 'produto',
      header: 'Produto',
      render: (a) => (
        <div>
          <div style={{ fontWeight: 600 }}>{a.produtoNome}</div>
          {a.notaFiscal && (
            <div style={{ fontSize: 11, color: colors.muted }}>NF {a.notaFiscal}</div>
          )}
        </div>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (a) => a.cliente?.nome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'rep',
      header: 'Representante',
      render: (a) => a.representanteNome ?? <em style={{ color: colors.muted }}>—</em>,
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (a) => fmtBRL(a.valor),
    },
    {
      key: 'enviado',
      header: 'Enviada em',
      render: (a) => fmtDate(a.enviadoEm),
    },
    {
      key: 'followup',
      header: 'Follow-up',
      render: (a) => {
        const dd = daysUntil(a.followUpEm);
        if (a.followUpEm === null || a.followUpEm === undefined) return '—';
        if (dd === null) return fmtDate(a.followUpEm);
        if (['CONVERTIDA', 'NAO_CONVERTEU'].includes(a.status)) {
          return fmtDate(a.followUpEm);
        }
        return (
          <div>
            <div>{fmtDate(a.followUpEm)}</div>
            <div
              style={{
                fontSize: 11,
                color: dd < 0 ? colors.danger : dd <= 2 ? colors.warning : colors.muted,
              }}
            >
              {dd < 0 ? `${-dd}d atrasado` : dd === 0 ? 'hoje' : `em ${dd}d`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <span style={badge(STATUS_COLOR[a.status])}>{STATUS_LABEL[a.status]}</span>,
    },
    {
      key: 'actions',
      header: '',
      render: (a) => (
        <button
          type="button"
          data-testid={`amostra-open-${a.id}`}
          onClick={() => setSelected(a.id)}
          style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Amostras"
      actions={
        <button
          type="button"
          data-testid="amostra-new-btn"
          onClick={() => setCreating(true)}
          style={btn}
        >
          + Nova amostra
        </button>
      }
    >
      <div style={card}>
        <FilterBar>
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
          <Select
            data-testid="filter-vencidas"
            value={vencidas}
            onChange={(e) => {
              setVencidas(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos follow-ups</option>
            <option value="true">Apenas vencidos / atrasados</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma amostra encontrada."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(a) => a.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {selected && (
        <AmostraDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
      {creating && (
        <AmostraFormModal
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

// ─── Detail ───────────────────────────────────────────────────────────

function AmostraDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, loading, error, refetch } = useApiQuery<Amostra>(`/amostras/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [transition, setTransition] = useState<AmostraStatus | null>(null);
  const [obs, setObs] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  async function doTransition() {
    if (!transition) return;
    setBusy(true);
    setActionError(null);
    try {
      const payload: Record<string, unknown> = { status: transition };
      if (obs.trim()) payload.observacao = obs.trim();
      await api.put(`/amostras/${id}/status`, payload);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao mudar status');
      refetch();
    } finally {
      setBusy(false);
    }
  }
  async function doDelete() {
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(`/amostras/${id}`);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao excluir');
    } finally {
      setBusy(false);
    }
  }

  const TRANSITIONS: AmostraStatus[] = [
    'AGUARDANDO_FOLLOWUP',
    'CONVERTIDA',
    'NAO_CONVERTEU',
    'VENCIDA',
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={data ? `Amostra — ${data.produtoNome}` : 'Amostra'}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Fechar
          </button>
          {data && !confirmDel && (
            <button
              type="button"
              data-testid="amostra-delete"
              onClick={() => setConfirmDel(true)}
              style={btnDanger}
            >
              Excluir
            </button>
          )}
          {data && confirmDel && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                style={btnSecondary}
              >
                Voltar
              </button>
              <button
                type="button"
                data-testid="amostra-delete-confirm"
                disabled={busy}
                onClick={doDelete}
                style={btnDanger}
              >
                {busy ? '…' : 'Confirmar exclusão'}
              </button>
            </>
          )}
        </>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}
            >
              <span style={badge(STATUS_COLOR[data.status])}>{STATUS_LABEL[data.status]}</span>
              {data.followUpEm &&
                !['CONVERTIDA', 'NAO_CONVERTEU'].includes(data.status) && (
                  <span style={{ fontSize: 12, color: colors.muted }}>
                    Follow-up em {fmtDate(data.followUpEm)}
                  </span>
                )}
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: 14 }}>
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="Representante">{data.representanteNome ?? '—'}</Info>
              <Info label="Valor">{fmtBRL(data.valor)}</Info>
              <Info label="NF">{data.notaFiscal ?? '—'}</Info>
              <Info label="Enviada em">{fmtDate(data.enviadoEm)}</Info>
              <Info label="Follow-up em">{fmtDate(data.followUpEm)}</Info>
            </dl>

            <div
              style={{
                borderTop: `1px solid ${colors.border}`,
                marginTop: '1rem',
                paddingTop: '1rem',
              }}
            >
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Atualizar status</h3>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {TRANSITIONS.filter((s) => s !== data.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid={`amostra-status-${s}`}
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
                  <FormField label="Observação (opcional)" htmlFor="am-obs">
                    <Textarea
                      id="am-obs"
                      data-testid="amostra-obs-input"
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      placeholder="Cliente gostou do sabor X, vai considerar para próxima compra…"
                    />
                  </FormField>
                  <button
                    type="button"
                    data-testid="amostra-status-confirm"
                    disabled={busy}
                    onClick={doTransition}
                    style={{ ...btn, opacity: busy ? 0.7 : 1 }}
                  >
                    {busy ? 'Aplicando…' : `Marcar como ${STATUS_LABEL[transition]}`}
                  </button>
                </div>
              )}
            </div>

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

// ─── Create ──────────────────────────────────────────────────────────

function AmostraFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cliente, setCliente] = useState<ClienteOpt | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [valor, setValor] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');
  const [enviadoEm, setEnviadoEm] = useState('');
  const [diasFollowUp, setDiasFollowUp] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = cliente !== null && produtoNome.trim().length >= 2 && valor.trim() !== '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente || !valid) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      clienteId: cliente.id,
      produtoNome: produtoNome.trim(),
      valor: Number(valor),
      diasFollowUp,
    };
    if (notaFiscal.trim()) payload.notaFiscal = notaFiscal.trim();
    if (enviadoEm) payload.enviadoEm = enviadoEm;
    try {
      await api.post('/amostras', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar amostra');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova amostra"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="amostra-form"
            data-testid="amostra-save-btn"
            disabled={busy || !valid}
            style={{ ...btn, opacity: busy || !valid ? 0.6 : 1 }}
          >
            {busy ? 'Salvando…' : 'Criar'}
          </button>
        </>
      }
    >
      <form id="amostra-form" onSubmit={submit}>
        <FormField label="Cliente" required>
          <AsyncCombobox<ClienteOpt>
            testId="cliente-picker"
            endpoint="/clientes"
            placeholder="Buscar cliente…"
            getLabel={(c) => c.nome}
            getSubLabel={(c) => c.cnpj ?? null}
            getId={(c) => c.id}
            value={cliente}
            onChange={setCliente}
          />
        </FormField>
        <FormField label="Produto" htmlFor="am-prod" required hint="Pode digitar mesmo se não estiver no catálogo">
          <Input
            id="am-prod"
            data-testid="amostra-produto-input"
            value={produtoNome}
            onChange={(e) => setProdutoNome(e.target.value)}
            minLength={2}
            maxLength={200}
            required
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Valor" htmlFor="am-val" required>
            <Input
              id="am-val"
              data-testid="amostra-valor-input"
              type="number"
              min={0}
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Nota fiscal" htmlFor="am-nf">
            <Input
              id="am-nf"
              value={notaFiscal}
              onChange={(e) => setNotaFiscal(e.target.value)}
              placeholder="opcional"
            />
          </FormField>
          <FormField label="Enviada em" htmlFor="am-env">
            <Input
              id="am-env"
              type="date"
              value={enviadoEm}
              onChange={(e) => setEnviadoEm(e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Dias até follow-up" htmlFor="am-fu" hint="Quantos dias após o envio o sistema deve cobrar retorno do rep.">
          <Input
            id="am-fu"
            type="number"
            min={1}
            max={60}
            value={diasFollowUp}
            onChange={(e) => setDiasFollowUp(Number(e.target.value))}
          />
        </FormField>
        {error && (
          <p data-testid="form-error" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
