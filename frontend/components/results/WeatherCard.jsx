'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Droplets, Info } from 'lucide-react';
import { weatherService } from '@/services/weatherService';
import { formatIndianDate } from '@/utils/format';

function WeatherCard({ iataCode, city }) {
  const { data: current, isLoading: currentLoading, isError: currentError } = useQuery({
    queryKey: ['weather-current', iataCode],
    queryFn: () => weatherService.getCurrent(iataCode),
    staleTime: 25 * 60 * 1000,
    retry: false,
  });

  const { data: forecast } = useQuery({
    queryKey: ['weather-forecast', iataCode],
    queryFn: () => weatherService.getForecast(iataCode),
    staleTime: 25 * 60 * 1000,
    retry: false,
    enabled: !currentError,
  });

  const { data: season } = useQuery({
    queryKey: ['weather-season', iataCode],
    queryFn: () => weatherService.getSeason(iataCode),
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  if (currentLoading) {
    return <div className="h-32 animate-pulse rounded-xl border border-ink-100 bg-ink-50" />;
  }

  if (currentError) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink-200 px-4 py-3 text-sm text-ink-400">
        <Cloud className="h-4 w-4" aria-hidden="true" /> Weather unavailable for {city} right now.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-400">Weather in {city}</p>
          <p className="mt-1 font-display text-2xl text-ink-900">{current.tempC}°C</p>
          <p className="text-sm capitalize text-ink-500">{current.description}</p>
        </div>
        {current.icon && (
          <Image
            src={`https://openweathermap.org/img/wn/${current.icon}@2x.png`}
            alt={current.description}
            width={56}
            height={56}
            unoptimized
          />
        )}
      </div>

      <div className="mt-3 flex gap-4 text-xs text-ink-400">
        <span className="flex items-center gap-1">
          <Droplets className="h-3.5 w-3.5" aria-hidden="true" /> {current.humidity}% humidity
        </span>
        <span>Feels like {current.feelsLikeC}°C</span>
      </div>

      {forecast?.days?.length > 0 && (
        <div className="mt-4 grid grid-cols-5 gap-1.5 border-t border-ink-100 pt-3">
          {forecast.days.map((day) => (
            <div key={day.date} className="text-center">
              <p className="text-[11px] text-ink-400">{formatIndianDate(day.date).split(' ').slice(0, 2).join(' ')}</p>
              {day.icon && (
                <Image
                  src={`https://openweathermap.org/img/wn/${day.icon}.png`}
                  alt={day.description}
                  width={32}
                  height={32}
                  className="mx-auto"
                  unoptimized
                />
              )}
              <p className="text-xs font-medium text-ink-700">{day.tempC}°</p>
            </div>
          ))}
        </div>
      )}

      {season && (
        <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            {season.guidance}
            {season.isGeneralGuidance && (
              <span className="mt-1 block text-amber-700/70">General seasonal guidance, not this city&apos;s exact climate data.</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export { WeatherCard };
