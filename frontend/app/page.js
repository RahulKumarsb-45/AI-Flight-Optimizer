import { Navbar } from '@/components/common/Navbar';
import { Footer } from '@/components/common/Footer';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Features } from '@/components/landing/Features';
import { MeetShreya } from '@/components/landing/MeetShreya';
import { PricingPreview } from '@/components/landing/PricingPreview';
import { FAQPreview } from '@/components/landing/FAQPreview';

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main id="main-content">
        <Hero />
        <HowItWorks />
        <Features />
        <MeetShreya />
        <PricingPreview />
        <FAQPreview />
      </main>
      <Footer />
    </>
  );
}
