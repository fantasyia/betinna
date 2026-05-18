import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility pra combinar classes Tailwind com override correto.
 *
 * - clsx: aceita strings, arrays, objects (clx('a', { b: cond, c: false }))
 * - twMerge: resolve conflitos (`p-2 p-4` → `p-4`)
 *
 * Uso em todos os primitives do design system.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
