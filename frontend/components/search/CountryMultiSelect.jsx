'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, ChevronDown } from 'lucide-react';
import { airportService } from '@/services/airportService';
import { cn } from '@/lib/utils';

const MAX_COUNTRIES = 4; // matches backend config.optimizer.maxCountriesPerTrip

function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '';
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function CountryOption({ country, onSelect }) {
  return (
    <li role="presentation">
      <button
        type="button"
        role="option"
        aria-selected={false}
        onClick={() => onSelect(country.countryCode)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-ink-50"
      >
        <span aria-hidden="true">{countryCodeToFlag(country.countryCode)}</span>
        {country.country}
        <span className="ml-auto text-xs text-ink-400">{country.region}</span>
      </button>
    </li>
  );
}

function CountryMultiSelect({ value = [], onChange, error }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerId = useId();
  const labelId = useId();
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const { data: countries = [], isLoading } = useQuery({
    queryKey: ['countries'],
    queryFn: () => airportService.listCountries(),
    staleTime: 24 * 60 * 60 * 1000, // country list never changes within a session
  });

  const selected = countries.filter((c) => value.includes(c.countryCode));
  const atMax = value.length >= MAX_COUNTRIES;

  const q = query.trim().toLowerCase();
  const selectable = useMemo(
    () => countries.filter((c) => !value.includes(c.countryCode)),
    [countries, value]
  );

  // Full, unbounded search across the complete country dataset — no slicing.
  const searchResults = useMemo(() => {
    if (!q) return null;
    return selectable.filter((c) => c.country.toLowerCase().includes(q));
  }, [selectable, q]);

  // Popular-destinations quick-pick shortlist, shown only while the person
  // hasn't typed a search query yet. This is a UX convenience on top of the
  // full country list, never a replacement for it (see backend
  // providers/country/countryData.js) — searching still reaches every
  // supported country, popular or not.
  const popular = useMemo(() => selectable.filter((c) => c.popular), [selectable]);
  const all = selectable;

  function addCountry(countryCode) {
    if (atMax) return;
    onChange([...value, countryCode]);
    setQuery('');
  }

  function removeCountry(countryCode) {
    onChange(value.filter((c) => c !== countryCode));
  }

  return (
    <div className="relative" ref={containerRef}>
      <label id={labelId} htmlFor={triggerId} className="mb-1.5 block text-sm font-medium text-ink-700">
        Destination countries
        <span className="ml-1.5 font-normal text-ink-400">(up to {MAX_COUNTRIES})</span>
      </label>

      {/*
        A <div role="button"> rather than a real <button> here: the chips
        inside need to be real, individually keyboard-focusable <button>
        elements (see "Remove" below) and a <button> cannot contain nested
        interactive controls without breaking the DOM/HTML spec and
        assistive-tech behavior.
      */}
      <div
        id={triggerId}
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${triggerId}`}
        onClick={() => !atMax && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (atMax) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className={cn(
          'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-left',
          'border-ink-200 focus-visible:border-horizon-500',
          error && 'border-danger-500',
          atMax && 'cursor-default'
        )}
      >
        {selected.length === 0 && <span className="px-1 text-[15px] text-ink-400">Select up to 4 countries</span>}
        {selected.map((c) => (
          <span
            key={c.countryCode}
            className="flex items-center gap-1.5 rounded-full bg-horizon-50 py-1 pl-2.5 pr-1.5 text-sm text-horizon-800"
          >
            <span aria-hidden="true">{countryCodeToFlag(c.countryCode)}</span>
            {c.country}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeCountry(c.countryCode);
              }}
              className="rounded-full p-0.5 hover:bg-horizon-100"
              aria-label={`Remove ${c.country}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {!atMax && <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />}
      </div>
      {error && <p className="mt-1 text-sm text-danger-600">{error}</p>}
      {atMax && <p className="mt-1 text-xs text-ink-400">Maximum of {MAX_COUNTRIES} countries per trip.</p>}

      {open && !atMax && (
        <div className="absolute z-30 mt-1.5 w-full rounded-md border border-ink-100 bg-white shadow-card">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries..."
            aria-label="Search countries"
            className="w-full border-b border-ink-100 px-3.5 py-2.5 text-sm outline-none"
          />
          <ul role="listbox" aria-label="Countries" className="max-h-72 overflow-auto py-1">
            {isLoading && <li className="px-3.5 py-2.5 text-sm text-ink-400">Loading countries...</li>}

            {!isLoading && q && (
              <>
                {searchResults.length === 0 && (
                  <li className="px-3.5 py-2.5 text-sm text-ink-400">No matches</li>
                )}
                {searchResults.map((c) => (
                  <CountryOption key={c.countryCode} country={c} onSelect={addCountry} />
                ))}
              </>
            )}

            {!isLoading && !q && (
              <>
                {popular.length > 0 && (
                  <>
                    <li className="px-3.5 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                      Popular destinations
                    </li>
                    {popular.map((c) => (
                      <CountryOption key={c.countryCode} country={c} onSelect={addCountry} />
                    ))}
                  </>
                )}
                {all.length > 0 && (
                  <>
                    <li className="px-3.5 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                      All countries
                    </li>
                    {all.map((c) => (
                      <CountryOption key={c.countryCode} country={c} onSelect={addCountry} />
                    ))}
                  </>
                )}
                {popular.length === 0 && all.length === 0 && (
                  <li className="px-3.5 py-2.5 text-sm text-ink-400">No matches</li>
                )}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export { CountryMultiSelect, MAX_COUNTRIES };
