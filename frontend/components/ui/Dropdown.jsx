'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const DropdownContext = createContext(null);

function Dropdown({ children, className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  // Closing returns focus to whatever opened the menu (WAI-ARIA menu
  // button pattern) instead of dropping it back to <body> — matters
  // whether the menu closed via Escape, an outside click, or a selection.
  const close = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) close({ restoreFocus: false });
    }
    function handleEscape(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, close]);

  return (
    <DropdownContext.Provider value={{ open, setOpen, close, triggerRef }}>
      <div ref={rootRef} className={cn('relative inline-block', className)}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

function DropdownTrigger({ children, asChild, className }) {
  const ctx = useContext(DropdownContext);

  function toggle() {
    ctx.setOpen((o) => !o);
  }

  // Opening with ArrowDown should hand keyboard focus straight to the
  // first menu item, same as native <select>/menu-button widgets.
  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      ctx.setOpen(true);
    }
  }

  if (asChild) {
    // A non-<button> trigger (e.g. an icon-only element) still needs to be
    // a real interactive control for keyboard users: focusable, activated
    // by both Enter and Space, and exposed as a button to assistive tech.
    return (
      <span
        ref={ctx.triggerRef}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          } else {
            handleKeyDown(e);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={ctx.open}
        className={className}
      >
        {children}
      </span>
    );
  }

  return (
    <button
      ref={ctx.triggerRef}
      type="button"
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className={className}
      aria-haspopup="menu"
      aria-expanded={ctx.open}
    >
      {children}
    </button>
  );
}

function DropdownContent({ children, className, align = 'start' }) {
  const ctx = useContext(DropdownContext);
  const contentRef = useRef(null);

  const getItems = useCallback(() => {
    if (!contentRef.current) return [];
    return Array.from(contentRef.current.querySelectorAll('[role="menuitem"]:not([disabled])'));
  }, []);

  useEffect(() => {
    if (!ctx.open) return;
    // Move focus into the menu on open — WAI-ARIA menu pattern expects the
    // first item to be focused, not left on the trigger.
    getItems()[0]?.focus();
  }, [ctx.open, getItems]);

  function handleKeyDown(e) {
    const items = getItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  if (!ctx.open) return null;

  return (
    <div
      ref={contentRef}
      role="menu"
      onKeyDown={handleKeyDown}
      className={cn(
        'absolute z-20 mt-2 min-w-[10rem] rounded-lg border border-ink-100 bg-white p-1 shadow-card animate-fade-up',
        align === 'end' ? 'right-0' : 'left-0',
        className
      )}
    >
      {children}
    </div>
  );
}

function DropdownItem({ children, onSelect, className, disabled }) {
  const ctx = useContext(DropdownContext);

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        ctx.close();
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink-700',
        'hover:bg-ink-50 disabled:pointer-events-none disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}

export { Dropdown, DropdownTrigger, DropdownContent, DropdownItem };
