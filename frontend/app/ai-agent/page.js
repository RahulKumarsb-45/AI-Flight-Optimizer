import { Navbar } from '@/components/common/Navbar';
import { BackButton } from '@/components/common/BackButton';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { AIAgentContent } from '@/components/ai-agent/AIAgentContent';

export const metadata = { title: 'Shreya AI' };

export default function AIAgentPage() {
  return (
    <>
      <Navbar />
      {/*
       * The chat panel below sizes itself to fill exactly the viewport
       * height left after the navbar (h-full inside this flex column), so
       * the Back control lives inside that same flex column rather than
       * stacking on top of a fixed vh calculation — otherwise the extra
       * height it takes up would push the chat past the viewport and force
       * a second, nested scrollbar.
       */}
      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        <BackButton />
        <main id="main-content" className="flex flex-1 flex-col overflow-hidden">
          <ProtectedRoute>
            <AIAgentContent />
          </ProtectedRoute>
        </main>
      </div>
    </>
  );
}
