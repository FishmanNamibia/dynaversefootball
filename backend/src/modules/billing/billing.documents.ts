import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const COLORS = {
  green900: '#083620',
  green800: '#0c4a2e',
  green700: '#11613c',
  gold500: '#c9a54c',
  slate900: '#1c2320',
  slate700: '#4e5d57',
  slate500: '#6f7e76',
  surface: '#f9fbf8',
  surfaceAlt: '#f1f6f2',
  surfaceHeader: '#e7f0e8',
  border: '#ccdbcf',
  borderSoft: '#dde8df',
  white: '#ffffff',
  danger: '#b0302f',
  warning: '#b1711b',
  success: '#1f7a3d'
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

type KeyValueRow = {
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

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function formatLongDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function statusColor(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'paid') {
    return COLORS.success;
  }
  if (normalized === 'overdue') {
    return COLORS.warning;
  }
  if (normalized === 'partial' || normalized === 'partially_paid') {
    return '#2e7d8d';
  }
  if (normalized === 'unpaid' || normalized === 'sent') {
    return COLORS.danger;
  }
  return COLORS.green800;
}

function ensureSpace(doc: PDFKit.PDFDocument, heightNeeded: number): void {
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + heightNeeded <= pageBottom) {
    return;
  }
  doc.addPage();
  doc.y = doc.page.margins.top;
}

function pageLayout(doc: PDFKit.PDFDocument): { left: number; right: number; width: number } {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  return {
    left,
    right,
    width: right - left
  };
}

function drawHeaderMetaRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string
): void {
  const labelWidth = 82;
  doc.fillColor('#d8e7dc').font('Helvetica-Bold').fontSize(8).text(label, x, y, { width: labelWidth });
  doc
    .fillColor(COLORS.white)
    .font('Helvetica')
    .fontSize(9)
    .text(value, x + labelWidth, y, {
      width: Math.max(width - labelWidth, 40),
      align: 'right'
    });
}

function drawBrandHeader(
  doc: PDFKit.PDFDocument,
  options: {
    academyName: string;
    subtitle: string;
    documentTitle: string;
    documentNumberLabel: string;
    documentNumber: string;
    issueDateLabel: string;
    issueDate: string;
    dueDateLabel?: string;
    dueDate?: string;
    status: string;
  }
): void {
  const { left, width } = pageLayout(doc);
  const top = doc.y;
  const headerHeight = 124;
  ensureSpace(doc, headerHeight + 10);

  doc.save();
  doc.roundedRect(left, top, width, headerHeight, 12).fill(COLORS.green900);
  doc.rect(left, top + headerHeight - 40, width, 40).fill(COLORS.green700);
  doc.restore();

  const logoX = left + 14;
  const logoY = top + 14;
  const logoSize = 76;
  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, logoX, logoY, { fit: [logoSize, logoSize], align: 'center', valign: 'center' });
    } catch {
      // If the image cannot render, continue with text-only header.
    }
  }

  const textStart = LOGO_PATH ? logoX + logoSize + 14 : left + 18;
  const rightPanelWidth = 210;
  const rightPanelX = left + width - rightPanelWidth - 16;
  const centerTextWidth = Math.max(rightPanelX - textStart - 18, 145);
  const academyTitleSize = options.academyName.length > 25 ? 17 : 20;
  const academyTitleY = top + 18;

  doc.font('Helvetica-Bold').fontSize(academyTitleSize);
  const academyTitleHeight = doc.heightOfString(options.academyName, { width: centerTextWidth });

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(academyTitleSize)
    .text(options.academyName, textStart, academyTitleY, { width: centerTextWidth });

  const subtitleY = academyTitleY + academyTitleHeight + 4;
  doc
    .fillColor('#d7e8dd')
    .font('Helvetica')
    .fontSize(10)
    .text(options.subtitle, textStart, subtitleY, { width: centerTextWidth });

  doc
    .fillColor('#f6d890')
    .font('Helvetica-Bold')
    .fontSize(28)
    .text(options.documentTitle, rightPanelX, top + 18, { width: rightPanelWidth, align: 'right' });

  const metaWidth = rightPanelWidth;
  const metaX = rightPanelX;
  let metaY = top + 62;
  drawHeaderMetaRow(doc, metaX, metaY, metaWidth, options.documentNumberLabel, options.documentNumber);
  metaY += 14;
  drawHeaderMetaRow(doc, metaX, metaY, metaWidth, options.issueDateLabel, formatLongDate(options.issueDate));
  if (options.dueDateLabel && options.dueDate) {
    metaY += 14;
    drawHeaderMetaRow(doc, metaX, metaY, metaWidth, options.dueDateLabel, formatLongDate(options.dueDate));
  }

  const statusText = options.status.toUpperCase();
  const statusWidth = Math.max(doc.widthOfString(statusText) + 24, 82);
  const statusX = left + width - statusWidth - 16;
  const statusY = top + 95;
  doc.save();
  doc.roundedRect(statusX, statusY, statusWidth, 20, 10).fill(statusColor(options.status));
  doc.restore();
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(statusText, statusX, statusY + 6, { width: statusWidth, align: 'center' });

  doc.y = top + headerHeight + 12;
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  const { left, right } = pageLayout(doc);
  doc.fillColor(COLORS.green900).font('Helvetica-Bold').fontSize(11).text(title, left, doc.y);
  const lineY = doc.y + 2;
  doc
    .save()
    .moveTo(left, lineY)
    .lineTo(right, lineY)
    .strokeColor(COLORS.gold500)
    .lineWidth(1)
    .stroke()
    .restore();
  doc.moveDown(0.5);
}

