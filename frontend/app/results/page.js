import { Suspense } from 'react';
import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { ResultsContent } from '@/components/results/ResultsContent';
import { OptimizerLoadingState } from '@/components/results/OptimizerLoadingState';

export const metadata = { title: 'Your trip options' };

export default function ResultsPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page py-14">
        <Suspense fallback={<OptimizerLoadingState />}>
          <ResultsContent />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
