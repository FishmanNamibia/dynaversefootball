import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const COLORS = {
  navy900: '#0f2550',
  navy700: '#1f3f76',
  gold500: '#be9131',
  gold600: '#ad842b',
  green700: '#8eaa93',
  green800: '#2c613f',
  gray900: '#1e2530',
  gray700: '#4b5666',
  border: '#d6dce4',
  panel: '#f2f4f8',
  white: '#ffffff'
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = resolveLogoPath();

type LineItem = {
  description: string;
  quantity: number;
  unitAmount: number;
  lineTotal: number;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export type InvoiceDocumentData = {
  academyName: string;
  academyDivisionLine: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  currency: string;
  subtotalAmount: number;
  totalAmount: number;
  playerCode: string;
  playerName: string;
  guardianName: string | null;
  guardianContact: string | null;
  items: LineItem[];
  paymentMethod: string;
  paymentReference: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  issuedBy: string;
};

export type ReceiptDocumentData = {
  academyName: string;
  academyTagline: string;
  receiptNumber: string;
  receiptDate: string;
  status: string;
  playerCode: string;
  playerName: string;
  academyProgram: string;
  paymentMethod: string;
  paymentReference: string | null;
  paymentAmount: number;
  currency: string;
  appliedTo: string[];
  totalPaid: number;
  balanceDue: number;
  issuedBy: string;
  generatedOn: string;
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

function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
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

function clean(value: string | null | undefined, fallback = '-'): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : fallback;
}

function statusFill(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'paid') return COLORS.green800;
  if (normalized === 'part_paid' || normalized === 'partial') return COLORS.gold600;
  if (normalized === 'overdue') return COLORS.gold600;
  return '#b33a36';
}

function pageBounds(doc: PDFKit.PDFDocument): { left: number; right: number; top: number; width: number } {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.page.margins.top;
  return { left, right, top, width: right - left };
}

function drawCommonHeader(
  doc: PDFKit.PDFDocument,
  params: { academyName: string; subtitle: string; title: string; accent: string }
): number {
  const { left, right, top, width } = pageBounds(doc);
  const logoSize = 76;

  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, left, top + 2, { fit: [logoSize, logoSize] });
    } catch {
      // Keep rendering without logo if image fails.
    }
  }

  const textX = left + logoSize + 12;
  const textW = width - logoSize - 210;
  const academyFontSize = params.academyName.length > 22 ? 18 : 22;
  const headingY = top + 14;

  doc.font('Helvetica-Bold').fontSize(academyFontSize);
  const academyNameHeight = doc.heightOfString(params.academyName, { width: textW });

  doc
    .fillColor(COLORS.navy900)
    .font('Helvetica-Bold')
    .fontSize(academyFontSize)
    .text(params.academyName, textX, headingY, { width: textW });

  const subtitleY = headingY + academyNameHeight + 2;
  doc.font('Helvetica').fontSize(8.8);
  const subtitleHeight = doc.heightOfString(params.subtitle, { width: textW });

  doc
    .fillColor(COLORS.gray700)
    .font('Helvetica')
    .fontSize(8.8)
    .text(params.subtitle, textX, subtitleY, { width: textW });

  doc
    .fillColor(COLORS.navy900)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text(params.title, right - 190, top + 18, { width: 190, align: 'right' });

  const contentBottom = Math.max(top + logoSize + 2, subtitleY + subtitleHeight);
  const dividerY = contentBottom + 8;
  doc
    .save()
    .moveTo(left, dividerY)
    .lineTo(right, dividerY)
    .lineWidth(3)
    .strokeColor(params.accent)
    .stroke()
    .restore();

  return dividerY + 12;
}

function drawMetaText(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string): void {
  doc
    .fillColor(COLORS.gray900)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`${label}:`, x, y)
    .font('Helvetica')
    .text(value, x + 74, y);
}