function drawDetailCard(doc: PDFKit.PDFDocument, title: string, rows: KeyValueRow[]): void {
  const { left, width } = pageLayout(doc);
  const horizontalPadding = 14;
  const labelWidth = 145;
  const valueWidth = width - horizontalPadding * 2 - labelWidth - 10;
  const rowGap = 8;

  doc.font('Helvetica').fontSize(10);
  const rowHeights = rows.map((row) => {
    const value = row.value.trim().length > 0 ? row.value : '-';
    const labelHeight = doc.heightOfString(row.label, { width: labelWidth });
    const valueHeight = doc.heightOfString(value, { width: valueWidth });
    return Math.max(labelHeight, valueHeight, 13);
  });

  const rowsHeight = rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0) + rowGap * Math.max(rows.length - 1, 0);
  const cardHeight = 42 + rowsHeight + 14;
  ensureSpace(doc, cardHeight + 8);

  const top = doc.y;
  doc.save();
  doc.roundedRect(left, top, width, cardHeight, 10).fillAndStroke(COLORS.surface, COLORS.border);
  doc.rect(left, top, width, 30).fill(COLORS.surfaceHeader);
  doc.restore();

  doc.fillColor(COLORS.green900).font('Helvetica-Bold').fontSize(10).text(title, left + horizontalPadding, top + 10);

  let rowY = top + 40;
  rows.forEach((row, index) => {
    if (index > 0) {
      doc
        .save()
        .moveTo(left + horizontalPadding, rowY - 5)
        .lineTo(left + width - horizontalPadding, rowY - 5)
        .strokeColor(COLORS.borderSoft)
        .lineWidth(1)
        .stroke()
        .restore();
    }
    const value = row.value.trim().length > 0 ? row.value : '-';
    doc.fillColor(COLORS.slate500).font('Helvetica-Bold').fontSize(8).text(row.label.toUpperCase(), left + horizontalPadding, rowY, {
      width: labelWidth
    });
    doc.fillColor(COLORS.slate900).font('Helvetica').fontSize(10).text(value, left + horizontalPadding + labelWidth + 10, rowY, {
      width: valueWidth
    });
    rowY += rowHeights[index] + rowGap;
  });

  doc.y = top + cardHeight + 10;
}

