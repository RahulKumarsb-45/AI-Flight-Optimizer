import { MapPinned, CalendarRange, Route, ScrollText } from 'lucide-react';

const FEATURES = [
  {
    icon: MapPinned,
    title: 'Nearby airport expansion',
    description:
      'Flying from Delhi? We also check Jaipur and Chandigarh. A 2-hour drive can mean a ₹6,000 saving on the flight itself.',
  },
  {
    icon: CalendarRange,
    title: 'Flexible date search',
    description:
      'Give us a ±3 day window and we search every combination — not just the exact date you typed in.',
  },
  {
    icon: Route,
    title: 'Multi-city routing',
    description:
      'Plan a circuit across up to 4 countries. We work out the order and dates that keep total travel time sane.',
  },
  {
    icon: ScrollText,
    title: 'A reason for every pick',
    description:
      'No black-box ranking. Every recommendation says exactly what it costs more or less, and why it made the list.',
  },
];

function Features() {
  return (
    <section className="lg:flex lg:min-h-screen lg:items-center">
      <div className="section-wide w-full py-12 lg:py-14">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-display-sm text-ink-900">What actually changes your fare</h2>
          <p className="mt-2.5 text-ink-500">
            Four levers most search engines ignore because checking them properly takes real computation.
          </p>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8 lg:mt-9">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg border border-ink-100 bg-white p-6 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded bg-horizon-50">
                <feature.icon className="h-5 w-5 text-horizon-700" aria-hidden="true" />
              </div>
              <h3 className="mt-4 font-display text-lg text-ink-900">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export { Features };
