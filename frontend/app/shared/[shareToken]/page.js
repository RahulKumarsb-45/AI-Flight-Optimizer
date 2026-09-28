import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { SharedTripContent } from '@/components/trips/SharedTripContent';

export const metadata = { title: 'Shared trip' };

// Intentionally NOT wrapped in <ProtectedRoute> — this is the public Share
// Trip view. Access control lives entirely server-side, keyed off the
// non-guessable share token in the URL (see tripController.getSharedTrip).
export default function SharedTripPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page py-14">
        <SharedTripContent />
      </main>
      <Footer />
    </>
  );
}
