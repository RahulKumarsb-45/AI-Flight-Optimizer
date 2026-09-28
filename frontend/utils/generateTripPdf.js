/**
 * PDF Export — renders a `buildPdfReportModel(...)` result (see
 * utils/pdfReport.js) onto a PDF document with jsPDF. This is purely a
 * layout/drawing layer: every figure it prints was already computed by the
 * real Trip Timeline (`utils/tripTimeline.js`) and Expense Calculator
 * (`utils/expenseCalculator.js`) modules and reshaped (not recalculated)
 * by `pdfReport.js`. No network calls happen here — everything drawn is
 * already in memory on the page that calls this.
 */
import { jsPDF } from 'jspdf';
import { formatInr, formatIndianDate, formatTime, formatDuration } from './format';

const PAGE_MARGIN = 14;
const PAGE_WIDTH = 210; // A4 portrait, mm
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const LINE_HEIGHT = 5;
const INK_900 = '#1a1a1a';
const INK_500 = '#6b6b6b';
const INK_300 = '#a3a3a3';
const HORIZON_600 = '#1d6fb8';

function formatRange(range) {
  if (!range) return 'Not enough data';
  if (range.min === range.max) return formatInr(range.min);
  return `${formatInr(range.min)}\u2013${formatInr(range.max)}`;
}

/** Small helper that tracks the vertical cursor and adds pages as needed. */
function createCursor(doc) {
  let y = PAGE_MARGIN;
  const pageHeight = doc.internal.pageSize.getHeight();

  return {
    get y() {
      return y;
    },
    advance(amount) {
      y += amount;
    },
    ensureSpace(amount) {
      if (y + amount > pageHeight - PAGE_MARGIN) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
    },
    setY(value) {
      y = value;
    },
  };
}

function drawSectionHeading(doc, cursor, text) {
  cursor.ensureSpace(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(INK_900);
  doc.text(text, PAGE_MARGIN, cursor.y);
  cursor.advance(2);
  doc.setDrawColor(INK_300);
  doc.line(PAGE_MARGIN, cursor.y, PAGE_MARGIN + CONTENT_WIDTH, cursor.y);
  cursor.advance(6);
}

function drawKeyValueLine(doc, cursor, label, value, { bold = false } = {}) {
  cursor.ensureSpace(LINE_HEIGHT + 1);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(10);
  doc.setTextColor(INK_500);
  doc.text(label, PAGE_MARGIN, cursor.y);
  doc.setTextColor(INK_900);
  doc.text(String(value), PAGE_MARGIN + CONTENT_WIDTH, cursor.y, { align: 'right' });
  cursor.advance(LINE_HEIGHT + 1);
}

function drawWrappedText(doc, cursor, text, { fontSize = 9, color = INK_500, indent = 0 } = {}) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(color);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - indent);
  cursor.ensureSpace(lines.length * LINE_HEIGHT);
  doc.text(lines, PAGE_MARGIN + indent, cursor.y);
  cursor.advance(lines.length * LINE_HEIGHT);
}

function drawFlightEntry(doc, cursor, entry) {
  cursor.ensureSpace(LINE_HEIGHT * 2 + 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(HORIZON_600);
  const directionLabel =
    entry.direction === 'return' ? 'Return flight' : entry.direction === 'connecting' ? 'Connecting flight' : 'Flight';
  doc.text(directionLabel, PAGE_MARGIN + 2, cursor.y);
  cursor.advance(LINE_HEIGHT);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK_900);

  if (entry.status === 'unavailable') {
    doc.text(`${entry.fromIata} \u2192 ${entry.toIata} \u2014 no flight offer available yet`, PAGE_MARGIN + 2, cursor.y);
    cursor.advance(LINE_HEIGHT + 1);
    return;
  }

  const stopsLabel = entry.stops === 0 ? 'Direct' : `${entry.stops} stop${entry.stops > 1 ? 's' : ''}`;
  doc.text(
    `${entry.fromIata} ${formatTime(entry.departureTime)} \u2192 ${entry.toIata} ${formatTime(entry.arrivalTime)}  \u00b7  ${stopsLabel}  \u00b7  ${formatDuration(entry.totalDurationMinutes)}`,
    PAGE_MARGIN + 2,
    cursor.y
  );
  cursor.advance(LINE_HEIGHT);

  if (entry.segments?.length > 0) {
    doc.setTextColor(INK_500);
    doc.setFontSize(8.5);
    const segText = entry.segments.map((seg) => `${seg.airline}${seg.flightNumber?.replace(seg.airline, '')}`).join(' \u00b7 ');
    doc.text(segText, PAGE_MARGIN + 2, cursor.y);
    cursor.advance(LINE_HEIGHT);
  }

  if (entry.priceInr != null) {
    doc.setTextColor(INK_900);
    doc.setFontSize(9);
    doc.text(formatInr(entry.priceInr), PAGE_MARGIN + 2, cursor.y);
    cursor.advance(LINE_HEIGHT);
  }
  cursor.advance(1);
}