function drawInvoiceItemsTable(
  doc: PDFKit.PDFDocument,
  currency: string,
  items: LineItem[],
  subtotalAmount: number,
  totalAmount: number
): void {
  const { left, width } = pageLayout(doc);
  const qtyWidth = 54;
  const unitWidth = 100;
  const amountWidth = 112;
  const descriptionWidth = width - qtyWidth - unitWidth - amountWidth;

  doc.font('Helvetica').fontSize(9);
  const normalizedRows = items.map((item) => {
    const period =
      item.periodStart && item.periodEnd
        ? `Coverage: ${formatLongDate(item.periodStart)} - ${formatLongDate(item.periodEnd)}`
        : null;
    const description = period ? `${item.description}\n${period}` : item.description;
    const rowHeight = Math.max(doc.heightOfString(description, { width: descriptionWidth - 12 }) + 10, 24);
    return {
      description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineTotal: item.lineTotal,
      rowHeight
    };
  });

  const rowsHeight = normalizedRows.reduce((sum, row) => sum + row.rowHeight, 0);
  const tableHeight = 26 + rowsHeight;
  const totalsHeight = 60;
  ensureSpace(doc, 34 + tableHeight + totalsHeight);

  drawSectionTitle(doc, 'INVOICE ITEMS');
  const tableTop = doc.y;

  doc.save();
  doc.rect(left, tableTop, width, 26).fill(COLORS.green800);
  doc.restore();
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(9).text('Description', left + 8, tableTop + 8, {
    width: descriptionWidth - 12
  });
  doc.fillColor(COLORS.white).text('Qty', left + descriptionWidth, tableTop + 8, { width: qtyWidth, align: 'center' });
  doc.fillColor(COLORS.white).text(`Unit (${currency})`, left + descriptionWidth + qtyWidth, tableTop + 8, {
    width: unitWidth,
    align: 'right'
  });
  doc.fillColor(COLORS.white).text(`Amount (${currency})`, left + descriptionWidth + qtyWidth + unitWidth, tableTop + 8, {
    width: amountWidth - 8,
    align: 'right'
  });

  let cursorY = tableTop + 26;
  normalizedRows.forEach((row, index) => {
    if (index % 2 === 1) {
      doc.save();
      doc.rect(left, cursorY, width, row.rowHeight).fill(COLORS.surfaceAlt);
      doc.restore();
    }

    doc.fillColor(COLORS.slate900).font('Helvetica').fontSize(9).text(row.description, left + 8, cursorY + 6, {
      width: descriptionWidth - 12
    });
    doc
      .fillColor(COLORS.slate900)
      .text(String(row.quantity), left + descriptionWidth, cursorY + 6, { width: qtyWidth, align: 'center' });
    doc.fillColor(COLORS.slate900).text(row.unitAmount.toFixed(2), left + descriptionWidth + qtyWidth, cursorY + 6, {
      width: unitWidth - 6,
      align: 'right'
    });
    doc.fillColor(COLORS.slate900).text(row.lineTotal.toFixed(2), left + descriptionWidth + qtyWidth + unitWidth, cursorY + 6, {
      width: amountWidth - 8,
      align: 'right'
    });

    doc
      .save()
      .moveTo(left, cursorY + row.rowHeight)
      .lineTo(left + width, cursorY + row.rowHeight)
      .strokeColor(COLORS.borderSoft)
      .lineWidth(1)
      .stroke()
      .restore();

    cursorY += row.rowHeight;
  });

  doc.save();
  doc.rect(left, tableTop, width, tableHeight).strokeColor(COLORS.border).lineWidth(1).stroke();
  doc
    .moveTo(left + descriptionWidth, tableTop)
    .lineTo(left + descriptionWidth, tableTop + tableHeight)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  doc
    .moveTo(left + descriptionWidth + qtyWidth, tableTop)
    .lineTo(left + descriptionWidth + qtyWidth, tableTop + tableHeight)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  doc
    .moveTo(left + descriptionWidth + qtyWidth + unitWidth, tableTop)
    .lineTo(left + descriptionWidth + qtyWidth + unitWidth, tableTop + tableHeight)
    .strokeColor(COLORS.border)
    .lineWidth(1)
    .stroke();
  doc.restore();

  const totalsTop = cursorY + 8;
  const totalsWidth = 220;
  const totalsX = left + width - totalsWidth;
  doc.save();
  doc.roundedRect(totalsX, totalsTop, totalsWidth, totalsHeight, 8).fillAndStroke(COLORS.surface, COLORS.border);
  doc.restore();
  doc.fillColor(COLORS.slate700).font('Helvetica-Bold').fontSize(9).text('Subtotal', totalsX + 12, totalsTop + 12, {
    width: 90
  });
  doc
    .fillColor(COLORS.slate900)
    .font('Helvetica')
    .fontSize(10)
    .text(subtotalAmount.toFixed(2), totalsX + 95, totalsTop + 12, { width: 110, align: 'right' });

  doc
    .save()
    .moveTo(totalsX + 12, totalsTop + 30)
    .lineTo(totalsX + totalsWidth - 12, totalsTop + 30)
    .strokeColor(COLORS.borderSoft)
    .lineWidth(1)
    .stroke()
    .restore();

  doc.fillColor(COLORS.green900).font('Helvetica-Bold').fontSize(10).text('TOTAL DUE', totalsX + 12, totalsTop + 38, {
    width: 90
  });
  doc
    .fillColor(COLORS.green900)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(money(totalAmount, currency), totalsX + 95, totalsTop + 36, {
      width: 110,
      align: 'right'
    });

  doc.y = totalsTop + totalsHeight + 10;
}

