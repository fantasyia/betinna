import { useMemo, useState } from 'react';
import { AlertCircle, Play, Plus, Trash2, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useRole } from '@/hooks/usePermission';
import { useToast } from '@/components/toast';
import { PageLayout } from '@/components/PageLayout';
import { StateView } from '@/components/StateView';
import { Badge, Button, Card, Dialog, Field, Input, Textarea } from '@/components/ui';

/**
 * TREINAMENTOS INTERNOS — os vídeos que a empresa deixa pro funcionário.
 *
 * 📌 O vídeo NÃO passa pelo nosso servidor: fica no YouTube e é servido por eles;
 * aqui vive só o ponteiro. Foi a escolha do Léo (18/09) pelo motivo certo — vídeo
 * é o que deixa plataforma pesada e cara.
 *
 * ⚠️ O vídeo precisa estar como **Não listado**, não "Privado". Não listado some
 * da busca e do canal mas EMBEDA; privado não embeda, e o funcionário vê "vídeo
 * indisponível". A URL é idêntica nos dois casos, então esse é o primeiro lugar
 * a olhar quando um treinamento não abre.
 */

interface Treinamento {
  id: string;
  titulo: string;
  descricao: string | null;
  youtubeId: string;
  categoria: string | null;
  ordem: number;
  ativo: boolean;
  urlEmbed: string;
  urlMiniatura: string;
}

const SEM_CATEGORIA = 'Geral';

export default function TreinamentosPage() {
  const role = useRole();
  const toast = useToast();
  const podeGerenciar = role === 'ADMIN' || role === 'DIRECTOR';

  const {
    data: itens,
    loading,
    error,
    refetch,
  } = useApiQuery<Treinamento[]>(
    `/treinamentos${podeGerenciar ? '?incluirInativos=true' : ''}`,
  );

  const [assistindo, setAssistindo] = useState<Treinamento | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [form, setForm] = useState({ titulo: '', video: '', categoria: '', descricao: '' });

  /** Agrupa por categoria — treinamento tem trilha, não é uma pilha só. */
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Treinamento[]>();
    for (const t of itens ?? []) {
      const chave = t.categoria?.trim() || SEM_CATEGORIA;
      mapa.set(chave, [...(mapa.get(chave) ?? []), t]);
    }
    return [...mapa.entries()];
  }, [itens]);

  async function salvar() {
    if (!form.titulo.trim() || !form.video.trim()) {
      setErroForm('Título e link do vídeo são obrigatórios.');
      return;
    }
    setSalvando(true);
    setErroForm(null);
    try {
      await api.post('/treinamentos', {
        titulo: form.titulo.trim(),
        video: form.video.trim(),
        categoria: form.categoria.trim() || undefined,
        descricao: form.descricao.trim() || undefined,
        ordem: (itens?.length ?? 0) + 1,
      });
      toast.success('Treinamento cadastrado');
      setCriando(false);
      setForm({ titulo: '', video: '', categoria: '', descricao: '' });
      refetch();
    } catch (e) {
      // O backend recusa link que não é vídeo do YouTube, com a frase que
      // explica o que colar. Ela é melhor que qualquer coisa que a tela invente.
      setErroForm(apiErrorMessage(e));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(t: Treinamento) {
    if (!window.confirm(`Apagar "${t.titulo}"? O vídeo continua no YouTube.`)) return;
    try {
      await api.delete(`/treinamentos/${t.id}`);
      toast.success('Treinamento removido');
      refetch();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <PageLayout
      title="Treinamentos"
      description="Vídeos internos da empresa."
      actions={
        podeGerenciar ? (
          <Button onClick={() => setCriando(true)} data-testid="treinamento-novo">
            <Plus size={16} aria-hidden="true" /> Adicionar vídeo
          </Button>
        ) : undefined
      }
    >
      <StateView
        loading={loading}
        error={error}
        empty={!loading && !error && (itens?.length ?? 0) === 0}
        onRetry={refetch}
        emptyMessage={
          podeGerenciar
            ? 'Nenhum treinamento ainda. Suba o vídeo no YouTube como "Não listado" e cole o link aqui.'
            : 'Nenhum treinamento publicado ainda.'
        }
      >
        <div className="flex flex-col gap-6" data-testid="treinamentos-lista">
          {porCategoria.map(([categoria, videos]) => (
            <section key={categoria}>
              <h2 className="mb-3 text-sm font-medium text-text-subtle">{categoria}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((t) => (
                  <Card key={t.id} className="overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAssistindo(t)}
                      data-testid={`treinamento-abrir-${t.id}`}
                      className="group relative block w-full text-left"
                      aria-label={`Assistir ${t.titulo}`}
                    >
                      {/* A capa também vem do YouTube — nada de imagem no nosso storage. */}
                      <img
                        src={t.urlMiniatura}
                        alt=""
                        loading="lazy"
                        className="aspect-video w-full object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                        <Play size={32} className="text-white" aria-hidden="true" />
                      </span>
                    </button>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{t.titulo}</p>
                        {!t.ativo && <Badge variant="warning">fora do ar</Badge>}
                      </div>
                      {t.descricao && (
                        <p className="mt-1 line-clamp-2 text-xs text-text-subtle">{t.descricao}</p>
                      )}
                      {podeGerenciar && (
                        <button
                          type="button"
                          onClick={() => remover(t)}
                          aria-label={`Apagar ${t.titulo}`}
                          className="mt-2 text-text-subtle hover:text-danger"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      </StateView>

      {/* O player só monta quando alguém clica: iframe de YouTube em cada card
          carregaria dezenas de players de uma vez e derrubaria a página. */}
      <Dialog open={!!assistindo} onClose={() => setAssistindo(null)} title={assistindo?.titulo}>
        {assistindo && (
          <div>
            <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
              <iframe
                src={assistindo.urlEmbed}
                title={assistindo.titulo}
                className="h-full w-full"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                data-testid="treinamento-player"
              />
            </div>
            {assistindo.descricao && (
              <p className="mt-3 whitespace-pre-line text-sm text-text-subtle">
                {assistindo.descricao}
              </p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog open={criando} onClose={() => setCriando(false)} title="Adicionar treinamento">
        <div className="flex flex-col gap-3">
          <Field label="Título" required>
            <Input
              data-testid="treinamento-titulo"
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
              placeholder="Como apresentar o Master Block"
            />
          </Field>
          <Field
            label="Link do vídeo"
            required
            hint='Suba no YouTube como "Não listado" — privado não abre aqui.'
          >
            <Input
              data-testid="treinamento-video"
              value={form.video}
              onChange={(e) => setForm((f) => ({ ...f, video: e.target.value }))}
              placeholder="https://youtu.be/…"
            />
          </Field>
          <Field label="Categoria" hint="Agrupa na lista. Ex.: Comercial, Instalação.">
            <Input
              data-testid="treinamento-categoria"
              value={form.categoria}
              onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
            />
          </Field>
          <Field label="Descrição">
            <Textarea
              data-testid="treinamento-descricao"
              rows={3}
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
          </Field>

          {erroForm && (
            <div
              data-testid="treinamento-erro"
              className="flex items-start gap-2 rounded-md bg-danger/15 px-3 py-2 text-sm text-danger"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{erroForm}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCriando(false)}>
              <X size={16} aria-hidden="true" /> Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando} data-testid="treinamento-salvar">
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </Dialog>
    </PageLayout>
  );
}
