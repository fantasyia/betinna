import { useId, type ReactElement, type ReactNode, cloneElement } from 'react';
import { cn } from '@/lib/cn';
import { Label } from './Label';

/**
 * Field — agrupa Label + Input/Select + hint + erro.
 *
 * Composição (filho único, geralmente Input/Select/Textarea):
 *   <Field label="E-mail" required hint="Use o e-mail profissional">
 *     <Input type="email" />
 *   </Field>
 *
 * Injeta `id` no filho automaticamente via cloneElement pra ligar com <Label htmlFor>.
 */
export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  required?: boolean;
  /** Texto de ajuda discreto abaixo do campo. Escondido quando há erro. */
  hint?: ReactNode;
  /** Mensagem de erro — substitui hint quando presente. */
  error?: ReactNode;
  /** Input/Select/Textarea único. */
  children: ReactElement;
  className?: string;
  htmlFor?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? (children.props as { id?: string }).id ?? autoId;

  // Injeta id + aria-invalid no filho
  const childWithProps = cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as Partial<typeof children.props>);

  return (
    <div className={cn('flex flex-col w-full', className)}>
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      )}
      {childWithProps}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-light">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
