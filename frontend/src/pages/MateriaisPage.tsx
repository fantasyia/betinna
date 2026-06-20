import { useMemo, useState } from 'react';
import { Lock, Link2, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery, type PaginatedResponse } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { VendasTabs } from '@/components/VendasTabs';
import { Table, Pagination, type Column } from '@/components/Table';
import { StateView } from '@/components/StateView';
import { FilterBar } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input, Select, Textarea } from '@/components/FormField';
import { useToast } from '@/components/toast';

interface Material {
  id: string;
  tipo: string;
  titulo: string;
  descricao?: string | null;
  categoria?: string | null;
  arquivoNome: string;
  mimeType?: string | null;
  tamanho?: number | null;
  versao: number;
  confidencial: boolean;
  criadoPorNome?: string | null;
  criadoEm: string;
}

interface TipoMaterial {
  key: string;
  label: string;
}

const DEFAULT_TIPOS: TipoMaterial[] = [
  { key: 'ficha_tecnica', label: 'Ficha técnica' },
  { key: 'foto_hd', label: 'Foto HD' },
  { key: 'apresentacao', label: 'Apresentação' },
  { key: 'video', label: 'Vídeo' },
  { key: 'certificacao', label: 'Certificação' },
  { key: 'tabela_comercial', label: 'Tabela comercial' },
  { key: 'tutorial', label: 'Tutorial' },
];

