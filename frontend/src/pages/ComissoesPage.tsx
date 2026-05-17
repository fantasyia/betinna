import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission, useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input, Select } from '@/components/FormField';
import { badge, btn, btnSecondary, card, colors } from '@/components/styles';

type ComissaoTipo = 'REP' | 'GERENTE';

interface Comissao {
  id: string;
  mes: number;
  ano: number;
  tipo: ComissaoTipo;
  representante?: { id: string; nome: string };
  valor: number;
  totalVendido: number;
  percentual: number;
  pago: boolean;
  pagoEm?: string | null;
  reciboUrl?: string | null;
}

interface Resumo {
  mesAtual: { valor: number; totalVendido: number; pago: boolean };
  ultimos12Meses: Array<{ mes: number; ano: number; valor: number; pago: boolean }>;
  totalReceber: number;
  totalRecebido: number;
}

const MES_NOMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function fmtPct(p: number) {
  return `${p.toFixed(2)}%`;
}

export default function ComissoesPage() {
  const canViewOwn = usePermission('comissoes.own');
  const canViewAllGlobal = usePermission('comissoes.all');
  const canViewTeam = usePermission('comissoes.team');
  const canViewAll = canViewAllGlobal || canViewTeam;

  return (
    <PageLayout title="Comissões">
      {canViewOwn && <ResumoPessoal />}
      {canViewAll && <ListaAdmin />}
      {!canViewOwn && !canViewAll && (
        <div style={card}>Você não tem permissão para visualizar comissões.</div>
      )}
    </PageLayout>
  );
}

// ─── Resumo pessoal (REP/GERENTE) ──────────────────────────────────────

