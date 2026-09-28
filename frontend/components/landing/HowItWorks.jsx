const STEPS = [
  {
    number: '01',
    title: 'Tell us your trip',
    description: 'Origin, destinations, dates and budget.',
  },
  {
    number: '02',
    title: 'We optimize',
    description: 'Nearby airports, flexible dates and multi-city routes.',
  },
  {
    number: '03',
    title: 'Compare recommendations',
    description: 'See the best options and understand the trade-offs.',
  },
  {
    number: '04',
    title: 'Ask Shreya AI',
    description: 'Ask Shreya AI why an option is better and get help understanding your trip.',
  },
];

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="bg-ink-900 py-12 lg:flex lg:min-h-screen lg:items-center lg:py-14"
    >
      <div className="section-wide w-full">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-display-sm text-white">How it works</h2>
          <p className="mt-2.5 text-ink-300">
            From your trip details to a recommendation you understand — one flow, four steps.
          </p>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8 lg:mt-9">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="rounded-lg border border-ink-700 bg-ink-800 p-6 transition-colors hover:border-ink-600 lg:p-7"
            >
              <span className="font-mono text-sm text-amber-500">{step.number}</span>
              <h3 className="mt-2 font-display text-lg text-white">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export { HowItWorks };
