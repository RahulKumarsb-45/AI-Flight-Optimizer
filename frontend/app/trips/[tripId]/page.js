import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { TripDetailsContent } from '@/components/trips/TripDetailsContent';

export const metadata = { title: 'Trip details' };

export default function TripDetailsPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page py-14">
        <ProtectedRoute>
          <TripDetailsContent />
        </ProtectedRoute>
      </main>
      <Footer />
    </>
  );
}