function drawAccommodationEntry(doc, cursor, entry) {
  cursor.ensureSpace(LINE_HEIGHT * 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(HORIZON_600);
  doc.text(`Where you could stay${entry.city ? ` near ${entry.city}` : ''}`, PAGE_MARGIN + 2, cursor.y);
  cursor.advance(LINE_HEIGHT);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK_900);
  for (const hotel of entry.options || []) {
    cursor.ensureSpace(LINE_HEIGHT);
    const ratingText = hotel.rating ? ` \u00b7 ${hotel.rating}\u2605` : '';
    doc.text(`\u2022 ${hotel.name}${ratingText}`, PAGE_MARGIN + 2, cursor.y);
    cursor.advance(LINE_HEIGHT);
  }
  doc.setFontSize(8);
  doc.setTextColor(INK_300);
  doc.text('Suggestions only \u2014 this app does not book or confirm a stay.', PAGE_MARGIN + 2, cursor.y);
  cursor.advance(LINE_HEIGHT + 1);
}

function drawListEntry(doc, cursor, heading, items, { showCategory = false } = {}) {
  cursor.ensureSpace(LINE_HEIGHT * 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(HORIZON_600);
  doc.text(heading, PAGE_MARGIN + 2, cursor.y);
  cursor.advance(LINE_HEIGHT);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK_900);
  for (const place of items || []) {
    cursor.ensureSpace(LINE_HEIGHT);
    const categoryText = showCategory && place.category ? ` \u00b7 ${place.category}` : '';
    doc.text(`\u2022 ${place.name}${categoryText}`, PAGE_MARGIN + 2, cursor.y);
    cursor.advance(LINE_HEIGHT);
  }
  cursor.advance(1);
}

