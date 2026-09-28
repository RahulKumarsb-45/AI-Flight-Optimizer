import { Mail, Github, Linkedin } from 'lucide-react';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { Card } from '@/components/ui/Card';

export const metadata = { title: 'Contact' };

const CHANNELS = [
  {
    icon: Mail,
    label: 'Email',
    value: 'hello@flightoptimizer.app',
    href: 'mailto:hello@flightoptimizer.app',
  },
  {
    icon: Github,
    label: 'GitHub',
    value: 'View the source code',
    href: 'https://github.com',
  },
  {
    icon: Linkedin,
    label: 'LinkedIn',
    value: 'Connect for feedback or collaboration',
    href: 'https://linkedin.com',
  },
];

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page max-w-3xl py-16">
        <h1 className="font-display text-display-md text-ink-900">Get in touch</h1>
        <p className="mt-3 text-ink-500">
          This is a portfolio project without a support team behind it — but bug reports, feedback, and questions
          about how it’s built are genuinely welcome.
        </p>

        <div className="mt-8 space-y-3">
          {CHANNELS.map((channel) => (
            <a key={channel.label} href={channel.href} target="_blank" rel="noreferrer">
              <Card className="flex items-center gap-4 p-4 transition-colors hover:border-horizon-200 hover:bg-horizon-50/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-50">
                  <channel.icon className="h-5 w-5 text-ink-600" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink-900">{channel.label}</span>
                  <span className="block text-sm text-ink-500">{channel.value}</span>
                </span>
              </Card>
            </a>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
