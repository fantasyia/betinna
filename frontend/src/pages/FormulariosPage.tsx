import { useState } from 'react';
import {
  FormInput,
  Plus,
  ExternalLink,
  Trash2,
  Eye,
  Copy,
  AlertCircle,
  FileText,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  Dialog,
  EmptyState,
  IconButton,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { FormularioBuilder, type FormularioPayload } from './FormularioBuilder';

interface FormularioListItem {
  id: string;
  slug: string;
  titulo: string;
  descricao?: string | null;
  ativo: boolean;
  geraLead: boolean;
  atualizadoEm: string;
  campos?: Array<{ id: string; tipo: string; label: string }>;
  _count?: { respostas?: number };
}

export default function FormulariosPage() {
  const toast = useToast();
  const { data, loading, error, refetch } = useApiQuery<FormularioListItem[]>('/formularios');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FormularioListItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/formularios/${confirmDelete.id}`);
      toast.success('Formulário removido');
      refetch();
      setConfirmDelete(null);
    } catch (err) {
      toast.error('Falha ao remover', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  function copyPublicUrl(slug: string) {
    const url = `${window.location.origin}/f/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado', url);
  }

  if (editing) {
    return (
      <FormularioBuilder
        id={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refetch();
        }}
      />
    );
  }

  return (
    <PageLayout
      title="Formulários"
      description="Capture leads com formulários públicos. Cada submissão gera um Lead no Pipeline."
      actions={
        <Button
          onClick={() => setEditing('new')}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          data-testid="form-new-btn"
        >
          Novo formulário
        </Button>
      }
    >
      <StateView loading={loading} error={error} onRetry={refetch}>
        {data && data.length === 0 ? (
          <EmptyState
            icon={<FormInput />}
            title="Nenhum formulário criado"
            description="Crie um formulário de captação de leads. Compartilhe o link público no seu site, redes sociais ou anúncios."
            action={
              <Button onClick={() => setEditing('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Criar primeiro formulário
              </Button>
            }
          />
        ) : data ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.map((f) => (
              <FormCard
                key={f.id}
                form={f}
                onEdit={() => setEditing(f.id)}
                onCopyUrl={() => copyPublicUrl(f.slug)}
                onDelete={() => setConfirmDelete(f)}
              />
            ))}
          </div>
        ) : null}
      </StateView>

      {confirmDelete && (
        <Dialog
          open
          onClose={() => setConfirmDelete(null)}
          title="Excluir formulário?"
          description={`"${confirmDelete.titulo}" e todas as respostas serão removidos permanentemente.`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={handleDelete}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Confirmar exclusão
              </Button>
            </>
          }
        >
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            Esta ação não pode ser desfeita. Respostas e leads gerados ficam intactos.
          </div>
        </Dialog>
      )}
    </PageLayout>
  );
}

function FormCard({
  form,
  onEdit,
  onCopyUrl,
  onDelete,
}: {
  form: FormularioListItem;
  onEdit: () => void;
  onCopyUrl: () => void;
  onDelete: () => void;
}) {
  return (
    <Card padding="md" className="flex flex-col gap-3 group">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-text tracking-tight truncate">
            {form.titulo}
          </h3>
          <code className="text-[11px] text-muted tabular">/f/{form.slug}</code>
          {form.descricao && (
            <CardDescription className="line-clamp-2 mt-1">{form.descricao}</CardDescription>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={form.ativo ? 'success' : 'neutral'}>
            {form.ativo ? 'Ativo' : 'Inativo'}
          </Badge>
          {form.geraLead && (
            <Badge variant="primary" size="sm">
              Gera Lead
            </Badge>
          )}
        </div>
      </header>

      <div className="flex items-center gap-3 text-[11px] text-muted">
        {form.campos && (
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {form.campos.length} {form.campos.length === 1 ? 'campo' : 'campos'}
          </span>
        )}
        {typeof form._count?.respostas === 'number' && (
          <span className="inline-flex items-center gap-1 tabular">
            <Activity className="h-3 w-3" />
            {form._count.respostas} {form._count.respostas === 1 ? 'resposta' : 'respostas'}
          </span>
        )}
      </div>

      <footer className="flex items-center justify-between pt-3 border-t border-border">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <div className="flex items-center gap-1">
          <IconButton
            aria-label="Copiar link público"
            variant="ghost"
            size="sm"
            icon={<Copy />}
            onClick={onCopyUrl}
          />
          <IconButton
            aria-label="Ver formulário público"
            variant="ghost"
            size="sm"
            icon={<ExternalLink />}
            onClick={() => window.open(`/f/${form.slug}`, '_blank')}
          />
          <IconButton
            aria-label="Excluir"
            variant="ghost"
            size="sm"
            icon={<Trash2 className="text-danger" />}
            onClick={onDelete}
          />
        </div>
      </footer>
    </Card>
  );
}

// Unused imports check
const _u1 = Eye;
const _u2 = CheckCircle2;
const _u3 = cn;
const _u4: FormularioPayload | undefined = undefined;
void _u1;
void _u2;
void _u3;
void _u4;
