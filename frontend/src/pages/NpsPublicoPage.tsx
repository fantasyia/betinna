import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * NpsPublicoPage — pesquisa pública em /n/:slug
 *
 * Layout focado: cliente clica numa nota 0-10, escreve comentário opcional,
 * envia. Pré-fim, mostra agradecimento.
 */

interface PesquisaPublica {
  slug: string;
  titulo: string;
  descricao?: string | null;
  mensagemAgradecimento?: string | null;
  pergunta: string;
  perguntaFollowUp?: string | null;
}

export default function NpsPublicoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [pesquisa, setPesquisa] = useState<PesquisaPublica | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [contato, setContato] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api
      // Página pública: não anexar Authorization/X-Empresa-Id do usuário logado a um
      // endpoint público (vazaria credenciais da sessão pra uma rota sem auth).
      .get<PesquisaPublica>(`/n/${slug}`, { skipAuth: true })
      .then(setPesquisa)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Pesquisa não encontrada'),
      )
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleSubmit() {
    if (nota === null) {
      setError('Escolha uma nota de 0 a 10');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ ok: true; message: string }>(
        `/n/${slug}/submit`,
        {
          nota,
          comentario: comentario.trim() || null,
          contato: contato.trim() || null,
        },
        { skipAuth: true },
      );
      setSuccess({ message: res.message });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao enviar');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-12 text-muted">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Carregando…
        </div>
      </Shell>
    );
  }

  if (error && !pesquisa) {
    return (
      <Shell>
        <div className="text-center py-12">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger mb-3">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-text mb-2">Pesquisa indisponível</h1>
          <p className="text-sm text-text-subtle">{error}</p>
        </div>
      </Shell>
    );
  }

  if (success) {
    return (
      <Shell>
        <div className="text-center py-12">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success mb-4">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-text mb-2">Obrigado!</h1>
          <p className="text-text-subtle leading-relaxed max-w-md mx-auto">{success.message}</p>
        </div>
      </Shell>
    );
  }

  if (!pesquisa) return null;

  return (
    <Shell>
      <div className="px-2">
        <h1 className="text-2xl font-bold text-text tracking-tight">{pesquisa.titulo}</h1>
        {pesquisa.descricao && (
          <p className="text-sm text-text-subtle mt-2 leading-relaxed">{pesquisa.descricao}</p>
        )}
      </div>

      <div className="mt-7 px-2">
        <p className="text-md font-medium text-text mb-4">{pesquisa.pergunta}</p>

        {/* Nota 0-10 */}
        <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5 mb-2">
          {Array.from({ length: 11 }).map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNota(n)}
              className={cn(
                'h-12 rounded-md text-base font-bold tabular',
                'border transition-all duration-100',
                nota === n
                  ? n <= 6
                    ? 'bg-danger text-white border-danger shadow-md scale-105'
                    : n <= 8
                      ? 'bg-warning text-bg border-warning shadow-md scale-105'
                      : 'bg-success text-white border-success shadow-md scale-105'
                  : 'bg-surface text-text border-border-strong hover:border-primary hover:bg-surface-hover',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-light uppercase tracking-wider mb-6">
          <span>Não recomendaria</span>
          <span>Recomendaria muito</span>
        </div>

        {/* Follow-up (aparece quando nota é selecionada) */}
        {nota !== null && (
          <div className="flex flex-col gap-3 animate-slide-up">
            {pesquisa.perguntaFollowUp && (
              <div>
                <label className="text-xs font-semibold text-text-subtle mb-1.5 block">
                  {pesquisa.perguntaFollowUp}
                </label>
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  rows={3}
                  className="w-full bg-bg text-text border border-border-strong rounded-md px-3 py-2 text-sm placeholder:text-muted-light resize-y min-h-[80px] focus:outline-none focus:border-primary focus:shadow-ring"
                  placeholder="Sua opinião é muito valiosa…"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-text-subtle mb-1.5 block">
                Seu contato (opcional)
              </label>
              <input
                type="text"
                value={contato}
                onChange={(e) => setContato(e.target.value)}
                placeholder="E-mail ou telefone — caso queira que entremos em contato"
                className="w-full bg-bg text-text border border-border-strong rounded-md px-3 h-9 text-sm placeholder:text-muted-light focus:outline-none focus:border-primary focus:shadow-ring"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <Button onClick={handleSubmit} loading={submitting} fullWidth size="lg">
              Enviar
            </Button>
          </div>
        )}

        <p className="text-[11px] text-muted-light text-center mt-6">
          Powered by <strong className="text-primary">Betinna.ai</strong>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex items-start sm:items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl bg-surface border border-border rounded-lg shadow-md p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}
