'use client';

import { createContext, useContext, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const TabsContext = createContext(null);

function Tabs({ defaultValue, value: controlledValue, onValueChange, children, className }) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const tabsId = useId();

  const setValue = (v) => {
    setInternalValue(v);
    onValueChange?.(v);
  };

  return (
    <TabsContext.Provider value={{ value, setValue, tabsId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ children, className }) {
  const listRef = useRef(null);

  // WAI-ARIA Tabs pattern: arrow keys move focus (and, since these are
  // automatically-activated tabs, selection) between tabs; only the
  // active tab sits in the normal Tab order (roving tabindex below).
  function handleKeyDown(e) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const tabs = Array.from(listRef.current?.querySelectorAll('[role="tab"]:not([disabled])') || []);
    if (tabs.length === 0) return;

    const currentIndex = tabs.indexOf(document.activeElement);
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1 + tabs.length) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;

    e.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn('inline-flex items-center gap-1 rounded-lg bg-ink-50 p-1', className)}
    >
      {children}
    </div>
  );
}

function TabsTrigger({ value: tabValue, children, className }) {
  const ctx = useContext(TabsContext);
  const isActive = ctx.value === tabValue;

  return (
    <button
      id={`${ctx.tabsId}-tab-${tabValue}`}
      role="tab"
      type="button"
      aria-selected={isActive}
      aria-controls={`${ctx.tabsId}-panel-${tabValue}`}
      tabIndex={isActive ? 0 : -1}
      onClick={() => ctx.setValue(tabValue)}
      className={cn(
        'rounded px-3.5 py-1.5 text-sm font-medium transition-colors',
        isActive ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-800',
        className
      )}
    >
      {children}
    </button>
  );
}

function TabsContent({ value: tabValue, children, className }) {
  const ctx = useContext(TabsContext);
  if (ctx.value !== tabValue) return null;
  return (
    <div
      id={`${ctx.tabsId}-panel-${tabValue}`}
      role="tabpanel"
      aria-labelledby={`${ctx.tabsId}-tab-${tabValue}`}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
