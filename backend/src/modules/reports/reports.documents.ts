import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const COLORS = {
  page: '#f6f7fb',
  panel: '#ffffff',
  panelSoft: '#f3f5fb',
  line: '#d7dce8',
  navy: '#112a55',
  navySoft: '#254577',
  gold: '#b6822a',
  text: '#1f2530',
  muted: '#5b6678',
  success: '#2b6f45'
} as const;

const TYPE = {
  headerBrand: 31,
  headerSubBrand: 13,
  reportTitle: 15,
  meta: 10.2,
  sectionHeading: 12.4,
  cardTitle: 10.8,
  cardLabel: 9.8,
  cardValue: 10.8,
  tableTitle: 10.8,
  tableHeader: 8.9,
  tableBody: 8.9,
  tableTotalLabel: 10,
  tableTotalValue: 11.2,
  overviewBalance: 10.4,
  overviewExplanation: 9.3,
  closingStatement: 9.2,
  footer: 9.2
} as const;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = resolveLogoPath();

type ReportPdfData = {
  academyName: string;
  divisionLine: string;
  periodFrom: string;
  periodTo: string;
  generatedOn: string;
  overview: {
    openingBalance: number;
    playerFeesCollected: number;
    donationsReceived: number;
    totalFundsAvailable: number;
    coachingSalaries: number;
    trainingEquipment: number;
    administration: number;
    totalExpenditure: number;
    closingBalance: number;
    explanation: string;
  };
  incomeBreakdown: Array<{
    date: string;
    source: string;
    description: string;
    amount: number;
    currency: string;
  }>;
  expenditureBreakdown: Array<{
    date: string;
    category: string;
    description: string;
    amount: number;
    currency: string;
  }>;
  budgetAllocation: Array<{
    category: string;
    amount: number;
    percentage: number;
  }>;
  accountability: Array<{
    transaction: string;
    proof: string;
    status: string;
  }>;
  closingStatement: string;
  contactEmail: string;
  contactPhone: string;
};

type MetricRow = {
  label: string;
  value: string;
  highlight?: boolean;
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
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function money(amount: number, currency = 'NAD'): string {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function longDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function drawRoundedPanel(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, fill: string = COLORS.panel): void {
  doc
    .save()
    .roundedRect(x, y, w, h, 8)
    .fillAndStroke(fill, COLORS.line)
    .restore();
}

function drawSectionHeading(doc: PDFKit.PDFDocument, x: number, y: number, text: string): void {
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(TYPE.sectionHeading).text(text, x, y);
}

function drawHeader(doc: PDFKit.PDFDocument, data: ReportPdfData, x: number, y: number, w: number): void {
  drawRoundedPanel(doc, x, y, w, 162, COLORS.panel);

  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, x + 14, y + 18, { fit: [88, 88] });
    } catch {
      // Continue without logo.
    }
  }

  doc
    .fillColor(COLORS.navy)
    .font('Helvetica-Bold')
    .fontSize(TYPE.headerBrand)
    .text('DYNAVERSE', x + 112, y + 28, { width: 300, ellipsis: true });
  doc
    .fillColor(COLORS.gold)
    .font('Helvetica-Bold')
    .fontSize(TYPE.headerSubBrand)
    .text('FOOTBALL ACADEMY', x + 114, y + 70, { width: 260, ellipsis: true });

  doc
    .fillColor(COLORS.navy)
    .font('Helvetica-Bold')
    .fontSize(TYPE.reportTitle)
    .text('FINANCIAL TRANSPARENCY REPORT', x + 14, y + 108, { width: w - 28 });

  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(TYPE.meta)
    .text('Period:', x + 14, y + 132)
    .font('Helvetica')
    .text(`${longDate(data.periodFrom)} - ${longDate(data.periodTo)}`, x + 56, y + 132)
    .font('Helvetica-Bold')
    .text('Generated:', x + 14, y + 149)
    .font('Helvetica')
    .text(longDate(data.generatedOn), x + 71, y + 149);

  doc
    .save()
    .moveTo(x, y + 168)
    .lineTo(x + w, y + 168)
    .lineWidth(2)
    .strokeColor('#7f8cad')
    .stroke()
    .restore();
}