function drawDay(doc, cursor, day) {
  cursor.ensureSpace(LINE_HEIGHT + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(INK_900);
  doc.text(`Day ${day.dayNumber}`, PAGE_MARGIN, cursor.y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK_500);
  doc.text(formatIndianDate(day.date), PAGE_MARGIN + CONTENT_WIDTH, cursor.y, { align: 'right' });
  cursor.advance(LINE_HEIGHT + 1);

  if (day.entries.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(INK_300);
    doc.text('Nothing scheduled yet for this day.', PAGE_MARGIN + 2, cursor.y);
    cursor.advance(LINE_HEIGHT + 3);
    return;
  }

  for (const entry of day.entries) {
    if (entry.type === 'flight') drawFlightEntry(doc, cursor, entry);
    else if (entry.type === 'accommodation') drawAccommodationEntry(doc, cursor, entry);
    else if (entry.type === 'attractions') drawListEntry(doc, cursor, 'Things to do', entry.items, { showCategory: true });
    else if (entry.type === 'restaurants') drawListEntry(doc, cursor, 'Where to eat', entry.items);
  }
  cursor.advance(2);
}

function drawExpenseSection(doc, cursor, expense) {
  drawSectionHeading(doc, cursor, 'Expense Calculator');

  cursor.ensureSpace(LINE_HEIGHT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK_500);
  const subLine = `${expense.travelers} traveler${expense.travelers > 1 ? 's' : ''}${
    expense.nights != null ? ` \u00b7 ${expense.nights} night${expense.nights > 1 ? 's' : ''}` : ''
  }`;
  doc.text(subLine, PAGE_MARGIN, cursor.y);
  cursor.advance(LINE_HEIGHT + 2);

  const rows = [
    ['Flight', expense.categories.flight.amountInr != null ? formatInr(expense.categories.flight.amountInr) : formatRange(null)],
    ['Hotel / accommodation', formatRange(expense.categories.accommodation.rangeInr)],
    ['Food', formatRange(expense.categories.food.rangeInr)],
    ['Local transport', formatRange(expense.categories.localTransport.rangeInr)],
    ['Tourist attractions / activities', formatRange(expense.categories.attractions.rangeInr)],
    ['Miscellaneous', formatRange(expense.categories.miscellaneous.rangeInr)],
  ];
  for (const [label, value] of rows) {
    drawKeyValueLine(doc, cursor, label, value);
  }

  cursor.advance(2);
  drawKeyValueLine(doc, cursor, 'Total trip expense', formatRange(expense.totalTripExpenseInr), { bold: true });
  if (expense.budgetInr != null) {
    drawKeyValueLine(doc, cursor, 'Your budget', formatInr(expense.budgetInr));
    if (expense.overBudgetInr != null) {
      drawKeyValueLine(doc, cursor, 'Amount over budget', formatInr(expense.overBudgetInr), { bold: true });
    } else if (expense.remainingBudgetInr != null) {
      drawKeyValueLine(doc, cursor, 'Remaining budget', formatInr(expense.remainingBudgetInr), { bold: true });
    }
  }

  cursor.advance(3);
  if (expense.note) {
    drawWrappedText(doc, cursor, expense.note, { fontSize: 8, color: INK_300 });
  }
}

/**
 * Builds a jsPDF document from a `buildPdfReportModel(...)` result. Returns
 * the jsPDF instance (caller decides whether to `.save()`, preview, etc.) —
 * kept separate from `downloadTripPdf` below so this half is testable
 * without touching the browser download API.
 */
function buildTripPdfDocument(reportModel) {
  if (!reportModel) {
    throw new Error('Cannot generate a PDF: no trip data is available yet.');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const cursor = createCursor(doc);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(INK_900);
  doc.text('Trip Plan', PAGE_MARGIN, cursor.y + 4);
  cursor.advance(10);

  if (reportModel.routeLabel) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(HORIZON_600);
    const routeLines = doc.splitTextToSize(reportModel.routeLabel, CONTENT_WIDTH);
    doc.text(routeLines, PAGE_MARGIN, cursor.y);
    cursor.advance(routeLines.length * 6);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK_500);
  const dateLine = reportModel.departureDate
    ? `${formatIndianDate(reportModel.departureDate)}${
        reportModel.returnDate ? ` \u2013 ${formatIndianDate(reportModel.returnDate)}` : ''
      }${reportModel.totalDays ? ` \u00b7 ${reportModel.totalDays} day${reportModel.totalDays > 1 ? 's' : ''}` : ''}`
    : 'Travel dates not available yet';
  doc.text(dateLine, PAGE_MARGIN, cursor.y);
  cursor.advance(4);
  doc.setFontSize(8);
  doc.setTextColor(INK_300);
  doc.text(`Generated ${formatIndianDate(reportModel.generatedAt.toISOString())}`, PAGE_MARGIN, cursor.y);
  cursor.advance(8);

  // Day-by-day Trip Timeline (flights, hotels, attractions, restaurants) —
  // reused verbatim from buildTripTimeline via pdfReport.js.
  drawSectionHeading(doc, cursor, 'Trip Timeline');
  if (!reportModel.timelineAvailable) {
    drawWrappedText(doc, cursor, reportModel.timelineUnavailableReason, { color: INK_300 });
  } else {
    for (const day of reportModel.days) {
      drawDay(doc, cursor, day);
    }
    const unavailableParts = [
      !reportModel.hotelsAvailable && 'accommodation',
      !reportModel.attractionsAvailable && 'tourist attractions',
      !reportModel.restaurantsAvailable && 'restaurants',
    ].filter(Boolean);
    if (unavailableParts.length > 0) {
      drawWrappedText(doc, cursor, `${unavailableParts.join(', ')} not shown \u2014 that data hasn't been loaded for this trip.`, {
        fontSize: 8,
        color: INK_300,
      });
    }
  }
  cursor.advance(4);

  // Expense Calculator breakdown + total + budget/remaining — reused
  // verbatim from computeExpenseBreakdown via pdfReport.js.
  if (reportModel.expenseAvailable) {
    drawExpenseSection(doc, cursor, reportModel.expense);
  } else {
    drawSectionHeading(doc, cursor, 'Expense Calculator');
    drawWrappedText(doc, cursor, 'Expense data is not available for this trip yet.', { color: INK_300 });
  }

  return doc;
}

/** Builds the PDF and triggers a browser download. Client-side only. */
function downloadTripPdf(reportModel, filename = 'trip-plan.pdf') {
  const doc = buildTripPdfDocument(reportModel);
  doc.save(filename);
}

export { buildTripPdfDocument, downloadTripPdf };
