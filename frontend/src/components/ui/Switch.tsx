import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Switch — toggle on/off. Pra preferências booleanas.
 */
export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  size?: 'sm' | 'md';
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { className, label, size = 'md', checked, disabled, ...props },
  ref,
) {
  const track = (
    <span className="relative inline-flex shrink-0">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          'inline-block rounded-full border',
          'border-border-strong bg-bg',
          'transition-[background,border-color] duration-150',
          'peer-checked:bg-primary peer-checked:border-primary',
          'peer-disabled:opacity-50 peer-disabled:cursor-not-allowed',
          'peer-focus-visible:shadow-ring-strong',
          'cursor-pointer',
          size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
          className,
        )}
      />
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 left-0.5 rounded-full bg-text',
          'transition-transform duration-150',
          size === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
          checked && (size === 'sm' ? 'translate-x-3' : 'translate-x-4'),
        )}
      />
    </span>
  );
  if (label) {
    return (
      <label className={cn('inline-flex items-center gap-2.5 cursor-pointer', disabled && 'cursor-not-allowed opacity-50')}>
        {track}
        <span className="text-sm text-text">{label}</span>
      </label>
    );
  }
  return track;
});