function drawMetricCard(doc: PDFKit.PDFDocument, x: number, y: number, w: number, title: string, rows: MetricRow[]): void {
  const rowH = 20;
  const cardH = 24 + rows.length * rowH;
  drawRoundedPanel(doc, x, y, w, cardH, COLORS.panelSoft);
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(TYPE.cardTitle).text(title, x + 10, y + 7);

  let rowY = y + 24;
  rows.forEach((row, idx) => {
    if (idx > 0) {
      doc
        .save()
        .moveTo(x + 8, rowY)
        .lineTo(x + w - 8, rowY)
        .lineWidth(0.8)
        .strokeColor(COLORS.line)
        .stroke()
        .restore();
    }
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(TYPE.cardLabel).text(row.label, x + 10, rowY + 6, { width: w * 0.58 });
    doc
      .fillColor(row.highlight ? COLORS.gold : COLORS.navy)
      .font('Helvetica-Bold')
      .fontSize(TYPE.cardValue)
      .text(row.value, x + w * 0.58, rowY + 5, { width: w * 0.42 - 10, align: 'right' });
    rowY += rowH;
  });
}

function drawMiniTable(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  title: string,
  columns: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center' }>,
  rows: string[][],
  totalLabel: string,
  totalValue: string
): number {
  const titleH = 18;
  const headH = 16;
  const rowH = 16;
  const totalH = 20;
  const boxH = titleH + headH + rows.length * rowH + totalH + 8;
  drawRoundedPanel(doc, x, y, w, boxH, COLORS.panel);

  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(TYPE.tableTitle).text(title, x + 10, y + 4);

  const headY = y + titleH;
  doc
    .save()
    .rect(x + 1, headY, w - 2, headH)
    .fillAndStroke('#edf1f9', COLORS.line)
    .restore();

  let currentX = x;
  columns.forEach((col) => {
    doc
      .fillColor(COLORS.navy)
      .font('Helvetica-Bold')
      .fontSize(TYPE.tableHeader)
      .text(col.label, currentX + 6, headY + 4, {
        width: col.width - 12,
        align: col.align ?? 'left',
        lineBreak: false,
        ellipsis: true
      });
    currentX += col.width;
  });

  let rowY = headY + headH;
  rows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      doc
        .save()
        .rect(x + 1, rowY, w - 2, rowH)
        .fillAndStroke('#fafcff', COLORS.line)
        .restore();
    }
    let colX = x;
    row.forEach((value, i) => {
      const col = columns[i];
      doc
        .fillColor(COLORS.text)
        .font('Helvetica')
        .fontSize(TYPE.tableBody)
        .text(value, colX + 6, rowY + 4, {
          width: col.width - 12,
          align: col.align ?? 'left',
          lineBreak: false,
          ellipsis: true
        });
      colX += col.width;
    });
    rowY += rowH;
  });

  doc
    .save()
    .rect(x + 1, rowY, w - 2, totalH)
    .fillAndStroke('#eff3f9', COLORS.line)
    .restore();
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(TYPE.tableTotalLabel).text(totalLabel, x + 10, rowY + 5, { width: w * 0.58 });
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(TYPE.tableTotalValue).text(totalValue, x + w * 0.58, rowY + 3, { width: w * 0.42 - 10, align: 'right' });

  return boxH;
}

function drawBudgetTable(doc: PDFKit.PDFDocument, x: number, y: number, w: number, rows: Array<{ category: string; amount: number; percentage: number }>): number {
  const limited = rows.slice(0, 3);
  const tableRows = limited.map((row) => [row.category, money(row.amount), `${row.percentage.toFixed(1)}%`]);
  const h = drawMiniTable(
    doc,
    x,
    y,
    w,
    'BUDGET ALLOCATION VIEW',
    [
      { label: 'Category', width: w * 0.5 },
      { label: 'Amount', width: w * 0.3, align: 'right' },
      { label: 'Percentage', width: w * 0.2, align: 'right' }
    ],
    tableRows.length ? tableRows : [['No category', money(0), '0%']],
      'Total Expenditure',
      money(limited.reduce((sum, row) => sum + row.amount, 0))
  );
  return h;
}

function drawFooter(doc: PDFKit.PDFDocument, data: ReportPdfData, x: number, y: number, w: number): void {
  doc
    .save()
    .rect(x, y, w, 22)
    .fill(COLORS.navy)
    .restore();
  doc
    .fillColor('#ffffff')
    .font('Helvetica')
    .fontSize(TYPE.footer)
    .text(`${data.contactPhone} | ${data.contactEmail} | www.dynaverseinvestment.com`, x + 4, y + 6, {
      width: w - 8,
      align: 'center'
    });
}

