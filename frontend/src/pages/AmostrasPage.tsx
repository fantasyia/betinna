import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { AsyncCombobox } from '@/components/AsyncCombobox';
import { formatMoeda as fmtBRL } from '@/lib/masks';
import { cn } from '@/lib/cn';

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
  // P7 — remessa OMIE
  produtoId?: string | null;
  quantidade?: number;
  produto?: {
    id: string;
    nome: string;
    codigoOmie?: string | null;
    sku?: string | null;
    unidade?: string | null;
  } | null;
  cfop?: string | null;
  numeroOmie?: string | null;
  enviadoOmieEm?: string | null;
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
  codigoOmie?: string | null;
  unidade?: string | null;
}

const STATUS_COLOR: Record<AmostraStatus, string> = {
  ENVIADA: 'var(--info)',
  AGUARDANDO_FOLLOWUP: 'var(--warning)',
  CONVERTIDA: 'var(--success)',
  NAO_CONVERTEU: 'var(--danger)',
  VENCIDA: 'var(--muted)',
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

// badge com cor dinâmica (status) — layout via classes, cores via color-mix inline.
const BADGE_CLS =
  'inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]';
function badgeStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 19%, transparent)`,
  };
}

export default function AmostrasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [vencidas, setVencidas] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Auto-abre drawer quando vem com ?highlight=ID
  useEffect(() => {
    const highlight = searchParams.get('highlight');
    if (highlight && highlight !== selected) {
      setSelected(highlight);
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const clienteIdFilter = searchParams.get('clienteId') || '';

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) qs.set('status', status);
    if (vencidas) qs.set('vencidas', vencidas);
    if (clienteIdFilter) qs.set('clienteId', clienteIdFilter);
    return `/amostras?${qs.toString()}`;
  }, [page, status, vencidas, clienteIdFilter]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Amostra>>(listPath);

  const columns: Column<Amostra>[] = [
    {
      key: 'produto',
      header: 'Produto',
      render: (a) => (
        <div>
          <div className="font-semibold">{a.produtoNome}</div>
          {a.notaFiscal && (
            <div className="text-[11px] text-muted">NF {a.notaFiscal}</div>
          )}
        </div>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (a) => a.cliente?.nome ?? <em className="text-muted">—</em>,
    },
    {
      key: 'rep',
      header: 'Representante',
      render: (a) => a.representanteNome ?? <em className="text-muted">—</em>,
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
              className="text-[11px]"
              style={{
                color:
                  dd < 0
                    ? 'var(--danger)'
                    : dd <= 2
                      ? 'var(--warning)'
                      : 'var(--muted)',
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
      render: (a) => (
        <span className={BADGE_CLS} style={badgeStyle(STATUS_COLOR[a.status])}>
          {STATUS_LABEL[a.status]}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (a) => (
        <button
          type="button"
          data-testid={`amostra-open-${a.id}`}
          onClick={() => setSelected(a.id)}
          className="bg-surface text-text border border-border-strong rounded-md font-medium cursor-pointer tracking-[-0.1px] px-2.5 py-1 text-[12px]"
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
          className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
        >
          + Nova amostra
        </button>
      }
    >
      <VendasTabs />
      {clienteIdFilter && (
        <div
          data-testid="amostras-cliente-filter-banner"
          className="mb-3 py-2 px-3 rounded-md bg-[#eaf0fb] border border-info text-text text-[13px] flex items-center gap-2"
        >
          <span className="flex-1">Filtrando amostras de um cliente específico.</span>
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('clienteId');
              setSearchParams(next, { replace: true });
            }}
            className="bg-surface text-text border border-border-strong rounded-md font-medium cursor-pointer tracking-[-0.1px] px-2.5 py-1 text-[12px]"
          >
            Ver todas
          </button>
        </div>
      )}
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
  // P7 — envia a amostra como remessa de amostra grátis pro OMIE
  async function doEnviarOmie() {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/amostras/${id}/enviar-omie`);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Falha ao enviar remessa ao OMIE');
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
    <Dialog
      open
      onClose={onClose}
      title={data ? `Amostra — ${data.produtoNome}` : 'Amostra'}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Fechar
          </button>
          {data && !confirmDel && (
            <button
              type="button"
              data-testid="amostra-delete"
              onClick={() => setConfirmDel(true)}
              className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              Excluir
            </button>
          )}
          {data && confirmDel && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
              >
                Voltar
              </button>
              <button
                type="button"
                data-testid="amostra-delete-confirm"
                disabled={busy}
                onClick={doDelete}
                className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
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
            <div className="flex items-center gap-2 mb-4">
              <span className={BADGE_CLS} style={badgeStyle(STATUS_COLOR[data.status])}>
                {STATUS_LABEL[data.status]}
              </span>
              {data.followUpEm &&
                !['CONVERTIDA', 'NAO_CONVERTEU'].includes(data.status) && (
                  <span className="text-[12px] text-muted">
                    Follow-up em {fmtDate(data.followUpEm)}
                  </span>
                )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Cliente">{data.cliente?.nome ?? '—'}</Info>
              <Info label="Representante">{data.representanteNome ?? '—'}</Info>
              <Info label="Produto (catálogo)">
                {data.produto?.nome ?? <em className="text-muted">não vinculado</em>}
              </Info>
              <Info label="Quantidade">{data.quantidade ?? 1}</Info>
              <Info label="Valor de referência">{fmtBRL(data.valor)}</Info>
              <Info label="NF">{data.notaFiscal ?? '—'}</Info>
              <Info label="Enviada em">{fmtDate(data.enviadoEm)}</Info>
              <Info label="Follow-up em">{fmtDate(data.followUpEm)}</Info>
            </dl>

            {/* P7 — Remessa de amostra grátis pro OMIE */}
            <div className="border-t border-border mt-4 pt-4">
              <h3 className="mt-0 text-sm">Remessa OMIE (amostra grátis)</h3>
              {data.numeroOmie ? (
                <div
                  data-testid="amostra-omie-enviada"
                  className="bg-[#e8f5ec] border border-success rounded-[10px] py-2.5 px-3 text-[13px]"
                >
                  ✅ Remessa enviada — OMIE <strong>#{data.numeroOmie}</strong>
                  {data.cfop ? ` · CFOP ${data.cfop}` : ''}
                  {data.enviadoOmieEm ? ` · ${fmtDate(data.enviadoOmieEm)}` : ''}
                </div>
              ) : (
                <div>
                  <p className="text-[12px] text-muted mt-0 mx-0 mb-2">
                    Gera uma remessa de amostra grátis no OMIE (CFOP 5911/6911, sem destaque de
                    tributos). Requer produto do catálogo vinculado e cliente sincronizado com OMIE.
                  </p>
                  {!data.produto && (
                    <p
                      data-testid="amostra-omie-sem-produto"
                      className="text-[12px] text-warning mt-0 mx-0 mb-2"
                    >
                      ⚠️ Esta amostra não tem produto do catálogo vinculado — edite e selecione um
                      produto antes de enviar.
                    </p>
                  )}
                  <button
                    type="button"
                    data-testid="amostra-enviar-omie"
                    disabled={busy || !data.produto}
                    onClick={doEnviarOmie}
                    className={cn(
                      'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold tracking-[-0.1px]',
                      busy || !data.produto
                        ? 'opacity-50 cursor-not-allowed'
                        : 'opacity-100 cursor-pointer',
                    )}
                  >
                    {busy ? 'Enviando…' : 'Enviar remessa ao OMIE'}
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-border mt-4 pt-4">
              <h3 className="mt-0 text-sm">Atualizar status</h3>
              <div className="flex gap-1 flex-wrap">
                {TRANSITIONS.filter((s) => s !== data.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid={`amostra-status-${s}`}
                    onClick={() => setTransition(s)}
                    className="bg-surface text-text border border-border-strong rounded-md font-medium cursor-pointer tracking-[-0.1px] px-2.5 py-1 text-[12px]"
                    style={{ borderColor: transition === s ? STATUS_COLOR[s] : undefined }}
                  >
                    → {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              {transition && (
                <div className="mt-3">
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
                    className={cn(
                      'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]',
                      busy ? 'opacity-70' : 'opacity-100',
                    )}
                  >
                    {busy ? 'Aplicando…' : `Marcar como ${STATUS_LABEL[transition]}`}
                  </button>
                </div>
              )}
            </div>

            {actionError && (
              <div
                data-testid="action-error"
                className="bg-surface border border-danger rounded-[10px] text-danger py-2 px-3 mt-3"
              >
                {actionError}
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
      <div className="text-[11px] uppercase text-muted mb-0.5 tracking-[0.3px] font-semibold">
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
  const [produto, setProduto] = useState<ProdutoOpt | null>(null);
  const [produtoNome, setProdutoNome] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [valor, setValor] = useState('');
  const [notaFiscal, setNotaFiscal] = useState('');
  const [enviadoEm, setEnviadoEm] = useState('');
  const [diasFollowUp, setDiasFollowUp] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ao escolher um produto do catálogo, preenche o nome automaticamente se vazio.
  function onPickProduto(p: ProdutoOpt | null) {
    setProduto(p);
    if (p && !produtoNome.trim()) setProdutoNome(p.nome);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente) {
      setError('Selecione um cliente.');
      return;
    }
    if (produtoNome.trim().length < 2) {
      setError('Nome do produto precisa ter no mínimo 2 caracteres.');
      return;
    }
    const valorNum = Number(valor);
    if (!valor.trim() || Number.isNaN(valorNum) || valorNum < 0) {
      setError('Valor inválido — informe um número >= 0.');
      return;
    }
    const qtdNum = Number(quantidade);
    if (Number.isNaN(qtdNum) || qtdNum <= 0) {
      setError('Quantidade inválida — informe um número maior que zero.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      clienteId: cliente.id,
      produtoNome: produtoNome.trim(),
      quantidade: qtdNum,
      valor: Number(valor),
      diasFollowUp,
    };
    if (produto) payload.produtoId = produto.id;
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
    <Dialog
      open
      onClose={onClose}
      title="Nova amostra"
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
            form="amostra-form"
            data-testid="amostra-save-btn"
            disabled={busy}
            className={cn(
              'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]',
              busy ? 'opacity-60' : 'opacity-100',
            )}
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
        <FormField
          label="Produto do catálogo"
          hint="Opcional. Necessário pra enviar a remessa ao OMIE (puxa o código OMIE do produto)."
        >
          <AsyncCombobox<ProdutoOpt>
            testId="produto-picker"
            endpoint="/produtos"
            placeholder="Buscar produto do catálogo…"
            getLabel={(p) => p.nome}
            getSubLabel={(p) => p.sku ?? p.codigoOmie ?? null}
            getId={(p) => p.id}
            value={produto}
            onChange={onPickProduto}
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
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Quantidade" htmlFor="am-qtd" required hint="Amostra = quantidade reduzida">
            <Input
              id="am-qtd"
              data-testid="amostra-quantidade-input"
              type="number"
              min={0}
              step="0.01"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Valor de referência" htmlFor="am-val" required hint="Valor unitário (a amostra é grátis)">
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
        </div>
        <div className="grid grid-cols-2 gap-3">
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
        <FormField label="Dias até follow-up" htmlFor="am-fu" hint="Quantos dias após o envio o sistema deve cobrar retorno do representante.">
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
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
