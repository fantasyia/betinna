import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { usePermission } from '@/hooks/usePermission';
import { useEmpresaLogo } from '@/hooks/useEmpresaLogo';
import { PageLayout } from '@/components/PageLayout';
import { SistemaTabs } from '@/components/SistemaTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select } from '@/components/FormField';
import { LogoUploader } from '@/components/LogoUploader';
import { useToast } from '@/components/toast';
import { currentEmpresaId } from '@/lib/auth-store';
import { maskCNPJ } from '@/lib/masks';
import { UfSelect, CidadeSelect } from '@/components/LocalidadeSelects';
import { cn } from '@/lib/cn';
import {
  PEDIDO_STATUSES,
  STATUS_VARIANTS,
  VARIANT_LABEL,
  STATUS_LABEL_DEFAULT,
  STATUS_VARIANT_DEFAULT,
  type PedidoStatus,
  type StatusVariant,
  type PedidoStatusConfig,
} from '@/lib/pedidoStatus';

// Cores oficiais brandbook usadas no tabs strip
const BRAND = {
  navy: '#201554',
  cyan: '#2bcae5',
  magenta: '#bd1fbf',
} as const;

type Tab = 'empresas' | 'avancado';

interface Empresa {
  id: string;
  nome: string;
  cnpj?: string | null;
  ramo?: string | null;
  cidade?: string | null;
  uf?: string | null;
  subtitulo?: string | null;
  ativo: boolean;
  criadoEm?: string;
  // B1 (Lote 6) — desconto à vista automático por empresa
  descontoPixPct?: number | null;
  descontoBoletoAvistaPct?: number | null;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

export default function ConfiguracoesPage() {
  const toast = useToast();
  // D46+D48: listar e editar empresas = ADMIN (master cross-tenant) OU
  // DIRECTOR (mandatário do tenant). Criar nova continua ADMIN-only (setup
  // multi-tenant — DIRECTOR não cria outro tenant, é mandatário do dele).
  const podeListar = usePermission('configuracoes.empresa');
  const podeCriarEmpresa = usePermission('configuracoes.view');
  const podeEditarEmpresa = usePermission('configuracoes.empresa');

  const [tab, setTab] = useState<Tab>('empresas');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [ativo, setAtivo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Empresa | null>(null);

  const listPath = useMemo(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) qs.set('search', search.trim());
    if (ativo) qs.set('ativo', ativo);
    return `/empresas?${qs.toString()}`;
  }, [page, search, ativo]);

  const { data: pageResp, loading, error, refetch } = useApiQuery<PaginatedResponse<Empresa>>(
    podeListar ? listPath : null,
  );

  async function toggleAtivo(emp: Empresa) {
    try {
      if (emp.ativo) {
        await api.delete(`/empresas/${emp.id}`);
        toast.success(`${emp.nome} desativada`);
      } else {
        await api.put(`/empresas/${emp.id}/ativar`);
        toast.success(`${emp.nome} ativada`);
      }
      refetch();
    } catch (err) {
      toast.error('Falha ao mudar status', apiErrorMessage(err));
    }
  }

  if (!podeListar) {
    return (
      <PageLayout title="Configurações">
        <div className="bg-surface border border-border rounded-[10px] p-6">
          <p>Apenas ADMIN ou DIRETOR pode acessar configurações de empresas.</p>
        </div>
      </PageLayout>
    );
  }