function drawFooterBand(doc: PDFKit.PDFDocument, text: string): void {
  const { left, width } = pageLayout(doc);
  ensureSpace(doc, 30);
  const top = doc.y;
  doc.save();
  doc.roundedRect(left, top, width, 24, 8).fill(COLORS.surfaceHeader);
  doc.restore();
  doc.fillColor(COLORS.slate700).font('Helvetica').fontSize(9).text(text, left + 10, top + 8, {
    width: width - 20,
    align: 'center'
  });
  doc.y = top + 30;
}

function cleanInvoiceText(value: string | null | undefined, fallback = '-'): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : fallback;
}

function drawTemplateLeftArtwork(
  doc: PDFKit.PDFDocument,
  pageLeft: number,
  pageTop: number,
  stripWidth: number,
  stripHeight: number
): void {
  doc.save();
  doc.rect(pageLeft, pageTop, stripWidth, stripHeight).fill('#f6f9f5');
  doc.fillOpacity(0.22).fillColor('#d6e4d2').rect(pageLeft + Math.max(stripWidth * 0.36, 2), pageTop + 16, Math.max(stripWidth * 0.28, 2), stripHeight - 32).fill();
  doc.restore();
}

function drawTemplateBottomWaves(
  doc: PDFKit.PDFDocument,
  pageLeft: number,
  pageRight: number,
  pageBottom: number
): void {
  const width = pageRight - pageLeft;
  const waveBase = pageBottom - 78;

  doc.save();
  doc
    .moveTo(pageLeft - 4, waveBase + 28)
    .bezierCurveTo(pageLeft + width * 0.18, waveBase - 34, pageLeft + width * 0.38, waveBase + 56, pageLeft + width * 0.6, waveBase + 20)
    .bezierCurveTo(pageLeft + width * 0.78, waveBase - 4, pageRight + 6, waveBase + 34, pageRight + 6, waveBase + 34)
    .lineTo(pageRight + 6, pageBottom + 8)
    .lineTo(pageLeft - 4, pageBottom + 8)
    .closePath()
    .fill('#4ab2de');

  doc
    .moveTo(pageLeft - 4, waveBase + 20)
    .bezierCurveTo(pageLeft + width * 0.2, waveBase - 44, pageLeft + width * 0.4, waveBase + 44, pageLeft + width * 0.64, waveBase + 8)
    .bezierCurveTo(pageLeft + width * 0.8, waveBase - 14, pageRight + 6, waveBase + 26, pageRight + 6, waveBase + 26)
    .lineTo(pageRight + 6, pageBottom + 8)
    .lineTo(pageLeft - 4, pageBottom + 8)
    .closePath()
    .fill('#1f7ec6');

  doc
    .moveTo(pageLeft - 4, waveBase + 14)
    .bezierCurveTo(pageLeft + width * 0.24, waveBase - 52, pageLeft + width * 0.45, waveBase + 38, pageLeft + width * 0.68, waveBase)
    .bezierCurveTo(pageLeft + width * 0.85, waveBase - 20, pageRight + 6, waveBase + 18, pageRight + 6, waveBase + 18)
    .lineTo(pageRight + 6, pageBottom + 8)
    .lineTo(pageLeft - 4, pageBottom + 8)
    .closePath()
    .fill('#2b62ab');
  doc.restore();
}

