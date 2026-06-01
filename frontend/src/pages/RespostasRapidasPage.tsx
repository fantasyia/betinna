import { useState } from 'react';
import { MessageSquarePlus, Pencil, Trash2, Building2, User } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Switch,
  Textarea,
} from '@/components/ui';

interface RespostaRapida {
  id: string;
  titulo: string;
  atalho: string;
  conteudo: string;
  categoria?: string | null;
  global: boolean;
  criadoPorId: string;
}

const VARIAVEIS = ['{nome_cliente}', '{nome_empresa}', '{representante}', '{ultimo_pedido}'];

const VAZIO = { id: '', titulo: '', atalho: '', conteudo: '', categoria: '', global: false };

export default function RespostasRapidasPage() {
  const toast = useToast();
  const role = useRole();
  const podeGlobal = role === 'ADMIN' || role === 'DIRECTOR';

  const { data, loading, error, refetch } = useApiQuery<RespostaRapida[]>('/respostas-rapidas');
  const [form, setForm] = useState<typeof VAZIO | null>(null);
  const [saving, setSaving] = useState(false);

  const lista = data ?? [];

  async function salvar() {
    if (!form) return;
    if (!form.titulo.trim() || !form.atalho.trim() || !form.conteudo.trim()) {
      toast.error('Preencha título, atalho e conteúdo');
      return;
    }
    setSaving(true);
    try {
      const body = {
        titulo: form.titulo.trim(),
        atalho: form.atalho.trim(),
        conteudo: form.conteudo.trim(),
        categoria: form.categoria.trim() || null,
        global: form.global,
      };
      if (form.id) await api.put(`/respostas-rapidas/${form.id}`, body);
      else await api.post('/respostas-rapidas', body);
      toast.success('Template salvo');
      setForm(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function excluir(r: RespostaRapida) {
    if (!window.confirm(`Apagar o template "${r.titulo}"?`)) return;
    try {
      await api.delete(`/respostas-rapidas/${r.id}`);
      toast.success('Template apagado');
      refetch();
    } catch (err) {
      toast.error('Falha ao apagar', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <PageLayout
      title="Respostas rápidas"
      description="Templates pra responder rápido no Inbox. Digite / no campo de resposta pra inserir."
      actions={
        <Button
          onClick={() => setForm({ ...VAZIO })}
          leftIcon={<MessageSquarePlus className="h-3.5 w-3.5" />}
        >
          Novo template
        </Button>
      }
    >
      <StateView
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={lista.length === 0}
        emptyMessage="Nenhum template ainda. Crie o primeiro pra agilizar o atendimento."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lista.map((r) => (
            <Card key={r.id} padding="md" className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-xs font-mono bg-bg-alt px-1.5 py-0.5 rounded text-primary shrink-0">
                    {r.atalho}
                  </code>
                  <strong className="text-sm truncate">{r.titulo}</strong>
                </div>
                <Badge variant={r.global ? 'primary' : 'neutral'} size="sm">
                  {r.global ? (
                    <>
                      <Building2 className="inline h-3 w-3 mr-0.5" />
                      empresa
                    </>
                  ) : (
                    <>
                      <User className="inline h-3 w-3 mr-0.5" />
                      meu
                    </>
                  )}
                </Badge>
              </div>
              <p className="text-xs text-text-subtle line-clamp-3 whitespace-pre-wrap">{r.conteudo}</p>
              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-[11px] text-muted">{r.categoria || '—'}</span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setForm({
                        id: r.id,
                        titulo: r.titulo,
                        atalho: r.atalho,
                        conteudo: r.conteudo,
                        categoria: r.categoria ?? '',
                        global: r.global,
                      })
                    }
                    leftIcon={<Pencil className="h-3 w-3" />}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void excluir(r)}
                    leftIcon={<Trash2 className="h-3 w-3" />}
                  >
                    Apagar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </StateView>

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Editar template' : 'Novo template'}
      >
        {form && (
          <div className="flex flex-col gap-3">
            <Field label="Título">
              <Input
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                placeholder="Ex: Agradecimento"
                maxLength={80}
              />
            </Field>
            <Field label="Atalho" hint='Digite isso depois de "/" no Inbox. Ex: /obrigado'>
              <Input
                value={form.atalho}
                onChange={(e) => setForm({ ...form, atalho: e.target.value })}
                placeholder="/obrigado"
                maxLength={40}
              />
            </Field>
            <Field
              label="Conteúdo"
              hint={`Variáveis disponíveis: ${VARIAVEIS.join('  ')}`}
            >
              <Textarea
                value={form.conteudo}
                onChange={(e) => setForm({ ...form, conteudo: e.target.value })}
                rows={5}
                maxLength={4000}
                placeholder="Olá {nome_cliente}, obrigado por falar com a {nome_empresa}!"
              />
            </Field>
            <Field label="Categoria (opcional)">
              <Input
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                placeholder="Ex: Saudações"
                maxLength={40}
              />
            </Field>
            {podeGlobal && (
              <Field label="Visibilidade">
                <Switch
                  checked={form.global}
                  onChange={(e) => setForm({ ...form, global: e.target.checked })}
                  label={
                    form.global
                      ? 'Da empresa toda — todos podem usar'
                      : 'Privado — só você usa'
                  }
                />
              </Field>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void salvar()} loading={saving}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </PageLayout>
  );
}
