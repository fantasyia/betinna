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
        color: active ? BRAND.navy : 'var(--muted)',
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
      <h2 className="mt-0 text-[16px]" style={{ color: BRAND.navy }}>
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
      <h2 className="mt-0 text-[16px]" style={{ color: BRAND.navy }}>
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
      color: BRAND.navy,
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
      color: BRAND.navy,
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
      <h2 className="mt-0 text-[16px]" style={{ color: BRAND.navy }}>
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
            <div className="font-semibold text-sm" style={{ color: BRAND.navy }}>
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
        <div className="text-sm font-bold" style={{ color: BRAND.navy }}>
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
