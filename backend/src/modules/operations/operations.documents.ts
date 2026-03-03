import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const COLORS = {
  navy900: '#0f2550',
  navy700: '#1f3f76',
  gold500: '#be9131',
  gold600: '#ad842b',
  gray900: '#1e2530',
  gray700: '#4b5666',
  gray500: '#788392',
  border: '#d6dce4',
  panel: '#f2f4f8',
  white: '#ffffff',
  ok: '#1f7a3d',
  warn: '#9a6700',
  danger: '#a82d2d'
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

type KvpRow = {
  label: string;
  value: string;
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

function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 34, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function toMoney(amount: number, currency: string): string {
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

function normalizePaymentMethod(value: string): string {
  const key = String(value || '').toLowerCase().trim();
  if (key === 'eft' || key === 'bank_transfer') return 'Bank Transfer';
  if (key === 'mobile_money') return 'Mobile Money';
  if (key === 'card') return 'Card';
  if (key === 'cash') return 'Cash';
  if (key === 'other') return 'Other';
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function periodRange(periodMonth: string): { startText: string; endText: string } {
  const start = new Date(`${periodMonth}-01`);
  if (Number.isNaN(start.getTime())) {
    return { startText: periodMonth, endText: periodMonth };
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    startText: longDate(start.toISOString()),
    endText: longDate(end.toISOString())
  };
}

function statusColor(status: string): string {
  if (status === 'paid') return COLORS.ok;
  if (status === 'part_paid') return COLORS.warn;
  return COLORS.danger;
}

function drawMetaItem(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string): void {
  doc
    .fillColor(COLORS.gray900)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`${label}:`, x, y)
    .font('Helvetica')
    .fontSize(10)
    .text(value, x + 70, y, { width: 160 });
}

function drawDetailCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, title: string, rows: KvpRow[]): number {
  const rowHeight = 21;
  const bodyHeight = rows.length * rowHeight + 14;
  const cardHeight = 34 + bodyHeight;

  doc
    .save()
    .roundedRect(x, y, width, cardHeight, 8)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .fillAndStroke(COLORS.white, COLORS.border)
    .restore();

  doc
    .save()
    .roundedRect(x, y, width, 34, 8)
    .fill(COLORS.panel)
    .restore()
    .fillColor(COLORS.navy900)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(title, x + 12, y + 11);

  let cursorY = y + 41;
  rows.forEach((row) => {
    doc
      .fillColor(COLORS.gray900)
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(`${row.label}:`, x + 12, cursorY)
      .font('Helvetica')
      .text(row.value, x + 108, cursorY, { width: width - 120 });
    cursorY += rowHeight;
  });

  return y + cardHeight;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  widths: { desc: number; amount: number; deduct: number },
  values: { desc: string; amount: string; deduct: string },
  isBold = false,
  shaded = false
): number {
  const rowHeight = 31;
  const bg = shaded ? '#fafbfd' : COLORS.white;
  doc
    .save()
    .rect(x, y, widths.desc + widths.amount + widths.deduct, rowHeight)
    .fillAndStroke(bg, COLORS.border)
    .restore();

  doc
    .save()
    .moveTo(x + widths.desc, y)
    .lineTo(x + widths.desc, y + rowHeight)
    .moveTo(x + widths.desc + widths.amount, y)
    .lineTo(x + widths.desc + widths.amount, y + rowHeight)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .restore();

  doc
    .fillColor(COLORS.gray900)
    .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(10.5)
    .text(values.desc, x + 10, y + 10, { width: widths.desc - 16 })
    .text(values.amount, x + widths.desc + 6, y + 10, { width: widths.amount - 12, align: 'right' })
    .text(values.deduct, x + widths.desc + widths.amount + 6, y + 10, { width: widths.deduct - 12, align: 'right' });

  return y + rowHeight;
}

export function buildSalarySlipPdf(data: SalarySlipDocumentData): Promise<Buffer> {
  return renderPdf((doc) => {
    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const right = left + width;
    const period = periodRange(data.payrollPeriod);
    const payDate = data.paymentDate ? longDate(data.paymentDate) : longDate(data.generatedOn);
    const gross = data.amountDue;
    const deductions = data.outstandingAmount;
    const netPay = Math.max(gross - deductions, 0);
    const statusText = data.status.replaceAll('_', ' ').toUpperCase();

    if (LOGO_PATH) {
      try {
        doc.image(LOGO_PATH, left + 4, top + 4, { fit: [86, 86] });
      } catch {
        // Keep rendering without logo if image fails.
      }
    }

    doc
      .fillColor(COLORS.navy900)
      .font('Helvetica-Bold')
      .fontSize(30)
      .text('DYNAVERSE', left + 104, top + 16, { width: 220 })
      .fillColor(COLORS.gold500)
      .fontSize(14)
      .text('FOOTBALL ACADEMY', left + 106, top + 52, { width: 250, characterSpacing: 1.3 });

    doc
      .fillColor(COLORS.navy900)
      .font('Helvetica-Bold')
      .fontSize(28)
      .text('PAYSLIP', right - 194, top + 22, { width: 190, align: 'right' })
      .fillColor(COLORS.gray700)
      .font('Helvetica')
      .fontSize(9)
      .text('A Division of Dynaverse Investments', right - 240, top + 58, { width: 236, align: 'right' });

    doc
      .save()
      .moveTo(left, top + 102)
      .lineTo(right, top + 102)
      .lineWidth(2)
      .strokeColor(COLORS.gold500)
      .stroke()
      .restore();

    drawMetaItem(doc, left + 2, top + 122, 'Slip Number', data.slipNumber);
    drawMetaItem(doc, left + 2, top + 146, 'Pay Period', `${period.startText} to ${period.endText}`);
    drawMetaItem(doc, left + 276, top + 146, 'Pay Date', payDate);

    doc
      .save()
      .moveTo(left, top + 178)
      .lineTo(right, top + 178)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke()
      .restore();

    doc
      .save()
      .roundedRect(right - 132, top + 120, 132, 22, 11)
      .fill(statusColor(data.status))
      .restore()
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(statusText, right - 132, top + 127, { width: 132, align: 'center' });

    const gap = 14;
    const cardWidth = (width - gap) / 2;
    const cardY = top + 194;

    const leftCardBottom = drawDetailCard(doc, left, cardY, cardWidth, 'EMPLOYEE DETAILS', [
      { label: 'Name', value: data.staffName },
      { label: 'Employee ID', value: data.staffCode },
      { label: 'Slip Date', value: longDate(data.generatedOn) },
      { label: 'Contact', value: data.contactPhone }
    ]);

    const rightCardBottom = drawDetailCard(doc, left + cardWidth + gap, cardY, cardWidth, 'POSITION DETAILS', [
      { label: 'Position', value: data.roleTitle },
      { label: 'Payment Method', value: normalizePaymentMethod(data.paymentMethod) },
      { label: 'Funding', value: data.fundingSourceName || '-' },
      { label: 'Reference', value: data.paymentReference || '-' }
    ]);

    let tableY = Math.max(leftCardBottom, rightCardBottom) + 18;

    doc
      .save()
      .roundedRect(left, tableY, width, 30, 8)
      .fill(COLORS.navy900)
      .restore()
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(11.5)
      .text('EARNINGS AND DEDUCTIONS', left, tableY + 10, { width, align: 'center' });
    tableY += 30;

    const tableCols = {
      desc: width * 0.53,
      amount: width * 0.17,
      deduct: width * 0.3
    };

    doc
      .save()
      .rect(left, tableY, width, 30)
      .fillAndStroke(COLORS.panel, COLORS.border)
      .restore()
      .fillColor(COLORS.gray900)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('DESCRIPTION', left + 10, tableY + 10, { width: tableCols.desc - 16 })
      .text('AMOUNT', left + tableCols.desc + 6, tableY + 10, { width: tableCols.amount - 12, align: 'right' })
      .text('DEDUCTIONS', left + tableCols.desc + tableCols.amount + 6, tableY + 10, {
        width: tableCols.deduct - 12,
        align: 'right'
      });
    doc
      .save()
      .moveTo(left + tableCols.desc, tableY)
      .lineTo(left + tableCols.desc, tableY + 30)
      .moveTo(left + tableCols.desc + tableCols.amount, tableY)
      .lineTo(left + tableCols.desc + tableCols.amount, tableY + 30)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke()
      .restore();
    tableY += 30;

    tableY = drawTableRow(
      doc,
      left,
      tableY,
      tableCols,
      {
        desc: 'Basic Salary',
        amount: gross.toFixed(2),
        deduct: '0.00'
      },
      false,
      false
    );

    tableY = drawTableRow(
      doc,
      left,
      tableY,
      tableCols,
      {
        desc: 'Amount Paid (to date)',
        amount: data.amountPaid.toFixed(2),
        deduct: '0.00'
      },
      false,
      true
    );

    tableY = drawTableRow(
      doc,
      left,
      tableY,
      tableCols,
      {
        desc: 'Outstanding Balance',
        amount: '0.00',
        deduct: deductions.toFixed(2)
      },
      false,
      false
    );

    tableY = drawTableRow(
      doc,
      left,
      tableY,
      tableCols,
      {
        desc: 'Total',
        amount: gross.toFixed(2),
        deduct: deductions.toFixed(2)
      },
      true,
      true
    );

    tableY += 12;

    doc
      .save()
      .roundedRect(left, tableY, width, 58, 8)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .fillAndStroke(COLORS.white, COLORS.border)
      .restore();

    const splitX = left + width * 0.69;
    doc
      .save()
      .rect(left, tableY, splitX - left, 29)
      .fill(COLORS.navy900)
      .rect(splitX, tableY, right - splitX, 29)
      .fill(COLORS.gold600)
      .restore()
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text('Gross Earnings', left + 12, tableY + 9)
      .text(gross.toFixed(2), splitX - 96, tableY + 9, { width: 84, align: 'right' })
      .text('Deductions', splitX + 10, tableY + 9)
      .text(deductions.toFixed(2), right - 86, tableY + 9, { width: 74, align: 'right' });

    doc
      .fillColor(COLORS.navy900)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('Net Pay:', left + 12, tableY + 38)
      .font('Helvetica')
      .text(netPay.toFixed(2), left + 118, tableY + 38)
      .fillColor(COLORS.gold600)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(toMoney(netPay, data.currency), splitX + 10, tableY + 34, { width: right - splitX - 20, align: 'right' });

    const notesY = tableY + 74;
    doc
      .fillColor(COLORS.navy900)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('NOTES', left, notesY)
      .save()
      .moveTo(left + 58, notesY + 8)
      .lineTo(right, notesY + 8)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke()
      .restore();

    const noteLines = [
      `Payment is recorded via ${normalizePaymentMethod(data.paymentMethod)}${data.paymentReference ? ` (Ref: ${data.paymentReference})` : ''}.`,
      `Keep this payslip for your records and payroll queries.`,
      `Generated by ${data.issuedBy}.`
    ];

    let noteY = notesY + 18;
    noteLines.forEach((line, index) => {
      doc
        .fillColor(COLORS.gold500)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`${index + 1}.`, left, noteY)
        .fillColor(COLORS.gray900)
        .font('Helvetica')
        .fontSize(11)
        .text(line, left + 18, noteY, { width: width - 18 });
      noteY += 21;
    });

    const footerY = doc.page.height - doc.page.margins.bottom - 36;
    doc
      .save()
      .moveTo(left, footerY - 10)
      .lineTo(right, footerY - 10)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke()
      .restore()
      .fillColor(COLORS.gray700)
      .font('Helvetica')
      .fontSize(10)
      .text(`${data.contactPhone}   |   ${data.contactEmail}`, left, footerY, { width, align: 'center' });

    doc
      .save()
      .rect(left, footerY + 18, width, 14)
      .fill(COLORS.navy900)
      .restore();
  });
}