function drawTemplateInvoice(doc: PDFKit.PDFDocument, data: InvoiceDocumentData): void {
  const pageInset = 10;
  const left = pageInset;
  const right = doc.page.width - pageInset;
  const width = right - left;
  const top = pageInset;
  const bottom = doc.page.height - pageInset;
  const pageHeight = bottom - top;

  doc.save();
  doc.rect(left, top, width, pageHeight).fill('#fbfcfd');
  doc.restore();

  const stripWidth = 0;
  const stripHeight = 0;
  if (stripWidth > 0 && stripHeight > 0) {
    drawTemplateLeftArtwork(doc, left, top, stripWidth, stripHeight);
  }

  const contentLeft = left + 14;
  const contentWidth = right - contentLeft - 10;
  const headerTop = top + 14;
  const logoSize = 56;
  const rightHeaderWidth = 182;
  const leftHeaderWidth = contentWidth - rightHeaderWidth - 18;

  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, contentLeft, headerTop + 4, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center'
      });
    } catch {
      // Continue with text if logo draw fails.
    }
  }

  const textStart = LOGO_PATH ? contentLeft + logoSize + 10 : contentLeft;
  const invoiceTitleX = contentLeft + contentWidth - rightHeaderWidth;
  doc
    .fillColor('#1d4d83')
    .font('Helvetica-Bold')
    .fontSize(44)
    .text('INVOICE', invoiceTitleX, headerTop + 2, {
      width: rightHeaderWidth,
      align: 'right',
      lineBreak: false
    });

  doc
    .fillColor('#0f2f57')
    .font('Helvetica-Bold')
    .fontSize(11.5)
    .text(data.academyName, textStart, headerTop + 8, {
      width: leftHeaderWidth
    });
  doc.fillColor('#384d66').font('Helvetica').fontSize(8.2).text(data.academyDivisionLine, textStart, headerTop + 24, {
    width: leftHeaderWidth
  });
  doc
    .fillColor('#384d66')
    .font('Helvetica')
    .fontSize(8.2)
    .text('Building Character - Developing Talent - Future Professionals', textStart, headerTop + 36, {
      width: leftHeaderWidth
    });

  const infoTop = headerTop + 86;
  const colGap = 12;
  const col1Width = 124;
  const col2Width = 126;
  const col3Width = contentWidth - col1Width - col2Width - colGap * 2;
  const col1X = contentLeft;
  const col2X = col1X + col1Width + colGap;
  const col3X = col2X + col2Width + colGap;
  const metaLabelWidth = 82;
  const metaValueWidth = col3Width - metaLabelWidth;

  const statusText = data.status.toUpperCase();
  const statusW = Math.max(doc.widthOfString(statusText) + 22, 92);
  const statusX = contentLeft + contentWidth - statusW - 2;
  const statusY = infoTop + 62;
  doc.save();
  doc.roundedRect(statusX, statusY, statusW, 18, 9).fill(statusColor(data.status));
  doc.restore();
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(statusText, statusX, statusY + 5, { width: statusW, align: 'center' });

  doc.fillColor('#1f5e9a').font('Helvetica-Bold').fontSize(8.5).text('BILL TO', col1X, infoTop);
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(8.5).text(cleanInvoiceText(data.guardianName), col1X, infoTop + 12, { width: col1Width });
  doc.fillColor('#1c2f43').font('Helvetica').fontSize(8).text(cleanInvoiceText(data.guardianContact), col1X, infoTop + 24, { width: col1Width });

  doc.fillColor('#1f5e9a').font('Helvetica-Bold').fontSize(8.5).text('SHIP TO', col2X, infoTop);
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(8.5).text(data.playerName, col2X, infoTop + 12, { width: col2Width });
  doc.fillColor('#1c2f43').font('Helvetica').fontSize(8).text(`Player ID: ${data.playerCode}`, col2X, infoTop + 24, { width: col2Width });
  doc.fillColor('#1c2f43').font('Helvetica').fontSize(8).text(data.academyName, col2X, infoTop + 36, { width: col2Width });

  const metaRows = [
    { label: 'INVOICE #', value: data.invoiceNumber },
    { label: 'INVOICE DATE', value: formatLongDate(data.issueDate) },
    { label: 'P.O.#', value: data.playerCode },
    { label: 'DUE DATE', value: formatLongDate(data.dueDate) }
  ];
  let metaY = infoTop;
  metaRows.forEach((row) => {
    doc.fillColor('#1f5e9a').font('Helvetica-Bold').fontSize(8).text(row.label, col3X, metaY, {
      width: metaLabelWidth
    });
    doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(8).text(row.value, col3X + metaLabelWidth, metaY, {
      width: metaValueWidth,
      align: 'right'
    });
    metaY += 16;
  });

  const tableTop = infoTop + 96;
  const qtyWidth = 44;
  const unitWidth = 94;
  const amountWidth = 94;
  const descWidth = contentWidth - qtyWidth - unitWidth - amountWidth;

  doc
    .save()
    .moveTo(contentLeft, tableTop - 2)
    .lineTo(contentLeft + contentWidth, tableTop - 2)
    .strokeColor('#91aecb')
    .lineWidth(0.8)
    .stroke()
    .restore();
  doc
    .fillColor('#1f5e9a')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('QTY', contentLeft + 2, tableTop + 2, { width: qtyWidth - 4, align: 'center' });
  doc.fillColor('#1f5e9a').text('DESCRIPTION', contentLeft + qtyWidth + 4, tableTop + 2, {
    width: descWidth - 8
  });
  doc.fillColor('#1f5e9a').text('UNIT PRICE', contentLeft + qtyWidth + descWidth, tableTop + 2, {
    width: unitWidth - 8,
    align: 'right'
  });
  doc.fillColor('#1f5e9a').text('AMOUNT', contentLeft + qtyWidth + descWidth + unitWidth, tableTop + 2, {
    width: amountWidth - 2,
    align: 'right'
  });
  doc
    .save()
    .moveTo(contentLeft, tableTop + 14)
    .lineTo(contentLeft + contentWidth, tableTop + 14)
    .strokeColor('#91aecb')
    .lineWidth(0.8)
    .stroke()
    .restore();

  let rowY = tableTop + 18;
  const rowHeight = 16;
  const maxRowsBottom = bottom - 248;
  const renderableItems: LineItem[] = [];
  for (const item of data.items) {
    if (rowY + rowHeight > maxRowsBottom) {
      break;
    }
    renderableItems.push(item);
    rowY += rowHeight;
  }
  const truncated = data.items.length > renderableItems.length;
  rowY = tableTop + 18;
  renderableItems.forEach((item, idx) => {
    const description = cleanInvoiceText(item.description, '-');
    doc.fillColor('#0f2338').font('Helvetica').fontSize(8).text(String(item.quantity), contentLeft + 2, rowY + 3, {
      width: qtyWidth - 4,
      align: 'center'
    });
    doc.fillColor('#0f2338').text(description, contentLeft + qtyWidth + 4, rowY + 3, {
      width: descWidth - 8,
      ellipsis: true
    });
    doc.fillColor('#0f2338').text(item.unitAmount.toFixed(2), contentLeft + qtyWidth + descWidth, rowY + 3, {
      width: unitWidth - 8,
      align: 'right'
    });
    doc.fillColor('#0f2338').text(item.lineTotal.toFixed(2), contentLeft + qtyWidth + descWidth + unitWidth, rowY + 3, {
      width: amountWidth - 2,
      align: 'right'
    });
    if (idx < renderableItems.length - 1) {
      doc
        .save()
        .moveTo(contentLeft, rowY + rowHeight)
        .lineTo(contentLeft + contentWidth, rowY + rowHeight)
        .strokeColor('#d4dfeb')
        .lineWidth(0.5)
        .stroke()
        .restore();
    }
    rowY += rowHeight;
  });
  if (truncated) {
    doc
      .fillColor('#4d5f71')
      .font('Helvetica-Oblique')
      .fontSize(7.5)
      .text(`... ${data.items.length - renderableItems.length} more item(s)`, contentLeft + qtyWidth + 4, rowY + 1, {
        width: descWidth - 8
      });
    rowY += 10;
  }

  const totalsTop = rowY + 10;
  const totalsWidth = 190;
  const totalsX = contentLeft + contentWidth - totalsWidth;
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(8.5).text('Subtotal', totalsX + 16, totalsTop, { width: 74 });
  doc.fillColor('#0f2338').font('Helvetica').fontSize(8.5).text(data.subtotalAmount.toFixed(2), totalsX + 88, totalsTop, {
    width: 94,
    align: 'right'
  });
  doc
    .save()
    .moveTo(totalsX + 16, totalsTop + 13)
    .lineTo(totalsX + totalsWidth - 8, totalsTop + 13)
    .strokeColor('#b9cadb')
    .lineWidth(0.7)
    .stroke()
    .restore();
  doc.fillColor('#1a4f86').font('Helvetica-Bold').fontSize(11).text('TOTAL', totalsX + 16, totalsTop + 17, { width: 74 });
  doc.fillColor('#1a4f86').font('Helvetica-Bold').fontSize(12).text(money(data.totalAmount, data.currency), totalsX + 88, totalsTop + 16, {
    width: 94,
    align: 'right'
  });

  const signatureY = totalsTop + 58;
  doc
    .fillColor('#12243b')
    .font('Helvetica-Oblique')
    .fontSize(26)
    .text('Dynaverse FA', totalsX - 8, signatureY, { width: 204, align: 'right' });

  const termsTop = Math.min(Math.max(signatureY + 66, rowY + 34), bottom - 120);
  doc.fillColor('#1f5e9a').font('Helvetica-Bold').fontSize(8).text('TERMS & CONDITIONS', contentLeft, termsTop);
  doc.fillColor('#0f2338').font('Helvetica').fontSize(7.5).text('Payment is due within 7 days.', contentLeft, termsTop + 12);
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(7.5).text('Name of Bank', contentLeft, termsTop + 30);
  doc.fillColor('#0f2338').font('Helvetica').fontSize(7.5).text(data.bankName, contentLeft + 74, termsTop + 30);
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(7.5).text('Account Name', contentLeft, termsTop + 42);
  doc.fillColor('#0f2338').font('Helvetica').fontSize(7.5).text(data.bankAccountName, contentLeft + 74, termsTop + 42);
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(7.5).text('Account #', contentLeft, termsTop + 54);
  doc.fillColor('#0f2338').font('Helvetica').fontSize(7.5).text(data.bankAccountNumber, contentLeft + 74, termsTop + 54);
  doc.fillColor('#0f2338').font('Helvetica-Bold').fontSize(7.5).text('Reference', contentLeft, termsTop + 66);
  doc.fillColor('#0f2338').font('Helvetica').fontSize(7.5).text(data.paymentReference, contentLeft + 74, termsTop + 66);
  doc.fillColor('#5a6e82').font('Helvetica').fontSize(7).text(`Issued By: ${data.issuedBy}`, contentLeft, termsTop + 82);

  doc.y = bottom;
}

