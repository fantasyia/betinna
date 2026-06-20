import { useMemo, useState } from 'react';
import { api, apiErrorMessage, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { useToast } from '@/components/toast';

type DevolucaoStatus =
  | 'ABERTA'
  | 'EM_ANALISE'
  | 'APROVADA'
  | 'NF_DEVOLUCAO_EMITIDA'
  | 'COLETA_AGENDADA'
  | 'COLETADA'
  | 'RESOLVIDA'
  | 'RECUSADA';

interface Devolucao {
  id: string;
  numero: string;
  pedidoId: string;
  motivo: string;
  status: DevolucaoStatus;
  itensDescricao?: string | null;
  observacao?: string | null;
  slaAnaliseEm?: string | null;
  aprovadorNome?: string | null;
  motivoRecusa?: string | null;
  criadoPorNome?: string | null;
  criadoEm: string;
}

interface Motivo {
  key: string;
  label: string;
  fotosObrigatorias?: boolean;
}

const STATUS_LABEL: Record<DevolucaoStatus, string> = {
  ABERTA: 'Aberta',
  EM_ANALISE: 'Em análise',
  APROVADA: 'Aprovada',
  NF_DEVOLUCAO_EMITIDA: 'NF emitida',
  COLETA_AGENDADA: 'Coleta agendada',
  COLETADA: 'Coletada',
  RESOLVIDA: 'Resolvida',
  RECUSADA: 'Recusada',
};
const STATUS_COLOR: Record<DevolucaoStatus, string> = {
  ABERTA: 'var(--warning)',
  EM_ANALISE: 'var(--info)',
  APROVADA: 'var(--success)',
  NF_DEVOLUCAO_EMITIDA: 'var(--info)',
  COLETA_AGENDADA: 'var(--info)',
  COLETADA: 'var(--info)',
  RESOLVIDA: 'var(--success)',
  RECUSADA: 'var(--danger)',
};
const TRANSICOES: Record<DevolucaoStatus, DevolucaoStatus[]> = {
  ABERTA: ['EM_ANALISE', 'RECUSADA'],
  EM_ANALISE: ['APROVADA', 'RECUSADA'],
  APROVADA: ['NF_DEVOLUCAO_EMITIDA'],
  NF_DEVOLUCAO_EMITIDA: ['COLETA_AGENDADA'],
  COLETA_AGENDADA: ['COLETADA'],
  COLETADA: ['RESOLVIDA'],
  RESOLVIDA: [],
  RECUSADA: [],
};
const DEFAULT_MOTIVOS: Motivo[] = [
  { key: 'avaria_transporte', label: 'Avaria no transporte' },
  { key: 'validade_proxima', label: 'Validade próxima' },
  { key: 'erro_produto', label: 'Erro de produto' },
  { key: 'qualidade', label: 'Qualidade' },
  { key: 'recusa_cliente', label: 'Recusa do cliente' },
  { key: 'outros', label: 'Outros' },
];

const BADGE = 'inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold text-white';
const badge = (c: string) => ({ backgroundColor: c });

export default function DevolucoesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [criando, setCriando] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: cfg } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const motivos = useMemo<Motivo[]>(() => {
    const m = (cfg?.devolucaoInterna as { motivos?: Motivo[] } | undefined)?.motivos;
    return m && m.length > 0 ? m : DEFAULT_MOTIVOS;
  }, [cfg]);
  const motivoLabel = (k: string) => motivos.find((m) => m.key === k)?.label ?? k;

  const listPath = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: '50' });
    if (status) p.set('status', status);
    return `/devolucoes?${p.toString()}`;
  }, [page, status]);
  const { data: resp, loading, error, refetch } = useApiQuery<PaginatedResponse<Devolucao>>(listPath);

  const columns: Column<Devolucao>[] = [
    { key: 'numero', header: 'Número', render: (d) => <span className="font-semibold">{d.numero}</span> },
    { key: 'motivo', header: 'Motivo', render: (d) => motivoLabel(d.motivo) },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <span className={BADGE} style={badge(STATUS_COLOR[d.status])}>
          {STATUS_LABEL[d.status]}
        </span>
      ),
    },
    { key: 'rep', header: 'Aberta por', render: (d) => d.criadoPorNome ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (d) => (
        <button
          type="button"
          data-testid={`devolucao-open-${d.id}`}
          onClick={() => setSelected(d.id)}
          className="bg-surface text-text border border-border-strong rounded-md font-medium cursor-pointer px-2.5 py-1 text-[12px]"
        >
          Abrir
        </button>
      ),
    },
  ];

  return (
    <PageLayout
      title="Devoluções"
      actions={
        <button
          type="button"
          data-testid="devolucao-new-btn"
          onClick={() => setCriando(true)}
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer"
        >
          + Nova devolução
        </button>
      }
    >
      <VendasTabs />
      <div className="bg-surface border border-border rounded-[10px] p-6">
        <FilterBar>
          <Select
            data-testid="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os status</option>
            {(Object.keys(STATUS_LABEL) as DevolucaoStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!resp || resp.data.length === 0}
          emptyMessage="Nenhuma devolução registrada."
          onRetry={refetch}
        >
          {resp && (
            <>
              <Table data={resp.data} columns={columns} rowKey={(d) => d.id} />
              <Pagination pagination={resp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {criando && (
        <AbrirDialog
          motivos={motivos}
          onClose={() => setCriando(false)}
          onCreated={() => {
            setCriando(false);
            refetch();
          }}
        />
      )}
      {selected && (
        <DetailDialog
          id={selected}
          motivoLabel={motivoLabel}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

interface PedidoOpt {
  id: string;
  numero: string;
  cliente?: { nome: string } | null;
}

function AbrirDialog({
  motivos,
  onClose,
  onCreated,
}: {
  motivos: Motivo[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [pedido, setPedido] = useState<PedidoOpt | null>(null);
  const [motivo, setMotivo] = useState(motivos[0]?.key ?? 'outros');
  const [itens, setItens] = useState('');
  const [obs, setObs] = useState('');
  const [busy, setBusy] = useState(false);

  async function salvar() {
    if (!pedido) {
      toast.error('Selecione o pedido');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { pedidoId: pedido.id, motivo };
      if (itens.trim()) payload.itensDescricao = itens.trim();
      if (obs.trim()) payload.observacao = obs.trim();
      await api.post('/devolucoes', payload);
      toast.success('Devolução aberta');
      onCreated();
    } catch (err) {
      toast.error('Falha ao abrir', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nova devolução"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="devolucao-abrir-confirm"
            disabled={busy}
            onClick={salvar}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Abrindo…' : 'Abrir devolução'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Pedido" required>
          <AsyncCombobox<PedidoOpt>
            testId="devolucao-pedido-picker"
            endpoint="/pedidos"
            placeholder="Buscar pedido…"
            getLabel={(p) => p.numero}
            getSubLabel={(p) => p.cliente?.nome ?? null}
            getId={(p) => p.id}
            value={pedido}
            onChange={setPedido}
          />
        </FormField>
        <FormField label="Motivo" htmlFor="dev-motivo">
          <Select id="dev-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {motivos.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {m.fotosObrigatorias ? ' (exige foto)' : ''}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Itens / quantidade (opcional)" htmlFor="dev-itens">
          <Textarea id="dev-itens" value={itens} onChange={(e) => setItens(e.target.value)} />
        </FormField>
        <FormField label="Observação (opcional)" htmlFor="dev-obs">
          <Textarea id="dev-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
        </FormField>
      </div>
    </Dialog>
  );
}

function DetailDialog({
  id,
  motivoLabel,
  onClose,
  onChanged,
}: {
  id: string;
  motivoLabel: (k: string) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const role = useRole();
  const podeDecidir = role === 'ADMIN' || role === 'DIRECTOR';
  const { data, loading, error, refetch } = useApiQuery<Devolucao>(`/devolucoes/${id}`);
  const [busy, setBusy] = useState(false);
  const [recusando, setRecusando] = useState<DevolucaoStatus | null>(null);
  const [motivoRecusa, setMotivoRecusa] = useState('');

  async function mudar(status: DevolucaoStatus, motivoRec?: string) {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { status };
      if (motivoRec) payload.motivoRecusa = motivoRec;
      await api.put(`/devolucoes/${id}/status`, payload);
      toast.success(`Devolução → ${STATUS_LABEL[status]}`);
      onChanged();
    } catch (err) {
      toast.error('Falha ao atualizar', err instanceof ApiError ? err.message : apiErrorMessage(err));
      refetch();
    } finally {
      setBusy(false);
    }
  }

  const proximos = data ? TRANSICOES[data.status] : [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={data ? `Devolução ${data.numero}` : 'Devolução'}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer"
        >
          Fechar
        </button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <div className="mb-3">
              <span className={BADGE} style={badge(STATUS_COLOR[data.status])}>
                {STATUS_LABEL[data.status]}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Motivo">{motivoLabel(data.motivo)}</Info>
              <Info label="Aberta por">{data.criadoPorNome ?? '—'}</Info>
              <Info label="SLA análise">
                {data.slaAnaliseEm ? new Date(data.slaAnaliseEm).toLocaleDateString('pt-BR') : '—'}
              </Info>
              <Info label="Decidido por">{data.aprovadorNome ?? '—'}</Info>
              {data.itensDescricao && <Info label="Itens">{data.itensDescricao}</Info>}
              {data.observacao && <Info label="Observação">{data.observacao}</Info>}
              {data.status === 'RECUSADA' && data.motivoRecusa && (
                <Info label="Motivo da recusa">{data.motivoRecusa}</Info>
              )}
            </dl>

            {podeDecidir && proximos.length > 0 && (
              <div className="border-t border-border mt-4 pt-4">
                <h3 className="mt-0 text-sm">Avançar lifecycle</h3>
                {recusando ? (
                  <div className="mt-1">
                    <FormField label="Motivo da recusa" htmlFor="dev-rec">
                      <Textarea
                        id="dev-rec"
                        data-testid="devolucao-recusa-motivo"
                        value={motivoRecusa}
                        onChange={(e) => setMotivoRecusa(e.target.value)}
                      />
                    </FormField>
                    <div className="flex gap-1 mt-2">
                      <button
                        type="button"
                        onClick={() => setRecusando(null)}
                        className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer"
                      >
                        Voltar
                      </button>
                      <button
                        type="button"
                        data-testid="devolucao-recusa-confirm"
                        disabled={busy || motivoRecusa.trim().length < 3}
                        onClick={() => mudar('RECUSADA', motivoRecusa.trim())}
                        className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:opacity-60"
                      >
                        Confirmar recusa
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1 flex-wrap">
                    {proximos.map((s) => (
                      <button
                        key={s}
                        type="button"
                        data-testid={`devolucao-to-${s}`}
                        disabled={busy}
                        onClick={() => (s === 'RECUSADA' ? setRecusando(s) : mudar(s))}
                        className="bg-surface text-text border border-border-strong rounded-md font-medium cursor-pointer px-2.5 py-1 text-[12px] disabled:opacity-60"
                        style={{ borderColor: STATUS_COLOR[s] }}
                      >
                        → {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </StateView>
    </Dialog>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted uppercase tracking-wide">{label}</dt>
      <dd className="m-0 text-sm">{children}</dd>
    </div>
  );
}
