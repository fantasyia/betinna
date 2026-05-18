import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * FormularioPublicoPage — renderiza o formulário público em /f/:slug.
 *
 * Sem auth — qualquer pessoa com o link pode preencher.
 * Submit chama POST /f/:slug/submit (sem auth, com honeypot).
 */

type CampoTipo =
  | 'TEXT'
  | 'EMAIL'
  | 'TEL'
  | 'NUMERO'
  | 'TEXTAREA'
  | 'SELECT'
  | 'CHECKBOX'
  | 'RADIO';

interface CampoPublico {
  ordem: number;
  tipo: CampoTipo;
  label: string;
  campo: string;
  placeholder?: string | null;
  obrigatorio: boolean;
  opcoes?: string[] | null;
  hint?: string | null;
}

interface FormularioPublico {
  slug: string;
  titulo: string;
  descricao?: string | null;
  mensagemSucesso?: string | null;
  redirectUrl?: string | null;
  campos: CampoPublico[];
}

export default function FormularioPublicoPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormularioPublico | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dados, setDados] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ message: string; redirectUrl?: string | null } | null>(
    null,
  );
  const [hp, setHp] = useState(''); // honeypot

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api
      .get<FormularioPublico>(`/f/${slug}`)
      .then((data) => {
        setForm(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Formulário não encontrado');
      })
      .finally(() => setLoading(false));
  }, [slug]);

  function setField(campo: string, value: string | string[]) {
    setDados((d) => ({ ...d, [campo]: value }));
  }

  function toggleCheckbox(campo: string, op: string) {
    const current = (dados[campo] ?? []) as string[];
    const next = current.includes(op) ? current.filter((v) => v !== op) : [...current, op];
    setField(campo, next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);

    for (const campo of form.campos) {
      if (campo.obrigatorio) {
        const v = dados[campo.campo];
        if (v === undefined || (typeof v === 'string' && v.trim().length === 0) || (Array.isArray(v) && v.length === 0)) {
          setError(`Preencha "${campo.label}"`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const res = await api.post<{ ok: true; message: string; redirectUrl?: string | null }>(
        `/f/${slug}/submit`,
        { dados, _hp: hp },
      );
      setSuccess({ message: res.message, redirectUrl: res.redirectUrl });
      if (res.redirectUrl) {
        setTimeout(() => {
          window.location.href = res.redirectUrl!;
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao enviar — tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center py-12 text-muted">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Carregando…
        </div>
      </PublicShell>
    );
  }

  if (error && !form) {
    return (
      <PublicShell>
        <div className="text-center py-12">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger mb-3">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-text mb-2">Formulário não encontrado</h1>
          <p className="text-sm text-text-subtle">{error}</p>
          <Button variant="secondary" onClick={() => navigate('/')} className="mt-4">
            Voltar
          </Button>
        </div>
      </PublicShell>
    );
  }

  if (success) {
    return (
      <PublicShell>
        <div className="text-center py-12">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success mb-4">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-text mb-2">Enviado!</h1>
          <p className="text-text-subtle leading-relaxed max-w-md mx-auto">{success.message}</p>
          {success.redirectUrl && (
            <p className="text-xs text-muted mt-4">Redirecionando…</p>
          )}
        </div>
      </PublicShell>
    );
  }

  if (!form) return null;

  return (
    <PublicShell>
      <div className="px-2">
        <h1 className="text-2xl font-bold text-text tracking-tight">{form.titulo}</h1>
        {form.descricao && (
          <p className="text-sm text-text-subtle mt-2 leading-relaxed">{form.descricao}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4 px-2">
        {form.campos.map((c) => (
          <FormField
            key={c.campo}
            campo={c}
            value={dados[c.campo]}
            onChange={(v) => setField(c.campo, v)}
            onCheckbox={(op) => toggleCheckbox(c.campo, op)}
          />
        ))}

        {/* Honeypot — escondido visualmente, bots preenchem */}
        <input
          type="text"
          name="_hp"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
          aria-hidden
        />

        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <Button
          type="submit"
          loading={submitting}
          fullWidth
          size="lg"
          data-testid="form-submit"
        >
          Enviar
        </Button>

        <p className="text-[11px] text-muted-light text-center mt-2">
          Powered by <strong className="text-primary">Betinna.ai</strong>
        </p>
      </form>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex items-start sm:items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl bg-surface border border-border rounded-lg shadow-md p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}

function FormField({
  campo,
  value,
  onChange,
  onCheckbox,
}: {
  campo: CampoPublico;
  value: string | string[] | undefined;
  onChange: (v: string) => void;
  onCheckbox: (op: string) => void;
}) {
  const id = `field-${campo.campo}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-text-subtle">
        {campo.label}
        {campo.obrigatorio && <span className="text-primary ml-0.5">*</span>}
      </label>
      {campo.tipo === 'TEXTAREA' ? (
        <textarea
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={campo.placeholder ?? ''}
          required={campo.obrigatorio}
          rows={4}
          className={cn(
            'w-full bg-bg text-text font-sans border border-border-strong rounded-md px-3 py-2 text-sm',
            'placeholder:text-muted-light resize-y min-h-[72px]',
            'focus:outline-none focus:border-primary focus:shadow-ring',
          )}
        />
      ) : campo.tipo === 'SELECT' ? (
        <select
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={campo.obrigatorio}
          className={cn(
            'w-full bg-bg text-text border border-border-strong rounded-md px-2.5 h-9 text-sm',
            'focus:outline-none focus:border-primary focus:shadow-ring',
          )}
        >
          <option value="">Selecione…</option>
          {(campo.opcoes ?? []).map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      ) : campo.tipo === 'RADIO' ? (
        <div className="flex flex-col gap-1.5">
          {(campo.opcoes ?? []).map((op) => (
            <label key={op} className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <input
                type="radio"
                name={campo.campo}
                value={op}
                checked={value === op}
                onChange={(e) => onChange(e.target.value)}
                className="accent-primary"
              />
              {op}
            </label>
          ))}
        </div>
      ) : campo.tipo === 'CHECKBOX' ? (
        <div className="flex flex-col gap-1.5">
          {(campo.opcoes ?? []).map((op) => (
            <label key={op} className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(op)}
                onChange={() => onCheckbox(op)}
                className="accent-primary"
              />
              {op}
            </label>
          ))}
        </div>
      ) : (
        <input
          id={id}
          type={
            campo.tipo === 'EMAIL'
              ? 'email'
              : campo.tipo === 'TEL'
                ? 'tel'
                : campo.tipo === 'NUMERO'
                  ? 'number'
                  : 'text'
          }
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={campo.placeholder ?? ''}
          required={campo.obrigatorio}
          className={cn(
            'w-full bg-bg text-text border border-border-strong rounded-md px-3 h-9 text-sm',
            'placeholder:text-muted-light',
            'focus:outline-none focus:border-primary focus:shadow-ring',
          )}
        />
      )}
      {campo.hint && <p className="text-[11px] text-muted-light">{campo.hint}</p>}
    </div>
  );
}
