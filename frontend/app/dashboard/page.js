import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { DashboardContent } from '@/components/dashboard/DashboardContent';

export const metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" className="container-page py-14">
        <ProtectedRoute>
          <DashboardContent />
        </ProtectedRoute>
      </main>
      <Footer />
    </>
  );
}
