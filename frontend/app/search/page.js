import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { SearchForm } from '@/components/search/SearchForm';

export const metadata = { title: 'Plan a trip' };

export default function SearchPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page max-w-5xl py-14">
        <div className="mb-8 text-center">
          <h1 className="font-display text-display-sm text-ink-900">Where are we optimizing today?</h1>
          <p className="mt-2 text-ink-500">One search checks nearby airports, flexible dates, and route order for you.</p>
        </div>
        <SearchForm />
      </main>
      <Footer />
    </>
  );
}
