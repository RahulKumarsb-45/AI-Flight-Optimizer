'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { buildTripTimeline } from '@/utils/tripTimeline';
import { buildPdfReportModel } from '@/utils/pdfReport';

/**
 * PDF Export button. Purely a display-layer action: it builds the exact
 * same Trip Timeline (`buildTripTimeline`, same inputs `TripTimelineCard`
 * already receives) and reuses the caller's already-computed Expense
 * Calculator `breakdown` (same object `ExpenseCalculatorCard` already
 * renders) to assemble a PDF, entirely from data already loaded on the
 * page. No new fetch happens here or in any module it calls — clicking
 * Export never issues a network request.
 *
 * `jspdf` is loaded via a dynamic import so it never adds to the initial
 * page bundle — it's only pulled in the moment someone actually exports.
 */
function PdfExportButton({
  recommendation,
  hotels,
  attractions,
  restaurants,
  destinationCity,
  placesByDestination,
  expenseBreakdown,
  filename = 'trip-plan.pdf',
  className,
}) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  if (!recommendation) return null;

  async function handleExport() {
    setGenerating(true);
    try {
      const { legs, legOffers, originAirport, destinationAirports } = recommendation;
      // Same pure function TripTimelineCard already calls, with the same
      // inputs the caller already has loaded — not a second implementation
      // of the Trip Timeline algorithm, just another invocation of it.
      const timeline = buildTripTimeline({
        legs,
        legOffers,
        originAirport,
        destinationAirports,
        hotels,
        attractions,
        restaurants,
        destinationCity,
        placesByDestination,
      });
      const reportModel = buildPdfReportModel({ recommendation, timeline, expenseBreakdown });
      const { downloadTripPdf } = await import('@/utils/generateTripPdf');
      downloadTripPdf(reportModel, filename);
    } catch (err) {
      toast({ variant: 'error', title: 'Could not export PDF', description: err.message });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Button variant="outline" loading={generating} onClick={handleExport} className={className}>
      <Download className="h-4 w-4" aria-hidden="true" /> {generating ? 'Preparing PDF…' : 'Export PDF'}
    </Button>
  );
}

export { PdfExportButton };
