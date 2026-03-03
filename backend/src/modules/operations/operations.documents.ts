import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const COLORS = {
  green900: '#0c3b25',
  green800: '#125938',
  gold500: '#c9a54c',
  slate900: '#1e2b24',
  slate700: '#506158',
  border: '#ccdbcf',
  panel: '#f6faf7',
  white: '#ffffff',
  danger: '#a82d2d',
  warn: '#9a6700',
  ok: '#1c7d3a'
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = resolveLogoPath();

export type SalarySlipDocumentData = {
  academyName: string;
  academyTagline: string;
  slipNumber: string;
  generatedOn: string;
  payrollPeriod: string;
  status: string;
  staffCode: string;
  staffName: string;
  roleTitle: string;
  paymentMethod: string;
  paymentDate: string | null;
  paymentReference: string | null;
  fundingSourceName: string | null;
  amountDue: number;
  amountPaid: number;
  outstandingAmount: number;
  currency: string;
  issuedBy: string;
  contactEmail: string;
  contactPhone: string;
};

function resolveLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../../../logo/logo.png'),
    path.resolve(process.cwd(), 'logo/logo.png'),
    path.resolve(process.cwd(), '../logo/logo.png')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function longDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function periodLabel(period: string): string {
  const date = new Date(`${period}-01`);
  if (Number.isNaN(date.getTime())) {
    return period;
  }
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function drawHeader(doc: PDFKit.PDFDocument, data: SalarySlipDocumentData): number {
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc
    .save()
    .roundedRect(left, top, width, 120, 12)
    .fill(COLORS.green900)
    .restore();

  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, left + 16, top + 14, { fit: [72, 72] });
    } catch {
      // Keep rendering if logo fails.
    }
  }

  const titleX = left + 98;
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(24)
    .text('SALARY SLIP', titleX, top + 14, { width: width - 220, align: 'left' })
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(data.academyName, titleX, top + 48, { width: width - 220 })
    .font('Helvetica')
    .fontSize(10)
    .text(data.academyTagline, titleX, top + 70, { width: width - 220 });

  const statusColor = data.status === 'paid' ? COLORS.ok : data.status === 'part_paid' ? COLORS.warn : COLORS.danger;
  doc
    .save()
    .roundedRect(left + width - 140, top + 14, 124, 28, 14)
    .fill(statusColor)
    .restore()
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(data.status.replaceAll('_', ' ').toUpperCase(), left + width - 140, top + 22, {
      width: 124,
      align: 'center'
    });

  return top + 140;
}

function drawKeyValueGrid(
  doc: PDFKit.PDFDocument,
  startY: number,
  items: Array<{ label: string; value: string }>,
  columns = 2
): number {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = width / columns;
  const rowHeight = 42;
  let y = startY;

  for (let i = 0; i < items.length; i += columns) {
    const rowItems = items.slice(i, i + columns);
    rowItems.forEach((item, index) => {
      const x = left + index * colWidth;
      doc
        .save()
        .rect(x, y, colWidth, rowHeight)
        .fillAndStroke(COLORS.panel, COLORS.border)
        .restore()
        .fillColor(COLORS.slate700)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(item.label.toUpperCase(), x + 10, y + 7, { width: colWidth - 18 })
        .fillColor(COLORS.slate900)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(item.value, x + 10, y + 19, { width: colWidth - 18 });
    });
    y += rowHeight + 6;
  }

  return y;
}

export function buildSalarySlipPdf(data: SalarySlipDocumentData): Promise<Buffer> {
  return renderPdf((doc) => {
    let cursorY = drawHeader(doc, data);

    cursorY = drawKeyValueGrid(doc, cursorY, [
      { label: 'Slip Number', value: data.slipNumber },
      { label: 'Generated On', value: longDate(data.generatedOn) },
      { label: 'Payroll Period', value: periodLabel(data.payrollPeriod) },
      { label: 'Payment Date', value: data.paymentDate ? longDate(data.paymentDate) : '-' }
    ]);

    doc
      .fillColor(COLORS.slate900)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('STAFF DETAILS', doc.page.margins.left, cursorY + 2);

    cursorY = drawKeyValueGrid(doc, cursorY + 20, [
      { label: 'Staff Name', value: data.staffName },
      { label: 'Staff Code', value: data.staffCode },
      { label: 'Role', value: data.roleTitle },
      { label: 'Payment Method', value: data.paymentMethod.toUpperCase() },
      { label: 'Payment Reference', value: data.paymentReference || '-' },
      { label: 'Funding Source', value: data.fundingSourceName || '-' }
    ]);

    doc
      .fillColor(COLORS.slate900)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('PAYMENT SUMMARY', doc.page.margins.left, cursorY + 2);

    cursorY = drawKeyValueGrid(doc, cursorY + 20, [
      { label: 'Amount Due', value: money(data.amountDue, data.currency) },
      { label: 'Amount Paid', value: money(data.amountPaid, data.currency) },
      { label: 'Outstanding', value: money(data.outstandingAmount, data.currency) }
    ]);

    const footerY = doc.page.height - doc.page.margins.bottom - 52;
    doc
      .save()
      .rect(doc.page.margins.left, footerY, doc.page.width - doc.page.margins.left - doc.page.margins.right, 40)
      .fill(COLORS.panel)
      .restore()
      .fillColor(COLORS.slate700)
      .font('Helvetica')
      .fontSize(9)
      .text(`Issued By: ${data.issuedBy}`, doc.page.margins.left + 10, footerY + 8)
      .text(`Contact: ${data.contactEmail} | ${data.contactPhone}`, doc.page.margins.left + 10, footerY + 22);
  });
}