  const columns: Column<Empresa>[] = [
    {
      key: 'nome',
      header: 'Empresa',
      render: (e) => (
        <div>
          <div className="font-semibold">{e.nome}</div>
          {e.cnpj && <div className="text-[11px] text-muted">{e.cnpj}</div>}
          {e.subtitulo && <div className="text-[11px] text-muted">{e.subtitulo}</div>}
        </div>
      ),
    },
    {
      key: 'local',
      header: 'Local',
      render: (e) => (e.cidade ? `${e.cidade}${e.uf ? '/' + e.uf : ''}` : '—'),
    },
    { key: 'ramo', header: 'Ramo', render: (e) => e.ramo ?? '—' },
    {
      key: 'ativo',
      header: 'Status',
      render: (e) => {
        const c = e.ativo ? 'var(--success)' : 'var(--muted)';
        return podeEditarEmpresa ? (
          <button
            type="button"
            data-testid={`emp-toggle-${e.id}`}
            onClick={() => toggleAtivo(e)}
            className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px] cursor-pointer"
            style={{
              background: `color-mix(in srgb, ${c} 12%, transparent)`,
              color: c,
              border: 'none',
              fontFamily: 'inherit',
            }}
          >
            {e.ativo ? 'ativo' : 'inativo'}
          </button>
        ) : (
          <span
            className="inline-flex items-center rounded-full px-[9px] py-0.5 text-[11px] font-semibold leading-[1.6] tracking-[0.2px]"
            style={{
              background: `color-mix(in srgb, ${c} 12%, transparent)`,
              color: c,
              border: `1px solid color-mix(in srgb, ${c} 19%, transparent)`,
            }}
          >
            {e.ativo ? 'ativo' : 'inativo'}
          </span>
        );
      },
    },
    {
      key: 'criado',
      header: 'Criado em',
      render: (e) => fmtDate(e.criadoEm),
    },
    {
      key: 'actions',
      header: '',
      render: (e) =>
        podeEditarEmpresa ? (
          <button
            type="button"
            data-testid={`emp-edit-${e.id}`}
            onClick={() => setEditing(e)}
            className="bg-surface text-text border border-border-strong rounded-md px-[0.625rem] py-1 text-xs font-medium cursor-pointer tracking-[-0.1px]"
          >
            Editar
          </button>
        ) : (
          <span className="text-[11px] text-muted italic">
            só diretor
          </span>
        ),
    },
  ];

  return (
    <PageLayout
      title="Configurações"
      actions={
        podeCriarEmpresa && tab === 'empresas' ? (
          <button
            type="button"
            data-testid="emp-new"
            onClick={() => setCreating(true)}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            + Nova empresa
          </button>
        ) : undefined
      }
    >
      <SistemaTabs />
      {/* Tabs strip — brandbook colors */}
      <div
        role="tablist"
        aria-label="Seções de configuração"
        className="flex gap-1 border-b border-border mb-4"
      >
        <TabButton id="empresas" current={tab} onClick={setTab} label="🏢 Empresas" />
        <TabButton id="avancado" current={tab} onClick={setTab} label="⚙️ Avançado" />
      </div>

      {tab === 'avancado' && (
        <>
          <AvancadoTab />
          <LifecycleConfig />
          <PedidoMinimoConfig />
          <AmostrasConfig />
          <ComissaoConfig />
          <MateriaisTiposConfig />
          <DevolucaoConfig />
          <InboxInternaConfig />
          <EnvioWhatsappConfig />
        </>
      )}
      {tab === 'empresas' && (
        <div className="flex flex-col gap-4">
          <LogoSection canEdit={podeEditarEmpresa} />
          <div className="bg-surface border border-border rounded-[10px] p-6">
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Nome, CNPJ…"
          />
          <Select
            data-testid="filter-ativo"
            value={ativo}
            onChange={(e) => {
              setAtivo(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos status</option>
            <option value="true">Apenas ativas</option>
            <option value="false">Apenas inativas</option>
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && (pageResp?.data.length ?? 0) === 0}
          emptyMessage="Nenhuma empresa cadastrada."
          onRetry={refetch}
        >
          {pageResp && (
            <>
              <Table data={pageResp.data} columns={columns} rowKey={(e) => e.id} />
              <Pagination pagination={pageResp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>
      </div>
      )}

      {(creating || editing) && (
        <EmpresaFormModal
          empresa={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

// ─── Tab nav + alternative tab content ───────────────────────────────

function TabButton({
  id,
  current,
  onClick,
  label,
}: {
  id: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  label: string;
}) {
  const active = current === id;
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-controls={`tab-panel-${id}`}
      data-testid={`config-tab-${id}`}
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        'px-4 py-2.5 text-[13px] bg-transparent border-none cursor-pointer mb-[-1px]',
        active ? 'font-bold' : 'font-medium',
      )}
      style={{
        borderBottom: `2px solid ${active ? BRAND.magenta : 'transparent'}`,
        color: active ? 'var(--text)' : 'var(--muted)',
        transition: 'color 120ms, border-color 120ms',
      }}
    >
      {label}
    </button>
  );
}

/** Lifecycle de pedido — 1º consumidor do ConfiguracaoTenant (no-code). */
function LifecycleConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [rows, setRows] = useState<Record<
    PedidoStatus,
    { label: string; variant: StatusVariant }
  > | null>(null);
  const [busy, setBusy] = useState(false);

  // Estado derivado da config (recomputa quando ela chega/muda; edições vivem em `rows`).
  const base = useMemo(() => {
    const saved = (cfg?.pedidoStatusLabels ?? {}) as PedidoStatusConfig;
    const o = {} as Record<PedidoStatus, { label: string; variant: StatusVariant }>;
    for (const s of PEDIDO_STATUSES) {
      o[s] = {
        label: saved[s]?.label ?? STATUS_LABEL_DEFAULT[s],
        variant: saved[s]?.variant ?? STATUS_VARIANT_DEFAULT[s],
      };
    }
    return o;
  }, [cfg]);
  const form = rows ?? base;

  function setRow(s: PedidoStatus, field: 'label' | 'variant', v: string) {
    setRows({ ...form, [s]: { ...form[s], [field]: v } });
  }

  async function save() {
    setBusy(true);
    try {
      await api.patch('/empresas/config', { pedidoStatusLabels: form });
      toast.success('Lifecycle de pedido salvo');
      setRows(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        🧭 Lifecycle de pedido
      </h2>
      <p className="text-xs text-muted mt-0">
        Personalize o nome e a cor de cada status do pedido pra esta empresa. Vale na lista de
        pedidos. Em branco usa o padrão.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-2 mt-4 max-w-[640px]">
          {PEDIDO_STATUSES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <code className="text-[11px] text-muted w-[180px] shrink-0">{s}</code>
              <Input
                value={form[s].label}
                disabled={!podeEditar}
                onChange={(e) => setRow(s, 'label', e.target.value)}
                placeholder={STATUS_LABEL_DEFAULT[s]}
              />
              <Select
                value={form[s].variant}
                disabled={!podeEditar}
                onChange={(e) => setRow(s, 'variant', e.target.value)}
              >
                {STATUS_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {VARIANT_LABEL[v]}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {podeEditar && (
            <button
              type="button"
              data-testid="lifecycle-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar lifecycle'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Pedido mínimo — 2º consumidor do ConfiguracaoTenant (no-code). */
const PEDIDO_MINIMO_TIPOS: Array<{ value: string; label: string }> = [
  { value: 'sem_minimo', label: 'Sem mínimo' },
  { value: 'por_valor', label: 'Por valor (R$)' },
  { value: 'por_peso', label: 'Por peso (kg)' },
  { value: 'por_quantidade', label: 'Por quantidade (un)' },
  { value: 'combinada', label: 'Combinada (valor/peso/qtd)' },
];

interface PedidoMinimoForm {
  tipo: string;
  valorMin: string;
  pesoMin: string;
  quantidadeMin: string;
  modo: 'E' | 'OU';
}

function PedidoMinimoConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [edit, setEdit] = useState<PedidoMinimoForm | null>(null);
  const [busy, setBusy] = useState(false);

  const base: PedidoMinimoForm = useMemo(() => {
    const r = (cfg?.pedidoMinimo ?? {}) as {
      tipo?: string;
      valorMin?: number;
      pesoMin?: number;
      quantidadeMin?: number;
      modo?: 'E' | 'OU';
    };
    return {
      tipo: r.tipo ?? 'sem_minimo',
      valorMin: r.valorMin != null ? String(r.valorMin) : '',
      pesoMin: r.pesoMin != null ? String(r.pesoMin) : '',
      quantidadeMin: r.quantidadeMin != null ? String(r.quantidadeMin) : '',
      modo: r.modo ?? 'E',
    };
  }, [cfg]);
  const form = edit ?? base;

  function set<K extends keyof PedidoMinimoForm>(field: K, v: PedidoMinimoForm[K]) {
    setEdit({ ...form, [field]: v } as PedidoMinimoForm);
  }

  const usaValor = form.tipo === 'por_valor' || form.tipo === 'combinada';
  const usaPeso = form.tipo === 'por_peso' || form.tipo === 'combinada';
  const usaQtd = form.tipo === 'por_quantidade' || form.tipo === 'combinada';

  async function save() {
    setBusy(true);
    try {
      const num = (s: string) => {
        const n = Number(s.replace(',', '.'));
        return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      const pedidoMinimo: Record<string, unknown> = { tipo: form.tipo };
      if (usaValor) pedidoMinimo.valorMin = num(form.valorMin);
      if (usaPeso) pedidoMinimo.pesoMin = num(form.pesoMin);
      if (usaQtd) pedidoMinimo.quantidadeMin = num(form.quantidadeMin);
      if (form.tipo === 'combinada') pedidoMinimo.modo = form.modo;
      await api.patch('/empresas/config', { pedidoMinimo });
      toast.success('Pedido mínimo salvo');
      setEdit(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        📦 Pedido mínimo
      </h2>
      <p className="text-xs text-muted mt-0">
        Mínimo que um pedido precisa atingir pra ser enviado ao OMIE. Rascunhos podem ficar abaixo.
        O peso usa o peso por unidade cadastrado em cada produto.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3 mt-4 max-w-[480px]">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Tipo de mínimo
            <Select
              value={form.tipo}
              disabled={!podeEditar}
              onChange={(e) => set('tipo', e.target.value)}
            >
              {PEDIDO_MINIMO_TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>

          {usaValor && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Valor mínimo (R$)
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.valorMin}
                disabled={!podeEditar}
                onChange={(e) => set('valorMin', e.target.value)}
                placeholder="ex: 5000"
              />
            </label>
          )}
          {usaPeso && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Peso mínimo (kg)
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.pesoMin}
                disabled={!podeEditar}
                onChange={(e) => set('pesoMin', e.target.value)}
                placeholder="ex: 250"
              />
            </label>
          )}
          {usaQtd && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Quantidade mínima (un)
              <Input
                type="number"
                min="0"
                step="1"
                value={form.quantidadeMin}
                disabled={!podeEditar}
                onChange={(e) => set('quantidadeMin', e.target.value)}
                placeholder="ex: 100"
              />
            </label>
          )}
          {form.tipo === 'combinada' && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Combinador
              <Select
                value={form.modo}
                disabled={!podeEditar}
                onChange={(e) => set('modo', e.target.value as 'E' | 'OU')}
              >
                <option value="E">E — precisa atingir todos os limites</option>
                <option value="OU">OU — basta atingir um dos limites</option>
              </Select>
            </label>
          )}

          {podeEditar && (
            <button
              type="button"
              data-testid="pedido-minimo-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar pedido mínimo'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Amostras: modos + elegibilidade + fila de aprovação — 3º consumidor (no-code). */
interface AmostrasConfigForm {
  subsidiada: boolean;
  compra_propria: boolean;
  compra_cliente: boolean;
  tipo: string;
  minKgMes: string;
  mesesJanela: string;
  exigeAprovacao: boolean;
}

function AmostrasConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [edit, setEdit] = useState<AmostrasConfigForm | null>(null);
  const [busy, setBusy] = useState(false);

  const base: AmostrasConfigForm = useMemo(() => {
    const r = (cfg?.amostraModos ?? {}) as {
      modosAtivos?: Record<string, boolean>;
      elegibilidadeSubsidiada?: { tipo?: string; minKgMes?: number; mesesJanela?: number };
      exigeAprovacaoSubsidiada?: boolean;
    };
    const m = r.modosAtivos ?? {};
    const e = r.elegibilidadeSubsidiada ?? {};
    return {
      subsidiada: m.subsidiada ?? true,
      compra_propria: m.compra_propria ?? false,
      compra_cliente: m.compra_cliente ?? false,
      tipo: e.tipo ?? 'sempre',
      minKgMes: e.minKgMes != null ? String(e.minKgMes) : '',
      mesesJanela: e.mesesJanela != null ? String(e.mesesJanela) : '3',
      exigeAprovacao: r.exigeAprovacaoSubsidiada ?? false,
    };
  }, [cfg]);
  const form = edit ?? base;

  function set<K extends keyof AmostrasConfigForm>(k: K, v: AmostrasConfigForm[K]) {
    setEdit({ ...form, [k]: v } as AmostrasConfigForm);
  }

  async function save() {
    setBusy(true);
    try {
      const num = (s: string, d: number) => {
        const n = Number(s.replace(',', '.'));
        return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : d;
      };
      await api.patch('/empresas/config', {
        amostraModos: {
          modosAtivos: {
            subsidiada: form.subsidiada,
            compra_propria: form.compra_propria,
            compra_cliente: form.compra_cliente,
          },
          elegibilidadeSubsidiada: {
            tipo: form.tipo,
            minKgMes: num(form.minKgMes, 0),
            mesesJanela: Math.max(1, Math.round(num(form.mesesJanela, 3))),
          },
          exigeAprovacaoSubsidiada: form.exigeAprovacao,
        },
      });
      toast.success('Configuração de amostras salva');
      setEdit(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const check = (k: 'subsidiada' | 'compra_propria' | 'compra_cliente', label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={form[k]}
        disabled={!podeEditar}
        onChange={(e) => set(k, e.target.checked)}
      />
      {label}
    </label>
  );

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        🧪 Amostras
      </h2>
      <p className="text-xs text-muted mt-0">
        Modos de amostra ativos + regra de elegibilidade da amostra subsidiada (empresa paga). A
        subsidiada pode cair numa fila de aprovação da diretoria.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3 mt-4 max-w-[480px]">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Modos ativos</span>
            {check('subsidiada', 'Subsidiada (empresa paga)')}
            {check('compra_propria', 'Compra própria (rep paga)')}
            {check('compra_cliente', 'Compra do cliente (cliente paga)')}
          </div>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Elegibilidade da subsidiada
            <Select value={form.tipo} disabled={!podeEditar} onChange={(e) => set('tipo', e.target.value)}>
              <option value="sempre">Sempre elegível</option>
              <option value="media_kg_mes">Por média de kg/mês do cliente</option>
              <option value="manual">Sempre exige aprovação manual</option>
            </Select>
          </label>

          {form.tipo === 'media_kg_mes' && (
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted flex-1">
                Mínimo kg/mês
                <Input
                  type="number"
                  min="0"
                  value={form.minKgMes}
                  disabled={!podeEditar}
                  onChange={(e) => set('minKgMes', e.target.value)}
                  placeholder="ex: 250"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted flex-1">
                Janela (meses)
                <Input
                  type="number"
                  min="1"
                  value={form.mesesJanela}
                  disabled={!podeEditar}
                  onChange={(e) => set('mesesJanela', e.target.value)}
                  placeholder="3"
                />
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.exigeAprovacao}
              disabled={!podeEditar}
              onChange={(e) => set('exigeAprovacao', e.target.checked)}
            />
            Toda subsidiada passa por aprovação da diretoria
          </label>

          {podeEditar && (
            <button
              type="button"
              data-testid="amostras-config-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar amostras'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Comissão escalonada por faturamento — 4º consumidor (no-code). */
interface FaixaForm {
  de: string;
  ate: string;
  percentual: string;
}

function ComissaoConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [modelo, setModelo] = useState<string | null>(null);
  const [faixas, setFaixas] = useState<FaixaForm[] | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => {
    const r = (cfg?.comissaoBonus ?? {}) as {
      modelo?: string;
      faixas?: Array<{ de?: number; ate?: number | null; percentual?: number }>;
    };
    return {
      modelo: r.modelo ?? 'fixa',
      faixas: (r.faixas ?? []).map((f) => ({
        de: f.de != null ? String(f.de) : '',
        ate: f.ate != null ? String(f.ate) : '',
        percentual: f.percentual != null ? String(f.percentual) : '',
      })),
    };
  }, [cfg]);
  const modeloForm = modelo ?? base.modelo;
  const faixasForm = faixas ?? base.faixas;

  function setFaixa(i: number, k: keyof FaixaForm, v: string) {
    setFaixas(faixasForm.map((f, idx) => (idx === i ? { ...f, [k]: v } : f)));
  }
  const addFaixa = () => setFaixas([...faixasForm, { de: '', ate: '', percentual: '' }]);
  const rmFaixa = (i: number) => setFaixas(faixasForm.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    try {
      const num = (s: string) => {
        const n = Number(s.replace(',', '.'));
        return s.trim() !== '' && Number.isFinite(n) ? n : null;
      };
      const payload: Record<string, unknown> = { modelo: modeloForm };
      if (modeloForm === 'escalonada_por_faturamento') {
        payload.faixas = faixasForm
          .map((f) => ({ de: num(f.de) ?? 0, ate: num(f.ate), percentual: num(f.percentual) ?? 0 }))
          .filter((f) => f.percentual >= 0);
      } else {
        payload.faixas = [];
      }
      await api.patch('/empresas/config', { comissaoBonus: payload });
      toast.success('Comissão salva');
      setModelo(null);
      setFaixas(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        💰 Comissão
      </h2>
      <p className="text-xs text-muted mt-0">
        Modelo de comissão do rep. <strong>Fixa</strong> = soma da comissão calculada por pedido (atual).{' '}
        <strong>Escalonada</strong> = faturamento mensal do rep × % da faixa. Aplica no fechamento do mês.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3 mt-4 max-w-[560px]">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Modelo
            <Select
              value={modeloForm}
              disabled={!podeEditar}
              onChange={(e) => setModelo(e.target.value)}
            >
              <option value="fixa">Fixa (por pedido)</option>
              <option value="escalonada_por_faturamento">Escalonada por faturamento</option>
            </Select>
          </label>

          {modeloForm === 'escalonada_por_faturamento' && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 text-[11px] text-muted">
                <span className="flex-1">De (R$)</span>
                <span className="flex-1">Até (R$, vazio = aberto)</span>
                <span className="w-[90px]">% comissão</span>
                <span className="w-[28px]" />
              </div>
              {faixasForm.map((f, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min="0"
                    value={f.de}
                    disabled={!podeEditar}
                    onChange={(e) => setFaixa(i, 'de', e.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    value={f.ate}
                    disabled={!podeEditar}
                    onChange={(e) => setFaixa(i, 'ate', e.target.value)}
                    placeholder="∞"
                  />
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={f.percentual}
                    disabled={!podeEditar}
                    onChange={(e) => setFaixa(i, 'percentual', e.target.value)}
                  />
                  {podeEditar && (
                    <button
                      type="button"
                      onClick={() => rmFaixa(i)}
                      className="w-[28px] h-[34px] shrink-0 bg-surface text-danger border border-border-strong rounded-md cursor-pointer"
                      aria-label="Remover faixa"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {podeEditar && (
                <button
                  type="button"
                  onClick={addFaixa}
                  className="self-start text-[12px] text-primary bg-transparent border-none cursor-pointer px-0"
                >
                  + Adicionar faixa
                </button>
              )}
            </div>
          )}

          {podeEditar && (
            <button
              type="button"
              data-testid="comissao-config-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar comissão'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Materiais de venda: tipos configuráveis — 5º consumidor (no-code). */
const DEFAULT_MATERIAIS_TIPOS = [
  { key: 'ficha_tecnica', label: 'Ficha técnica' },
  { key: 'foto_hd', label: 'Foto HD' },
  { key: 'apresentacao', label: 'Apresentação' },
  { key: 'video', label: 'Vídeo' },
  { key: 'certificacao', label: 'Certificação' },
  { key: 'tabela_comercial', label: 'Tabela comercial' },
  { key: 'tutorial', label: 'Tutorial' },
];

function MateriaisTiposConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [rows, setRows] = useState<Array<{ key: string; label: string }> | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => {
    const t = (cfg?.materiaisVenda as { tipos?: Array<{ key: string; label: string }> } | undefined)
      ?.tipos;
    return t && t.length > 0 ? t : DEFAULT_MATERIAIS_TIPOS;
  }, [cfg]);
  const tipos = rows ?? base;

  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

  function setLabel(i: number, label: string) {
    setRows(tipos.map((t, idx) => (idx === i ? { key: t.key || slug(label), label } : t)));
  }
  const add = () => setRows([...tipos, { key: '', label: '' }]);
  const rm = (i: number) => setRows(tipos.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    try {
      const limpos = tipos
        .map((t) => ({ key: t.key || slug(t.label), label: t.label.trim() }))
        .filter((t) => t.key && t.label);
      await api.patch('/empresas/config', { materiaisVenda: { tipos: limpos } });
      toast.success('Tipos de materiais salvos');
      setRows(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        📁 Tipos de materiais de venda
      </h2>
      <p className="text-xs text-muted mt-0">
        Categorias de material que aparecem na biblioteca (Vendas → Materiais). Em branco usa os
        padrões.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-2 mt-4 max-w-[480px]">
          {tipos.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={t.label}
                disabled={!podeEditar}
                onChange={(e) => setLabel(i, e.target.value)}
                placeholder="Nome do tipo"
              />
              <code className="text-[11px] text-muted w-[140px] shrink-0 truncate">
                {t.key || slug(t.label) || '—'}
              </code>
              {podeEditar && (
                <button
                  type="button"
                  onClick={() => rm(i)}
                  className="w-[28px] h-[34px] shrink-0 bg-surface text-danger border border-border-strong rounded-md cursor-pointer"
                  aria-label="Remover tipo"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {podeEditar && (
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={add}
                className="text-[12px] text-primary bg-transparent border-none cursor-pointer px-0"
              >
                + Adicionar tipo
              </button>
            </div>
          )}
          {podeEditar && (
            <button
              type="button"
              data-testid="materiais-tipos-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar tipos'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Devolução interna: motivos + SLA + janela — 6º consumidor (no-code). */
interface DevMotivoForm {
  key: string;
  label: string;
  fotosObrigatorias: boolean;
}
const DEFAULT_DEV_MOTIVOS: DevMotivoForm[] = [
  { key: 'avaria_transporte', label: 'Avaria no transporte', fotosObrigatorias: true },
  { key: 'validade_proxima', label: 'Validade próxima', fotosObrigatorias: false },
  { key: 'erro_produto', label: 'Erro de produto', fotosObrigatorias: true },
  { key: 'qualidade', label: 'Qualidade', fotosObrigatorias: true },
  { key: 'recusa_cliente', label: 'Recusa do cliente', fotosObrigatorias: false },
  { key: 'outros', label: 'Outros', fotosObrigatorias: false },
];

function DevolucaoConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [motivos, setMotivos] = useState<DevMotivoForm[] | null>(null);
  const [sla, setSla] = useState<string | null>(null);
  const [janela, setJanela] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => {
    const r = (cfg?.devolucaoInterna ?? {}) as {
      motivos?: DevMotivoForm[];
      slaAnaliseDiasUteis?: number;
      janelaPosEntregaDias?: number;
    };
    return {
      motivos:
        r.motivos && r.motivos.length > 0
          ? r.motivos.map((m) => ({
              key: m.key,
              label: m.label,
              fotosObrigatorias: !!m.fotosObrigatorias,
            }))
          : DEFAULT_DEV_MOTIVOS,
      sla: String(r.slaAnaliseDiasUteis ?? 5),
      janela: String(r.janelaPosEntregaDias ?? 60),
    };
  }, [cfg]);
  const motivosForm = motivos ?? base.motivos;
  const slaForm = sla ?? base.sla;
  const janelaForm = janela ?? base.janela;

  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

  function setMot(i: number, patch: Partial<DevMotivoForm>) {
    setMotivos(motivosForm.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  const add = () =>
    setMotivos([...motivosForm, { key: '', label: '', fotosObrigatorias: false }]);
  const rm = (i: number) => setMotivos(motivosForm.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    try {
      const limpos = motivosForm
        .map((m) => ({
          key: m.key || slug(m.label),
          label: m.label.trim(),
          fotosObrigatorias: m.fotosObrigatorias,
        }))
        .filter((m) => m.key && m.label);
      await api.patch('/empresas/config', {
        devolucaoInterna: {
          motivos: limpos,
          slaAnaliseDiasUteis: Math.max(0, Math.round(Number(slaForm) || 5)),
          janelaPosEntregaDias: Math.max(0, Math.round(Number(janelaForm) || 60)),
        },
      });
      toast.success('Configuração de devolução salva');
      setMotivos(null);
      setSla(null);
      setJanela(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        ↩️ Devolução interna
      </h2>
      <p className="text-xs text-muted mt-0">
        Motivos de devolução, SLA de análise (dias úteis) e janela após a entrega. Em branco usa os
        padrões.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3 mt-4 max-w-[560px]">
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted flex-1">
              SLA análise (dias úteis)
              <Input
                type="number"
                min="0"
                value={slaForm}
                disabled={!podeEditar}
                onChange={(e) => setSla(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted flex-1">
              Janela pós-entrega (dias)
              <Input
                type="number"
                min="0"
                value={janelaForm}
                disabled={!podeEditar}
                onChange={(e) => setJanela(e.target.value)}
              />
            </label>
          </div>

          <span className="text-xs text-muted">Motivos</span>
          {motivosForm.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={m.label}
                disabled={!podeEditar}
                onChange={(e) =>
                  setMot(i, { label: e.target.value, key: m.key || slug(e.target.value) })
                }
                placeholder="Nome do motivo"
              />
              <label className="flex items-center gap-1 text-[11px] text-muted shrink-0">
                <input
                  type="checkbox"
                  checked={m.fotosObrigatorias}
                  disabled={!podeEditar}
                  onChange={(e) => setMot(i, { fotosObrigatorias: e.target.checked })}
                />
                foto obrig.
              </label>
              {podeEditar && (
                <button
                  type="button"
                  onClick={() => rm(i)}
                  className="w-[28px] h-[34px] shrink-0 bg-surface text-danger border border-border-strong rounded-md cursor-pointer"
                  aria-label="Remover motivo"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {podeEditar && (
            <button
              type="button"
              onClick={add}
              className="self-start text-[12px] text-primary bg-transparent border-none cursor-pointer px-0"
            >
              + Adicionar motivo
            </button>
          )}

          {podeEditar && (
            <button
              type="button"
              data-testid="devolucao-config-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar devolução'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Inbox interna: tipos de canal + SLA — 7º consumidor (no-code). */
interface InboxTipoForm {
  key: string;
  nome: string;
  slaHorasUteis: string;
  permiteResposta: boolean;
  prioridade: string;
}
const DEFAULT_INBOX_TIPOS: InboxTipoForm[] = [
  { key: 'diretor_comercial', nome: 'Direto com Diretor Comercial', slaHorasUteis: '48', permiteResposta: true, prioridade: 'alta' },
  { key: 'suporte_pedidos', nome: 'Suporte Pedidos', slaHorasUteis: '8', permiteResposta: true, prioridade: 'media' },
  { key: 'avisos', nome: 'Avisos', slaHorasUteis: '0', permiteResposta: false, prioridade: 'baixa' },
];

function InboxInternaConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [rows, setRows] = useState<InboxTipoForm[] | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useMemo<InboxTipoForm[]>(() => {
    const t = (
      cfg?.inboxInterna as
        | {
            tipos?: Array<{
              key: string;
              nome: string;
              slaHorasUteis?: number;
              permiteResposta?: boolean;
              prioridade?: string;
            }>;
          }
        | undefined
    )?.tipos;
    if (!t || t.length === 0) return DEFAULT_INBOX_TIPOS;
    return t.map((x) => ({
      key: x.key,
      nome: x.nome,
      slaHorasUteis: String(x.slaHorasUteis ?? 24),
      permiteResposta: x.permiteResposta !== false,
      prioridade: x.prioridade ?? 'media',
    }));
  }, [cfg]);
  const tipos = rows ?? base;

  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

  function setRow(i: number, patch: Partial<InboxTipoForm>) {
    setRows(tipos.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  const add = () =>
    setRows([...tipos, { key: '', nome: '', slaHorasUteis: '24', permiteResposta: true, prioridade: 'media' }]);
  const rm = (i: number) => setRows(tipos.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    try {
      const limpos = tipos
        .map((t) => ({
          key: t.key || slug(t.nome),
          nome: t.nome.trim(),
          slaHorasUteis: Math.max(0, Math.round(Number(t.slaHorasUteis) || 0)),
          permiteResposta: t.permiteResposta,
          prioridade: t.prioridade,
        }))
        .filter((t) => t.key && t.nome);
      await api.patch('/empresas/config', { inboxInterna: { tipos: limpos } });
      toast.success('Canais internos salvos');
      setRows(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        💬 Mensagens internas (canais)
      </h2>
      <p className="text-xs text-muted mt-0">
        Canais de conversa do rep com a empresa, com SLA em horas úteis. Desmarque "responde" para
        canais só-leitura (avisos/broadcast).
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-2 mt-4 max-w-[620px]">
          {tipos.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={t.nome}
                disabled={!podeEditar}
                onChange={(e) => setRow(i, { nome: e.target.value, key: t.key || slug(e.target.value) })}
                placeholder="Nome do canal"
              />
              <Input
                type="number"
                min="0"
                value={t.slaHorasUteis}
                disabled={!podeEditar}
                onChange={(e) => setRow(i, { slaHorasUteis: e.target.value })}
                placeholder="SLA h"
                className="w-[90px]"
              />
              <Select
                value={t.prioridade}
                disabled={!podeEditar}
                onChange={(e) => setRow(i, { prioridade: e.target.value })}
              >
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </Select>
              <label className="flex items-center gap-1 text-[11px] text-muted shrink-0">
                <input
                  type="checkbox"
                  checked={t.permiteResposta}
                  disabled={!podeEditar}
                  onChange={(e) => setRow(i, { permiteResposta: e.target.checked })}
                />
                responde
              </label>
              {podeEditar && (
                <button
                  type="button"
                  onClick={() => rm(i)}
                  className="w-[28px] h-[34px] shrink-0 bg-surface text-danger border border-border-strong rounded-md cursor-pointer"
                  aria-label="Remover canal"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {podeEditar && (
            <button
              type="button"
              onClick={add}
              className="self-start text-[12px] text-primary bg-transparent border-none cursor-pointer px-0"
            >
              + Adicionar canal
            </button>
          )}
          {podeEditar && (
            <button
              type="button"
              data-testid="inbox-config-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar canais'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Pacing de envio de WhatsApp (anti-rajada / humano) — 8º consumidor (no-code). */
interface EnvioWaForm {
  maxPorMinuto: string;
  maxPorMinutoReativo: string;
  jitterMinSeg: string;
  jitterMaxSeg: string;
}

function EnvioWhatsappConfig() {
  const toast = useToast();
  const podeEditar = usePermission('configuracoes.empresa');
  const { data: cfg, loading, refetch } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const [edit, setEdit] = useState<EnvioWaForm | null>(null);
  const [busy, setBusy] = useState(false);

  const base: EnvioWaForm = useMemo(() => {
    const r = (cfg?.envioWhatsapp ?? {}) as {
      maxPorMinuto?: number;
      maxPorMinutoReativo?: number;
      jitterMinSeg?: number;
      jitterMaxSeg?: number;
    };
    return {
      maxPorMinuto: String(r.maxPorMinuto ?? 12),
      maxPorMinutoReativo: String(r.maxPorMinutoReativo ?? 30),
      jitterMinSeg: String(r.jitterMinSeg ?? 1),
      jitterMaxSeg: String(r.jitterMaxSeg ?? 4),
    };
  }, [cfg]);
  const form = edit ?? base;
  const set = (k: keyof EnvioWaForm, v: string) => setEdit({ ...form, [k]: v });

  async function save() {
    setBusy(true);
    try {
      const n = (s: string, d: number) => {
        const v = Math.round(Number(s));
        return Number.isFinite(v) && v >= 0 ? v : d;
      };
      const maxPorMinuto = Math.max(1, n(form.maxPorMinuto, 12));
      const maxPorMinutoReativo = Math.max(1, n(form.maxPorMinutoReativo, 30));
      const jitterMinSeg = n(form.jitterMinSeg, 1);
      const jitterMaxSeg = Math.max(jitterMinSeg, n(form.jitterMaxSeg, 4));
      await api.patch('/empresas/config', {
        envioWhatsapp: { maxPorMinuto, maxPorMinutoReativo, jitterMinSeg, jitterMaxSeg },
      });
      toast.success('Ritmo de envio salvo');
      setEdit(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const intervalo = (s: string, d: number) =>
    Math.ceil(60 / Math.max(1, Math.round(Number(s) || d)));

  return (
    <div className="bg-surface border border-border rounded-[10px] p-6 mt-4">
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        🐢 Ritmo de envio (WhatsApp)
      </h2>
      <p className="text-xs text-muted mt-0">
        Espaça TODA mensagem do WhatsApp (fluxos, campanhas e respostas do bot) pra nunca disparar
        tudo de uma vez — parece humano e protege o número. Vale por empresa.
      </p>
      {loading ? (
        <p className="text-sm text-muted mt-4">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3 mt-4 max-w-[480px]">
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted flex-1">
              Proativo — máx/min (abordagem, campanha)
              <Input
                type="number"
                min="1"
                max="600"
                value={form.maxPorMinuto}
                disabled={!podeEditar}
                onChange={(e) => set('maxPorMinuto', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted flex-1">
              Reativo — máx/min (resposta a quem escreveu)
              <Input
                type="number"
                min="1"
                max="600"
                value={form.maxPorMinutoReativo}
                disabled={!podeEditar}
                onChange={(e) => set('maxPorMinutoReativo', e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted flex-1">
              Variação mínima (s)
              <Input
                type="number"
                min="0"
                value={form.jitterMinSeg}
                disabled={!podeEditar}
                onChange={(e) => set('jitterMinSeg', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted flex-1">
              Variação máxima (s)
              <Input
                type="number"
                min="0"
                value={form.jitterMaxSeg}
                disabled={!podeEditar}
                onChange={(e) => set('jitterMaxSeg', e.target.value)}
              />
            </label>
          </div>
          <p className="text-[11px] text-muted m-0">
            Proativo ≈ 1 a cada {intervalo(form.maxPorMinuto, 12)}s · Reativo ≈ 1 a cada{' '}
            {intervalo(form.maxPorMinutoReativo, 30)}s — ambos + {form.jitterMinSeg}–
            {form.jitterMaxSeg}s de variação aleatória.
          </p>

          {podeEditar && (
            <button
              type="button"
              data-testid="envio-wa-salvar"
              onClick={save}
              disabled={busy}
              className="bg-primary text-white rounded-md py-2 px-4 text-sm font-semibold cursor-pointer border-none self-start mt-2 disabled:opacity-60"
            >
              {busy ? 'Salvando…' : 'Salvar ritmo'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AvancadoTab() {
  const links: Array<{
    to: string;
    emoji: string;
    title: string;
    description: string;
    color: string;
  }> = [
    {
      to: '/integracoes',
      emoji: '🔌',
      title: 'Integrações',
      description: 'OMIE, Meta, ML, Shopee, Amazon, TikTok, WhatsApp',
      color: BRAND.cyan,
    },
    {
      to: '/permissoes',
      emoji: '🔐',
      title: 'Permissões',
      description: 'Matriz Role × Módulo (ver / editar)',
      color: BRAND.magenta,
    },
    {
      to: '/usuarios',
      emoji: '👥',
      title: 'Usuários',
      description: 'Convites, papéis, teto de desconto, comissão',
      color: 'var(--blue)', // accent adaptativo (BRAND.navy fixo somia no card escuro do dark)
    },
    {
      to: '/notificacoes',
      emoji: '🔔',
      title: 'Notificações',
      description: 'Histórico de avisos do sistema',
      color: BRAND.cyan,
    },
    {
      to: '/admin',
      emoji: '🛡️',
      title: 'Painel admin',
      description: 'Status, audit log, dead-letter',
      color: BRAND.magenta,
    },
    {
      to: '/fluxos',
      emoji: '⚡',
      title: 'Fluxos de automação',
      description: 'Triggers e ações via BullMQ',
      color: 'var(--blue)', // accent adaptativo (BRAND.navy fixo somia no card escuro do dark)
    },
    {
      to: '/respostas-rapidas',
      emoji: '💬',
      title: 'Respostas rápidas',
      description: 'Templates pra responder no Inbox com "/"',
      color: BRAND.cyan,
    },
  ];

  return (
    <div
      className="bg-surface border border-border rounded-[10px] p-6"
      id="tab-panel-avancado"
      role="tabpanel"
    >
      <h2 className="mt-0 text-[16px]" style={{ color: 'var(--text)' }}>
        ⚙️ Áreas administrativas relacionadas
      </h2>
      <p className="text-xs text-muted mt-0">
        Atalhos rápidos pras outras telas de configuração e administração.
      </p>
      <div
        className="grid gap-3 mt-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]"
      >
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            data-testid={`config-link-${l.to.replace(/\//g, '')}`}
            className="p-3.5 bg-bg-alt border border-border rounded-[10px] no-underline text-text block"
            style={{
              borderLeft: `3px solid ${l.color}`,
              transition: 'border-color 120ms, transform 120ms',
            }}
          >
            <div className="text-xl mb-1">{l.emoji}</div>
            <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              {l.title}
            </div>
            <div className="text-xs text-muted mt-0.5 leading-[1.4]">
              {l.description}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Logo da empresa (v1.5.0) ──────────────────────────────────────────

function LogoSection({ canEdit }: { canEdit: boolean }) {
  const empresaId = currentEmpresaId();
  const { logoUrl, reload, loading } = useEmpresaLogo(empresaId);

  if (!empresaId) return null;

  return (
    <div
      className="bg-surface border border-border rounded-[10px] p-5"
      data-testid="logo-section"
    >
      <div className="mb-3">
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          🖼️ Logo da empresa
        </div>
        <div className="text-xs text-muted mt-0.5">
          Aparece no header e na sidebar de todos os usuários. Fallback para o logo
          Betinna quando ausente.
        </div>
      </div>
      {!canEdit ? (
        <div className="text-xs text-muted italic">
          Apenas ADMIN ou DIRECTOR pode trocar o logo.
        </div>
      ) : loading ? (
        <div className="text-xs text-muted">Carregando…</div>
      ) : (
        <LogoUploader
          empresaId={empresaId}
          currentLogoUrl={logoUrl}
          onUploaded={reload}
        />
      )}
    </div>
  );
}

function EmpresaFormModal({
  empresa,
  onClose,
  onSaved,
}: {
  empresa: Empresa | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(empresa);
  const [form, setForm] = useState({
    nome: empresa?.nome ?? '',
    cnpj: empresa?.cnpj ?? '',
    ramo: empresa?.ramo ?? '',
    cidade: empresa?.cidade ?? '',
    uf: empresa?.uf ?? '',
    subtitulo: empresa?.subtitulo ?? '',
    descontoPixPct: String(empresa?.descontoPixPct ?? 0),
    descontoBoletoAvistaPct: String(empresa?.descontoBoletoAvistaPct ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
    };
    for (const k of ['cnpj', 'ramo', 'cidade', 'uf', 'subtitulo'] as const) {
      const v = form[k].trim();
      if (v) payload[k] = v;
    }
    // B1 — desconto à vista (sempre enviado, 0 = desligado). Clamp 0–50.
    const pix = Math.min(50, Math.max(0, Number(form.descontoPixPct) || 0));
    const boleto = Math.min(50, Math.max(0, Number(form.descontoBoletoAvistaPct) || 0));
    payload.descontoPixPct = pix;
    payload.descontoBoletoAvistaPct = boleto;
    try {
      if (isEdit && empresa) {
        await api.patch(`/empresas/${empresa.id}`, payload);
      } else {
        await api.post('/empresas', payload);
      }
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doDeactivate() {
    if (!empresa) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/empresas/${empresa.id}`);
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? `Editar ${empresa?.nome}` : 'Nova empresa'}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="bg-surface text-text border border-border-strong rounded-md px-4 py-2 text-[13px] font-medium cursor-pointer tracking-[-0.1px]"
          >
            Cancelar
          </button>
          {isEdit && empresa?.ativo && !confirmDel && (
            <button
              type="button"
              data-testid="emp-deactivate"
              onClick={() => setConfirmDel(true)}
              className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
            >
              Desativar
            </button>
          )}
          {isEdit && confirmDel && (
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
                data-testid="emp-deactivate-confirm"
                onClick={doDeactivate}
                disabled={busy}
                className="bg-danger text-white rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
              >
                {busy ? '…' : 'Confirmar desativação'}
              </button>
            </>
          )}
          {!confirmDel && (
            <button
              type="submit"
              form="emp-form"
              data-testid="emp-save"
              disabled={busy || form.nome.trim().length < 2}
              className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </>
      }
    >
      <form id="emp-form" onSubmit={submit}>
        <FormField label="Nome" required>
          <Input
            data-testid="emp-nome"
            value={form.nome}
            onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
            required
            minLength={2}
            maxLength={200}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="CNPJ" hint="00.000.000/0001-00">
            <Input
              value={form.cnpj}
              onChange={(e) => setForm((s) => ({ ...s, cnpj: maskCNPJ(e.target.value) }))}
              placeholder="00.000.000/0001-00"
              maxLength={18}
              inputMode="numeric"
            />
          </FormField>
          <FormField label="Ramo">
            <Input
              value={form.ramo}
              onChange={(e) => setForm((s) => ({ ...s, ramo: e.target.value }))}
            />
          </FormField>
          <FormField label="Subtítulo / Tag">
            <Input
              value={form.subtitulo}
              onChange={(e) => setForm((s) => ({ ...s, subtitulo: e.target.value }))}
            />
          </FormField>
          <FormField label="UF">
            <UfSelect
              testId="empresa-uf-select"
              value={form.uf}
              onChange={(uf) => setForm((s) => ({ ...s, uf, cidade: '' }))}
            />
          </FormField>
          <FormField label="Cidade">
            <CidadeSelect
              testId="empresa-cidade-select"
              uf={form.uf}
              value={form.cidade}
              onChange={(cidade) => setForm((s) => ({ ...s, cidade }))}
            />
          </FormField>
        </div>

        {/* B1 — Desconto à vista automático */}
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="m-0 mb-1 text-sm">Desconto à vista automático</h4>
          <p className="m-0 mb-3 text-xs text-muted">
            Aplicado automaticamente em pedidos/propostas conforme a forma de pagamento.
            Deixe 0 para desligar. O desconto à vista <strong>não</strong> conta pro teto
            de aprovação do representante (é política da empresa).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Pix (%)" hint="0–50%, aplicado em qualquer Pix">
              <Input
                data-testid="emp-desconto-pix"
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={form.descontoPixPct}
                onChange={(e) => setForm((s) => ({ ...s, descontoPixPct: e.target.value }))}
              />
            </FormField>
            <FormField label="Boleto à vista (%)" hint="0–50%, só boleto com condição à vista">
              <Input
                data-testid="emp-desconto-boleto"
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={form.descontoBoletoAvistaPct}
                onChange={(e) =>
                  setForm((s) => ({ ...s, descontoBoletoAvistaPct: e.target.value }))
                }
              />
            </FormField>
          </div>
        </div>
        {error && (
          <p data-testid="form-error" className="text-danger text-[13px]">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
