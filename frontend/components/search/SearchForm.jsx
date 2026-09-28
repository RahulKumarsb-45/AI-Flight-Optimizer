'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeftRight, Wallet, Users, Sparkles } from 'lucide-react';
import { AirportAutocomplete } from './AirportAutocomplete';
import { CountryMultiSelect, MAX_COUNTRIES } from './CountryMultiSelect';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { trackFlightSearch } from '@/lib/analytics';

const todayStr = () => new Date().toISOString().split('T')[0];

const schema = z
  .object({
    originAirport: z.object({ iata: z.string() }, { required_error: 'Pick a departure airport' }),
    destinationCountries: z.array(z.string()).min(1, 'Pick at least one country').max(MAX_COUNTRIES),
    departureDate: z.string().min(1, 'Pick a departure date'),
    returnDate: z.string().optional().or(z.literal('')),
    dateFlexible: z.boolean(),
    travelers: z.coerce.number().int().min(1).max(9),
    budgetInr: z.coerce.number().min(1000, 'Budget must be at least ₹1,000').optional().or(z.literal('')),
    preference: z.enum(['cheapest', 'fastest', 'balanced']),
    nearbyAirportsEnabled: z.boolean(),
  })
  .refine((d) => !d.returnDate || d.returnDate >= d.departureDate, {
    message: 'Return date must be after departure',
    path: ['returnDate'],
  });

const PREFERENCES = [
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fastest', label: 'Fastest' },
  { value: 'balanced', label: 'Balanced' },
];

function SearchForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      destinationCountries: [],
      departureDate: todayStr(),
      returnDate: '',
      dateFlexible: false,
      travelers: 1,
      budgetInr: '',
      preference: 'balanced',
      nearbyAirportsEnabled: true,
    },
  });

  const dateFlexible = watch('dateFlexible');

  function onSubmit(values) {
    setSubmitting(true);
    const params = new URLSearchParams({
      origin: values.originAirport.iata,
      destinations: values.destinationCountries.join(','),
      departureDate: values.departureDate,
      dateFlexible: String(values.dateFlexible),
      travelers: String(values.travelers),
      preference: values.preference,
      nearbyAirportsEnabled: String(values.nearbyAirportsEnabled),
    });
    if (values.returnDate) params.set('returnDate', values.returnDate);
    if (values.budgetInr) params.set('budgetInr', String(values.budgetInr));

    trackFlightSearch({
      origin: values.originAirport.iata,
      destinations: values.destinationCountries,
      tripType: values.returnDate ? 'round_trip' : 'one_way',
      travelers: values.travelers,
      preference: values.preference,
      dateFlexible: values.dateFlexible,
      nearbyAirportsEnabled: values.nearbyAirportsEnabled,
    });

    router.push(`/results?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="rounded-xl border border-ink-100 bg-white p-5 shadow-card sm:p-7">
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          name="originAirport"
          control={control}
          render={({ field }) => (
            <AirportAutocomplete
              label="Flying from"
              value={field.value}
              onChange={field.onChange}
              error={errors.originAirport?.message}
            />
          )}
        />

        <Controller
          name="destinationCountries"
          control={control}
          render={({ field }) => (
            <CountryMultiSelect
              value={field.value}
              onChange={field.onChange}
              error={errors.destinationCountries?.message}
            />
          )}
        />

        <Input
          label="Departure date"
          type="date"
          min={todayStr()}
          error={errors.departureDate?.message}
          {...register('departureDate')}
        />

        <Input
          label="Return date"
          type="date"
          helperText="Leave blank for one-way"
          error={errors.returnDate?.message}
          {...register('returnDate')}
        />

        <Input
          type="number"
          placeholder="e.g. 80000"
          label={
            <span className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Budget (₹, optional)
            </span>
          }
          error={errors.budgetInr?.message}
          {...register('budgetInr')}
        />

        <Input
          type="number"
          min={1}
          max={9}
          label={
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Travelers
            </span>
          }
          error={errors.travelers?.message}
          {...register('travelers')}
        />
      </div>

      <label className="mt-5 flex items-center gap-2.5">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-ink-300"
          aria-describedby={dateFlexible ? 'date-flexible-hint' : undefined}
          {...register('dateFlexible')}
        />
        <span className="text-sm text-ink-700">
          Flexible dates <span className="text-ink-400">(search ±3 days for a better fare)</span>
        </span>
      </label>
      {dateFlexible && (
        <p id="date-flexible-hint" className="mt-1.5 ml-6 text-xs text-ink-400">
          We&apos;ll check dates a few days either side of what you picked above.
        </p>
      )}

      <label className="mt-3 flex items-center gap-2.5">
        <input type="checkbox" className="h-4 w-4 rounded border-ink-300" {...register('nearbyAirportsEnabled')} />
        <span className="text-sm text-ink-700">
          Include nearby airports <span className="text-ink-400">(up to 3 alternates within ~300km)</span>
        </span>
      </label>

      <div className="mt-5">
        <span id="optimize-for-label" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-700">
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> Optimize for
        </span>
        <Controller
          name="preference"
          control={control}
          render={({ field }) => (
            <div role="radiogroup" aria-labelledby="optimize-for-label" className="inline-flex rounded-lg bg-ink-50 p-1">
              {PREFERENCES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={field.value === p.value}
                  tabIndex={field.value === p.value ? 0 : -1}
                  onClick={() => field.onChange(p.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    const currentIndex = PREFERENCES.findIndex((pref) => pref.value === field.value);
                    const delta = e.key === 'ArrowRight' ? 1 : -1;
                    const nextIndex = (currentIndex + delta + PREFERENCES.length) % PREFERENCES.length;
                    field.onChange(PREFERENCES[nextIndex].value);
                    // Roving tabindex (WAI-ARIA radiogroup pattern): move
                    // focus to the newly-selected radio button.
                    const siblings = Array.from(e.currentTarget.parentElement?.children || []);
                    siblings[nextIndex]?.focus();
                  }}
                  className={cn(
                    'rounded px-4 py-1.5 text-sm font-medium transition-colors',
                    field.value === p.value ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-800'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      <Button type="submit" size="lg" loading={submitting} className="mt-7 w-full sm:w-auto">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Optimize my trip
      </Button>
    </form>
  );
}

export { SearchForm };