function drawStatusPill(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fillColor: string
): void {
  doc
    .save()
    .roundedRect(x, y, width, height, 9)
    .fillAndStroke(fillColor, fillColor)
    .restore()
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(text.toUpperCase(), x, y + 8, { width, align: 'center' });
}

function drawSoftCardHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  title: string,
  tint: string = COLORS.panel
): void {
  doc
    .save()
    .roundedRect(x, y, w, 32, 8)
    .fillAndStroke(tint, COLORS.border)
    .restore()
    .fillColor(COLORS.navy900)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(title, x + 12, y + 10);
}

function drawInvoiceTemplate(doc: PDFKit.PDFDocument, data: InvoiceDocumentData): void {
  const { left, right, width } = pageBounds(doc);
  const headerBottom = drawCommonHeader(doc, {
    academyName: data.academyName,
    subtitle: data.academyDivisionLine,
    title: 'INVOICE',
    accent: COLORS.gold500
  });

  const metaTop = headerBottom + 8;
  drawMetaText(doc, left, metaTop, 'Invoice Number', data.invoiceNumber);
  drawMetaText(doc, left, metaTop + 23, 'Invoice Date', `${longDate(data.issueDate)} • ${longDate(data.dueDate)}`);

  drawStatusPill(doc, right - 148, metaTop - 4, 142, 30, data.status, statusFill(data.status));

  const ornateY = metaTop + 54;
  doc
    .save()
    .moveTo(left, ornateY)
    .lineTo(right, ornateY)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .circle((left + right) / 2, ornateY, 4)
    .fill(COLORS.gold500)
    .restore();

  const billingCardY = ornateY + 14;
  const cardHeight = 128;
  doc
    .save()
    .roundedRect(left, billingCardY, width, cardHeight, 8)
    .fillAndStroke(COLORS.white, COLORS.border)
    .restore();
  drawSoftCardHeader(doc, left, billingCardY, width, 'PLAYER / BILLING DETAILS');

  const bodyY = billingCardY + 44;
  drawMetaText(doc, left + 12, bodyY, 'Player Name', data.playerName);
  drawMetaText(doc, left + 12, bodyY + 22, 'Player ID', data.playerCode);
  drawMetaText(doc, left + 12, bodyY + 44, 'Guardian', clean(data.guardianName));
  drawMetaText(doc, left + 12, bodyY + 66, 'Contact', clean(data.guardianContact));

  const tableTop = billingCardY + cardHeight + 14;
  const qtyW = 60;
  const unitW = 110;
  const amtW = 128;
  const descW = width - qtyW - unitW - amtW;

  doc
    .save()
    .roundedRect(left, tableTop, width, 30, 8)
    .fill(COLORS.navy900)
    .restore()
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('INVOICE ITEMS', left + 12, tableTop + 10)
    .fontSize(9.5)
    .text('QTY', left + descW, tableTop + 10, { width: qtyW - 8, align: 'center' })
    .text('(UNIT)', left + descW + qtyW, tableTop + 10, { width: unitW - 8, align: 'right' })
    .text(`AMOUNT (${data.currency})`, left + descW + qtyW + unitW, tableTop + 10, { width: amtW - 8, align: 'right' });

  let rowY = tableTop + 30;
  const rows = data.items.slice(0, 8);
  rows.forEach((item, index) => {
    const rowHeight = 30;
    doc
      .save()
      .rect(left, rowY, width, rowHeight)
      .fillAndStroke(index % 2 === 0 ? COLORS.white : '#fafbfd', COLORS.border)
      .restore()
      .fillColor(COLORS.gray900)
      .font('Helvetica')
      .fontSize(10.2)
      .text(clean(item.description), left + 12, rowY + 10, { width: descW - 16, ellipsis: true })
      .text(String(item.quantity), left + descW + 2, rowY + 10, { width: qtyW - 8, align: 'center' })
      .text(item.unitAmount.toFixed(2), left + descW + qtyW, rowY + 10, { width: unitW - 8, align: 'right' })
      .text(item.lineTotal.toFixed(2), left + descW + qtyW + unitW, rowY + 10, { width: amtW - 8, align: 'right' });
    rowY += rowHeight;
  });

  rowY += 6;
  doc
    .save()
    .roundedRect(left, rowY, width, 34, 8)
    .fillAndStroke(COLORS.panel, COLORS.border)
    .restore()
    .fillColor(COLORS.gray900)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Sub-total', left + descW + qtyW + 10, rowY + 10, { width: 100, align: 'right' })
    .text(data.subtotalAmount.toFixed(2), left + descW + qtyW + unitW, rowY + 10, { width: amtW - 8, align: 'right' });

  const instructY = rowY + 48;
  doc
    .fillColor(COLORS.navy900)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('PAYMENT INSTRUCTIONS', left, instructY);
  doc
    .save()
    .moveTo(left + 194, instructY + 8)
    .lineTo(right, instructY + 8)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .restore();

  doc
    .fillColor(COLORS.gray900)
    .font('Helvetica')
    .fontSize(11)
    .text(clean(data.paymentMethod, 'EFT / Cash'), left, instructY + 24)
    .font('Helvetica-Bold')
    .text(`REFERENCE: ${data.paymentReference}`, left, instructY + 46)
    .font('Helvetica')
    .text(clean(data.bankName), left, instructY + 68)
    .text(clean(data.bankAccountNumber), left, instructY + 88);

  const dueBoxW = 220;
  const dueBoxX = right - dueBoxW;
  doc
    .save()
    .roundedRect(dueBoxX, instructY - 6, dueBoxW, 76, 11)
    .fillAndStroke(COLORS.white, COLORS.gold500)
    .restore()
    .fillColor(COLORS.gray900)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text('TOTAL DUE', dueBoxX + 16, instructY + 8)
    .save()
    .moveTo(dueBoxX + 12, instructY + 34)
    .lineTo(dueBoxX + dueBoxW - 12, instructY + 34)
    .lineWidth(1)
    .strokeColor(COLORS.gold500)
    .stroke()
    .restore()
    .fillColor(COLORS.gold600)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(money(data.totalAmount, data.currency), dueBoxX + 12, instructY + 44, { width: dueBoxW - 24, align: 'right' });

  const footerTop = doc.page.height - doc.page.margins.bottom - 46;
  doc
    .save()
    .moveTo(left, footerTop - 10)
    .lineTo(right, footerTop - 10)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .restore()
    .fillColor(COLORS.gray900)
    .font('Helvetica')
    .fontSize(10)
    .text(`+264 81 299 4529   |   services@dynaverseinvestment.com`, left, footerTop, { width, align: 'center' });

  doc
    .save()
    .rect(left, footerTop + 18, width, 15)
    .fill(COLORS.navy900)
    .restore()
    .fillColor(COLORS.white)
    .font('Helvetica')
    .fontSize(11)
    .text('/   www.dynaverseinvestment.com', left, footerTop + 21, { width, align: 'center' });
}