export async function buildInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return renderPdf((doc) => {
    drawTemplateInvoice(doc, data);
  });
}

export async function buildReceiptPdf(data: ReceiptDocumentData): Promise<Buffer> {
  return renderPdf((doc) => {
    drawBrandHeader(doc, {
      academyName: data.academyName,
      subtitle: data.academyTagline,
      documentTitle: 'RECEIPT',
      documentNumberLabel: 'Receipt Number',
      documentNumber: data.receiptNumber,
      issueDateLabel: 'Receipt Date',
      issueDate: data.receiptDate,
      status: data.status
    });

    drawDetailCard(doc, 'PLAYER DETAILS', [
      { label: 'Player Name', value: data.playerName },
      { label: 'Player ID', value: data.playerCode },
      { label: 'Academy Program', value: data.academyProgram }
    ]);

    drawDetailCard(doc, 'PAYMENT DETAILS', [
      { label: 'Payment Method', value: data.paymentMethod.toUpperCase() },
      { label: 'Payment Reference', value: data.paymentReference ?? '-' },
      { label: 'Payment Amount', value: money(data.paymentAmount, data.currency) }
    ]);

    const appliedLines = data.appliedTo.length > 0 ? data.appliedTo : ['Invoice(s) Settled Successfully'];
    const appliedAsText = appliedLines.map((line) => `- ${line}`).join('\n');
    drawDetailCard(doc, 'APPLIED TO', [{ label: 'Items', value: appliedAsText }]);

    drawDetailCard(doc, 'SUMMARY', [
      { label: 'Total Paid', value: money(data.totalPaid, data.currency) },
      { label: 'Balance Due', value: money(data.balanceDue, data.currency) },
      { label: 'Issued By', value: data.issuedBy },
      { label: 'Generated On', value: formatLongDate(data.generatedOn) }
    ]);

    drawFooterBand(doc, `Contact: ${data.contactEmail} | ${data.contactPhone}`);
  });
}
