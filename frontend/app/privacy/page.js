import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';

export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page max-w-4xl py-16">
        <h1 className="font-display text-display-md text-ink-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-400">Last updated: July 2026</p>

        <div className="mt-8 space-y-6 text-ink-600">
          <p>
            FlightOptimizer is a portfolio project. This policy describes, plainly, what data the application
            actually collects and how it’s used — not boilerplate copied from elsewhere.
          </p>

          <section>
            <h2 className="font-display text-lg text-ink-900">What we collect</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Account details you provide: name, email, and a hashed (never plaintext) password.</li>
              <li>Search inputs: origin, destinations, dates, budget, and preferences you submit.</li>
              <li>Trips you run while logged in are saved to your account and appear in your dashboard.</li>
              <li>Basic technical data for security: IP address and browser user-agent, attached to login sessions.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">How authentication works</h2>
            <p className="mt-2">
              Passwords are hashed before storage and never stored or logged in plain text. Sessions use a
              short-lived (15-minute) access token plus a longer-lived refresh token stored in an httpOnly cookie,
              which JavaScript on the page can’t read — this limits exposure if a browser extension or script were
              ever compromised. Refresh tokens rotate on each use and are revoked if reuse is detected.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">How your search is used</h2>
            <p className="mt-2">
              When you run a search, your criteria (origin, destinations, dates, budget, preference) are sent to
              our optimizer, which expands them into route and date combinations and queries a flight data
              provider for each. Flight search results are cached server-side for 20 minutes, keyed to the exact
              search parameters, so an identical search shortly after doesn’t repeat the same external lookups.
              If you’re logged in, the search and its results are saved to your account so you can revisit them
              from your dashboard; guest searches are not persisted after the results are shown.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">Payments</h2>
            <p className="mt-2">
              Pricing tiers are defined and a Razorpay integration is configured in the codebase, but payment
              processing is <strong>not live</strong> in the current build — no card or payment data is collected,
              and no charges can currently be made. When billing is enabled, Razorpay would process payments
              directly; we would not store your card details.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">AI features</h2>
            <p className="mt-2">
              Natural-language trip planning (an AI chat assistant powered by Anthropic’s Claude API) is planned
              but <strong>not yet built</strong> in this version of the app. If and when it ships, this section
              will be updated to describe exactly what’s sent to Anthropic and how conversation data is handled.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">Analytics</h2>
            <p className="mt-2">
              We use Google Analytics 4 for basic product analytics — which pages get visited, and a small set of
              in-product actions like running a search, sending an AI Agent message, or starting checkout. Events
              are limited to non-identifying metadata (e.g. an origin airport code, a search preference, whether a
              step succeeded); we don’t send names, emails, passwords, tokens, payment details, or AI conversation
              text to Google. Google Signals and ad-personalization features are turned off. Analytics is disabled
              automatically if it isn’t configured, and it never affects whether the app itself works.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">What we don’t do</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>We don’t sell or share your data with advertisers.</li>
              <li>We don’t run third-party ad trackers, or use analytics for ad personalization.</li>
              <li>We don’t store payment card details.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg text-ink-900">Your data, your choice</h2>
            <p className="mt-2">
              You can remove saved trips at any time from your dashboard. To request full account deletion, reach
              out via the contact page.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
