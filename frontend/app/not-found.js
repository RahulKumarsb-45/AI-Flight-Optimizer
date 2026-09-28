import Link from 'next/link';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { RouteArc } from '@/components/common/RouteArc';
import { buttonVariants } from '@/components/ui/button-variants';

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page flex flex-col items-center py-24 text-center">
        <RouteArc width={320} height={110} />
        <h1 className="mt-8 font-display text-display-md text-ink-900">This route doesn’t exist</h1>
        <p className="mt-2 max-w-sm text-ink-500">
          The page you’re looking for may have moved, or the link might be off by a letter.
        </p>
        <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
          Back to home
        </Link>
      </main>
      <Footer />
    </>
  );
}
