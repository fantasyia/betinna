import { useState } from 'react';
import { BookPlus, Pencil, Trash2, Settings2, BookText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Dialog, Field, Input, Switch, Textarea } from '@/components/ui';

interface KnowledgeChunk {
  id: string;
  fonte: 'MANUAL' | 'CONFIG' | 'MATERIAL';
  titulo: string;
  conteudo: string;
  categoria: string | null;
  ativo: boolean;
}

interface Paginado {
  data: KnowledgeChunk[];
  pagination: { total: number };
}

const VAZIO = { id: '', titulo: '', conteudo: '', categoria: '', ativo: true };

export default function KnowledgePage() {
  const toast = useToast();
  const role = useRole();
  const podeEditar = role === 'ADMIN' || role === 'DIRECTOR';

  const { data, loading, error, refetch } = useApiQuery<Paginado>(
    '/conhecimento?incluirConfig=true&limit=100',
  );
  const [form, setForm] = useState<typeof VAZIO | null>(null);
  const [saving, setSaving] = useState(false);

  const lista = data?.data ?? [];

  async function salvar() {
    if (!form) return;
    if (!form.titulo.trim() || !form.conteudo.trim()) {
      toast.error('Preencha título e conteúdo');
      return;
    }
    setSaving(true);
    try {
      const body = {
        titulo: form.titulo.trim(),
        conteudo: form.conteudo.trim(),
        categoria: form.categoria.trim() || undefined,
        ativo: form.ativo,
      };
      if (form.id) await api.patch(`/conhecimento/${form.id}`, body);
      else await api.post('/conhecimento', body);
      toast.success('Conhecimento salvo');
      setForm(null);
      refetch();
    } catch (err) {
      toast.error('Falha ao salvar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function excluir(c: KnowledgeChunk) {
    if (!window.confirm(`Apagar "${c.titulo}"?`)) return;
    try {
      await api.delete(`/conhecimento/${c.id}`);
      toast.success('Apagado');
      refetch();
    } catch (err) {
      toast.error('Falha ao apagar', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <PageLayout
      title="Base de conhecimento"
      description="O que o bot pode consultar pra responder (FAQ, condições, políticas). Itens automáticos vêm da configuração da empresa."
      actions={
        podeEditar ? (
          <Button onClick={() => setForm({ ...VAZIO })} leftIcon={<BookPlus className="h-3.5 w-3.5" />}>
            Novo conhecimento
          </Button>
        ) : undefined
      }
    >
      <StateView
        loading={loading}
        error={error}
        onRetry={refetch}
        empty={lista.length === 0}
        emptyMessage="Nada cadastrado ainda. Adicione perguntas/respostas que o bot deve saber."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lista.map((c) => {
            const auto = c.fonte === 'CONFIG';
            return (
              <Card key={c.id} padding="md" className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm truncate text-text">{c.titulo}</strong>
                  <Badge variant={auto ? 'info' : 'neutral'} size="sm">
                    {auto ? (
                      <>
                        <Settings2 className="inline h-3 w-3 mr-0.5" />
                        automático
                      </>
                    ) : (
                      <>
                        <BookText className="inline h-3 w-3 mr-0.5" />
                        manual
                      </>
                    )}
                  </Badge>
                </div>
                <p className="text-xs text-text-subtle line-clamp-3 whitespace-pre-wrap">
                  {c.conteudo}
                </p>
                <div className="flex items-center justify-between mt-auto pt-1">
                  <span className="text-[11px] text-muted">
                    {c.categoria || '—'}
                    {!c.ativo && ' · inativo'}
                  </span>
                  {podeEditar && !auto && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setForm({
                            id: c.id,
                            titulo: c.titulo,
                            conteudo: c.conteudo,
                            categoria: c.categoria ?? '',
                            ativo: c.ativo,
                          })
                        }
                        leftIcon={<Pencil className="h-3 w-3" />}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void excluir(c)}
                        leftIcon={<Trash2 className="h-3 w-3" />}
                      >
                        Apagar
                      </Button>
                    </div>
                  )}
                  {auto && (
                    <span className="text-[11px] text-muted italic">
                      gerado da config — edite em Configurações
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </StateView>

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Editar conhecimento' : 'Novo conhecimento'}
      >
        {form && (
          <div className="flex flex-col gap-3">
            <Field label="Título" hint="Resumo curto (ex.: Prazo de entrega)">
              <Input
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                placeholder="Ex: Prazo de entrega"
                maxLength={160}
              />
            </Field>
            <Field label="Conteúdo" hint="A resposta que o bot pode usar. Seja específico e correto.">
              <Textarea
                value={form.conteudo}
                onChange={(e) => setForm({ ...form, conteudo: e.target.value })}
                rows={5}
                maxLength={5000}
                placeholder="Entregamos em todo o Brasil em até 7 dias úteis após a confirmação do pagamento."
              />
            </Field>
            <Field label="Categoria (opcional)">
              <Input
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                placeholder="Ex: Entrega"
                maxLength={60}
              />
            </Field>
            <Field label="Ativo">
              <Switch
                checked={form.ativo}
                onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                label={form.ativo ? 'O bot pode usar' : 'Oculto do bot'}
              />
            </Field>
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
