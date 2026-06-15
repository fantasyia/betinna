import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { CrmTabs } from '@/components/CrmTabs';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Dialog } from '@/components/ui';
import { FormField, Input } from '@/components/FormField';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

interface Tag {
  id: string;
  nome: string;
  cor: string;
  /** Quantidade de clientes que usam essa tag */
  clientesCount?: number;
  criadoEm?: string;
}

const PRESET_COLORS = [
  '#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#facc15',
  '#f97316', '#dc2626', '#ec4899', '#6b7280', '#1f2937',
];

export default function TagsPage() {
  const role = useRole();
  const toast = useToast();
  const canEdit = ['ADMIN', 'DIRECTOR', 'GERENTE'].includes(role ?? '');

  const [search, setSearch] = useState('');
  const path = useMemo(() => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    const s = qs.toString();
    return `/tags${s ? `?${s}` : ''}`;
  }, [search]);

  const { data, loading, error, refetch } = useApiQuery<Tag[] | { data: Tag[] }>(path);
  const tags: Tag[] = Array.isArray(data) ? data : data?.data ?? [];

  const [editing, setEditing] = useState<Tag | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmAsync, ConfirmDialog] = useConfirm();

  async function delTag(t: Tag) {
    const message =
      t.clientesCount && t.clientesCount > 0
        ? `A tag está em uso em ${t.clientesCount} cliente${t.clientesCount === 1 ? '' : 's'} — sairá deles também.`
        : 'Não pode ser desfeito.';
    const ok = await confirmAsync({
      title: `Excluir a tag "${t.nome}"?`,
      message,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/tags/${t.id}`);
      toast.success('Tag excluída');
      refetch();
    } catch (err) {
      toast.error('Falha ao excluir tag', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <PageLayout
      title="Tags"
      actions={
        canEdit ? (
          <button
            type="button"
            data-testid="tag-new"
            onClick={() => setCreating(true)}
            className="bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]"
          >
            + Nova tag
          </button>
        ) : undefined
      }
    >
      <CrmTabs />
      <div className="bg-surface border border-border rounded-[10px] p-6">
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar tag…" />
        </FilterBar>

        <StateView
          loading={loading}
          error={error}
          empty={!loading && !error && tags.length === 0}
          emptyMessage={search ? 'Nenhuma tag encontrada com este nome.' : 'Sem tags ainda. Crie a primeira.'}
          onRetry={refetch}
        >
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3"
          >
            {tags.map((t) => (
              <div
                key={t.id}
                data-testid={`tag-card-${t.id}`}
                className="border border-border rounded-md p-3 flex flex-col gap-2 bg-surface"
                style={{ borderLeft: `4px solid ${t.cor}` }}
              >
                <header className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: t.cor }}
                  />
                  <strong className="flex-1 text-[14px] overflow-hidden text-ellipsis">
                    {t.nome}
                  </strong>
                </header>
                <p className="m-0 text-[12px] text-muted">
                  {t.clientesCount ?? 0} {t.clientesCount === 1 ? 'cliente' : 'clientes'}
                </p>
                {canEdit && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      data-testid={`tag-edit-${t.id}`}
                      onClick={() => setEditing(t)}
                      className="bg-surface text-text border border-border-strong rounded-md px-[0.625rem] py-1 text-[12px] font-medium cursor-pointer tracking-[-0.1px]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      data-testid={`tag-del-${t.id}`}
                      onClick={() => delTag(t)}
                      className="bg-danger text-white rounded-md px-[0.625rem] py-1 text-[12px] font-semibold cursor-pointer tracking-[-0.1px]"
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </StateView>
      </div>

      {(creating || editing) && (
        <TagFormModal
          tag={editing}
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
      {ConfirmDialog}
    </PageLayout>
  );
}

function TagFormModal({
  tag,
  onClose,
  onSaved,
}: {
  tag: Tag | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(tag);
  const [nome, setNome] = useState(tag?.nome ?? '');
  const [cor, setCor] = useState(tag?.cor ?? PRESET_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { nome: nome.trim(), cor };
      if (isEdit && tag) {
        await api.patch(`/tags/${tag.id}`, payload);
      } else {
        await api.post('/tags', payload);
      }
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
      title={isEdit ? `Editar tag — ${tag?.nome}` : 'Nova tag'}
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
            form="tag-form"
            data-testid="tag-save"
            disabled={busy || nome.trim().length === 0}
            className={cn(
              'bg-primary text-primary-contrast rounded-md px-4 py-2 text-[13px] font-semibold cursor-pointer tracking-[-0.1px]',
              busy ? 'opacity-60' : 'opacity-100',
            )}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="tag-form" onSubmit={submit}>
        <FormField label="Nome" htmlFor="tag-nome" required>
          <Input
            id="tag-nome"
            data-testid="tag-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={1}
            maxLength={50}
            autoFocus
          />
        </FormField>
        <FormField label="Cor" hint="Clique numa cor abaixo ou digite hex">
          <div className="flex gap-[6px] flex-wrap mb-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`tag-color-${c}`}
                onClick={() => setCor(c)}
                className="w-8 h-8 rounded-md cursor-pointer p-0"
                style={{
                  background: c,
                  border: `2px solid ${cor === c ? 'var(--text)' : 'transparent'}`,
                }}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
          <Input
            data-testid="tag-cor-hex"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            onBlur={(e) => {
              // Normaliza no blur: adiciona '#', completa pra 6 chars, lowercase.
              // Se inválido, reverte pro último válido (state inicial).
              const raw = e.target.value.trim().toLowerCase();
              const candidate = raw.startsWith('#') ? raw : `#${raw}`;
              if (/^#[0-9a-f]{6}$/.test(candidate)) {
                setCor(candidate);
              } else if (/^#[0-9a-f]{3}$/.test(candidate)) {
                // Aceita short hex (#RGB) expandindo pra #RRGGBB
                const c = candidate;
                setCor(`#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`);
              }
              // Inválido: mantém o que tá. UI mostra erro via pattern HTML5 +
              // o backend (Zod) rejeita no submit.
            }}
            placeholder="#RRGGBB"
            pattern="^#[0-9a-fA-F]{6}$"
            title="Hex color no formato #RRGGBB (ex: #7c3aed)"
          />
        </FormField>
        <div className="flex items-center gap-2 p-3 bg-bg-alt border border-border rounded-md mt-2">
          <span
            className="w-4 h-4 rounded-full"
            style={{ background: cor }}
          />
          <span className="font-semibold">{nome || 'Preview'}</span>
        </div>
        {error && <p className="text-danger text-[13px]">{error}</p>}
      </form>
    </Dialog>
  );
}
