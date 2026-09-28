import { cva } from 'class-variance-authority';

/**
 * Deliberately NOT in a 'use client' file. buttonVariants is a plain function
 * (no hooks, no browser APIs) — it just computes a class string. If this lived
 * inside Button.jsx (which needs 'use client' for its interactive behavior),
 * Server Components importing buttonVariants directly would receive an inert
 * RSC client-reference placeholder instead of a callable function ("x is not
 * a function" at render/serialize time), since only React components — not
 * plain utility exports — can cross the server/client boundary that way.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-body font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-horizon-700 text-white hover:bg-horizon-800 shadow-soft',
        accent: 'bg-amber-500 text-ink-900 hover:bg-amber-600 shadow-glow-amber',
        outline: 'border border-ink-200 bg-transparent text-ink-800 hover:bg-ink-50',
        ghost: 'bg-transparent text-ink-700 hover:bg-ink-50',
        link: 'bg-transparent text-horizon-700 underline-offset-4 hover:underline p-0 h-auto',
        danger: 'bg-danger-500 text-white hover:bg-danger-600',
      },
      size: {
        sm: 'h-9 px-3.5 text-sm',
        md: 'h-11 px-5 text-[15px]',
        lg: 'h-13 px-7 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);
