import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium font-mono', {
  variants: {
    variant: {
      neutral: 'bg-ink-100 text-ink-700',
      horizon: 'bg-horizon-50 text-horizon-700',
      amber: 'bg-amber-100 text-amber-800',
      route: 'bg-route-50 text-route-700',
      danger: 'bg-danger-50 text-danger-600',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

function Badge({ className, variant, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