const fmtTamanho = (b?: number | null) => {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export default function MateriaisPage() {
  const toast = useToast();
  const role = useRole();
  const podeGerir = role === 'ADMIN' || role === 'DIRECTOR';

  const [page, setPage] = useState(1);
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [criando, setCriando] = useState(false);

  const { data: cfg } = useApiQuery<Record<string, unknown>>('/empresas/config');
  const tipos = useMemo<TipoMaterial[]>(() => {
    const t = (cfg?.materiaisVenda as { tipos?: TipoMaterial[] } | undefined)?.tipos;
    return t && t.length > 0 ? t : DEFAULT_TIPOS;
  }, [cfg]);
  const tipoLabel = (key: string) => tipos.find((t) => t.key === key)?.label ?? key;

  const listPath = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: '50' });
    if (tipoFiltro) p.set('tipo', tipoFiltro);
    return `/materiais?${p.toString()}`;
  }, [page, tipoFiltro]);

  const { data: resp, loading, error, refetch } = useApiQuery<PaginatedResponse<Material>>(listPath);

  async function abrirLink(id: string) {
    try {
      const r = await api.get<{ url: string }>(`/materiais/${id}/link`);
      window.open(r.url, '_blank', 'noopener');
      try {
        await navigator.clipboard.writeText(r.url);
        toast.success('Link copiado', 'Válido por 1h.');
      } catch {
        toast.success('Link aberto', 'Válido por 1h.');
      }
    } catch (err) {
      toast.error('Falha ao gerar link', apiErrorMessage(err));
    }
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este material? A ação não pode ser desfeita.')) return;
    try {
      await api.delete(`/materiais/${id}`);
      toast.success('Material excluído');
      refetch();
    } catch (err) {
      toast.error('Falha ao excluir', apiErrorMessage(err));
    }
  }

  const columns: Column<Material>[] = [
    {
      key: 'titulo',
      header: 'Título',
      render: (m) => (
        <div>
          <div className="font-semibold flex items-center gap-1.5">
            {m.titulo}
            {m.confidencial && <Lock size={12} className="text-danger" aria-label="Confidencial" />}
          </div>
          <div className="text-[11px] text-muted">
            {m.arquivoNome} · {fmtTamanho(m.tamanho)} · v{m.versao}
          </div>
        </div>
      ),
    },
    { key: 'tipo', header: 'Tipo', render: (m) => tipoLabel(m.tipo) },
    { key: 'categoria', header: 'Categoria', render: (m) => m.categoria ?? '—' },
    { key: 'criadoPor', header: 'Publicado por', render: (m) => m.criadoPorNome ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (m) => (
        <div className="flex gap-1 justify-end">
          <button
            type="button"
            data-testid={`material-link-${m.id}`}
            onClick={() => abrirLink(m.id)}
            className="bg-surface text-text border border-border-strong rounded-md font-medium cursor-pointer px-2.5 py-1 text-[12px] inline-flex items-center gap-1"
          >
            <Link2 size={13} /> Link
          </button>
          {podeGerir && (
            <button
              type="button"
              data-testid={`material-del-${m.id}`}
              onClick={() => excluir(m.id)}
              className="bg-surface text-danger border border-border-strong rounded-md font-medium cursor-pointer px-2.5 py-1 text-[12px] inline-flex items-center gap-1"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title="Materiais de venda"
      actions={
        podeGerir ? (
          <button
            type="button"
            data-testid="material-new-btn"
            onClick={() => setCriando(true)}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            + Novo material
          </button>
        ) : undefined
      }
    >
      <VendasTabs />
      <div className="bg-surface border border-border rounded-[10px] p-6">
        <FilterBar>
          <Select
            data-testid="filter-tipo"
            value={tipoFiltro}
            onChange={(e) => {
              setTipoFiltro(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos os tipos</option>
            {tipos.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!resp || resp.data.length === 0}
          emptyMessage="Nenhum material publicado ainda."
          onRetry={refetch}
        >
          {resp && (
            <>
              <Table data={resp.data} columns={columns} rowKey={(m) => m.id} />
              <Pagination pagination={resp.pagination} onPageChange={setPage} />
            </>
          )}
        </StateView>
      </div>

      {criando && (
        <UploadDialog
          tipos={tipos}
          onClose={() => setCriando(false)}
          onCreated={() => {
            setCriando(false);
            refetch();
          }}
        />
      )}
    </PageLayout>
  );
}

function UploadDialog({
  tipos,
  onClose,
  onCreated,
}: {
  tipos: TipoMaterial[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [tipo, setTipo] = useState(tipos[0]?.key ?? 'ficha_tecnica');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('');
  const [confidencial, setConfidencial] = useState(false);
  const [busy, setBusy] = useState(false);

  async function salvar() {
    if (!file) {
      toast.error('Selecione um arquivo');
      return;
    }
    if (titulo.trim().length < 2) {
      toast.error('Informe um título');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('tipo', tipo);
      fd.append('titulo', titulo.trim());
      if (descricao.trim()) fd.append('descricao', descricao.trim());
      if (categoria.trim()) fd.append('categoria', categoria.trim());
      fd.append('confidencial', String(confidencial));

      // api client é JSON-only → fetch direto pro multipart (padrão de upload do app).
      const sess = await import('@/lib/auth-store').then((m) => m.getSession());
      const baseUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/v1/materiais`, {
        method: 'POST',
        body: fd,
        headers: {
          ...(sess?.accessToken ? { Authorization: `Bearer ${sess.accessToken}` } : {}),
          ...(sess?.user.empresaIdAtiva ? { 'X-Empresa-Id': sess.user.empresaIdAtiva } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Falha no upload (${res.status})`);
      }
      toast.success('Material publicado');
      onCreated();
    } catch (err) {
      toast.error('Falha ao publicar', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Novo material"
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
            data-testid="material-upload-confirm"
            disabled={busy}
            onClick={salvar}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer disabled:opacity-60"
          >
            {busy ? 'Enviando…' : 'Publicar'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Arquivo" htmlFor="mat-file" required>
          <input
            id="mat-file"
            type="file"
            data-testid="material-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </FormField>
        <FormField label="Tipo" htmlFor="mat-tipo">
          <Select id="mat-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tipos.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Título" htmlFor="mat-titulo" required>
          <Input
            id="mat-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Ficha técnica Óleo 5L"
          />
        </FormField>
        <FormField label="Categoria (opcional)" htmlFor="mat-cat">
          <Input id="mat-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
        </FormField>
        <FormField label="Descrição (opcional)" htmlFor="mat-desc">
          <Textarea id="mat-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confidencial}
            onChange={(e) => setConfidencial(e.target.checked)}
          />
          Confidencial (não compartilhar fora da empresa)
        </label>
      </div>
    </Dialog>
  );
}
