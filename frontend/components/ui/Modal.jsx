'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Selector for elements a real focus trap needs to cycle between — the
// standard "is this focusable" list minus anything disabled/hidden.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function Modal({ open, onClose, title, children, className }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    // Remember what had focus before the dialog opened so it can be
    // restored on close (WAI-ARIA dialog pattern) — otherwise focus is
    // silently dropped back to <body> and a keyboard/screen-reader user
    // loses their place in the page.
    previouslyFocusedRef.current = document.activeElement;

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }

      if (e.key !== 'Tab' || !panelRef.current) return;

      // Real focus trap: cycle Tab/Shift+Tab between the first and last
      // focusable elements inside the panel instead of letting focus
      // escape to the page behind the modal.
      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    // move focus into the panel on open
    panelRef.current?.focus();

    // prevent background scroll while open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;

      // Restore focus to whatever triggered the modal, so keyboard users
      // land back where they were instead of at the top of <body>.
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm animate-fade-up"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-md rounded-lg bg-white shadow-card outline-none animate-fade-up',
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg text-ink-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export { Modal };