function drawReceiptTemplate(doc: PDFKit.PDFDocument, data: ReceiptDocumentData): void {
  const { left, right, width } = pageBounds(doc);
  const headerBottom = drawCommonHeader(doc, {
    academyName: data.academyName,
    subtitle: data.academyTagline,
    title: 'RECEIPT',
    accent: COLORS.green700
  });

  const metaTop = headerBottom + 8;
  drawMetaText(doc, left, metaTop, 'Receipt No', data.receiptNumber);
  drawMetaText(doc, left, metaTop + 23, 'Receipt Date', longDate(data.receiptDate));
  drawStatusPill(doc, right - 122, metaTop - 4, 116, 30, data.status, statusFill(data.status));

  const ornateY = metaTop + 54;
  doc
    .save()
    .moveTo(left, ornateY)
    .lineTo(right, ornateY)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .circle((left + right) / 2, ornateY, 4)
    .fill(COLORS.green700)
    .restore();

  const cardY = ornateY + 14;
  const cardH = 128;
  doc
    .save()
    .roundedRect(left, cardY, width, cardH, 8)
    .fillAndStroke(COLORS.white, COLORS.border)
    .restore();
  drawSoftCardHeader(doc, left, cardY, width, 'PAYMENT RECEIVED FROM:', '#e8efea');

  const midX = left + width * 0.52;
  doc
    .save()
    .moveTo(midX, cardY + 44)
    .lineTo(midX, cardY + cardH - 8)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .restore();

  drawMetaText(doc, left + 12, cardY + 52, 'Player', data.playerName);
  drawMetaText(doc, left + 12, cardY + 80, 'Employee ID', data.playerCode);
  drawMetaText(doc, left + 12, cardY + 108, 'Guardian', '-');
  drawMetaText(doc, midX + 12, cardY + 52, 'Program', clean(data.academyProgram));
  drawMetaText(doc, midX + 12, cardY + 80, 'Payer', clean(data.playerName));
  drawMetaText(doc, midX + 12, cardY + 108, 'Phone', clean(data.contactPhone ?? null));

  const detailY = cardY + cardH + 14;
  const detailH = 170;
  doc
    .save()
    .roundedRect(left, detailY, width, detailH, 8)
    .fillAndStroke(COLORS.white, COLORS.border)
    .restore();
  drawSoftCardHeader(doc, left, detailY, width, 'PAYMENT DETAILS', '#e8efea');

  const primaryLine = data.appliedTo.length > 0 ? data.appliedTo[0] : 'Invoice settlement';
  doc
    .fillColor(COLORS.gray900)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(primaryLine.toUpperCase(), left + 18, detailY + 54, { width: width - 36 })
    .font('Helvetica')
    .fontSize(15)
    .text(data.paymentAmount.toFixed(2), right - 120, detailY + 54, { width: 100, align: 'right' });

  doc
    .save()
    .roundedRect(left, detailY + 90, width, 34, 7)
    .fillAndStroke('#e9f0eb', COLORS.border)
    .restore()
    .fillColor(COLORS.green800)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Total Paid:', left + 18, detailY + 102)
    .text(data.totalPaid.toFixed(2), right - 120, detailY + 102, { width: 100, align: 'right' });

  drawMetaText(doc, left + 18, detailY + 140, 'Payment Method', data.paymentMethod.toUpperCase());
  drawMetaText(doc, left + 280, detailY + 140, 'Reference', clean(data.paymentReference));

  const issuedBandY = detailY + detailH + 12;
  doc
    .save()
    .roundedRect(left, issuedBandY, width, 40, 6)
    .fill('#e8efea')
    .restore()
    .fillColor(COLORS.gray900)
    .font('Helvetica')
    .fontSize(12)
    .text(`Issued by ${data.issuedBy}  |  Thank you`, left, issuedBandY + 14, { width, align: 'center' });

  const footerTop = doc.page.height - doc.page.margins.bottom - 46;
  doc
    .save()
    .moveTo(left, footerTop - 10)
    .lineTo(right, footerTop - 10)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke()
    .restore()
    .fillColor(COLORS.gray900)
    .font('Helvetica')
    .fontSize(10)
    .text(`${data.contactPhone}   |   ${data.contactEmail}`, left, footerTop, { width, align: 'center' });

  doc
    .save()
    .rect(left, footerTop + 18, width, 15)
    .fill(COLORS.navy900)
    .restore()
    .fillColor(COLORS.white)
    .font('Helvetica')
    .fontSize(11)
    .text('/   www.dynaverseinvestment.com', left, footerTop + 21, { width, align: 'center' });
}

export async function buildInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return renderPdf((doc) => {
    drawInvoiceTemplate(doc, data);
  });
}

export async function buildReceiptPdf(data: ReceiptDocumentData): Promise<Buffer> {
  return renderPdf((doc) => {
    drawReceiptTemplate(doc, data);
  });
}
