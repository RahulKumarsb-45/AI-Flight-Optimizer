import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, resolving Tailwind conflicts sanely
 * (e.g. cn('p-2', 'p-4') -> 'p-4', not both).
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
