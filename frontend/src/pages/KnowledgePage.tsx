import { useRef, useState } from 'react';
import {
  BookPlus,
  Pencil,
  Trash2,
  Settings2,
  BookText,
  FileUp,
  FileText,
  Send,
  AlertTriangle,
  Paperclip,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useToast } from '@/components/toast';
import { useRole } from '@/hooks/usePermission';
import { PageLayout } from '@/components/PageLayout';
import { AtendimentoTabs } from '@/components/AtendimentoTabs';
import { AssistenteTabs } from '@/components/AssistenteTabs';
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

interface KnowledgeDocumento {
  id: string;
  titulo: string;
  fileName: string;
  mimetype: string;
  tamanhoBytes: number;
  podeEnviar: boolean;
  totalChunks: number;
  erroExtracao: string | null;
  criadoEm: string;
}

interface Paginado {
  data: KnowledgeChunk[];
  pagination: { total: number };
}

const VAZIO = { id: '', titulo: '', conteudo: '', categoria: '', ativo: true };

// 14MB raw → ~18,7MB em base64 + overhead do JSON, com folga sob o limite de
// 20MB do backend. 15MB dava EXATAMENTE 20MB em base64 → estourava o parser.
const MAX_BYTES = 14 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    r.readAsDataURL(file);
  });
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function KnowledgePage() {
  const toast = useToast();
  const role = useRole();
  const podeEditar = role === 'ADMIN' || role === 'DIRECTOR';

  const { data, loading, error, refetch } = useApiQuery<Paginado>(
    '/conhecimento?incluirConfig=true&limit=100',
  );
  const docsQuery = useApiQuery<KnowledgeDocumento[]>('/conhecimento/documentos');
  const [form, setForm] = useState<typeof VAZIO | null>(null);
  const [saving, setSaving] = useState(false);

  // Upload de documento.
  const fileRef = useRef<HTMLInputElement>(null);
  const [docForm, setDocForm] = useState<{ titulo: string; podeEnviar: boolean; file: File } | null>(
    null,
  );
  const [enviandoDoc, setEnviandoDoc] = useState(false);

  const lista = data?.data ?? [];
  const documentos = docsQuery.data ?? [];

  function escolherArquivo(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error('Arquivo muito grande', 'O limite é 14MB.');
      return;
    }
    // Título inicial = nome do arquivo sem extensão.
    const base = file.name.replace(/\.[^.]+$/, '');
    setDocForm({ titulo: base.slice(0, 160), podeEnviar: false, file });
  }

  async function salvarDoc() {
    if (!docForm) return;
    if (!docForm.titulo.trim()) {
      toast.error('Dê um título ao documento');
      return;
    }
    setEnviandoDoc(true);
    try {
      const dataBase64 = await fileToBase64(docForm.file);
      // Upload grande: o timeout default de 10s do api.ts mata o envio de um PDF
      // de vários MB em conexão comum — este POST usa 120s.
      await api.post(
        '/conhecimento/documento',
        {
          titulo: docForm.titulo.trim(),
          fileName: docForm.file.name,
          mimetype: docForm.file.type || 'application/octet-stream',
          podeEnviar: docForm.podeEnviar,
          dataBase64,
        },
        { timeoutMs: 120_000 },
      );
      toast.success('Documento anexado', 'O texto foi extraído e indexado pra busca.');
      setDocForm(null);
      docsQuery.refetch();
    } catch (err) {
      toast.error('Falha ao anexar', err instanceof ApiError ? err.message : undefined);
    } finally {
      setEnviandoDoc(false);
    }
  }

  async function alternarEnvio(d: KnowledgeDocumento) {
    try {
      await api.patch(`/conhecimento/documento/${d.id}`, { podeEnviar: !d.podeEnviar });
      docsQuery.refetch();
    } catch (err) {
      toast.error('Falha ao atualizar', err instanceof ApiError ? err.message : undefined);
    }
  }

  // Liga/desliga se o bot considera este trecho (ativo) — direto no card, sem
  // abrir o editor. Espelha o "Bot pode enviar" dos documentos.
  async function alternarAtivo(c: KnowledgeChunk) {
    try {
      await api.patch(`/conhecimento/${c.id}`, { ativo: !c.ativo });
      refetch();
    } catch (err) {
      toast.error('Falha ao atualizar', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function excluirDoc(d: KnowledgeDocumento) {
    if (!window.confirm(`Apagar o documento "${d.titulo}" e seus trechos indexados?`)) return;
    try {
      await api.delete(`/conhecimento/documento/${d.id}`);
      toast.success('Documento apagado');
      docsQuery.refetch();
    } catch (err) {
      toast.error('Falha ao apagar', err instanceof ApiError ? err.message : undefined);
    }
  }

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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              leftIcon={<FileUp className="h-3.5 w-3.5" />}
            >
              Anexar documento
            </Button>
            <Button
              onClick={() => setForm({ ...VAZIO })}
              leftIcon={<BookPlus className="h-3.5 w-3.5" />}
            >
              Novo conhecimento
            </Button>
          </div>
        ) : undefined
      }
    >
      <AtendimentoTabs />
      <AssistenteTabs />
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx,.odt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) escolherArquivo(f);
          e.target.value = '';
        }}
      />
      {documentos.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text">
            <FileText className="h-4 w-4" /> Documentos
            <span className="font-normal text-muted">({documentos.length})</span>
          </h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {documentos.map((d) => (
              <Card key={d.id} padding="md" className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm text-text">{d.titulo}</strong>
                  {d.podeEnviar && (
                    <Badge variant="info" size="sm">
                      <Send className="mr-0.5 inline h-3 w-3" />
                      enviável
                    </Badge>
                  )}
                </div>
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <Paperclip className="h-3 w-3" />
                  {d.fileName} · {formatBytes(d.tamanhoBytes)}
                </span>
                {d.erroExtracao ? (
                  <p className="flex items-start gap-1 text-[11px] text-warning">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {d.erroExtracao}
                  </p>
                ) : (
                  <p className="text-[11px] text-text-subtle">
                    {d.totalChunks} trecho{d.totalChunks === 1 ? '' : 's'} indexado
                    {d.totalChunks === 1 ? '' : 's'} pra busca
                  </p>
                )}
                {podeEditar && (
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <Switch
                      checked={d.podeEnviar}
                      onChange={() => void alternarEnvio(d)}
                      label="Bot pode enviar"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void excluirDoc(d)}
                      leftIcon={<Trash2 className="h-3 w-3" />}
                    >
                      Apagar
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

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
                  {podeEditar && !auto ? (
                    <Switch
                      checked={c.ativo}
                      onChange={() => void alternarAtivo(c)}
                      label={c.ativo ? 'Bot usa' : 'Bot ignora'}
                    />
                  ) : (
                    <span className="text-[11px] text-muted">
                      {c.categoria || '—'}
                      {!c.ativo && ' · inativo'}
                    </span>
                  )}
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

      <Dialog open={docForm !== null} onClose={() => setDocForm(null)} title="Anexar documento">
        {docForm && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              <Paperclip className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">
                {docForm.file.name} · {formatBytes(docForm.file.size)}
              </span>
            </div>
            <Field label="Título" hint="Como esse documento aparece pra você e pro bot.">
              <Input
                value={docForm.titulo}
                onChange={(e) => setDocForm({ ...docForm, titulo: e.target.value })}
                placeholder="Ex: Catálogo 2026"
                maxLength={160}
              />
            </Field>
            <Field
              label="O bot pode enviar este arquivo?"
              hint="Ligado: quando o lead pedir (ex.: a tabela de preços em PDF), o bot manda o arquivo inteiro. Desligado: o bot só usa o conteúdo como fonte de resposta em texto."
            >
              <Switch
                checked={docForm.podeEnviar}
                onChange={(e) => setDocForm({ ...docForm, podeEnviar: e.target.checked })}
                label={docForm.podeEnviar ? 'Pode enviar o arquivo' : 'Só fonte de informação'}
              />
            </Field>
            <p className="text-[11px] text-muted">
              O texto do documento é extraído e indexado pra busca. PDFs escaneados (imagem) podem não
              ter texto extraível — nesse caso o arquivo ainda pode ser enviado, mas não vira fonte de
              resposta.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setDocForm(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void salvarDoc()} loading={enviandoDoc}>
                Anexar
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </PageLayout>
  );
}