export async function buildFinancialTransparencyPdfDocument(data: ReportPdfData): Promise<Buffer> {
  return renderPdf((doc) => {
    const marginX = 32;
    const width = 595.28 - marginX * 2;
    doc.rect(0, 0, 595.28, 841.89).fill(COLORS.page);

    drawHeader(doc, data, marginX, 28, width);

    drawSectionHeading(doc, marginX, 206, '1) FINANCIAL OVERVIEW');
    const colGap = 12;
    const colW = (width - colGap) / 2;

    drawMetricCard(doc, marginX, 226, colW, 'INFLOWS', [
      { label: 'Opening Balance', value: money(data.overview.openingBalance) },
      { label: 'Player Fees Collected', value: money(data.overview.playerFeesCollected) },
      { label: 'Donations Received', value: money(data.overview.donationsReceived) },
      { label: 'Total Funds Available', value: money(data.overview.totalFundsAvailable), highlight: true }
    ]);

    drawMetricCard(doc, marginX + colW + colGap, 226, colW, 'EXPENDITURE', [
      { label: 'Coaching Salaries', value: money(data.overview.coachingSalaries) },
      { label: 'Training Equipment', value: money(data.overview.trainingEquipment) },
      { label: 'Administration', value: money(data.overview.administration) },
      { label: 'Total Expenditure', value: money(data.overview.totalExpenditure), highlight: true }
    ]);

    doc
      .fillColor(COLORS.navy)
      .font('Helvetica-Bold')
      .fontSize(TYPE.overviewBalance)
      .text(`Closing Balance: ${money(data.overview.closingBalance)}`, marginX, 350);
    doc
      .fillColor(COLORS.text)
      .font('Helvetica')
      .fontSize(TYPE.overviewExplanation)
      .text(`Explanation: ${data.overview.explanation}`, marginX, 366, { width });

    drawSectionHeading(doc, marginX, 392, '2) INCOME BREAKDOWN');
    drawSectionHeading(doc, marginX + colW + colGap, 392, '3) EXPENDITURE BREAKDOWN');

    const incomeRows = data.incomeBreakdown.slice(0, 3).map((row) => [
      shortDate(row.date),
      row.source,
      money(row.amount, row.currency)
    ]);
    const expenseRows = data.expenditureBreakdown.slice(0, 3).map((row) => [
      shortDate(row.date),
      row.category.replaceAll('_', ' '),
      money(row.amount, row.currency)
    ]);
    const totalIncome = data.incomeBreakdown.reduce((sum, row) => sum + row.amount, 0);
    const totalExpense = data.expenditureBreakdown.reduce((sum, row) => sum + row.amount, 0);
    const breakdownDateCol = 78;
    const breakdownAmountCol = 84;
    const breakdownTextCol = colW - breakdownDateCol - breakdownAmountCol;

    drawMiniTable(
      doc,
      marginX,
      410,
      colW,
      'Income',
      [
        { label: 'Date', width: breakdownDateCol },
        { label: 'Source', width: breakdownTextCol },
        { label: 'Amount', width: breakdownAmountCol, align: 'right' }
      ],
      incomeRows.length ? incomeRows : [['-', 'No income rows', money(0)]],
      'Total Income',
      money(totalIncome)
    );

    drawMiniTable(
      doc,
      marginX + colW + colGap,
      410,
      colW,
      'Expenditure',
      [
        { label: 'Date', width: breakdownDateCol },
        { label: 'Category', width: breakdownTextCol },
        { label: 'Amount', width: breakdownAmountCol, align: 'right' }
      ],
      expenseRows.length ? expenseRows : [['-', 'No expenditure rows', money(0)]],
      'Total Expenditure',
      money(totalExpense)
    );

    drawSectionHeading(doc, marginX, 530, '4) BUDGET ALLOCATION VIEW');
    drawBudgetTable(doc, marginX, 548, width, data.budgetAllocation);

    drawSectionHeading(doc, marginX, 664, '5) CLOSING STATEMENT');
    doc
      .fillColor(COLORS.text)
      .font('Helvetica')
      .fontSize(TYPE.closingStatement)
      .text(data.closingStatement, marginX, 684, { width });

    drawFooter(doc, data, marginX, 818, width);
  });
}
