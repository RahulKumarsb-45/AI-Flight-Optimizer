'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plane, Loader2 } from 'lucide-react';
import { airportService } from '@/services/airportService';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

function AirportAutocomplete({ label, placeholder = 'City or airport code', value, onChange, error }) {
  const listboxId = useId();
  const inputId = useId();
  const errorId = useId();
  const [query, setQuery] = useState(value?.city ? `${value.city} (${value.iata})` : '');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);
  const debouncedQuery = useDebounce(query, 250);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['airport-search', debouncedQuery],
    queryFn: () => airportService.search(debouncedQuery, 8),
    enabled: debouncedQuery.trim().length > 0 && open,
    staleTime: 60 * 60 * 1000, // airport data barely changes; cache generously
  });

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectAirport(airport) {
    onChange(airport);
    setQuery(`${airport.city} (${airport.iata})`);
    setOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      selectAirport(results[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const activeOptionId =
    highlightedIndex >= 0 && results[highlightedIndex] ? `${listboxId}-option-${highlightedIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-700">
          {label}
        </label>
      )}
      <div className="relative">
        <Plane className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            onChange(null); // clear selection until a new one is made
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'h-11 w-full rounded-md border bg-white pl-10 pr-9 text-[15px] text-ink-900 placeholder:text-ink-400',
            'border-ink-200 focus-visible:border-horizon-500 focus-visible:outline-none',
            error && 'border-danger-500'
          )}
        />
        {isFetching && (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-400"
            aria-hidden="true"
          />
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-danger-600">
          {error}
        </p>
      )}

      {/* Announces result count changes to screen reader users, who can't
          see the listbox fill in the way sighted users can. */}
      <p className="sr-only" role="status" aria-live="polite">
        {open && debouncedQuery.trim().length > 0 && !isFetching
          ? `${results.length} airport${results.length === 1 ? '' : 's'} found`
          : ''}
      </p>

      {open && debouncedQuery.trim().length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-md border border-ink-100 bg-white py-1 shadow-card"
        >
          {results.length === 0 && !isFetching && (
            <li className="px-3.5 py-2.5 text-sm text-ink-400">No airports found for &quot;{debouncedQuery}&quot;</li>
          )}
          {results.map((airport, idx) => (
            <li key={airport.iata}>
              <button
                id={`${listboxId}-option-${idx}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={idx === highlightedIndex}
                onClick={() => selectAirport(airport)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm',
                  idx === highlightedIndex ? 'bg-horizon-50' : 'hover:bg-ink-50'
                )}
              >
                <span>
                  <span className="font-medium text-ink-900">{airport.city}</span>
                  <span className="text-ink-400"> · {airport.country}</span>
                  <br />
                  <span className="text-xs text-ink-400">{airport.name}</span>
                </span>
                <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs font-medium text-ink-600">
                  {airport.iata}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { AirportAutocomplete };