function ResumoPessoal() {
  const { data, loading, error, refetch } = useApiQuery<Resumo>('/comissoes/meu-resumo');

  return (
    <section style={{ ...card, marginBottom: '1.5rem' }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Meu resumo</h2>
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && (
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <StatBox
                label="Mês atual"
                value={fmtBRL(data.mesAtual.valor)}
                hint={`Vendido: ${fmtBRL(data.mesAtual.totalVendido)}`}
              />
              <StatBox
                label="A receber"
                value={fmtBRL(data.totalReceber)}
                color={colors.warning}
              />
              <StatBox
                label="Recebido"
                value={fmtBRL(data.totalRecebido)}
                color={colors.success}
              />
            </div>
            <h3 style={{ fontSize: 14, marginBottom: '0.5rem' }}>Últimos 12 meses</h3>
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
              {data.ultimos12Meses.map((m) => (
                <div
                  key={`${m.ano}-${m.mes}`}
                  data-testid="comissao-historico"
                  style={{
                    flex: '1 1 70px',
                    minWidth: 70,
                    padding: '0.5rem',
                    background: m.pago ? colors.success + '15' : '#fafbfc',
                    borderRadius: 6,
                    textAlign: 'center',
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ fontSize: 11, color: colors.muted }}>
                    {MES_NOMES[m.mes - 1]}/{String(m.ano).slice(2)}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>
                    {fmtBRL(m.valor)}
                  </div>
                  {m.pago && (
                    <div style={{ ...badge(colors.success), marginTop: 4, fontSize: 9 }}>
                      pago
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </StateView>
    </section>
  );
}

function StatBox({
  label,
  value,
  hint,
  color = colors.text,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: '#fafbfc',
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '0.75rem',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: colors.muted, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// ─── Lista admin (ADMIN/DIRECTOR/GERENTE) ──────────────────────────────

function ListaAdmin() {
  // D46+D48: fechar mês / marcar pago / desmarcar = DIRECTOR (mandatário do
  // tenant) OU ADMIN (master da plataforma). GERENTE só visualiza.
  const role = useRole();
  const canManage = role === 'DIRECTOR' || role === 'ADMIN';
  const [page, setPage] = useState(1);
  const now = new Date();
  const [mes, setMes] = useState<number | ''>(now.getMonth() + 1);
  const [ano, setAno] = useState<number>(now.getFullYear());
  const [pago, setPago] = useState<string>('');

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20', ano: String(ano) });
    if (mes !== '') qs.set('mes', String(mes));
    if (pago) qs.set('pago', pago);
    return `/comissoes?${qs.toString()}`;
  }, [page, mes, ano, pago]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Comissao>>(listPath);

  const [fecharOpen, setFecharOpen] = useState(false);
  const [pagar, setPagar] = useState<Comissao | null>(null);

  const columns: Column<Comissao>[] = [
    {
      key: 'periodo',
      header: 'Período',
      render: (c) => `${MES_NOMES[c.mes - 1]}/${c.ano}`,
    },
    {
      key: 'rep',
      header: 'Representante',
      render: (c) => (
        <div>
          <div>{c.representante?.nome ?? '—'}</div>
          <span style={{ ...badge(c.tipo === 'GERENTE' ? colors.warning : '#0891b2'), fontSize: 10 }}>
            {c.tipo}
          </span>
        </div>
      ),
    },
    {
      key: 'vendido',
      header: 'Vendido',
      render: (c) => fmtBRL(c.totalVendido),
    },
    {
      key: 'percentual',
      header: '%',
      render: (c) => fmtPct(c.percentual),
    },
    {
      key: 'valor',
      header: 'Comissão',
      render: (c) => <strong>{fmtBRL(c.valor)}</strong>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) =>
        c.pago ? (
          <span style={badge(colors.success)}>Pago</span>
        ) : (
          <span style={badge(colors.warning)}>Em aberto</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (c) =>
        canManage && !c.pago ? (
          <button
            type="button"
            data-testid={`comissao-pagar-${c.id}`}
            onClick={() => setPagar(c)}
            style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
          >
            Marcar pago
          </button>
        ) : null,
    },
  ];

  return (
    <section style={card}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Comissões da equipe</h2>
        {canManage && (
          <button
            type="button"
            data-testid="fechar-mes-btn"
            onClick={() => setFecharOpen(true)}
            style={btn}
          >
            Fechar mês
          </button>
        )}
      </header>

      <FilterBar>
        <Select
          data-testid="filter-mes"
          value={mes}
          onChange={(e) => {
            setMes(e.target.value === '' ? '' : Number(e.target.value));
            setPage(1);
          }}
        >
          <option value="">Todos meses</option>
          {MES_NOMES.map((n, i) => (
            <option key={i} value={i + 1}>
              {n}
            </option>
          ))}
        </Select>
        <Select
          data-testid="filter-ano"
          value={ano}
          onChange={(e) => {
            setAno(Number(e.target.value));
            setPage(1);
          }}
        >
          {[ano - 1, ano, ano + 1].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select
          data-testid="filter-pago"
          value={pago}
          onChange={(e) => {
            setPago(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Pagos + abertos</option>
          <option value="true">Apenas pagos</option>
          <option value="false">Apenas em aberto</option>
        </Select>
      </FilterBar>

      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
        emptyMessage="Nenhuma comissão encontrada nesse filtro."
        onRetry={refetch}
      >
        {pageResp && (
          <>
            <Table data={pageResp.data} columns={columns} rowKey={(c) => c.id} />
            <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
          </>
        )}
      </StateView>

      {fecharOpen && (
        <FecharMesModal onClose={() => setFecharOpen(false)} onDone={() => { setFecharOpen(false); refetch(); }} />
      )}
      {pagar && (
        <PagarModal
          comissao={pagar}
          onClose={() => setPagar(null)}
          onDone={() => { setPagar(null); refetch(); }}
        />
      )}
    </section>
  );
}

function FecharMesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const now = new Date();
  // Default: mês anterior (que é o que normalmente se fecha)
  const dPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [mes, setMes] = useState(dPrev.getMonth() + 1);
  const [ano, setAno] = useState(dPrev.getFullYear());
  const [reprocessar, setReprocessar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/comissoes/fechar-mes', { mes, ano, reprocessar });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao fechar mês');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Fechar mês de comissões"
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="fechar-mes-form"
            data-testid="fechar-mes-confirm"
            disabled={busy}
            style={btn}
          >
            {busy ? 'Fechando…' : 'Fechar mês'}
          </button>
        </>
      }
    >
      <form id="fechar-mes-form" onSubmit={submit}>
        <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
          Agrega pedidos comissionáveis do período e cria/atualiza registros REP + GERENTE.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Mês" htmlFor="fm-mes" required>
            <Select id="fm-mes" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MES_NOMES.map((n, i) => (
                <option key={i} value={i + 1}>
                  {n}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Ano" htmlFor="fm-ano" required>
            <Input
              id="fm-ano"
              type="number"
              min={2020}
              max={2100}
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
            />
          </FormField>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, marginTop: '0.5rem' }}>
          <input
            type="checkbox"
            data-testid="reprocessar-checkbox"
            checked={reprocessar}
            onChange={(e) => setReprocessar(e.target.checked)}
          />
          Reprocessar (sobrescreve fechamentos existentes)
        </label>
        {error && (
          <p style={{ color: colors.danger, fontSize: 13, marginTop: '0.5rem' }}>{error}</p>
        )}
      </form>
    </Modal>
  );
}

function PagarModal({
  comissao,
  onClose,
  onDone,
}: {
  comissao: Comissao;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reciboUrl, setReciboUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (reciboUrl.trim()) payload.reciboUrl = reciboUrl.trim();
      await api.put(`/comissoes/${comissao.id}/pagar`, payload);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao marcar como pago');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Marcar comissão como paga — ${MES_NOMES[comissao.mes - 1]}/${comissao.ano}`}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="pagar-form"
            data-testid="pagar-confirm"
            disabled={busy}
            style={btn}
          >
            {busy ? 'Marcando…' : 'Marcar como pago'}
          </button>
        </>
      }
    >
      <form id="pagar-form" onSubmit={submit}>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          <strong>{comissao.representante?.nome}</strong> — {fmtBRL(comissao.valor)}
        </p>
        <FormField
          label="URL do recibo (opcional)"
          htmlFor="pg-recibo"
          hint="Ex: link do comprovante no Storage / Drive"
        >
          <Input
            id="pg-recibo"
            type="url"
            data-testid="pagar-recibo-input"
            value={reciboUrl}
            onChange={(e) => setReciboUrl(e.target.value)}
            placeholder="https://…"
          />
        </FormField>
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
