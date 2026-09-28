import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function Spinner({ className, size = 20 }) {
  return <Loader2 className={cn('animate-spin text-horizon-600', className)} width={size} height={size} aria-hidden="true" />;
}

function PageSpinner({ label = 'Loading' }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <Spinner size={28} />
      <span className="text-sm text-ink-400">{label}</span>
    </div>
  );
}

export { Spinner, PageSpinner };
