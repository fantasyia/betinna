import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { Modal } from '@/components/Modal';
import { FormField, Input } from '@/components/FormField';
import { useToast } from '@/components/toast';
import { btn, btnDanger, btnSecondary, card, colors } from '@/components/styles';

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

  async function delTag(t: Tag) {
    const msg =
      t.clientesCount && t.clientesCount > 0
        ? `Excluir a tag "${t.nome}"? Ela está em uso em ${t.clientesCount} cliente${t.clientesCount === 1 ? '' : 's'} — sairá deles também.`
        : `Excluir a tag "${t.nome}"?`;
    if (!confirm(msg)) return;
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
            style={btn}
          >
            + Nova tag
          </button>
        ) : undefined
      }
    >
      <div style={card}>
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
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '0.75rem',
            }}
          >
            {tags.map((t) => (
              <div
                key={t.id}
                data-testid={`tag-card-${t.id}`}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderLeft: `4px solid ${t.cor}`,
                  borderRadius: 6,
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  background: colors.surface,
                }}
              >
                <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: t.cor,
                      flexShrink: 0,
                    }}
                  />
                  <strong style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.nome}
                  </strong>
                </header>
                <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>
                  {t.clientesCount ?? 0} {t.clientesCount === 1 ? 'cliente' : 'clientes'}
                </p>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      data-testid={`tag-edit-${t.id}`}
                      onClick={() => setEditing(t)}
                      style={{ ...btnSecondary, padding: '0.25rem 0.625rem', fontSize: 12 }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      data-testid={`tag-del-${t.id}`}
                      onClick={() => delTag(t)}
                      style={{ ...btnDanger, padding: '0.25rem 0.625rem', fontSize: 12 }}
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
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Editar tag — ${tag?.nome}` : 'Nova tag'}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            form="tag-form"
            data-testid="tag-save"
            disabled={busy || nome.trim().length === 0}
            style={{ ...btn, opacity: busy ? 0.6 : 1 }}
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`tag-color-${c}`}
                onClick={() => setCor(c)}
                style={{
                  width: 32,
                  height: 32,
                  background: c,
                  border: `2px solid ${cor === c ? colors.text : 'transparent'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  padding: 0,
                }}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
          <Input
            data-testid="tag-cor-hex"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            placeholder="#RRGGBB"
            pattern="^#[0-9a-fA-F]{6}$"
          />
        </FormField>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            background: '#fafbfc',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            marginTop: '0.5rem',
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: cor,
            }}
          />
          <span style={{ fontWeight: 600 }}>{nome || 'Preview'}</span>
        </div>
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </form>
    </Modal>
  );
}
